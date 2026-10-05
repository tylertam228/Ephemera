PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  public_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, public_key)
);

CREATE TABLE IF NOT EXISTS drops (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL,
  pin_salt TEXT,
  created_at INTEGER NOT NULL,
  sender_device_id TEXT REFERENCES devices(id)
);

CREATE TABLE IF NOT EXISTS drop_keys (
  drop_id TEXT NOT NULL REFERENCES drops(id) ON DELETE CASCADE,
  device_id TEXT NOT NULL REFERENCES devices(id),
  sealed_key TEXT NOT NULL,
  PRIMARY KEY (drop_id, device_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS drops_expires_at ON drops (expires_at);
CREATE INDEX IF NOT EXISTS devices_user_id ON devices (user_id);
