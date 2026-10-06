import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("en.json and zhTW.json have the same keys", async () => {
  const dir = join(dirname(fileURLToPath(import.meta.url)), "locales");
  const en = JSON.parse(await readFile(join(dir, "en.json"), "utf8"));
  const zh = JSON.parse(await readFile(join(dir, "zhTW.json"), "utf8"));
  assert.deepEqual(Object.keys(en).sort(), Object.keys(zh).sort());
  assert.equal(typeof en.signIn, "string");
  assert.notEqual(en.signIn, zh.signIn);
});
