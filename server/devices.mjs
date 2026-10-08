import { createPublicKey } from "node:crypto";
import { rm } from "node:fs/promises";
import { blobPath, newId } from "./db.mjs";
import { log as writeLog } from "./log.mjs";
import { sessionUser } from "./session.mjs";

const maxBody = 4096;

export async function handleDevice(req, res, { db, dataDir, log = writeLog }) {
  const user = sessionUser(req, db);
  if (!user) {
    json(res, 401, {});
    return;
  }
  const url = new URL(req.url ?? "/", "http://localhost");
  const item = url.pathname.match(/^\/api\/devices\/([0-9a-f]{32})$/);
  if (item) {
    await manageDevice(req, res, { db, dataDir, user, id: item[1], log });
    return;
  }
  if (req.method === "GET") {
    const except = url.searchParams.get("except") ?? "";
    const rows = db
      .prepare(
        `SELECT id, name, public_key AS publicKey, created_at AS createdAt,
                COALESCE(disabled, 0) AS disabled
         FROM devices WHERE user_id = ? ORDER BY created_at`,
      )
      .all(user.id)
      .map((row) => ({
        id: row.id,
        name: row.name,
        publicKey: row.publicKey,
        createdAt: row.createdAt,
        disabled: Boolean(row.disabled),
      }));
    json(
      res,
      200,
      rows.filter((row) => row.id !== except && (!except || !row.disabled)),
    );
    return;
  }
  if (req.method !== "POST") {
    res.writeHead(405, { allow: "GET, POST", "content-type": "text/plain; charset=utf-8" });
    res.end("method");
    return;
  }
  let text;
  try {
    text = await readBody(req);
  } catch {
    json(res, 413, {});
    return;
  }
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    json(res, 400, {});
    return;
  }
  const name = cleanName(body?.name);
  const publicKey = p256(body?.publicKey);
  if (!name || !publicKey) {
    json(res, 400, {});
    return;
  }
  const existing = db
    .prepare("SELECT id, name FROM devices WHERE user_id = ? AND public_key = ?")
    .get(user.id, publicKey);
  if (existing) {
    json(res, 200, { id: existing.id, name: existing.name });
    return;
  }
  const id = newId();
  db.prepare(
    "INSERT INTO devices (id, user_id, name, public_key, created_at, disabled) VALUES (?, ?, ?, ?, ?, 0)",
  ).run(id, user.id, name, publicKey, Date.now());
  log("info", "device_registered", { user: user.id, device: id });
  json(res, 201, { id, name });
}

async function manageDevice(req, res, { db, dataDir, user, id, log }) {
  const row = db.prepare("SELECT id FROM devices WHERE id = ? AND user_id = ?").get(id, user.id);
  if (!row) {
    json(res, 404, {});
    return;
  }
  if (req.method === "PATCH") {
    let text;
    try {
      text = await readBody(req);
    } catch {
      json(res, 413, {});
      return;
    }
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      json(res, 400, {});
      return;
    }
    const hasName = Object.prototype.hasOwnProperty.call(body, "name");
    const hasDisabled = Object.prototype.hasOwnProperty.call(body, "disabled");
    if (!hasName && !hasDisabled) {
      json(res, 400, {});
      return;
    }
    let name;
    if (hasName) {
      name = cleanName(body.name);
      if (!name) {
        json(res, 400, {});
        return;
      }
    }
    if (hasDisabled && typeof body.disabled !== "boolean") {
      json(res, 400, {});
      return;
    }
    if (hasName) {
      db.prepare("UPDATE devices SET name = ? WHERE id = ? AND user_id = ?").run(name, id, user.id);
    }
    if (hasDisabled) {
      db.prepare("UPDATE devices SET disabled = ? WHERE id = ? AND user_id = ?").run(
        body.disabled ? 1 : 0,
        id,
        user.id,
      );
    }
    const saved = db
      .prepare(
        `SELECT id, name, COALESCE(disabled, 0) AS disabled FROM devices WHERE id = ? AND user_id = ?`,
      )
      .get(id, user.id);
    log("info", "device_updated", { user: user.id, device: id });
    json(res, 200, { id: saved.id, name: saved.name, disabled: Boolean(saved.disabled) });
    return;
  }
  if (req.method === "DELETE") {
    const orphaned = db.transaction(() => {
      db.prepare("UPDATE drops SET sender_device_id = NULL WHERE sender_device_id = ?").run(id);
      const dropIds = db
        .prepare("SELECT drop_id AS id FROM drop_keys WHERE device_id = ?")
        .all(id)
        .map((item) => item.id);
      db.prepare("DELETE FROM drop_keys WHERE device_id = ?").run(id);
      const gone = [];
      for (const dropId of dropIds) {
        const left = db.prepare("SELECT COUNT(*) AS n FROM drop_keys WHERE drop_id = ?").get(dropId).n;
        if (left === 0) {
          db.prepare("DELETE FROM drops WHERE id = ? AND user_id = ?").run(dropId, user.id);
          gone.push(dropId);
        }
      }
      db.prepare("DELETE FROM devices WHERE id = ? AND user_id = ?").run(id, user.id);
      return gone;
    })();
    for (const dropId of orphaned) {
      await rm(blobPath(dataDir, dropId), { force: true });
    }
    log("info", "device_removed", { user: user.id, device: id });
    res.writeHead(204);
    res.end();
    return;
  }
  res.writeHead(405, { allow: "PATCH, DELETE", "content-type": "text/plain; charset=utf-8" });
  res.end("method");
}

function cleanName(value) {
  if (typeof value !== "string") return "";
  const name = value.trim();
  if (!name || name.length > 40 || /[\u0000-\u001f]/.test(name)) return "";
  return name;
}

function p256(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return "";
  const der = Buffer.from(value, "base64");
  if (der.length < 80 || der.length > 128 || der.toString("base64") !== value) return "";
  try {
    const key = createPublicKey({ key: der, format: "der", type: "spki" });
    if (key.asymmetricKeyType !== "ec" || key.asymmetricKeyDetails?.namedCurve !== "prime256v1") {
      return "";
    }
  } catch {
    return "";
  }
  return value;
}

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBody) {
        reject(new Error("body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
