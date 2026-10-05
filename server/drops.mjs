import { createReadStream, createWriteStream } from "node:fs";
import { rm, stat } from "node:fs/promises";
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
  const url = new URL(req.url ?? "/", "http://localhost");
  const item = url.pathname.match(/^\/api\/drops\/([0-9a-f]{32})(\/blob)?$/);
  if (item) {
    await openItem(req, res, { db, dataDir, user, id: item[1], blob: Boolean(item[2]), log });
    return;
  }
  if (req.method === "GET") {
    listInbox(req, res, db, user);
    return;
  }
  if (req.method !== "POST") {
    res.writeHead(405, { allow: "GET, POST", "content-type": "text/plain; charset=utf-8" });
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
        "INSERT INTO drops (id, user_id, expires_at, pin_salt, created_at, sender_device_id) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(id, user.id, expiresAt, meta.pinSalt, finishedAt, meta.senderDeviceId);
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

async function openItem(req, res, { db, dataDir, user, id, blob, log }) {
  const device = deviceParam(req);
  if (!device) {
    json(res, 400, {});
    return;
  }
  const row = recipientDrop(db, user.id, device, id);
  if (!row) {
    json(res, 404, {});
    return;
  }
  if (req.method === "GET" && blob) {
    await streamBlob(res, dataDir, id);
    return;
  }
  if (req.method === "GET") {
    json(res, 200, { pinSalt: row.pinSalt, sealedKey: row.sealedKey, expiresAt: row.expiresAt });
    return;
  }
  if (req.method === "DELETE" && !blob) {
    const last = db.transaction(() => {
      db.prepare("DELETE FROM drop_keys WHERE drop_id = ? AND device_id = ?").run(id, device);
      const left = db.prepare("SELECT COUNT(*) AS n FROM drop_keys WHERE drop_id = ?").get(id).n;
      if (left > 0) return false;
      db.prepare("DELETE FROM drops WHERE id = ? AND user_id = ?").run(id, user.id);
      return true;
    })();
    if (last) await rm(blobPath(dataDir, id), { force: true });
    log("info", "drop_claimed", { user: user.id, drop: id });
    res.writeHead(204);
    res.end();
    return;
  }
  res.writeHead(405, { allow: blob ? "GET" : "GET, DELETE", "content-type": "text/plain; charset=utf-8" });
  res.end("method");
}

async function streamBlob(res, dataDir, id) {
  const file = blobPath(dataDir, id);
  try {
    await stat(file);
  } catch {
    json(res, 404, {});
    return;
  }
  const stream = createReadStream(file);
  stream.on("error", () => {
    if (!res.headersSent) json(res, 404, {});
    else res.destroy();
  });
  res.writeHead(200, { "content-type": "application/octet-stream" });
  stream.pipe(res);
}

function recipientDrop(db, userId, device, id) {
  return db
    .prepare(
      `SELECT drops.expires_at AS expiresAt, drops.pin_salt AS pinSalt, drop_keys.sealed_key AS sealedKey
       FROM drops
       JOIN drop_keys ON drop_keys.drop_id = drops.id AND drop_keys.device_id = ?
       JOIN devices ON devices.id = drop_keys.device_id AND devices.user_id = ?
       WHERE drops.id = ? AND drops.user_id = ? AND drops.expires_at > ?`,
    )
    .get(device, userId, id, userId, Date.now());
}

function deviceParam(req) {
  const device = new URL(req.url ?? "/", "http://localhost").searchParams.get("device") ?? "";
  return /^[0-9a-f]{32}$/.test(device) ? device : "";
}

function listInbox(req, res, db, user) {
  const device = deviceParam(req);
  if (!device) {
    json(res, 400, {});
    return;
  }
  const owned = db.prepare("SELECT id FROM devices WHERE id = ? AND user_id = ?").get(device, user.id);
  if (!owned) {
    json(res, 400, {});
    return;
  }
  const rows = db
    .prepare(
      `SELECT drops.id, drops.expires_at AS expiresAt, drops.created_at AS createdAt,
              drops.pin_salt IS NOT NULL AS pin,
              sender.name AS fromDevice, users.username AS fromUser
       FROM drops
       JOIN drop_keys ON drop_keys.drop_id = drops.id AND drop_keys.device_id = ?
       JOIN users ON users.id = drops.user_id
       LEFT JOIN devices AS sender ON sender.id = drops.sender_device_id
       WHERE drops.user_id = ? AND drops.expires_at > ?
       ORDER BY drops.created_at`,
    )
    .all(device, user.id, Date.now());
  json(
    res,
    200,
    rows.map((row) => ({
      id: row.id,
      expiresAt: row.expiresAt,
      createdAt: row.createdAt,
      pin: Boolean(row.pin),
      fromDevice: row.fromDevice,
      fromUser: row.fromUser,
    })),
  );
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
  const senderDeviceId = meta.senderDeviceId;
  if (typeof senderDeviceId !== "string" || !/^[0-9a-f]{32}$/.test(senderDeviceId)) throw bad();
  const sender = db.prepare("SELECT id FROM devices WHERE id = ? AND user_id = ?").get(senderDeviceId, userId);
  if (!sender) throw bad();
  return { keepMs, expiresAt, pinSalt, keys, senderDeviceId };
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
