import { gazeStates, phoneStates } from "../shared/advancedVision.js";
import { z } from "zod";
import { pool, transaction } from "./db.js";
import { owned, HttpError } from "./service.js";
import { VISION_VERSION, visionStates } from "../shared/vision.js";
export const observationSchema = z
  .object({
    id: z.string().uuid(),
    sessionId: z.string().uuid(),
    sequence: z.number().int().min(0).max(100000),
    elapsedMs: z.number().int().min(0).max(7200000),
    state: z.enum(visionStates),
    calibrated: z.boolean(),
    gaze: z.enum(gazeStates).optional(),
    phone: z.enum(phoneStates).optional(),
    phoneScore: z.number().min(0).max(1).optional(),
    gazeError: z.number().min(0).max(1).optional(),
    reason: z
      .enum([
        "usable",
        "low_light",
        "stale_frame",
        "camera_muted",
        "tab_hidden",
        "pending_transition",
        "stopped",
      ])
      .optional(),
    inferenceMs: z.number().min(0).max(60000),
  })
  .strict();
export const cameraBatch = z
  .object({ observations: z.array(observationSchema).min(1).max(50) })
  .strict();
export const cameraConsent = z
  .object({
    sessionId: z.string().uuid(),
    acknowledged: z.literal(true),
    evidence: z.boolean(),
  })
  .strict();
export async function startCamera(
  id: string,
  owner: string,
  body: z.infer<typeof cameraConsent>,
) {
  return transaction(async (c) => {
    const a = await owned(c, id, owner);
    if (a.status !== "active" || a.expired)
      throw new HttpError(409, "This assessment has ended.");
    const old = await c.query("SELECT * FROM camera_sessions WHERE id=$1", [
      body.sessionId,
    ]);
    if (
      old.rowCount &&
      (old.rows[0].attempt_id !== id ||
        old.rows[0].stopped_at ||
        old.rows[0].evidence_consent !== body.evidence)
    )
      throw new HttpError(409, "Camera session already used.");
    const count = await c.query(
      "SELECT count(*) FROM camera_sessions WHERE attempt_id=$1",
      [id],
    );
    if (!old.rowCount && Number(count.rows[0].count) >= 100)
      throw new HttpError(429, "Camera session limit reached.");
    await c.query(
      "INSERT INTO camera_sessions(id,attempt_id,evidence_consent,version) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",
      [body.sessionId, id, body.evidence, VISION_VERSION],
    );
    return { serverNow: new Date().toISOString(), startedAt: a.started_at };
  });
}
export async function stopCamera(id: string, owner: string, sessionId: string) {
  return transaction(async (c) => {
    await owned(c, id, owner);
    await c.query(
      "UPDATE camera_sessions SET stopped_at=COALESCE(stopped_at,now()) WHERE id=$1 AND attempt_id=$2",
      [sessionId, id],
    );
    return { ok: true };
  });
}
export async function ingestCamera(
  id: string,
  owner: string,
  observations: z.infer<typeof observationSchema>[],
) {
  return transaction(async (c) => {
    const a = await owned(c, id, owner),
      start = new Date(a.started_at).getTime();
    const cutoff = Math.min(
      new Date(a.deadline).getTime(),
      a.submitted_at ? new Date(a.submitted_at).getTime() : Date.now(),
    );
    if (Date.now() - cutoff > 7 * 86400000)
      throw new HttpError(410, "Camera upload window expired.");
    const count = await c.query(
      "SELECT count(*) FROM camera_observations WHERE attempt_id=$1",
      [id],
    );
    let n = Number(count.rows[0].count);
    const acknowledged: string[] = [];
    for (const o of observations) {
      const {
        rows: [session],
      } = await c.query(
        "SELECT * FROM camera_sessions WHERE id=$1 AND attempt_id=$2",
        [o.sessionId, id],
      );
      if (!session) throw new HttpError(400, "Unknown camera session.");
      const time = start + o.elapsedMs;
      if (
        time > Date.now() + 2000 ||
        time < new Date(session.started_at).getTime() - 2000
      )
        throw new HttpError(400, "Invalid camera timestamp.");
      const existing = await c.query(
        "SELECT payload FROM camera_observations WHERE id=$1 OR (session_id=$2 AND sequence=$3)",
        [o.id, o.sessionId, o.sequence],
      );
      if (existing.rowCount) {
        if (
          JSON.stringify(observationSchema.parse(existing.rows[0].payload)) !==
          JSON.stringify(o)
        )
          throw new HttpError(409, "Observation identity conflict.");
      } else if (
        time <= cutoff &&
        (!session.stopped_at || time <= new Date(session.stopped_at).getTime())
      ) {
        if (++n > 20000)
          throw new HttpError(429, "Camera observation limit reached.");
        await c.query(
          "INSERT INTO camera_observations(id,session_id,attempt_id,sequence,elapsed_ms,payload) VALUES($1,$2,$3,$4,$5,$6)",
          [o.id, o.sessionId, id, o.sequence, o.elapsedMs, JSON.stringify(o)],
        );
      }
      acknowledged.push(o.id);
    }
    return { acknowledged };
  });
}
export async function purgeEvidence() {
  await pool.query(
    "UPDATE screen_evidence SET image=NULL,deleted_at=now() WHERE image IS NOT NULL AND expires_at<=now()",
  );
  await pool.query(
    "UPDATE camera_evidence SET image=NULL,deleted_at=now() WHERE image IS NOT NULL AND expires_at<=now()",
  );
}
export async function saveEvidence(
  id: string,
  owner: string,
  observationId: string,
  jpeg: string,
) {
  const image = Buffer.from(jpeg, "base64");
  if (
    image.length > 48000 ||
    image.length < 4 ||
    image[0] !== 255 ||
    image[1] !== 216 ||
    image.at(-2) !== 255 ||
    image.at(-1) !== 217
  )
    throw new HttpError(400, "Invalid JPEG snapshot.");
  return transaction(async (c) => {
    const a = await owned(c, id, owner);
    if (a.status !== "active" || a.expired)
      throw new HttpError(409, "Assessment ended.");
    const {
      rows: [o],
    } = await c.query(
      "SELECT o.*,s.evidence_consent,s.stopped_at FROM camera_observations o JOIN camera_sessions s ON s.id=o.session_id WHERE o.id=$1 AND o.attempt_id=$2",
      [observationId, id],
    );
    if (!o) throw new HttpError(404, "Observation not found.");
    if (!o.evidence_consent || o.stopped_at)
      throw new HttpError(403, "Snapshot consent is not active.");
    if (
      !["no_face", "multiple_faces", "head_turned"].includes(o.payload.state) &&
      o.payload.phone !== "detected" &&
      o.payload.gaze !== "repeated"
    )
      throw new HttpError(400, "Snapshot requires a review observation.");
    if (Date.now() - new Date(a.started_at).getTime() - o.elapsed_ms > 10000)
      throw new HttpError(400, "Snapshot observation is stale.");
    const existing = await c.query(
      "SELECT id FROM camera_evidence WHERE id=$1",
      [observationId],
    );
    if (existing.rowCount) return { ok: true };
    const count = await c.query(
      "SELECT count(*),max(created_at) AS latest FROM camera_evidence WHERE attempt_id=$1",
      [id],
    );
    if (
      Number(count.rows[0].count) >= 20 ||
      (count.rows[0].latest &&
        Date.now() - new Date(count.rows[0].latest).getTime() < 60000)
    )
      throw new HttpError(
        429,
        "Snapshot limit: one per minute, twenty per attempt.",
      );
    await c.query(
      "INSERT INTO camera_evidence(id,attempt_id,session_id,image) VALUES($1,$2,$3,$4)",
      [observationId, id, o.session_id, image],
    );
    return { ok: true };
  });
}
export async function deleteEvidence(id: string, owner: string) {
  return transaction(async (c) => {
    await owned(c, id, owner);
    await c.query(
      "UPDATE camera_sessions SET evidence_consent=false WHERE attempt_id=$1",
      [id],
    );
    await c.query(
      "UPDATE camera_evidence SET image=NULL,deleted_at=COALESCE(deleted_at,now()) WHERE attempt_id=$1",
      [id],
    );
    return { ok: true };
  });
}
export async function readEvidence(
  id: string,
  owner: string,
  evidenceId: string,
) {
  const {
    rows: [r],
  } = await pool.query(
    "SELECT e.image,e.expires_at FROM camera_evidence e JOIN attempts a ON a.id=e.attempt_id WHERE e.id=$1 AND a.id=$2 AND a.owner=$3",
    [evidenceId, id, owner],
  );
  if (!r) throw new HttpError(404, "Evidence not found.");
  if (!r.image || new Date(r.expires_at).getTime() <= Date.now())
    throw new HttpError(410, "Evidence deleted or expired.");
  return r.image as Buffer;
}
export async function cameraReport(id: string, owner: string) {
  const {
    rows: [a],
  } = await pool.query("SELECT * FROM attempts WHERE id=$1 AND owner=$2", [
    id,
    owner,
  ]);
  if (!a) throw new HttpError(404, "Attempt not found.");
  const totalMs = Math.max(
    0,
    Math.min(
      Date.now(),
      new Date(a.deadline).getTime(),
      a.submitted_at ? new Date(a.submitted_at).getTime() : Infinity,
    ) - new Date(a.started_at).getTime(),
  );
  const { rows } = await pool.query(
    "SELECT o.payload,e.id AS evidence_id,(e.image IS NOT NULL AND e.expires_at>now()) AS available FROM camera_observations o LEFT JOIN camera_evidence e ON e.id=o.id WHERE o.attempt_id=$1 ORDER BY o.elapsed_ms,o.session_id,o.sequence",
    [id],
  );
  const observations = rows.map((r) => ({
    ...r.payload,
    evidenceId: r.evidence_id,
    evidenceAvailable: r.available,
  }));
  const intervals: { start: number; end: number }[] = [];
  const gazeIntervals: { start: number; end: number }[] = [];
  const phoneIntervals: { start: number; end: number }[] = [];
  const previous = new Map<string, any>();
  const timeline: any[] = [];
  for (const o of observations) {
    const p = previous.get(o.sessionId);
    if (
      p &&
      o.sequence === p.sequence + 1 &&
      o.elapsedMs >= p.elapsedMs &&
      o.elapsedMs - p.elapsedMs <= 1500
    ) {
      const interval = {
        start: p.elapsedMs,
        end: Math.min(totalMs, o.elapsedMs),
      };
      if (
        ["inside", "outside", "repeated"].includes(p.gaze) &&
        ["inside", "outside", "repeated"].includes(o.gaze)
      )
        gazeIntervals.push(interval);
      if (
        ["detected", "not_detected"].includes(p.phone) &&
        ["detected", "not_detected"].includes(o.phone)
      )
        phoneIntervals.push(interval);
    }
    if (
      p &&
      o.sequence === p.sequence + 1 &&
      o.elapsedMs - p.elapsedMs <= 1500 &&
      o.state !== "unknown" &&
      p.state !== "unknown"
    )
      intervals.push({
        start: p.elapsedMs,
        end: Math.min(totalMs, o.elapsedMs),
      });
    if (
      !p ||
      p.state !== o.state ||
      p.calibrated !== o.calibrated ||
      p.gaze !== o.gaze ||
      p.phone !== o.phone ||
      p.reason !== o.reason ||
      o.evidenceId
    )
      timeline.push(o);
    previous.set(o.sessionId, o);
  }
  intervals.sort((a, b) => a.start - b.start);
  let end = 0,
    coveredMs = 0;
  const gaps: { start: number; end: number }[] = [];
  for (const i of intervals) {
    if (i.start > end) gaps.push({ start: end, end: i.start });
    coveredMs += Math.max(0, i.end - Math.max(end, i.start));
    end = Math.max(end, i.end);
  }
  if (end < totalMs) gaps.push({ start: end, end: totalMs });
  const { rows: sessions } = await pool.query(
    "SELECT id,started_at,stopped_at,evidence_consent,version FROM camera_sessions WHERE attempt_id=$1 ORDER BY started_at",
    [id],
  );
  function observedMs(items: { start: number; end: number }[]) {
    let end = 0,
      total = 0;
    for (const i of items.sort((a, b) => a.start - b.start)) {
      total += Math.max(0, i.end - Math.max(end, i.start));
      end = Math.max(end, i.end);
    }
    return total;
  }
  return {
    gazeCoveredMs: observedMs(gazeIntervals),
    phoneCoveredMs: observedMs(phoneIntervals),
    totalMs,
    coveredMs,
    gaps,
    events: timeline.slice(-200),
    eventCount: timeline.length,
    sessions,
  };
}
