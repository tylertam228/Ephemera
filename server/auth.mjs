import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { hashToken } from "./db.mjs";
import { handleDevice } from "./devices.mjs";
import { log as writeLog } from "./log.mjs";
import { readCookie, sessionUser } from "./session.mjs";

const SESSION = "session";
const PKCE = "pkce";
const SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const PKCE_S = 10 * 60;

export function createPkce() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const state = randomBytes(16).toString("base64url");
  return { verifier, challenge, state };
}

export function authorizeUrl(config, { challenge, state }) {
  const url = new URL("https://discord.com/api/oauth2/authorize");
  url.searchParams.set("client_id", config.discordClientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirectUri(config));
  url.searchParams.set("scope", "identify");
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url;
}

export async function handleAuth(req, res, { config, db, fetch: fetchImpl, log = writeLog }) {
  const url = new URL(req.url ?? "/", config.authUrl);
  if (!url.pathname.startsWith("/api/")) return false;
  const started = Date.now();
  let status = 500;
  const writeHead = res.writeHead.bind(res);
  res.writeHead = (code, ...args) => {
    status = code;
    return writeHead(code, ...args);
  };
  try {
    if (req.method === "GET" && url.pathname === "/api/auth/discord") {
      const pkce = createPkce();
      res.appendHeader("Set-Cookie", setCookie(PKCE, `${pkce.state}.${pkce.verifier}`, PKCE_S));
      res.writeHead(302, { location: authorizeUrl(config, pkce).href });
      res.end();
      return true;
    }
    if (req.method === "GET" && url.pathname === "/api/auth/callback/discord") {
      await callback(req, res, url, config, db, fetchImpl, log);
      return true;
    }
    if (req.method === "POST" && url.pathname === "/api/auth/logout") {
      logout(req, res, db, log);
      return true;
    }
    if (req.method === "GET" && url.pathname === "/api/me") {
      me(req, res, db);
      return true;
    }
    if (url.pathname === "/api/devices") {
      await handleDevice(req, res, { db, log });
      return true;
    }
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found");
    return true;
  } finally {
    log("info", "request", {
      method: req.method,
      path: url.pathname,
      status,
      dur_ms: Date.now() - started,
    });
  }
}

function redirectUri(config) {
  return `${config.authUrl}/api/auth/callback/discord`;
}

async function callback(req, res, url, config, db, fetchImpl, log) {
  const code = url.searchParams.get("code") ?? "";
  const state = url.searchParams.get("state") ?? "";
  const saved = readPkce(req);
  if (!saved || !code || !safeEqual(saved.state, state)) {
    log("warn", "auth_failed", { reason: "state" });
    fail(res);
    return;
  }
  let user;
  try {
    user = await discordUser(config, code, saved.verifier, fetchImpl);
  } catch {
    log("warn", "auth_failed", { reason: "discord" });
    fail(res);
    return;
  }
  const now = Date.now();
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
  db.prepare(
    `INSERT INTO users (id, username, created_at) VALUES (?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET username = excluded.username`,
  ).run(user.id, user.username, now);
  const token = randomBytes(32).toString("base64url");
  db.prepare(
    "INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
  ).run(hashToken(token), user.id, now + SESSION_MS, now);
  log("info", "signed_in", { user: user.id });
  res.appendHeader("Set-Cookie", setCookie(PKCE, "", 0));
  res.appendHeader("Set-Cookie", setCookie(SESSION, token, SESSION_MS / 1000));
  res.writeHead(302, { location: "/" });
  res.end();
}

async function discordUser(config, code, verifier, fetchImpl) {
  const body = new URLSearchParams({
    client_id: config.discordClientId,
    client_secret: config.discordClientSecret,
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri(config),
    code_verifier: verifier,
  });
  const tokenRes = await fetchImpl("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!tokenRes.ok) throw new Error("discord token failed");
  const token = await tokenRes.json();
  if (typeof token.access_token !== "string" || !token.access_token) {
    throw new Error("discord token failed");
  }
  const meRes = await fetchImpl("https://discord.com/api/users/@me", {
    headers: { authorization: `Bearer ${token.access_token}` },
  });
  if (!meRes.ok) throw new Error("discord profile failed");
  const me = await meRes.json();
  if (!/^\d+$/.test(me.id ?? "") || typeof me.username !== "string" || !me.username) {
    throw new Error("discord profile failed");
  }
  return { id: me.id, username: me.username };
}

function logout(req, res, db, log) {
  const token = readCookie(req, SESSION);
  if (token) db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token));
  log("info", "signed_out");
  res.appendHeader("Set-Cookie", setCookie(SESSION, "", 0));
  res.writeHead(303, { location: "/" });
  res.end();
}

function me(req, res, db) {
  const row = sessionUser(req, db);
  if (!row) {
    res.writeHead(401, { "content-type": "application/json; charset=utf-8" });
    res.end("{}");
    return;
  }
  res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify({ id: row.id, username: row.username }));
}

function fail(res) {
  res.appendHeader("Set-Cookie", setCookie(PKCE, "", 0));
  res.writeHead(302, { location: "/?auth=failed" });
  res.end();
}

function readPkce(req) {
  const raw = readCookie(req, PKCE);
  const dot = raw.indexOf(".");
  if (dot <= 0) return null;
  return { state: raw.slice(0, dot), verifier: raw.slice(dot + 1) };
}

function setCookie(name, value, maxAge) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function safeEqual(a, b) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
