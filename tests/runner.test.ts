import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { judge0, mapResult } from "../server/runner.js";
const enc = (s: string) => Buffer.from(s).toString("base64");
test("maps actual execution outcomes without exposing hidden diagnostics", () => {
  const fixture = { input: "", output: "6\n" };
  assert.equal(
    mapResult({ status: { id: 3 }, stdout: enc("6\r\n") }, fixture, 0, true)
      .passed,
    true,
  );
  assert.equal(
    mapResult({ status: { id: 3 }, stdout: enc("7") }, fixture, 0, true).status,
    "Wrong answer",
  );
  assert.equal(
    mapResult({ status: { id: 5 } }, fixture, 0, true).status,
    "Time limit exceeded",
  );
  assert.equal(
    mapResult(
      { status: { id: 6 }, compile_output: enc("syntax error") },
      fixture,
      0,
      true,
    ).stderr,
    "syntax error",
  );
  assert.equal(
    mapResult({ status: { id: 11 } }, fixture, 0, true).status,
    "Runtime error",
  );
  assert.equal(
    mapResult({ status: { id: 3 }, stdout: enc("6") }, fixture, 0, false)
      .stdout,
    undefined,
  );
  assert.throws(() => mapResult({ status: { id: 13 } }, fixture, 0, true));
});
test("Judge0 adapter sends resource-limited code and correlates reordered responses", async () => {
  let received: any;
  const server = createServer(async (req, res) => {
    res.setHeader("Content-Type", "application/json");
    if (req.method === "POST") {
      let text = "";
      for await (const chunk of req) text += chunk;
      received = JSON.parse(text);
      res.end(JSON.stringify([{ token: "a" }, { token: "b" }]));
    } else
      res.end(
        JSON.stringify({
          submissions: [
            { token: "b", status: { id: 3 }, stdout: enc("2") },
            { token: "a", status: { id: 3 }, stdout: enc("1") },
          ],
        }),
      );
  }).listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  const original = process.env.JUDGE0_URL;
  process.env.JUDGE0_URL = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    const result = await judge0(
      "print(1)",
      [
        { input: "a", output: "1" },
        { input: "b", output: "2" },
      ],
      true,
    );
    assert.equal(
      result.every((r) => r.passed),
      true,
    );
    assert.equal(
      received.submissions[0].language_id,
      Number(process.env.JUDGE0_PYTHON_ID || 71),
    );
    for (const [language, id] of [
      ["cpp", Number(process.env.JUDGE0_CPP_ID || 54)],
      ["java", Number(process.env.JUDGE0_JAVA_ID || 62)],
    ] as const) {
      await judge0(
        "fixture source",
        [
          { input: "a", output: "1" },
          { input: "b", output: "2" },
        ],
        true,
        language,
      );
      assert.equal(received.submissions[0].language_id, id);
    }
    assert.equal(received.submissions[0].enable_network, false);
    assert.equal(received.submissions[0].wall_time_limit, 5);
    assert.equal(received.submissions[0].cpu_time_limit, 2);
    assert.equal(
      Buffer.from(received.submissions[0].source_code, "base64").toString(),
      "fixture source",
    );
  } finally {
    if (original === undefined) delete process.env.JUDGE0_URL;
    else process.env.JUDGE0_URL = original;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
