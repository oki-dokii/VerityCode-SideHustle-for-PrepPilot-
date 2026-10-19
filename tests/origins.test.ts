import { test } from "node:test";
import assert from "node:assert/strict";
import { allowedOrigins } from "../server/origins.js";
test("development accepts only exact loopback aliases on the configured port", () => {
  for (const configured of ["http://localhost:5173", "http://127.0.0.1:5173"]) {
    const origins = allowedOrigins(configured, false);
    assert.ok(origins.has("http://localhost:5173"));
    assert.ok(origins.has("http://127.0.0.1:5173"));
    for (const rejected of [
      "http://localhost:5174",
      "https://localhost:5173",
      "http://localhost.attacker.example:5173",
      "null",
      "https://attacker.example",
    ])
      assert.equal(origins.has(rejected), false);
  }
});
test("production and non-loopback configuration do not gain development aliases", () => {
  assert.deepEqual(
    [...allowedOrigins("http://127.0.0.1:5173", true)],
    ["http://127.0.0.1:5173"],
  );
  assert.deepEqual(
    [...allowedOrigins("https://verity.example", false)],
    ["https://verity.example"],
  );
});
