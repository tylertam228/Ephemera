import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
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
