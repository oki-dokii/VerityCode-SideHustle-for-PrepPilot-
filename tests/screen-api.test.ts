import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import pg from "pg";
import "dotenv/config";
const base =
  process.env.DATABASE_URL ||
  "postgresql://veritycode@127.0.0.1:54329/veritycode";
const admin = new pg.Pool({ connectionString: base }),
  schema = `screen_${randomUUID().replaceAll("-", "")}`;
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
await test("screen evidence requires separate consent, remains private and obeys expiry/revocation", async (t) => {
  try {
    cookie = (await req("/bootstrap")).cookie!;
    const a = (await req("/attempts", "POST", { acknowledged: true })).data;
    const path = `/attempts/${a.id}/screen`,
      sessionId = randomUUID(),
      other = (await req("/bootstrap", "GET", undefined, "")).cookie!;
    const jpeg = Buffer.from([255, 216, 255, 217]).toString("base64");
    const b = {
      id: randomUUID(),
      sessionId,
      elapsedMs: Date.now() - Date.parse(a.started_at),
      reason: "periodic",
      jpeg,
    };
    await t.test(
      "rejects absent consent and cross-owner registration",
      async () => {
        assert.equal((await req(path + "/captures", "POST", b)).status, 403);
        assert.equal(
          (
            await req(path + "/sessions", "POST", {
              sessionId,
              surface: "monitor",
            })
          ).status,
          400,
        );
        assert.equal(
          (
            await req(
              path + "/sessions",
              "POST",
              { sessionId, acknowledged: true, surface: "monitor" },
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
              surface: "monitor",
            })
          ).status,
          201,
        );
      },
    );
    await t.test(
      "bounded immutable captures, rate limits, no public image access",
      async () => {
        assert.equal(
          (await req(path + "/captures", "POST", { ...b, jpeg: "bad" })).status,
          400,
        );
        assert.equal((await req(path + "/captures", "POST", b)).status, 200);
        assert.equal((await req(path + "/captures", "POST", b)).status, 200);
        assert.equal(
          (
            await req(path + "/captures", "POST", {
              ...b,
              reason: "window_blur",
            })
          ).status,
          409,
        );
        assert.equal(
          (await req(path + "/captures", "POST", { ...b, id: randomUUID() }))
            .status,
          429,
        );
        assert.equal((await req(path, "GET", undefined, other)).status, 404);
        assert.equal(
          (await req(path + "/evidence/" + b.id, "GET", undefined, other))
            .status,
          404,
        );
        const image = await fetch(endpoint + path + "/evidence/" + b.id, {
          headers: { Cookie: cookie },
        });
        assert.equal(image.status, 200);
        assert.equal(image.headers.get("cache-control"), "no-store");
      },
    );
    await t.test("expiry denies reads and clears stored bytes", async () => {
      await pool.query(
        "UPDATE screen_evidence SET expires_at=now()-interval '1 second' WHERE id=$1",
        [b.id],
      );
      assert.equal((await req(path + "/evidence/" + b.id)).status, 410);
      const { purgeEvidence } = await import("../server/vision.js");
      await purgeEvidence();
      assert.equal(
        (
          await pool.query("SELECT image FROM screen_evidence WHERE id=$1", [
            b.id,
          ])
        ).rows[0].image,
        null,
      );
    });
    await t.test(
      "stopped sharing and revoked consent reject further captures",
      async () => {
        assert.equal(
          (
            await req(path + "/stop", "POST", {
              sessionId,
              reason: "stream_ended",
            })
          ).status,
          200,
        );
        assert.equal(
          (await req(path + "/captures", "POST", { ...b, id: randomUUID() }))
            .status,
          403,
        );
        const second = randomUUID();
        await req(path + "/sessions", "POST", {
          sessionId: second,
          acknowledged: true,
          surface: "window",
        });
        await req(path + "/evidence", "DELETE");
        assert.equal(
          (
            await req(path + "/captures", "POST", {
              ...b,
              id: randomUUID(),
              sessionId: second,
            })
          ).status,
          403,
        );
        assert.equal(
          (await req(path)).data.sessions.find((s: any) => s.id === second)
            .consent,
          false,
        );
      },
    );
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await pool.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
});
