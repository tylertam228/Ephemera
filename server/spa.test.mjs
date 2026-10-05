import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer, request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { serveSpa, spaPath } from "./spa.mjs";

function get(port, path) {
  return new Promise((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port, path, method: "GET" }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          status: res.statusCode,
          body: Buffer.concat(chunks).toString(),
          type: res.headers["content-type"],
        });
      });
    });
    req.on("error", reject);
    req.end();
  });
}

test("serves built files and falls back to the shell", async () => {
  const root = await mkdtemp(join(tmpdir(), "eph-"));
  await mkdir(join(root, "assets"));
  await writeFile(join(root, "index.html"), "home");
  await writeFile(join(root, "assets/app.js"), "js");
  const server = createServer((req, res) => {
    serveSpa(root, req, res).catch((err) => {
      console.error(err);
      if (!res.headersSent) res.writeHead(500).end();
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    for (const [path, want] of [
      ["/", "home"],
      ["/assets/app.js", "js"],
      ["/inbox", "home"],
    ]) {
      const res = await get(port, path);
      assert.equal(res.status, 200, path);
      assert.equal(res.body, want, path);
    }
    const js = await get(port, "/assets/app.js");
    assert.equal(js.type, "text/javascript; charset=utf-8");
    assert.equal(await spaPath(root, "/../../secret"), join(root, "index.html"));
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await rm(root, { recursive: true, force: true });
  }
});
