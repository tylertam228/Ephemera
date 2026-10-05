import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { finished } from "node:stream/promises";
import { blobPath, newId } from "./db.mjs";
import { log as writeLog } from "./log.mjs";
import { sessionUser } from "./session.mjs";

const maxJson = 65536;

export async function handleDrop(req, res, { db, config, dataDir, log = writeLog }) {
  const user = sessionUser(req, db);
  if (!user) {
    json(res, 401, {});
    return;
  }
  if (req.method !== "POST") {
    res.writeHead(405, { allow: "POST", "content-type": "text/plain; charset=utf-8" });
    res.end("method");
    return;
  }
  const id = newId();
  const file = blobPath(dataDir, id);
  let opened = false;
  let committed = false;
  let meta = null;
  try {
    const accepted = await acceptBody(req, file, config.maxUploadMb * 1024 * 1024, () => {
      opened = true;
    }, (parsed) => {
      meta = checkMeta(db, user.id, parsed);
    });
    if (!meta || !accepted.size) throw bad();
    const finishedAt = Date.now();
    if (meta.keepMs != null && meta.keepMs > Number.MAX_SAFE_INTEGER - finishedAt) throw bad();
    const expiresAt = meta.keepMs != null ? finishedAt + meta.keepMs : meta.expiresAt;
    if (expiresAt <= finishedAt) throw bad();
    db.transaction(() => {
      db.prepare(
        "INSERT INTO drops (id, user_id, expires_at, pin_salt, created_at) VALUES (?, ?, ?, ?, ?)",
      ).run(id, user.id, expiresAt, meta.pinSalt, finishedAt);
      const insertKey = db.prepare(
        "INSERT INTO drop_keys (drop_id, device_id, sealed_key) VALUES (?, ?, ?)",
      );
      for (const key of meta.keys) insertKey.run(id, key.deviceId, key.sealedKey);
    })();
    committed = true;
    log("info", "drop_stored", { user: user.id, drop: id, bytes: accepted.size });
    json(res, 201, { id, expiresAt });
  } catch (err) {
    if (opened && !committed) await rm(file, { force: true });
    if (res.destroyed || res.writableEnded) return;
    json(res, err?.code === "cap" ? 413 : err?.code === "bad" ? 400 : 500, {});
    if (err?.code !== "cap" && err?.code !== "bad") {
      log("error", "request_failed", { err: err instanceof Error ? err.message : "request failed" });
    }
  }
}

function checkMeta(db, userId, meta) {
  if (!meta || typeof meta !== "object") throw bad();
  const hasKeep = meta.keepMs != null;
  const hasAt = meta.expiresAt != null;
  if (hasKeep === hasAt) throw bad();
  const keepMs = hasKeep ? integer(meta.keepMs) : null;
  const expiresAt = hasAt ? integer(meta.expiresAt) : null;
  if (hasKeep && (keepMs == null || keepMs < 1)) throw bad();
  if (hasAt && expiresAt == null) throw bad();
  const pinSalt = meta.pinSalt == null ? null : salt(meta.pinSalt);
  if (meta.pinSalt != null && !pinSalt) throw bad();
  if (!Array.isArray(meta.keys) || meta.keys.length < 1 || meta.keys.length > 32) throw bad();
  const keys = meta.keys.map((key) => {
    if (!key || typeof key.deviceId !== "string" || !/^[0-9a-f]{32}$/.test(key.deviceId)) throw bad();
    if (!canonical(key.sealedKey, 100, 2048)) throw bad();
    return { deviceId: key.deviceId, sealedKey: key.sealedKey };
  });
  if (new Set(keys.map((key) => key.deviceId)).size !== keys.length) throw bad();
  const rows = db
    .prepare(
      `SELECT id FROM devices WHERE user_id = ? AND id IN (${keys.map(() => "?").join(",")})`,
    )
    .all(userId, ...keys.map((key) => key.deviceId));
  if (rows.length !== keys.length) throw bad();
  return { keepMs, expiresAt, pinSalt, keys };
}

async function acceptBody(req, file, maxBytes, onOpen, onMeta) {
  const out = createWriteStream(file);
  onOpen();
  let header = Buffer.alloc(0);
  let declared = null;
  let seenMeta = false;
  let size = 0;
  try {
    for await (const chunk of req) {
      let buf = chunk;
      if (!seenMeta) {
        const take = takeHeader(header, buf, declared);
        header = take.header;
        buf = take.rest;
        declared = take.declared;
        if (declared == null || header.length < 4 + declared) continue;
        const parsed = JSON.parse(header.subarray(4, 4 + declared).toString("utf8"));
        onMeta(parsed);
        seenMeta = true;
        header = Buffer.alloc(0);
        if (!buf.length) continue;
      }
      size += buf.length;
      if (size > maxBytes) throw cap();
      if (!out.write(buf)) await new Promise((resolve) => out.once("drain", resolve));
    }
    out.end();
    await finished(out);
  } catch (err) {
    out.destroy();
    req.destroy();
    await finished(out).catch(() => {});
    throw err?.code ? err : bad();
  }
  if (!seenMeta) throw bad();
  return { size };
}

function takeHeader(header, buf, declared) {
  let rest = buf;
  let nextHeader = header;
  let nextDeclared = declared;
  const pull = () => {
    const want = (nextDeclared == null ? 4 : 4 + nextDeclared) - nextHeader.length;
    if (want <= 0 || !rest.length) return;
    const bite = rest.subarray(0, want);
    rest = rest.subarray(bite.length);
    nextHeader = Buffer.concat([nextHeader, bite]);
  };
  pull();
  if (nextDeclared == null && nextHeader.length >= 4) {
    nextDeclared = nextHeader.readUInt32BE(0);
    if (nextDeclared < 2 || nextDeclared > maxJson) throw bad();
    pull();
  }
  return { header: nextHeader, rest, declared: nextDeclared };
}

function salt(value) {
  const buf = canonical(value, 24, 24);
  return buf?.length === 16 ? value : "";
}

function canonical(value, min, max) {
  if (typeof value !== "string" || value.length < min || value.length > max) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  const buf = Buffer.from(value, "base64");
  if (!buf.length || buf.toString("base64") !== value) return null;
  return buf;
}

function integer(value) {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function bad() {
  return Object.assign(new Error("bad drop"), { code: "bad" });
}

function cap() {
  return Object.assign(new Error("too large"), { code: "cap" });
}

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}
