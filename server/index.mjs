import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { applyEnvFile, loadConfig } from "./config.mjs";
import { openDb } from "./db.mjs";
import { serveSpa } from "./spa.mjs";

const repo = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = { ...process.env };
applyEnvFile(env, join(repo, ".env"));

let db;
try {
  loadConfig(env);
  db = openDb(join(repo, "data"));
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

const root = join(repo, "web/dist");
const port = 3000;

createServer((req, res) => {
  serveSpa(root, req, res).catch((err) => {
    console.error(err);
    if (!res.headersSent) {
      res.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      res.end("error");
    } else {
      res.destroy();
    }
  });
}).listen(port, () => {
  console.log(`http://localhost:${port}`);
});
