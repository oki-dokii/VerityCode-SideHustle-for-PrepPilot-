import { z } from "zod";
import { pool, transaction } from "./db.js";
import { owned, HttpError } from "./service.js";
const uuid = z.string().uuid();
export const screenConsent = z
  .object({
    sessionId: uuid,
    acknowledged: z.literal(true),
    surface: z.enum(["browser", "window", "monitor", "unknown"]),
  })
  .strict();
export const screenCapture = z
  .object({
    id: uuid,
    sessionId: uuid,
    elapsedMs: z.number().int().min(0).max(7200000),
    reason: z.enum(["periodic", "window_blur", "capture_unavailable"]),
    jpeg: z
      .string()
      .max(64000)
      .regex(/^[A-Za-z0-9+/]+={0,2}$/)
      .optional(),
  })
  .strict();
export const screenStop = z
  .object({
    sessionId: uuid,
    reason: z.enum([
      "user_stopped",
      "stream_ended",
      "attempt_ended",
      "page_left",
      "error",
    ]),
  })
  .strict();
export async function startScreen(
  id: string,
  owner: string,
  b: z.infer<typeof screenConsent>,
) {
  return transaction(async (c) => {
    const a = await owned(c, id, owner);
    if (a.status !== "active" || a.expired)
      throw new HttpError(409, "Assessment ended.");
    const old = await c.query("SELECT * FROM screen_sessions WHERE id=$1", [
      b.sessionId,
    ]);
    if (
      old.rowCount &&
      (old.rows[0].attempt_id !== id ||
        old.rows[0].stopped_at ||
        !old.rows[0].consent ||
        old.rows[0].surface !== b.surface)
    )
      throw new HttpError(409, "Screen session already used.");
    const n = await c.query(
      "SELECT count(*) FROM screen_sessions WHERE attempt_id=$1",
      [id],
    );
    if (!old.rowCount && Number(n.rows[0].count) >= 50)
      throw new HttpError(429, "Screen session limit reached.");
    await c.query(
      "INSERT INTO screen_sessions(id,attempt_id,surface) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
      [b.sessionId, id, b.surface],
    );
    return { serverNow: new Date().toISOString(), startedAt: a.started_at };
  });
}
export async function stopScreen(
  id: string,
  owner: string,
  b: z.infer<typeof screenStop>,
) {
  return transaction(async (c) => {
    await owned(c, id, owner);
    await c.query(
      "UPDATE screen_sessions SET stopped_at=COALESCE(stopped_at,now()),stop_reason=COALESCE(stop_reason,$3) WHERE attempt_id=$1 AND id=$2",
      [id, b.sessionId, b.reason],
    );
    return { ok: true };
  });
}
export async function captureScreen(
  id: string,
  owner: string,
  b: z.infer<typeof screenCapture>,
) {
  const image = b.jpeg ? Buffer.from(b.jpeg, "base64") : null;
  if (
    image &&
    (image.length > 48000 ||
      image.length < 4 ||
      image[0] !== 255 ||
      image[1] !== 216 ||
      image.at(-2) !== 255 ||
      image.at(-1) !== 217)
  )
    throw new HttpError(400, "Invalid JPEG snapshot.");
  if ((b.reason === "capture_unavailable") === !!image)
    throw new HttpError(400, "Snapshot and capture reason disagree.");
  return transaction(async (c) => {
    const a = await owned(c, id, owner);
    if (a.status !== "active" || a.expired)
      throw new HttpError(409, "Assessment ended.");
    const {
      rows: [session],
    } = await c.query(
      "SELECT * FROM screen_sessions WHERE id=$1 AND attempt_id=$2",
      [b.sessionId, id],
    );
    if (!session || !session.consent || session.stopped_at)
      throw new HttpError(403, "Screen capture consent is not active.");
    const time = new Date(a.started_at).getTime() + b.elapsedMs;
    if (
      time < Date.now() - 15000 ||
      time > Date.now() + 2000 ||
      time < new Date(session.started_at).getTime() - 2000
    )
      throw new HttpError(400, "Invalid screen capture timestamp.");
    const {
      rows: [old],
    } = await c.query("SELECT * FROM screen_evidence WHERE id=$1", [b.id]);
    if (old) {
      if (
        old.attempt_id !== id ||
        old.session_id !== b.sessionId ||
        old.elapsed_ms !== b.elapsedMs ||
        old.reason !== b.reason ||
        !(
          (old.image === null && image === null) ||
          (old.image && image && old.image.equals(image))
        )
      )
        throw new HttpError(409, "Snapshot identity conflict.");
      return { ok: true };
    }
    const {
      rows: [n],
    } = await c.query(
      "SELECT count(*),max(created_at) latest FROM screen_evidence WHERE attempt_id=$1",
      [id],
    );
    if (
      Number(n.count) >= 240 ||
      (n.latest && Date.now() - new Date(n.latest).getTime() < 5000)
    )
      throw new HttpError(
        429,
        "Screen limit: one capture per 5 seconds, up to 240 per attempt.",
      );
    await c.query(
      "INSERT INTO screen_evidence(id,session_id,attempt_id,elapsed_ms,reason,image) VALUES($1,$2,$3,$4,$5,$6)",
      [b.id, b.sessionId, id, b.elapsedMs, b.reason, image],
    );
    return { ok: true };
  });
}
export async function screenReport(id: string, owner: string) {
  const a = await pool.query(
    "SELECT id FROM attempts WHERE id=$1 AND owner=$2",
    [id, owner],
  );
  if (!a.rowCount) throw new HttpError(404, "Attempt not found.");
  const { rows: sessions } = await pool.query(
    "SELECT id,started_at,stopped_at,stop_reason,surface,consent FROM screen_sessions WHERE attempt_id=$1 ORDER BY started_at",
    [id],
  );
  const { rows: events } = await pool.query(
    "SELECT id,session_id,elapsed_ms,reason,created_at,expires_at,(image IS NOT NULL AND expires_at>now()) available FROM screen_evidence WHERE attempt_id=$1 ORDER BY elapsed_ms",
    [id],
  );
  return { sessions, events };
}
export async function readScreen(
  id: string,
  owner: string,
  evidenceId: string,
) {
  const {
    rows: [r],
  } = await pool.query(
    "SELECT e.image,e.expires_at FROM screen_evidence e JOIN attempts a ON a.id=e.attempt_id WHERE a.id=$1 AND a.owner=$2 AND e.id=$3",
    [id, owner, evidenceId],
  );
  if (!r) throw new HttpError(404, "Screen evidence not found.");
  if (!r.image || new Date(r.expires_at).getTime() <= Date.now())
    throw new HttpError(
      410,
      "Screen evidence unavailable, deleted or expired.",
    );
  return r.image;
}
export async function deleteScreen(id: string, owner: string) {
  return transaction(async (c) => {
    await owned(c, id, owner);
    await c.query(
      "UPDATE screen_sessions SET consent=false,stopped_at=COALESCE(stopped_at,now()),stop_reason=COALESCE(stop_reason,'user_stopped') WHERE attempt_id=$1",
      [id],
    );
    await c.query(
      "UPDATE screen_evidence SET image=NULL,deleted_at=COALESCE(deleted_at,now()) WHERE attempt_id=$1",
      [id],
    );
    return { ok: true };
  });
}
