import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { applyEnvFile, loadConfig } from "./config.mjs";

const filled = {
  DISCORD_CLIENT_ID: "id",
  DISCORD_CLIENT_SECRET: "secret",
  DISCORD_PUBLIC_KEY: "pub",
  AUTH_URL: "http://localhost:3000",
};

test("config defaults the upload cap and keeps the discord values", () => {
  const config = loadConfig({ ...filled });
  assert.equal(config.maxUploadMb, 1024);
  assert.equal(config.discordClientId, "id");
  assert.equal(config.discordClientSecret, "secret");
  assert.equal(config.discordPublicKey, "pub");
  assert.equal(config.authUrl, "http://localhost:3000");
  assert.equal(loadConfig({ ...filled, AUTH_URL: "http://localhost:3000/" }).authUrl, "http://localhost:3000");
});

test("config rejects a bad cap and a missing secret", () => {
  assert.throws(() => loadConfig({ ...filled, MAX_UPLOAD_MB: "0" }), /positive integer/);
  assert.throws(() => loadConfig({ ...filled, DISCORD_CLIENT_SECRET: "" }), /missing DISCORD_CLIENT_SECRET/);
  assert.throws(() => loadConfig({ ...filled, AUTH_URL: "http://localhost:3000/api" }), /origin/);
});

test("env file fills blanks and does not override the process", async () => {
  const dir = await mkdtemp(join(tmpdir(), "eph-env-"));
  const file = join(dir, ".env");
  await writeFile(file, "DISCORD_CLIENT_ID=from-file\nAUTH_URL=http://localhost:3000\n");
  const env = { DISCORD_CLIENT_ID: "from-process" };
  applyEnvFile(env, file);
  assert.equal(env.DISCORD_CLIENT_ID, "from-process");
  assert.equal(env.AUTH_URL, "http://localhost:3000");
  await rm(dir, { recursive: true, force: true });
});
