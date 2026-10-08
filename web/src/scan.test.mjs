import assert from "node:assert/strict";
import test from "node:test";
import { scanFile } from "./scan.mjs";

test("local scan flags risky names and executable magic", () => {
  assert.equal(scanFile({ name: "note.txt", bytes: new Uint8Array([1, 2, 3]) }).ok, true);
  assert.deepEqual(scanFile({ name: "setup.exe", bytes: new Uint8Array([1, 2, 3]) }).flags, ["extension"]);
  assert.deepEqual(scanFile({ name: "payload.bin", bytes: new Uint8Array([0x4d, 0x5a, 0x90, 0x00]) }).flags, [
    "binary",
  ]);
  assert.deepEqual(scanFile({ name: "evil.exe", bytes: new Uint8Array([0x4d, 0x5a, 0x90, 0x00]) }).flags, [
    "extension",
    "binary",
  ]);
});
