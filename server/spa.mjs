import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";

const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".map": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
};

export async function spaPath(root, urlPath) {
  const base = resolve(root);
  const index = join(base, "index.html");
  let pathname = "/";
  try {
    pathname = decodeURIComponent((urlPath ?? "/").split("?")[0]);
  } catch {
    return index;
  }
  const candidate = resolve(base, pathname.replace(/^\/+/, ""));
  const inside = candidate === base || candidate.startsWith(base + sep);
  if (!inside) return index;
  try {
    if ((await stat(candidate)).isFile()) return candidate;
  } catch {}
  return index;
}

export async function serveSpa(root, req, res) {
  const file = await spaPath(root, req.url);
  let info;
  try {
    info = await stat(file);
  } catch {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("not found");
    return;
  }
  res.writeHead(200, {
    "content-type": types[extname(file)] ?? "application/octet-stream",
    "content-length": info.size,
  });
  if (req.method === "HEAD") {
    res.end();
    return;
  }
  createReadStream(file).pipe(res);
}
