import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import "dotenv/config";
const baseUrl =
  process.env.DATABASE_URL ||
  "postgresql://veritycode@127.0.0.1:54329/veritycode";
const schema = `test_${randomUUID().replaceAll("-", "")}`;
const admin = new pg.Pool({ connectionString: baseUrl });
await admin.query(`CREATE SCHEMA ${schema}`);
const connection = new URL(baseUrl);
connection.searchParams.set("options", `-c search_path=${schema}`);
process.env.DATABASE_URL = connection.toString();
const { pool, migrate } = await import("../server/db.js");
const { makeApp } = await import("../server/app.js");
const { workOne, expireAttempts } = await import("../server/service.js");
await migrate();
const server = makeApp().listen(0, "127.0.0.1");
await new Promise<void>((resolve) => server.once("listening", resolve));
const address = server.address() as { port: number };
const origin = `http://127.0.0.1:${address.port}`;
async function request(
  path: string,
  method = "GET",
  body?: unknown,
  cookie = "",
) {
  const result = await fetch(`${origin}/api${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-VerityCode": "1",
      Cookie: cookie,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: result.status,
    data: await result.json(),
    cookie: result.headers.get("set-cookie")?.split(";")[0] || cookie,
  };
}
await test("assessment API and durable job lifecycle", async (t) => {
  try {
    const boot = await request("/bootstrap");
    const cookie = boot.cookie;
    let id = "";
    let deadline = "";
    await t.test(
      "requires acknowledgement and owns an immutable server deadline",
      async () => {
        assert.equal(
          (await request("/attempts", "POST", {}, cookie)).status,
          400,
        );
        const result = await request(
          "/attempts",
          "POST",
          { acknowledged: true },
          cookie,
        );
        assert.equal(result.status, 201);
        id = result.data.id;
        deadline = result.data.deadline;
        const repeated = await request(
          "/attempts",
          "POST",
          { acknowledged: true },
          cookie,
        );
        assert.equal(repeated.data.id, id);
        assert.equal(repeated.data.deadline, deadline);
        assert.ok(
          Date.parse(deadline) - Date.parse(result.data.started_at) === 1800000,
        );
      },
    );
    await t.test("persists code and rejects stale revisions", async () => {
      const result = await request(
        `/attempts/${id}/draft`,
        "PUT",
        { code: "print(6)", revision: 0 },
        cookie,
      );
      assert.equal(result.data.revision, 1);
      assert.equal(
        (
          await request(
            `/attempts/${id}/draft`,
            "PUT",
            { code: "stale", revision: 0 },
            cookie,
          )
        ).status,
        409,
      );
      const refreshed = await request(
        `/attempts/${id}`,
        "GET",
        undefined,
        cookie,
      );
      assert.equal(refreshed.data.draft, "print(6)");
      assert.equal(refreshed.data.deadline, deadline);
    });
    await t.test(
      "denies access to another session and cross-origin mutations",
      async () => {
        for (const browserOrigin of [
          "http://localhost:5173",
          "http://127.0.0.1:5173",
        ]) {
          const response = await fetch(`${origin}/api/attempts`, {
            method: "POST",
            headers: {
              Origin: browserOrigin,
              "Content-Type": "application/json",
              "X-VerityCode": "1",
              Cookie: cookie,
            },
            body: JSON.stringify({ acknowledged: true }),
          });
          assert.equal(response.status, 201);
          assert.equal((await response.json()).id, id);
        }
        const other = await request("/bootstrap");
        assert.equal(
          (await request(`/attempts/${id}`, "GET", undefined, other.cookie))
            .status,
          404,
        );
        const rejected = await fetch(`${origin}/api/attempts`, {
          method: "POST",
          headers: {
            Origin: "https://attacker.example",
            "Content-Type": "application/json",
            "X-VerityCode": "1",
            Cookie: cookie,
          },
          body: JSON.stringify({ acknowledged: true }),
        });
        assert.equal(rejected.status, 403);
        const noHeader = await fetch(`${origin}/api/attempts`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Cookie: cookie },
          body: JSON.stringify({ acknowledged: true }),
        });
        assert.equal(noHeader.status, 403);
      },
    );
    await t.test(
      "deduplicates pending runs and distinguishes infrastructure failure",
      async () => {
        const first = await request(
          `/attempts/${id}/runs`,
          "POST",
          { code: "print(6)" },
          cookie,
        );
        const second = await request(
          `/attempts/${id}/runs`,
          "POST",
          { code: "print(7)" },
          cookie,
        );
        assert.equal(first.data.id, second.data.id);
        await workOne(async () => {
          throw new Error("provider unavailable");
        });
        const result = await request(
          `/attempts/${id}`,
          "GET",
          undefined,
          cookie,
        );
        assert.equal(result.data.jobs[0].state, "unavailable");
        assert.equal(result.data.jobs[0].results, null);
        assert.equal(result.data.status, "active");
      },
    );
    await t.test(
      "final submission freezes the acknowledged revision and is idempotent",
      async () => {
        const key = randomUUID();
        assert.equal(
          (
            await request(
              `/attempts/${id}/submit`,
              "POST",
              { key, revision: 0 },
              cookie,
            )
          ).status,
          409,
        );
        await request(
          `/attempts/${id}/submit`,
          "POST",
          { key, revision: 1 },
          cookie,
        );
        await request(
          `/attempts/${id}/submit`,
          "POST",
          { key, revision: 1 },
          cookie,
        );
        await request(
          `/attempts/${id}/submit`,
          "POST",
          { key: randomUUID(), revision: 1 },
          cookie,
        );
        const jobs = await pool.query(
          "SELECT * FROM jobs WHERE attempt_id=$1 AND kind='submit'",
          [id],
        );
        assert.equal(jobs.rowCount, 1);
        assert.equal(jobs.rows[0].code, "print(6)");
        assert.equal(
          (
            await request(
              `/attempts/${id}/draft`,
              "PUT",
              { code: "changed", revision: 1 },
              cookie,
            )
          ).status,
          409,
        );
        await workOne(async (_code, tests) =>
          tests.map((_, index) => ({
            index,
            passed: index < 6,
            status: index < 6 ? "Accepted" : "Wrong answer",
            stdout: "SECRET",
            expected: "SECRET",
            stderr: "SECRET",
          })),
        );
        const result = await request(
          `/attempts/${id}`,
          "GET",
          undefined,
          cookie,
        );
        assert.equal(result.data.status, "completed");
        const final = result.data.jobs.find((j: any) => j.kind === "submit");
        assert.equal(final.results.length, 8);
        assert.equal(final.results.filter((c: any) => c.passed).length, 6);
        assert.equal(JSON.stringify(final).includes("SECRET"), false);
      },
    );
    await t.test(
      "deadline finalises without a browser and grades the last acknowledged draft",
      async () => {
        const created = await request(
          "/attempts",
          "POST",
          { acknowledged: true },
          cookie,
        );
        const expiredId = created.data.id;
        await request(
          `/attempts/${expiredId}/draft`,
          "PUT",
          { code: "deadline snapshot", revision: 0 },
          cookie,
        );
        await pool.query(
          "UPDATE attempts SET deadline=now()-interval '1 second' WHERE id=$1",
          [expiredId],
        );
        await expireAttempts();
        await expireAttempts();
        const state = await request(
          `/attempts/${expiredId}`,
          "GET",
          undefined,
          cookie,
        );
        assert.equal(state.data.end_reason, "deadline");
        assert.equal(state.data.status, "submitted");
        assert.equal(
          (
            await request(
              `/attempts/${expiredId}/draft`,
              "PUT",
              { code: "late edit", revision: 1 },
              cookie,
            )
          ).status,
          409,
        );
        const jobs = await pool.query(
          "SELECT code FROM jobs WHERE attempt_id=$1 AND kind='submit'",
          [expiredId],
        );
        assert.equal(jobs.rowCount, 1);
        assert.equal(jobs.rows[0].code, "deadline snapshot");
        await workOne(async () => {
          throw new Error("offline");
        });
        await pool.query(
          "UPDATE jobs SET updated_at=now()-interval '10 seconds' WHERE attempt_id=$1",
          [expiredId],
        );
        await request(`/attempts/${expiredId}/retry`, "POST", {}, cookie);
        await workOne(async (_code, tests) =>
          tests.map((_, index) => ({
            index,
            passed: true,
            status: "Accepted",
          })),
        );
        assert.equal(
          (await request(`/attempts/${expiredId}`, "GET", undefined, cookie))
            .data.status,
          "completed",
        );
      },
    );
    await t.test(
      "reclaims interrupted jobs and rejects oversized code",
      async () => {
        const created = await request(
          "/attempts",
          "POST",
          { acknowledged: true },
          cookie,
        );
        const a = created.data.id;
        assert.equal(
          (
            await request(
              `/attempts/${a}/draft`,
              "PUT",
              { code: "x".repeat(50001), revision: 0 },
              cookie,
            )
          ).status,
          400,
        );
        await request(`/attempts/${a}/runs`, "POST", { code: "x" }, cookie);
        await pool.query(
          "UPDATE jobs SET state='running',tries=1,lease_until=now()-interval '1 second' WHERE attempt_id=$1",
          [a],
        );
        await workOne(async (_code, tests) =>
          tests.map((_, index) => ({
            index,
            passed: true,
            status: "Accepted",
          })),
        );
        const result = await request(
          `/attempts/${a}`,
          "GET",
          undefined,
          cookie,
        );
        assert.equal(result.data.jobs[0].state, "completed");
      },
    );
    await t.test(
      "language drafts survive switching and final jobs retain the selected language",
      async () => {
        const session = await request("/bootstrap");
        const created = await request(
          "/attempts",
          "POST",
          { acknowledged: true },
          session.cookie,
        );
        const id = created.data.id;
        const url = `/attempts/${id}`;
        assert.equal(created.data.language, "python");
        await request(
          `${url}/draft`,
          "PUT",
          { code: "python draft", revision: 0 },
          session.cookie,
        );
        let result = await request(
          `${url}/language`,
          "PUT",
          { language: "cpp", revision: 1 },
          session.cookie,
        );
        assert.equal(result.data.language, "cpp");
        assert.match(result.data.draft, /#include/);
        assert.equal(result.data.deadline, created.data.deadline);
        await request(
          `${url}/draft`,
          "PUT",
          { code: "cpp draft", revision: 2 },
          session.cookie,
        );
        result = await request(
          `${url}/language`,
          "PUT",
          { language: "java", revision: 3 },
          session.cookie,
        );
        assert.match(result.data.draft, /public class Main/);
        result = await request(
          `${url}/language`,
          "PUT",
          { language: "python", revision: 4 },
          session.cookie,
        );
        assert.equal(result.data.draft, "python draft");
        result = await request(
          `${url}/language`,
          "PUT",
          { language: "cpp", revision: 5 },
          session.cookie,
        );
        assert.equal(result.data.draft, "cpp draft");
        assert.equal(
          (
            await request(
              `${url}/runs`,
              "POST",
              { code: "stale python", revision: 5 },
              session.cookie,
            )
          ).status,
          409,
        );
        assert.equal(
          (
            await request(
              `${url}/language`,
              "PUT",
              { language: "ruby", revision: 6 },
              session.cookie,
            )
          ).status,
          400,
        );
        await request(
          `${url}/submit`,
          "POST",
          { key: randomUUID(), revision: 6 },
          session.cookie,
        );
        const stored = await pool.query(
          "SELECT language,code FROM jobs WHERE attempt_id=$1 AND kind='submit'",
          [id],
        );
        assert.equal(stored.rows[0].language, "cpp");
        assert.equal(stored.rows[0].code, "cpp draft");
        await workOne(async (_code, tests, _reveal, language) => {
          assert.equal(language, "cpp");
          return tests.map((_, index) => ({
            index,
            passed: true,
            status: "Accepted",
          }));
        });
        assert.equal(
          (
            await request(
              `${url}/language`,
              "PUT",
              { language: "java", revision: 6 },
              session.cookie,
            )
          ).status,
          409,
        );
      },
    );
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});
