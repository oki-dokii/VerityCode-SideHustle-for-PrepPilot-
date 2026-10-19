import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import "dotenv/config";
const base =
  process.env.DATABASE_URL ||
  "postgresql://veritycode@127.0.0.1:54329/veritycode";
const admin = new pg.Pool({ connectionString: base }),
  schema = `monitor_${randomUUID().replaceAll("-", "")}`;
await admin.query(`CREATE SCHEMA ${schema}`);
const url = new URL(base);
url.searchParams.set("options", `-c search_path=${schema}`);
process.env.DATABASE_URL = url.toString();
const { pool, migrate } = await import("../server/db.js");
const { makeApp } = await import("../server/app.js");
await migrate();
await migrate();
const server = makeApp().listen(0, "127.0.0.1");
await new Promise<void>((r) => server.once("listening", r));
const endpoint = `http://127.0.0.1:${(server.address() as any).port}/api`;
let cookie = "";
async function req(
  path: string,
  method = "GET",
  body?: unknown,
  auth = cookie,
) {
  const response = await fetch(endpoint + path, {
    method,
    headers: {
      "Content-Type": "application/json",
      "X-VerityCode": "1",
      Cookie: auth,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: response.status,
    data: await response.json(),
    cookie: response.headers.get("set-cookie")?.split(";")[0],
  };
}
await test("monitoring ownership, retry, ordering, cutoff and legacy compatibility", async (t) => {
  try {
    cookie = (await req("/bootstrap")).cookie!;
    const attempt = (await req("/attempts", "POST", { acknowledged: true }))
        .data,
      id = attempt.id,
      path = `/attempts/${id}`;
    const sessionId = randomUUID();
    assert.equal(attempt.monitoring_enabled, true);
    assert.equal(
      (await req(`${path}/monitoring/sessions`, "POST", { sessionId })).status,
      201,
    );
    await pool.query(
      "UPDATE attempts SET started_at=now()-interval '60 seconds' WHERE id=$1",
      [id],
    );
    await pool.query(
      "UPDATE monitoring_sessions SET started_at=(SELECT started_at FROM attempts WHERE id=$1) WHERE id=$2",
      [id, sessionId],
    );
    const make = (sequence: number, elapsedMs: number, type = "heartbeat") => ({
      id: randomUUID(),
      sessionId,
      sequence,
      elapsedMs,
      type,
      state: { visible: true, focused: true, fullscreen: false },
    });
    const a = make(0, 0, "session_started"),
      b = make(1, 5000),
      c = make(2, 10000, "editor_paste");
    await t.test(
      "out-of-order batches and repeated IDs reconcile without duplication",
      async () => {
        assert.equal(
          (await req(`${path}/events/batch`, "POST", { events: [c, a] }))
            .status,
          200,
        );
        let report = (await req(`${path}/monitoring`)).data;
        assert.equal(report.coveredMs, 0);
        assert.equal(
          (await req(`${path}/events/batch`, "POST", { events: [b, a, c] }))
            .status,
          200,
        );
        report = (await req(`${path}/monitoring`)).data;
        assert.equal(report.coveredMs, 10000);
        assert.equal(report.eventCount, 2);
        assert.equal(report.counts.heartbeat, 1);
        assert.ok(report.events.every((e: any) => e.receivedAt));
      },
    );
    await t.test(
      "rejects clipboard contents, invalid timestamps, unknown sessions and cross-owner reads",
      async () => {
        assert.equal(
          (
            await req(`${path}/events/batch`, "POST", {
              events: [{ ...make(3, 11000), clipboard: "private" }],
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await req(`${path}/events/batch`, "POST", {
              events: [make(3, 600000)],
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await req(`${path}/events/batch`, "POST", {
              events: [{ ...make(3, 11000), sessionId: randomUUID() }],
            })
          ).status,
          400,
        );
        const other = (await req("/bootstrap", "GET", undefined, "")).cookie!;
        assert.equal(
          (await req(`${path}/monitoring`, "GET", undefined, other)).status,
          404,
        );
        assert.equal(
          (await req(`${path}/events/batch`, "POST", { events: [a] }, other))
            .status,
          404,
        );
      },
    );
    await t.test("conflicting retries roll back the entire batch", async () => {
      const fresh = make(3, 11000);
      assert.equal(
        (
          await req(`${path}/events/batch`, "POST", {
            events: [fresh, { ...a, type: "window_blur" }],
          })
        ).status,
        409,
      );
      assert.equal(
        (
          await pool.query("SELECT id FROM browser_events WHERE id=$1", [
            fresh.id,
          ])
        ).rowCount,
        0,
      );
    });
    await t.test(
      "late upload accepted but events after final submission discarded",
      async () => {
        await req(`${path}/submit`, "POST", { key: randomUUID(), revision: 0 });
        const state = (await req(path)).data;
        const end =
          Date.parse(state.submitted_at) - Date.parse(state.started_at);
        const late = make(3, 15000, "window_blur"),
          after = make(4, Math.ceil(end + 500), "window_focus");
        const response = await req(`${path}/events/batch`, "POST", {
          events: [late, after],
        });
        assert.equal(response.status, 200);
        assert.deepEqual(response.data.discarded, [after.id]);
        assert.equal(
          (await req(`${path}/monitoring`)).data.counts.window_blur,
          1,
        );
        assert.equal(
          (
            await req(`${path}/monitoring/sessions`, "POST", {
              sessionId: randomUUID(),
            })
          ).status,
          409,
        );
      },
    );
    await t.test("legacy attempts remain unmonitored", async () => {
      const legacy = (await req("/attempts", "POST", { acknowledged: true }))
        .data;
      await pool.query(
        "UPDATE attempts SET monitoring_enabled=false WHERE id=$1",
        [legacy.id],
      );
      assert.equal(
        (await req(`/attempts/${legacy.id}/monitoring`)).data.enabled,
        false,
      );
      assert.equal(
        (
          await req(`/attempts/${legacy.id}/monitoring/sessions`, "POST", {
            sessionId: randomUUID(),
          })
        ).status,
        409,
      );
    });
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});
