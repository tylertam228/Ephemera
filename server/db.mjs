import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import Database from "better-sqlite3";

const schema = readFileSync(new URL("./schema.sql", import.meta.url), "utf8");
const idPattern = /^[0-9a-f]{32}$/;

export function openDb(dataDir) {
  mkdirSync(join(dataDir, "blobs"), { recursive: true });
  const db = new Database(join(dataDir, "ephemera.sqlite"));
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(schema);
  const columns = db.prepare("PRAGMA table_info(drops)").all();
  if (!columns.some((column) => column.name === "sender_device_id")) {
    db.exec("ALTER TABLE drops ADD COLUMN sender_device_id TEXT REFERENCES devices(id)");
  }
  return db;
}

export function newId() {
  return randomBytes(16).toString("hex");
}

export function hashToken(token) {
  if (!token) throw new Error("missing token");
  return createHash("sha256").update(token).digest("hex");
}

export function blobPath(dataDir, id) {
  if (!idPattern.test(id)) throw new Error("bad id");
  return join(dataDir, "blobs", id);
}
