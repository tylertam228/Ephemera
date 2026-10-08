import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import Database from "better-sqlite3";
import { blobPath, hashToken, newId, openDb } from "./db.mjs";

test("schema stores sealed keys and only the session hash", async () => {
  const dir = await mkdtemp(join(tmpdir(), "eph-db-"));
  const db = openDb(dir);
  try {
    const names = [];
    for (const table of ["users", "devices", "drops", "drop_keys", "sessions"]) {
      for (const column of db.prepare(`PRAGMA table_info(${table})`).all()) {
        names.push(column.name);
      }
    }
    assert.equal(names.includes("sealed_key"), true);
    assert.equal(names.includes("public_key"), true);
    assert.equal(names.includes("token_hash"), true);
    assert.equal(names.includes("pin_salt"), true);
    for (const name of names) {
      assert.equal(/secret|private_key|^pin$/.test(name), false, name);
    }

    const now = 1_700_000_000_000;
    const user = newId();
    db.prepare("INSERT INTO users (id, username, created_at) VALUES (?, ?, ?)").run(user, "ada", now);
    const device = newId();
    db.prepare(
      "INSERT INTO devices (id, user_id, name, public_key, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(device, user, "laptop", "device-public-key", now);
    const drop = newId();
    db.prepare(
      "INSERT INTO drops (id, user_id, expires_at, pin_salt, created_at) VALUES (?, ?, ?, ?, ?)",
    ).run(drop, user, now + 60_000, "public-salt", now);
    db.prepare("INSERT INTO drop_keys (drop_id, device_id, sealed_key) VALUES (?, ?, ?)").run(
      drop,
      device,
      "sealed-content-key",
    );
    const token = "session-token";
    const tokenHash = hashToken(token);
    assert.equal(tokenHash.length, 64);
    assert.notEqual(tokenHash, token);
    db.prepare(
      "INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
    ).run(tokenHash, user, now + 60_000, now);
    assert.equal(blobPath(dir, drop), join(dir, "blobs", drop));
    assert.throws(() => blobPath(dir, "../ephemera.sqlite"), /bad id/);
    assert.throws(() =>
      db.prepare("INSERT INTO drop_keys (drop_id, device_id, sealed_key) VALUES (?, ?, ?)").run(
        drop,
        newId(),
        "nope",
      ),
    );
    openDb(dir).close();
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("opening an older database adds the disabled column once", async () => {
  const dir = await mkdtemp(join(tmpdir(), "eph-dev-"));
  try {
    mkdirSync(dir, { recursive: true });
    const old = new Database(join(dir, "ephemera.sqlite"));
    old.exec(
      "CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL, created_at INTEGER NOT NULL);" +
        "CREATE TABLE devices (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, public_key TEXT NOT NULL, created_at INTEGER NOT NULL);" +
        "INSERT INTO users VALUES ('1', 'ada', 1);" +
        "INSERT INTO devices VALUES ('d', '1', 'phone', 'pk', 1);",
    );
    old.close();
    const db = openDb(dir);
    const names = db.prepare("PRAGMA table_info(devices)").all().map((column) => column.name);
    assert.equal(names.includes("disabled"), true);
    assert.equal(db.prepare("SELECT disabled AS d FROM devices WHERE id = 'd'").get().d, 0);
    db.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("opening an older database adds the sender column once", async () => {
  const dir = await mkdtemp(join(tmpdir(), "eph-old-"));
  try {
    mkdirSync(dir, { recursive: true });
    const old = new Database(join(dir, "ephemera.sqlite"));
    old.exec(
      "CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL, created_at INTEGER NOT NULL);" +
        "CREATE TABLE devices (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, public_key TEXT NOT NULL, created_at INTEGER NOT NULL);" +
        "CREATE TABLE drops (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires_at INTEGER NOT NULL, pin_salt TEXT, created_at INTEGER NOT NULL);" +
        "INSERT INTO users VALUES ('1', 'ada', 1);" +
        "INSERT INTO drops VALUES ('d', '1', 9, NULL, 1);",
    );
    old.close();
    for (let round = 0; round < 2; round += 1) {
      const db = openDb(dir);
      const names = db.prepare("PRAGMA table_info(drops)").all().map((column) => column.name);
      assert.equal(names.filter((name) => name === "sender_device_id").length, 1);
      assert.equal(db.prepare("SELECT sender_device_id AS s FROM drops WHERE id = 'd'").get().s, null);
      db.close();
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
