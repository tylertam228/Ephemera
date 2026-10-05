import { createPublicKey } from "node:crypto";
import { newId } from "./db.mjs";
import { log as writeLog } from "./log.mjs";
import { sessionUser } from "./session.mjs";

const maxBody = 4096;

export async function handleDevice(req, res, { db, log = writeLog }) {
  const user = sessionUser(req, db);
  if (!user) {
    json(res, 401, {});
    return;
  }
  if (req.method === "GET") {
    json(
      res,
      200,
      db
        .prepare(
          "SELECT id, name, created_at AS createdAt FROM devices WHERE user_id = ? ORDER BY created_at",
        )
        .all(user.id),
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
    "INSERT INTO devices (id, user_id, name, public_key, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(id, user.id, name, publicKey, Date.now());
  log("info", "device_registered", { user: user.id, device: id });
  json(res, 201, { id, name });
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
