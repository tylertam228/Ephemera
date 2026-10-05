import { createServer } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { serveSpa } from "./spa.mjs";

const root = join(dirname(fileURLToPath(import.meta.url)), "../web/dist");
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
