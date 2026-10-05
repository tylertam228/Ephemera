import assert from "node:assert/strict";
import { randomBytes, webcrypto } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { handleAuth } from "./auth.mjs";
import { hashToken, openDb } from "./db.mjs";
import { logfmt } from "./log.mjs";

const config = {
  discordClientId: "client-id",
  discordClientSecret: "client-secret",
  discordPublicKey: "unused",
  authUrl: "http://localhost:3000",
  maxUploadMb: 1024,
};

async function p256(extractable = false) {
  const pair = await webcrypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    extractable,
    ["deriveBits"],
  );
  const spki = Buffer.from(await webcrypto.subtle.exportKey("spki", pair.publicKey)).toString("base64");
  return { pair, spki };
}

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
          ...(body ? { "content-type": "application/json", "content-length": Buffer.byteLength(body) } : {}),
        },
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() });
        });
      },
    );
    req.on("error", reject);
    req.end(body);
  });
}

test("a device public key is stored for the signed-in user only", async () => {
  const locked = await p256(false);
  await assert.rejects(() => webcrypto.subtle.exportKey("pkcs8", locked.pair.privateKey));
  const other = await webcrypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-384" }, true, ["deriveBits"]);
  const p384 = Buffer.from(await webcrypto.subtle.exportKey("spki", other.publicKey)).toString("base64");

  const dir = await mkdtemp(join(tmpdir(), "eph-device-"));
  const db = openDb(dir);
  const now = Date.now();
  const token = randomBytes(32).toString("base64url");
  db.prepare("INSERT INTO users (id, username, created_at) VALUES (?, ?, ?)").run("42", "ada", now);
  db.prepare("INSERT INTO users (id, username, created_at) VALUES (?, ?, ?)").run("7", "bob", now);
  db.prepare(
    "INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
  ).run(hashToken(token), "42", now + 60_000, now);
  const lines = [];
  const server = createServer((req, res) => {
    handleAuth(req, res, {
      config,
      db,
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
    const anon = await send(port, "POST", "/api/devices", {
      body: JSON.stringify({ name: "laptop", publicKey: locked.spki }),
    });
    assert.equal(anon.status, 401);

    const bad = await send(port, "POST", "/api/devices", {
      cookie,
      body: JSON.stringify({ name: "laptop", publicKey: p384 }),
    });
    assert.equal(bad.status, 400);

    const created = await send(port, "POST", "/api/devices", {
      cookie,
      body: JSON.stringify({ name: "  laptop  ", publicKey: locked.spki }),
    });
    assert.equal(created.status, 201);
    const saved = JSON.parse(created.body);
    assert.equal(saved.name, "laptop");
    assert.equal(saved.id.length, 32);

    const again = await send(port, "POST", "/api/devices", {
      cookie,
      body: JSON.stringify({ name: "other", publicKey: locked.spki }),
    });
    assert.equal(again.status, 200);
    assert.equal(JSON.parse(again.body).id, saved.id);
    assert.equal(JSON.parse(again.body).name, "laptop");

    const list = await send(port, "GET", "/api/devices", { cookie });
    assert.deepEqual(JSON.parse(list.body).map((row) => row.name), ["laptop"]);
    assert.equal(JSON.parse(list.body)[0].publicKey, locked.spki);

    const alone = await send(port, "GET", `/api/devices?except=${saved.id}`, { cookie });
    assert.deepEqual(JSON.parse(alone.body), []);
    db.prepare(
      "INSERT INTO devices (id, user_id, name, public_key, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run("b".repeat(32), "42", "phone", "other-key", now + 1);
    db.prepare(
      "INSERT INTO devices (id, user_id, name, public_key, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run("c".repeat(32), "7", "bob-phone", "bob-key", now + 2);
    const others = await send(port, "GET", `/api/devices?except=${saved.id}`, { cookie });
    assert.deepEqual(
      JSON.parse(others.body).map((row) => row.name),
      ["phone"],
    );

    const text = lines.join("\n");
    assert.match(text, /msg=device_registered/);
    assert.equal(text.includes(locked.spki), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
