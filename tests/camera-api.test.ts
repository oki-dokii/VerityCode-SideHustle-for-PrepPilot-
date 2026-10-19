import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import "dotenv/config";
const base =
  process.env.DATABASE_URL ||
  "postgresql://veritycode@127.0.0.1:54329/veritycode";
const admin = new pg.Pool({ connectionString: base }),
  schema = `camera_${randomUUID().replaceAll("-", "")}`;
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
await test("camera consent, immutable metadata, evidence isolation, revoke and retention", async (t) => {
  try {
    cookie = (await req("/bootstrap")).cookie!;
    const a = (await req("/attempts", "POST", { acknowledged: true })).data;
    const path = `/attempts/${a.id}/camera`,
      sessionId = randomUUID();
    const other = (await req("/bootstrap", "GET", undefined, "")).cookie!;
    await t.test(
      "explicit consent required, owner-scoped session",
      async () => {
        assert.equal(
          (
            await req(path + "/sessions", "POST", {
              sessionId,
              evidence: false,
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await req(
              path + "/sessions",
              "POST",
              { sessionId, acknowledged: true, evidence: true },
              other,
            )
          ).status,
          404,
        );
        assert.equal(
          (
            await req(path + "/sessions", "POST", {
              sessionId,
              acknowledged: true,
              evidence: true,
            })
          ).status,
          201,
        );
      },
    );
    const elapsed = () => Date.now() - Date.parse(a.started_at);
    const o = {
      id: randomUUID(),
      sessionId,
      sequence: 0,
      elapsedMs: elapsed(),
      state: "no_face",
      calibrated: false,
      inferenceMs: 30,
    };
    await t.test("idempotency and strict metadata allowlist", async () => {
      assert.equal(
        (
          await req(path + "/batch", "POST", {
            observations: [{ ...o, landmarks: [] }],
          })
        ).status,
        400,
      );
      assert.equal(
        (await req(path + "/batch", "POST", { observations: [o] })).status,
        200,
      );
      assert.equal(
        (await req(path + "/batch", "POST", { observations: [o] })).status,
        200,
      );
      assert.equal(
        (
          await req(path + "/batch", "POST", {
            observations: [{ ...o, state: "one_face" }],
          })
        ).status,
        409,
      );
      assert.equal(
        (
          await req(path + "/batch", "POST", {
            observations: [
              {
                ...o,
                id: randomUUID(),
                sequence: 1,
                elapsedMs: elapsed() + 100000,
              },
            ],
          })
        ).status,
        400,
      );
      assert.equal((await req(path, "GET", undefined, other)).status, 404);
    });
    const jpeg = Buffer.from([255, 216, 255, 217]).toString("base64");
    await t.test(
      "snapshots are private, bounded, consent gated and deletable",
      async () => {
        assert.equal(
          (
            await req(path + "/evidence", "POST", {
              observationId: o.id,
              jpeg: "not a JPEG",
            })
          ).status,
          400,
        );
        assert.equal(
          (await req(path + "/evidence", "POST", { observationId: o.id, jpeg }))
            .status,
          200,
        );
        assert.equal(
          (
            await fetch(endpoint + path + "/evidence/" + o.id, {
              headers: { Cookie: cookie },
            })
          ).status,
          200,
        );
        assert.equal(
          (await req(path + "/evidence/" + o.id, "GET", undefined, other))
            .status,
          404,
        );
        assert.equal((await req(path, "DELETE")).status, 404);
        assert.equal((await req(path + "/evidence", "DELETE")).status, 200);
        assert.equal((await req(path + "/evidence/" + o.id)).status, 410);
        assert.equal(
          (await req(path + "/evidence", "POST", { observationId: o.id, jpeg }))
            .status,
          403,
        );
      },
    );
    await t.test(
      "stop prevents new evidence and retention removes actual bytes",
      async () => {
        const second = randomUUID();
        await req(path + "/sessions", "POST", {
          sessionId: second,
          acknowledged: true,
          evidence: true,
        });
        const b = {
          ...o,
          id: randomUUID(),
          sessionId: second,
          elapsedMs: elapsed(),
        };
        await req(path + "/batch", "POST", { observations: [b] });
        // Separate fixture bypasses upload rate limits solely to exercise expiry cleanup.
        await pool.query(
          "INSERT INTO camera_evidence(id,attempt_id,session_id,image,expires_at) VALUES($1,$2,$3,$4,now()-interval '1 second')",
          [b.id, a.id, second, Buffer.from([255, 216, 255, 217])],
        );
        const { purgeEvidence } = await import("../server/vision.js");
        await purgeEvidence();
        const stored = await pool.query(
          "SELECT image,deleted_at FROM camera_evidence WHERE id=$1",
          [b.id],
        );
        assert.equal(stored.rows[0].image, null);
        assert.ok(stored.rows[0].deleted_at);
        assert.equal(
          (await req(path + "/stop", "POST", { sessionId: second })).status,
          200,
        );
        assert.equal(
          (await req(path + "/evidence", "POST", { observationId: b.id, jpeg }))
            .status,
          403,
        );
      },
    );
    await t.test(
      "missing observations and unknown quality do not count as coverage",
      async () => {
        await pool.query(
          "UPDATE attempts SET started_at=now()-interval '30 seconds' WHERE id=$1",
          [a.id],
        );
        await pool.query(
          "UPDATE camera_sessions SET started_at=now()-interval '30 seconds' WHERE attempt_id=$1",
          [a.id],
        );
        const third = randomUUID();
        await req(path + "/sessions", "POST", {
          sessionId: third,
          acknowledged: true,
          evidence: false,
        });
        await pool.query(
          "UPDATE camera_sessions SET started_at=now()-interval '30 seconds' WHERE id=$1",
          [third],
        );
        const obs = (
          sequence: number,
          elapsedMs: number,
          state = "one_face",
        ) => ({
          ...o,
          id: randomUUID(),
          sessionId: third,
          sequence,
          elapsedMs,
          state,
        });
        await req(path + "/batch", "POST", {
          observations: [
            obs(0, 5000),
            obs(1, 6000),
            obs(2, 7000, "unknown"),
            obs(3, 8000),
            obs(5, 10000),
            obs(6, 11000),
          ],
        });
        const r = (await req(path)).data;
        assert.equal(r.coveredMs, 2000);
        assert.ok(r.gaps.length >= 3);
      },
    );
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});
