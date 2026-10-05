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

function send(port, method, path, { cookie, body } = {}) {
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
        res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
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
  const meta = { keepMs: 60_000, pinSalt: prepared.pinSalt, keys: prepared.keys };
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
      Buffer.from(encodePrefix({ keepMs: 60_000, pinSalt: null, keys: [{ deviceId: "b".repeat(32), sealedKey: prepared.keys[0].sealedKey }] })),
      cipher,
    ]);
    assert.equal((await send(port, "POST", "/api/drops", { cookie, body: foreign })).status, 400);

    const past = Buffer.concat([
      Buffer.from(encodePrefix({ expiresAt: 1, pinSalt: null, keys: prepared.keys })),
      cipher,
    ]);
    assert.equal((await send(port, "POST", "/api/drops", { cookie, body: past })).status, 400);

    const both = Buffer.concat([
      Buffer.from(encodePrefix({ keepMs: 60_000, expiresAt: Date.now() + 60_000, pinSalt: null, keys: prepared.keys })),
      cipher,
    ]);
    assert.equal((await send(port, "POST", "/api/drops", { cookie, body: both })).status, 400);

    const huge = Buffer.concat([Buffer.from(encodePrefix(meta)), Buffer.alloc(1024 * 1024 + 1)]);
    assert.equal((await send(port, "POST", "/api/drops", { cookie, body: huge })).status, 413);
    assert.equal((await send(port, "GET", "/api/drops", { cookie })).status, 405);

    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM drops").get().n, 1);
    assert.deepEqual(await readdir(join(dir, "blobs")), [saved.id]);
    const text = lines.join("\n");
    assert.match(text, /msg=drop_stored/);
    assert.equal(text.includes(prepared.keys[0].sealedKey), false);
    assert.equal(text.includes("hello secret"), false);
    assert.equal(text.includes("note.txt"), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
