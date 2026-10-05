import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { blobPath, newId, openDb } from "./db.mjs";
import { sweepExpired } from "./sweep.mjs";

test("expiry deletes the ciphertext and leaves a later drop", async () => {
  const dir = await mkdtemp(join(tmpdir(), "eph-sweep-"));
  const db = openDb(dir);
  const lines = [];
  const log = (_level, msg, fields) => lines.push(`${msg} ${fields?.drop ?? ""} ${fields?.err ?? ""}`);
  try {
    const now = 1_700_000_000_000;
    const user = newId();
    db.prepare("INSERT INTO users (id, username, created_at) VALUES (?, ?, ?)").run(user, "ada", now);
    const device = newId();
    db.prepare("INSERT INTO devices (id, user_id, name, public_key, created_at) VALUES (?, ?, ?, ?, ?)").run(
      device,
      user,
      "phone",
      "phone-public-key",
      now,
    );
    const expired = newId();
    const kept = newId();
    db.prepare("INSERT INTO drops (id, user_id, expires_at, pin_salt, created_at) VALUES (?, ?, ?, ?, ?)").run(
      expired,
      user,
      now,
      "pin-salt-value",
      now,
    );
    db.prepare("INSERT INTO drops (id, user_id, expires_at, pin_salt, created_at) VALUES (?, ?, ?, ?, ?)").run(
      kept,
      user,
      now + 1,
      null,
      now,
    );
    db.prepare("INSERT INTO drop_keys (drop_id, device_id, sealed_key) VALUES (?, ?, ?)").run(
      expired,
      device,
      "sealed-for-phone",
    );
    await writeFile(blobPath(dir, expired), "ciphertext");
    await writeFile(blobPath(dir, kept), "keep");
    await sweepExpired(db, dir, now, log);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM drops WHERE id = ?").get(expired).n, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM drop_keys").get().n, 0);
    await assert.rejects(() => readFile(blobPath(dir, expired)));
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM drops WHERE id = ?").get(kept).n, 1);
    assert.equal(await readFile(blobPath(dir, kept), "utf8"), "keep");
    assert.match(lines.join("\n"), new RegExp(`drop_expired ${expired}`));
    assert.equal(lines.join("\n").includes("pin-salt-value"), false);
    assert.equal(lines.join("\n").includes("sealed-for-phone"), false);
    assert.equal(lines.join("\n").includes("ciphertext"), false);
  } finally {
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
