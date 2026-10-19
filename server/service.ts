import { languages, type Language } from "../shared/languages.js";
import { randomUUID, createHash } from "node:crypto";
import type pg from "pg";
import { pool, transaction } from "./db.js";
import { problem, hiddenTests } from "./problem.js";
import { judge0, type Runner } from "./runner.js";
export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function owned(client: pg.PoolClient, id: string, owner: string) {
  const { rows } = await client.query(
    "SELECT *, deadline <= clock_timestamp() AS expired FROM attempts WHERE id=$1 AND owner=$2 FOR UPDATE",
    [id, owner],
  );
  if (!rows[0]) throw new HttpError(404, "Attempt not found.");
  return rows[0];
}
export async function finalise(
  client: pg.PoolClient,
  attempt: any,
  reason: string,
  key: string = randomUUID(),
) {
  if (attempt.status !== "active") return;
  const hash = createHash("sha256").update(attempt.draft).digest("hex");
  await client.query(
    `UPDATE attempts SET status='submitted', final_code=draft, final_hash=$2, submitted_at=now(), end_reason=$3, submission_key=$4 WHERE id=$1`,
    [attempt.id, hash, reason, key],
  );
  await client.query(
    "INSERT INTO jobs(id,attempt_id,kind,code,language) VALUES($1,$2,'submit',$3,$4) ON CONFLICT DO NOTHING",
    [randomUUID(), attempt.id, attempt.draft, attempt.language],
  );
}
export async function createAttempt(owner: string) {
  return transaction(async (client) => {
    // Serialise starts in the same browser session.
    await client.query("SELECT id FROM sessions WHERE id=$1 FOR UPDATE", [
      owner,
    ]);
    const current = await client.query(
      "SELECT * FROM attempts WHERE owner=$1 AND status='active' AND deadline > now() ORDER BY started_at DESC LIMIT 1",
      [owner],
    );
    if (current.rows[0]) return current.rows[0].id;
    const id = randomUUID();
    await client.query(
      "INSERT INTO attempts(id,owner,deadline,draft,monitoring_enabled) VALUES($1,$2,now()+interval '30 minutes',$3,true)",
      [id, owner, problem.starter],
    );
    return id;
  });
}
export async function saveDraft(
  id: string,
  owner: string,
  code: string,
  revision: number,
) {
  return transaction(async (client) => {
    const attempt = await owned(client, id, owner);
    if (attempt.expired && attempt.status === "active")
      await finalise(client, attempt, "deadline");
    if (attempt.expired || attempt.status !== "active") return { closed: true };
    if (attempt.revision !== revision)
      throw new HttpError(
        409,
        "A newer draft exists, possibly in another tab. Reload the saved draft before continuing.",
      );
    const result = await client.query(
      "UPDATE attempts SET draft=$2, revision=revision+1, saved_at=now() WHERE id=$1 RETURNING revision,saved_at",
      [id, code],
    );
    return result.rows[0];
  });
}
export async function submit(
  id: string,
  owner: string,
  key: string,
  expectedRevision: number,
) {
  await transaction(async (client) => {
    const attempt = await owned(client, id, owner);
    if (
      attempt.status === "active" &&
      !attempt.expired &&
      attempt.revision !== expectedRevision
    )
      throw new HttpError(
        409,
        "The saved draft changed. Reload before submitting.",
      );
    await finalise(
      client,
      attempt,
      attempt.expired ? "deadline" : "submitted",
      key,
    );
  });
}
export async function expireAttempts() {
  await transaction(async (client) => {
    const { rows } = await client.query(
      "SELECT * FROM attempts WHERE status='active' AND deadline <= now() FOR UPDATE SKIP LOCKED",
    );
    for (const attempt of rows) await finalise(client, attempt, "deadline");
  });
}
export async function getAttempt(id: string, owner: string) {
  await transaction(async (client) => {
    const attempt = await owned(client, id, owner);
    if (attempt.expired) await finalise(client, attempt, "deadline");
  });
  const {
    rows: [attempt],
  } = await pool.query(
    "SELECT id,status,started_at,deadline,language,monitoring_enabled,draft,revision,saved_at,submitted_at,end_reason,final_hash FROM attempts WHERE id=$1 AND owner=$2",
    [id, owner],
  );
  const { rows: jobs } = await pool.query(
    "SELECT id,kind,language,state,results,error,created_at FROM jobs WHERE attempt_id=$1 ORDER BY created_at DESC LIMIT 8",
    [id],
  );
  return {
    ...attempt,
    jobs,
    serverNow: new Date().toISOString(),
    monitoring: attempt.monitoring_enabled ? "browser_only" : "not_enabled",
  };
}
export async function runCode(
  id: string,
  owner: string,
  code: string,
  expectedRevision?: number,
) {
  return transaction(async (client) => {
    const attempt = await owned(client, id, owner);
    if (attempt.expired || attempt.status !== "active")
      throw new HttpError(409, "This assessment has ended.");
    if (expectedRevision !== undefined && attempt.revision !== expectedRevision)
      throw new HttpError(
        409,
        "The saved draft or language changed. Reload before running.",
      );
    const pending = await client.query(
      "SELECT id FROM jobs WHERE attempt_id=$1 AND kind='run' AND state IN ('queued','running')",
      [id],
    );
    if (pending.rows[0]) return pending.rows[0].id;
    const count = await client.query(
      "SELECT count(*) FROM jobs WHERE attempt_id=$1 AND created_at > now()-interval '1 minute'",
      [id],
    );
    if (Number(count.rows[0].count) >= 10)
      throw new HttpError(429, "Please wait before running again.");
    const jobId = randomUUID();
    await client.query(
      "INSERT INTO jobs(id,attempt_id,kind,code,language) VALUES($1,$2,'run',$3,$4)",
      [jobId, id, code, attempt.language],
    );
    return jobId;
  });
}
export async function retryGrading(id: string, owner: string) {
  await transaction(async (client) => {
    await owned(client, id, owner);
    await client.query(
      "UPDATE jobs SET state='queued', tries=0,error=NULL,updated_at=now() WHERE attempt_id=$1 AND kind='submit' AND state='unavailable' AND updated_at < now()-interval '5 seconds'",
      [id],
    );
  });
}
export async function workOne(runner: Runner = judge0) {
  const job = await transaction(async (client) => {
    // A crashed worker's job can be reclaimed. The lease token fences stale completions.
    await client.query(
      "UPDATE jobs SET state='unavailable', error='Execution interrupted repeatedly. Retry grading.',updated_at=now() WHERE state='running' AND lease_until < now() AND tries >= 3",
    );
    const { rows } = await client.query(
      "SELECT * FROM jobs WHERE state='queued' OR (state='running' AND lease_until < now() AND tries < 3) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1",
    );
    if (!rows[0]) return null;
    const token = randomUUID();
    await client.query(
      "UPDATE jobs SET state='running',tries=tries+1,lease_until=now()+interval '120 seconds',lease_token=$2,updated_at=now() WHERE id=$1",
      [rows[0].id, token],
    );
    return { ...rows[0], token };
  });
  if (!job) return false;
  try {
    const tests = job.kind === "run" ? problem.examples : hiddenTests;
    const results = await runner(
      job.code,
      tests,
      job.kind === "run",
      job.language,
    );
    if (results.length !== tests.length)
      throw new Error("Incomplete execution results.");
    // Even a future adapter cannot accidentally expose hidden stdout or diagnostics.
    const safe =
      job.kind === "submit"
        ? results.map(({ index, status, passed, time, memory }) => ({
            index,
            status,
            passed,
            time,
            memory,
          }))
        : results;
    await transaction(async (client) => {
      const updated = await client.query(
        "UPDATE jobs SET state='completed',results=$2,updated_at=now(),lease_until=NULL WHERE id=$1 AND lease_token=$3 AND state='running' RETURNING id",
        [job.id, JSON.stringify(safe), job.token],
      );
      if (updated.rowCount && job.kind === "submit")
        await client.query(
          "UPDATE attempts SET status='completed' WHERE id=$1",
          [job.attempt_id],
        );
    });
  } catch {
    // Never store upstream response bodies or secrets in user-visible errors.
    await pool.query(
      "UPDATE jobs SET state='unavailable',error=$2,updated_at=now(),lease_until=NULL WHERE id=$1 AND lease_token=$3 AND state='running'",
      [
        job.id,
        "Execution unavailable. Your code is saved. Configure or check the runner, then retry.",
        job.token,
      ],
    );
  }
  return true;
}

export async function changeLanguage(
  id: string,
  owner: string,
  language: Language,
  revision: number,
) {
  return transaction(async (client) => {
    const attempt = await owned(client, id, owner);
    if (attempt.expired || attempt.status !== "active")
      throw new HttpError(409, "This assessment has ended.");
    if (attempt.revision !== revision)
      throw new HttpError(
        409,
        "A newer draft exists. Load the saved draft before switching languages.",
      );
    const drafts = { ...attempt.drafts, [attempt.language]: attempt.draft };
    const draft = drafts[language] ?? languages[language].starter;
    await client.query(
      "UPDATE attempts SET language=$2, draft=$3, drafts=$4, revision=revision+1, saved_at=now() WHERE id=$1",
      [id, language, draft, JSON.stringify(drafts)],
    );
  });
}
