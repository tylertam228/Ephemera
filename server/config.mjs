import { existsSync, readFileSync } from "node:fs";

export function applyEnvFile(env, file) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!env[key]) env[key] = value;
  }
}

export function loadConfig(env) {
  const maxRaw = (env.MAX_UPLOAD_MB ?? "").trim();
  const maxUploadMb = maxRaw === "" ? 1024 : Number(maxRaw);
  if (!Number.isInteger(maxUploadMb) || maxUploadMb < 1) {
    throw new Error("MAX_UPLOAD_MB must be a positive integer");
  }
  const authUrl = origin(required(env, "AUTH_URL"));
  return {
    discordClientId: required(env, "DISCORD_CLIENT_ID"),
    discordClientSecret: required(env, "DISCORD_CLIENT_SECRET"),
    discordPublicKey: required(env, "DISCORD_PUBLIC_KEY"),
    authUrl,
    maxUploadMb,
  };
}

function required(env, key) {
  const value = (env[key] ?? "").trim();
  if (!value) throw new Error(`missing ${key}`);
  return value;
}

function origin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("AUTH_URL must be an http(s) origin");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("AUTH_URL must be an http(s) origin");
  }
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("AUTH_URL must be an origin");
  }
  return url.origin;
}
