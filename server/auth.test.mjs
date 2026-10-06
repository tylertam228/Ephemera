import assert from "node:assert/strict";
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

function listen(db, fetchImpl, lines) {
  const log = (level, msg, fields) => lines.push(logfmt(level, msg, fields));
  const server = createServer((req, res) => {
    handleAuth(req, res, { config, db, fetch: fetchImpl, log }).catch((err) => {
      console.error(err instanceof Error ? err.message : "request failed");
      if (!res.headersSent) res.writeHead(500).end();
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve(server));
  });
}

function send(port, method, path, cookie) {
  return new Promise((resolve, reject) => {
    const req = request(
      { hostname: "127.0.0.1", port, path, method, headers: cookie ? { cookie } : {} },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const raw = res.headers["set-cookie"];
          const cookies = raw ? (Array.isArray(raw) ? raw : [raw]) : [];
          resolve({
            status: res.statusCode,
            location: res.headers.location,
            body: Buffer.concat(chunks).toString(),
            cookies,
          });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function cookiePair(header) {
  return header.split(";")[0];
}

test("discord sign-in stores a session hash and logout removes it", async () => {
  const dir = await mkdtemp(join(tmpdir(), "eph-auth-"));
  const db = openDb(dir);
  const calls = [];
  const lines = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url: String(url), body: opts?.body });
    if (String(url).endsWith("/oauth2/token")) {
      assert.equal(String(url), "https://discord.com/api/v10/oauth2/token");
      assert.equal(opts.body.get("client_secret"), "client-secret");
      assert.equal(String(url).includes("client-secret"), false);
      return { ok: true, json: async () => ({ access_token: "access-token" }) };
    }
    assert.equal(opts.headers.authorization, "Bearer access-token");
    assert.equal(String(url), "https://discord.com/api/v10/users/@me");
    return { ok: true, json: async () => ({ id: "42", username: "ada", global_name: "Ada" }) };
  };
  const server = await listen(db, fetchImpl, lines);
  const { port } = server.address();
  try {
    const start = await send(port, "GET", "/api/auth/discord");
    const location = new URL(start.location);
    assert.equal(start.status, 302);
    assert.equal(location.origin + location.pathname, "https://discord.com/api/oauth2/authorize");
    assert.equal(location.searchParams.get("scope"), "identify");
    assert.equal(location.searchParams.get("code_challenge_method"), "S256");
    assert.equal(location.searchParams.get("client_id"), "client-id");
    assert.equal(location.search.includes("client-secret"), false);
    assert.match(start.cookies[0], /pkce=.*; Path=\/; HttpOnly; Secure; SameSite=Lax/);
    const pkce = cookiePair(start.cookies[0]);

    const bad = await send(port, "GET", "/api/auth/callback/discord?code=nope&state=wrong", pkce);
    assert.equal(bad.status, 302);
    assert.equal(bad.location, "/?auth=failed");
    assert.equal(calls.length, 0);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sessions").get().n, 0);

    const state = location.searchParams.get("state");
    const ok = await send(port, "GET", `/api/auth/callback/discord?code=good&state=${state}`, pkce);
    assert.equal(ok.status, 302);
    assert.equal(ok.location, "/");
    const sessionHeader = ok.cookies.find((item) => item.startsWith("session="));
    assert.match(sessionHeader, /HttpOnly; Secure; SameSite=Lax/);
    const token = decodeURIComponent(cookiePair(sessionHeader).slice("session=".length));
    const stored = db.prepare("SELECT token_hash, user_id FROM sessions").get();
    assert.equal(stored.token_hash, hashToken(token));
    assert.notEqual(stored.token_hash, token);
    assert.equal(stored.user_id, "42");
    assert.equal(db.prepare("SELECT username FROM users WHERE id = ?").get("42").username, "Ada");

    const who = await send(port, "GET", "/api/me", `session=${token}`);
    assert.equal(who.status, 200);
    assert.deepEqual(JSON.parse(who.body), { id: "42", username: "Ada", maxUploadMb: 1024 });

    const out = await send(port, "POST", "/api/auth/logout", `session=${token}`);
    assert.equal(out.status, 303);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sessions").get().n, 0);
    const gone = await send(port, "GET", "/api/me", `session=${token}`);
    assert.equal(gone.status, 401);

    const missing = await send(port, "GET", "/api/nope");
    assert.equal(missing.status, 404);
    const getLogout = await send(port, "GET", "/api/auth/logout");
    assert.equal(getLogout.status, 404);
    const text = lines.join("\n");
    assert.match(text, /msg=auth_failed reason=state/);
    assert.match(text, /msg=signed_in user=42/);
    assert.match(text, /msg=signed_out/);
    assert.match(text, /path=\/api\/auth\/callback\/discord/);
    assert.equal(text.includes("client-secret"), false);
    assert.equal(text.includes("access-token"), false);
    assert.equal(text.includes(token), false);
    assert.equal(text.includes("good"), false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    db.close();
    await rm(dir, { recursive: true, force: true });
  }
});
