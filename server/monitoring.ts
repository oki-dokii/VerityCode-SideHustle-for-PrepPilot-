import { z } from "zod";
import { pool, transaction } from "./db.js";
import { HttpError, owned } from "./service.js";
import {
  eventTypes,
  type BrowserEvent,
  type MonitoringReport,
} from "../shared/monitoring.js";
import { coverage } from "./coverage.js";
export const eventSchema = z
  .object({
    id: z.string().uuid(),
    sessionId: z.string().uuid(),
    sequence: z.number().int().min(0).max(1000000),
    elapsedMs: z.number().int().min(0).max(7200000),
    type: z.enum(eventTypes),
    state: z
      .object({
        visible: z.boolean(),
        focused: z.boolean(),
        fullscreen: z.boolean(),
      })
      .strict(),
    dropped: z.number().int().min(1).max(1000000).optional(),
  })
  .strict();
export const batchSchema = z
  .object({ events: z.array(eventSchema).min(1).max(50) })
  .strict();
export async function startMonitoring(
  id: string,
  owner: string,
  sessionId: string,
) {
  return transaction(async (client) => {
    const attempt = await owned(client, id, owner);
    if (!attempt.monitoring_enabled)
      throw new HttpError(
        409,
        "Browser monitoring was not enabled for this attempt.",
      );
    if (attempt.status !== "active" || attempt.expired)
      throw new HttpError(409, "This assessment has ended.");
    const existing = await client.query(
      "SELECT attempt_id FROM monitoring_sessions WHERE id=$1",
      [sessionId],
    );
    if (existing.rowCount && existing.rows[0].attempt_id !== id)
      throw new HttpError(409, "Session ID already used.");
    const count = await client.query(
      "SELECT count(*) FROM monitoring_sessions WHERE attempt_id=$1",
      [id],
    );
    if (!existing.rowCount && Number(count.rows[0].count) >= 100)
      throw new HttpError(429, "Monitoring session limit reached.");
    await client.query(
      "INSERT INTO monitoring_sessions(id,attempt_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
      [sessionId, id],
    );
    return {
      sessionId,
      serverNow: new Date().toISOString(),
      startedAt: attempt.started_at,
      deadline: attempt.deadline,
    };
  });
}
export async function ingestEvents(
  id: string,
  owner: string,
  events: BrowserEvent[],
) {
  return transaction(async (client) => {
    const attempt = await owned(client, id, owner);
    if (!attempt.monitoring_enabled)
      throw new HttpError(
        409,
        "Browser monitoring was not enabled for this attempt.",
      );
    const start = new Date(attempt.started_at).getTime();
    const end = Math.min(
      new Date(attempt.deadline).getTime(),
      attempt.submitted_at
        ? new Date(attempt.submitted_at).getTime()
        : Date.now(),
    );
    if (Date.now() - end > 7 * 86400000)
      throw new HttpError(410, "Monitoring upload window expired.");
    const count = await client.query(
      "SELECT count(*) FROM browser_events WHERE attempt_id=$1",
      [id],
    );
    let storedCount = Number(count.rows[0].count);
    const acknowledged: string[] = [],
      discarded: string[] = [];
    for (const event of events) {
      const session = await client.query(
        "SELECT started_at FROM monitoring_sessions WHERE id=$1 AND attempt_id=$2",
        [event.sessionId, id],
      );
      if (!session.rowCount)
        throw new HttpError(400, "Unknown monitoring session.");
      if (
        start + event.elapsedMs > Date.now() + 2000 ||
        start + event.elapsedMs <
          new Date(session.rows[0].started_at).getTime() - 2000
      )
        throw new HttpError(400, "Event timestamp is outside its session.");
      const existing = await client.query(
        "SELECT id,payload FROM browser_events WHERE id=$1 OR (session_id=$2 AND sequence=$3)",
        [event.id, event.sessionId, event.sequence],
      );
      if (existing.rowCount) {
        if (
          existing.rows[0].id !== event.id ||
          JSON.stringify(eventSchema.parse(existing.rows[0].payload)) !==
            JSON.stringify(event)
        )
          throw new HttpError(
            409,
            "Event identity conflicts with a previously received observation.",
          );
        acknowledged.push(event.id);
        continue;
      }
      // Late arrivals are welcome, but observations made after submission are not part of the assessment.
      if (start + event.elapsedMs > end && attempt.status !== "active") {
        acknowledged.push(event.id);
        discarded.push(event.id);
        continue;
      }
      if (start + event.elapsedMs > new Date(attempt.deadline).getTime()) {
        acknowledged.push(event.id);
        discarded.push(event.id);
        continue;
      }
      if (storedCount >= 20000)
        throw new HttpError(429, "Monitoring event limit reached.");
      storedCount++;
      await client.query(
        "INSERT INTO browser_events(id,attempt_id,session_id,sequence,elapsed_ms,type,payload) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          event.id,
          id,
          event.sessionId,
          event.sequence,
          event.elapsedMs,
          event.type,
          JSON.stringify(event),
        ],
      );
      acknowledged.push(event.id);
    }
    return { acknowledged, discarded };
  });
}
export async function monitoringReport(
  id: string,
  owner: string,
): Promise<MonitoringReport> {
  const {
    rows: [attempt],
  } = await pool.query("SELECT * FROM attempts WHERE id=$1 AND owner=$2", [
    id,
    owner,
  ]);
  if (!attempt) throw new HttpError(404, "Attempt not found.");
  const end = Math.min(
    Date.now(),
    new Date(attempt.deadline).getTime(),
    attempt.submitted_at ? new Date(attempt.submitted_at).getTime() : Infinity,
  );
  const totalMs = Math.max(0, end - new Date(attempt.started_at).getTime());
  const { rows } = await pool.query(
    "SELECT payload,received_at FROM browser_events WHERE attempt_id=$1 ORDER BY elapsed_ms,session_id,sequence",
    [id],
  );
  const events = rows.map((row) => ({
    ...row.payload,
    receivedAt: row.received_at.toISOString(),
  }));
  const counts: MonitoringReport["counts"] = {};
  for (const event of events)
    counts[event.type as BrowserEvent["type"]] =
      (counts[event.type as BrowserEvent["type"]] || 0) + 1;
  const timeline = events.filter((e) => e.type !== "heartbeat");
  const {
    rows: [sessions],
  } = await pool.query(
    "SELECT count(*) FROM monitoring_sessions WHERE attempt_id=$1",
    [id],
  );
  return {
    enabled: attempt.monitoring_enabled,
    totalMs,
    ...coverage(events, totalMs),
    counts,
    events: timeline.slice(-200),
    eventCount: timeline.length,
    sessions: Number(sessions.count),
    timelineTruncated: timeline.length > 200,
  };
}
