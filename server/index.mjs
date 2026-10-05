import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { handleAuth } from "./auth.mjs";
import { applyEnvFile, loadConfig } from "./config.mjs";
import { openDb } from "./db.mjs";
import { log } from "./log.mjs";
import { serveSpa } from "./spa.mjs";
import { sweepExpired } from "./sweep.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const dataDir = join(repo, "data");
const env = { ...process.env };
applyEnvFile(env, join(repo, ".env"));

let config;
let db;
try {
  config = loadConfig(env);
  db = openDb(dataDir);
} catch (err) {
  log("error", "startup_failed", { err: err instanceof Error ? err.message : "startup failed" });
  process.exit(1);
}

const root = join(repo, "web/dist");
const port = env.PORT == null || env.PORT === "" ? 3000 : Number(env.PORT);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  log("error", "startup_failed", { err: "PORT" });
  process.exit(1);
}

createServer((req, res) => {
  handleAuth(req, res, { config, db, dataDir, fetch })
    .then((handled) => {
      if (handled) return;
      return serveSpa(root, req, res);
    })
    .catch((err) => {
      log("error", "request_failed", { err: err instanceof Error ? err.message : "request failed" });
      if (!res.headersSent) {
        res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
        res.end("error");
      } else {
        res.destroy();
      }
    });
}).listen(port, "127.0.0.1", () => {
  log("info", "listening", { port });
});

const sweepMs = 30_000;
const sweep = () => {
  sweepExpired(db, dataDir).catch((err) => {
    log("error", "sweep_failed", { err: err instanceof Error ? err.message : "sweep failed" });
  });
};
sweep();
setInterval(sweep, sweepMs);
