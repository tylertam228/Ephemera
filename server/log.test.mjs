import assert from "node:assert/strict";
import { test } from "node:test";
import { logfmt } from "./log.mjs";

test("logfmt quotes text and drops secret fields", () => {
  const line = logfmt("info", "signed in", {
    user: "42",
    client_secret: "hidden-secret",
    access_token: "hidden-token",
    code: "hidden-code",
    path: "/api/me",
  });
  assert.match(line, /^ts=\d{4}-\d{2}-\d{2}T/);
  assert.match(line, /level=info/);
  assert.match(line, /msg="signed in"/);
  assert.match(line, /user=42/);
  assert.match(line, /path=\/api\/me/);
  assert.equal(line.includes("hidden-secret"), false);
  assert.equal(line.includes("hidden-token"), false);
  assert.equal(line.includes("hidden-code"), false);
});
