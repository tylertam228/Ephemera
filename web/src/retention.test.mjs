import assert from "node:assert/strict";
import test from "node:test";
import { expiry, presets } from "./retention.mjs";

test("a preset runs from upload time and a chosen time has no maximum", () => {
  const uploadedAt = 1_700_000_000_000;
  const expected = {
    "1m": 60_000,
    "5m": 300_000,
    "15m": 900_000,
    "1h": 3_600_000,
    "1d": 86_400_000,
    "7d": 604_800_000,
    "30d": 2_592_000_000,
  };
  assert.deepEqual(
    presets.map((row) => row[0]),
    Object.keys(expected),
  );
  for (const [id, , ms] of presets) {
    assert.equal(ms, expected[id]);
    assert.equal(expiry({ preset: id, at: null }, uploadedAt), uploadedAt + ms);
  }
  const far = uploadedAt + 1000 * 366 * 24 * 60 * 60 * 1000;
  assert.equal(expiry({ preset: "1m", at: far }, uploadedAt), far);
  assert.equal(expiry({ preset: "1m", at: uploadedAt }, uploadedAt), null);
  assert.equal(expiry({ preset: "nope", at: null }, uploadedAt), null);
});
