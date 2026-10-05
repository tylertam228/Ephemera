import assert from "node:assert/strict";
import { randomBytes, webcrypto } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { createServer, request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { test } from "node:test";
import { encodePrefix, openDrop, prepareDrop } from "../web/src/drop.mjs";
import { handleAuth } from "./auth.mjs";
import { hashToken, openDb } from "./db.mjs";
import { logfmt } from "./log.mjs";

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const config = {
  discordClientId: "client-id",
  discordClientSecret: "client-secret",
  discordPublicKey: "unused",
  authUrl: "http://localhost:3000",
  maxUploadMb: 1,
};

function send(port, method, path, { cookie, body, raw } = {}) {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        hostname: "127.0.0.1",
        port,
        path,
        method,
        headers: {
          ...(cookie ? { cookie } : {}),
          ...(body ? { "content-type": "application/octet-stream", "content-length": body.length } : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const buf = Buffer.concat(chunks);
          resolve({ status: res.statusCode, body: raw ? buf : buf.toString() });
        });
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

test("an upload stores ciphertext and starts the timer when it finishes", async () => {
  const pair = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const publicKey = Buffer.from(await crypto.subtle.exportKey("spki", pair.publicKey)).toString("base64");
  const deviceId = "a".repeat(32);
  const prepared = await prepareDrop({
    recipients: [{ id: deviceId, publicKey }],
    texts: ["hello secret"],
    files: [{ name: "note.txt", type: "text/plain", bytes: new Uint8Array([9, 8, 7]) }],
  });
  const frames = [];
  for await (const frame of prepared.frames) frames.push(Buffer.from(frame));
  const cipher = Buffer.concat(frames);
  assert.equal(cipher.includes("hello secret"), false);
  assert.equal(cipher.includes("note.txt"), false);
  const meta = { keepMs: 60_000, pinSalt: prepared.pinSalt, keys: prepared.keys, senderDeviceId: deviceId };
  const body = Buffer.concat([Buffer.from(encodePrefix(meta)), cipher]);

  const dir = await mkdtemp(join(tmpdir(), "eph-drop-"));
  const db = openDb(dir);
  const now = Date.now();
  const token = randomBytes(32).toString("base64url");
  db.prepare("INSERT INTO users (id, username, created_at) VALUES (?, ?, ?)").run("42", "ada", now);
  db.prepare("INSERT INTO users (id, username, created_at) VALUES (?, ?, ?)").run("7", "bob", now);
  db.prepare("INSERT INTO devices (id, user_id, name, public_key, created_at) VALUES (?, ?, ?, ?, ?)").run(
    deviceId,
    "42",
    "phone",
    publicKey,
    now,
  );
  db.prepare("INSERT INTO devices (id, user_id, name, public_key, created_at) VALUES (?, ?, ?, ?, ?)").run(
    "b".repeat(32),
    "7",
    "bob-phone",
    publicKey,
    now,
  );
  db.prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)").run(
    hashToken(token),
    "42",
    now + 60_000,
    now,
  );
  const lines = [];
  const server = createServer((req, res) => {
    handleAuth(req, res, {
      config,
      db,
      dataDir: dir,
      fetch,
      log: (level, msg, fields) => lines.push(logfmt(level, msg, fields)),
    }).catch((err) => {
      console.error(err instanceof Error ? err.message : "request failed");
      if (!res.headersSent) res.writeHead(500).end();
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  const cookie = `session=${token}`;
  try {
    const anon = await send(port, "POST", "/api/drops", { body });
    assert.equal(anon.status, 401);

    const before = Date.now();
    const created = await send(port, "POST", "/api/drops", { cookie, body });
    const after = Date.now();
    assert.equal(created.status, 201);
    const saved = JSON.parse(created.body);
    assert.equal(saved.id.length, 32);
    assert.ok(saved.expiresAt >= before + 60_000 && saved.expiresAt <= after + 60_000);
    const row = db.prepare("SELECT pin_salt FROM drops WHERE id = ?").get(saved.id);
    assert.equal(row.pin_salt, null);
    const stored = await readFile(join(dir, "blobs", saved.id));
    assert.deepEqual(stored, cipher);
    const opened = await openDrop({
      privateKey: pair.privateKey,
      pinSalt: null,
      sealedKey: prepared.keys[0].sealedKey,
      bytes: new Uint8Array(stored),
    });
    assert.deepEqual(opened.texts, ["hello secret"]);
    assert.equal(opened.files[0].name, "note.txt");

    const foreign = Buffer.concat([
      Buffer.from(encodePrefix({ keepMs: 60_000, pinSalt: null, keys: [{ deviceId: "b".repeat(32), sealedKey: prepared.keys[0].sealedKey }], senderDeviceId: deviceId })),
      cipher,
    ]);
    assert.equal((await send(port, "POST", "/api/drops", { cookie, body: foreign })).status, 400);

    const strangerSender = Buffer.concat([
      Buffer.from(encodePrefix({ ...meta, senderDeviceId: "b".repeat(32) })),
      cipher,
    ]);
    assert.equal((await send(port, "POST", "/api/drops", { cookie, body: strangerSender })).status, 400);

    const { senderDeviceId: _omitted, ...withoutSender } = meta;
    const anonymous = Buffer.concat([Buffer.from(encodePrefix(withoutSender)), cipher]);
    assert.equal((await send(port, "POST", "/api/drops", { cookie, body: anonymous })).status, 400);

    const past = Buffer.concat([
      Buffer.from(encodePrefix({ expiresAt: 1, pinSalt: null, keys: prepared.keys, senderDeviceId: deviceId })),
      cipher,
    ]);
    assert.equal((await send(port, "POST", "/api/drops", { cookie, body: past })).status, 400);

    const both = Buffer.concat([
      Buffer.from(encodePrefix({ keepMs: 60_000, expiresAt: Date.now() + 60_000, pinSalt: null, keys: prepared.keys, senderDeviceId: deviceId })),
      cipher,
    ]);
    assert.equal((await send(port, "POST", "/api/drops", { cookie, body: both })).status, 400);

    const huge = Buffer.concat([Buffer.from(encodePrefix(meta)), Buffer.alloc(1024 * 1024 + 1)]);
    assert.equal((await send(port, "POST", "/api/drops", { cookie, body: huge })).status, 413);
    assert.equal((await send(port, "PUT", "/api/drops", { cookie })).status, 405);

    assert.equal((await send(port, "GET", "/api/drops", { cookie })).status, 400);
    assert.equal((await send(port, "GET", `/api/drops?device=${deviceId}`)).status, 401);
    assert.equal((await send(port, "GET", `/api/drops?device=${"b".repeat(32)}`, { cookie })).status, 400);
    const laptop = "c".repeat(32);
    db.prepare("INSERT INTO devices (id, user_id, name, public_key, created_at) VALUES (?, ?, ?, ?, ?)").run(
      laptop,
      "42",
      "laptop",
      "laptop-public-key",
      now,
    );
    const pinId = "d".repeat(32);
    const salt = "cGluLXNhbHQtcGluLXNhbHQ=";
    db.prepare("INSERT INTO drops (id, user_id, expires_at, pin_salt, created_at) VALUES (?, ?, ?, ?, ?)").run(
      pinId,
      "42",
      after + 120_000,
      salt,
      after + 1,
    );
    db.prepare("INSERT INTO drop_keys (drop_id, device_id, sealed_key) VALUES (?, ?, ?)").run(
      pinId,
      deviceId,
      "sealed-for-phone",
    );
    db.prepare("INSERT INTO drops (id, user_id, expires_at, pin_salt, created_at) VALUES (?, ?, ?, ?, ?)").run(
      "e".repeat(32),
      "42",
      1,
      null,
      now,
    );
    db.prepare("INSERT INTO drop_keys (drop_id, device_id, sealed_key) VALUES (?, ?, ?)").run(
      "e".repeat(32),
      deviceId,
      "sealed-expired",
    );
    const inbox = await send(port, "GET", `/api/drops?device=${deviceId}`, { cookie });
    assert.equal(inbox.status, 200);
    const listed = JSON.parse(inbox.body);
    assert.deepEqual(
      listed.map((row) => row.id),
      [saved.id, pinId],
    );
    assert.equal(listed[0].pin, false);
    assert.equal(listed[1].pin, true);
    assert.equal(listed[0].fromDevice, "phone");
    assert.equal(listed[0].fromUser, "ada");
    assert.equal(listed[1].fromDevice, null);
    assert.equal(listed[1].fromUser, "ada");
    assert.equal(listed[0].expiresAt, saved.expiresAt);
    assert.equal(inbox.body.includes(salt), false);
    assert.equal(inbox.body.includes("sealed-for-phone"), false);
    const elsewhere = await send(port, "GET", `/api/drops?device=${laptop}`, { cookie });
    assert.deepEqual(JSON.parse(elsewhere.body), []);

    assert.equal((await send(port, "GET", `/api/drops/${saved.id}?device=${deviceId}`)).status, 401);
    assert.equal((await send(port, "GET", `/api/drops/${saved.id}?device=${laptop}`, { cookie })).status, 404);
    const detail = await send(port, "GET", `/api/drops/${saved.id}?device=${deviceId}`, { cookie });
    assert.equal(detail.status, 200);
    assert.equal(JSON.parse(detail.body).sealedKey, prepared.keys[0].sealedKey);
    assert.equal(JSON.parse(detail.body).pinSalt, null);
    const pinMeta = await send(port, "GET", `/api/drops/${pinId}?device=${deviceId}`, { cookie });
    assert.equal(JSON.parse(pinMeta.body).pinSalt, salt);
    const blob = await send(port, "GET", `/api/drops/${saved.id}/blob?device=${deviceId}`, { cookie, raw: true });
    assert.equal(blob.status, 200);
    assert.deepEqual(blob.body, cipher);
    const readBack = await openDrop({
      privateKey: pair.privateKey,
      pinSalt: null,
      sealedKey: prepared.keys[0].sealedKey,
      bytes: new Uint8Array(blob.body),
    });
    assert.deepEqual(readBack.texts, ["hello secret"]);
    assert.equal((await send(port, "DELETE", `/api/drops/${saved.id}?device=${laptop}`, { cookie })).status, 404);
    const claimed = await send(port, "DELETE", `/api/drops/${saved.id}?device=${deviceId}`, { cookie });
    assert.equal(claimed.status, 204);
    assert.equal((await send(port, "GET", `/api/drops/${saved.id}?device=${deviceId}`, { cookie })).status, 404);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM drop_keys WHERE drop_id = ?").get(saved.id).n, 0);

    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM drops").get().n, 2);
    assert.deepEqual(await readdir(join(dir, "blobs")), []);
    const text = lines.join("\n");
    assert.match(text, /msg=drop_stored/);
    assert.match(text, /msg=drop_claimed/);
    assert.equal(text.includes(prepared.keys[0].sealedKey), false);
    assert.equal(text.includes("hello secret"), false);
    assert.equal(text.includes("note.txt"), false);
    assert.equal(text.includes(salt), false);
    assert.equal(text.includes("sealed-for-phone"), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
