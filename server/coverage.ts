import type { BrowserEvent, Interval } from "../shared/monitoring.js";
/** Coverage is an estimate between consecutive observations, never a proof of continuous supervision. */
export function coverage(events: BrowserEvent[], totalMs: number) {
  const intervals: Interval[] = [];
  const sessions = new Map<string, BrowserEvent[]>();
  for (const event of events) {
    const group = sessions.get(event.sessionId) || [];
    group.push(event);
    sessions.set(event.sessionId, group);
  }
  for (const group of sessions.values()) {
    group.sort((a, b) => a.sequence - b.sequence);
    for (let i = 1; i < group.length; i++) {
      const a = group[i - 1],
        b = group[i];
      const delta = b.elapsedMs - a.elapsedMs;
      if (
        b.sequence === a.sequence + 1 &&
        delta >= 0 &&
        delta <= 15000 &&
        a.type !== "session_stopped" &&
        b.type !== "queue_overflow"
      ) {
        const start = Math.max(0, Math.min(totalMs, a.elapsedMs)),
          end = Math.max(0, Math.min(totalMs, b.elapsedMs));
        if (end > start) intervals.push({ start, end });
      }
    }
  }
  intervals.sort((a, b) => a.start - b.start);
  const merged: Interval[] = [];
  for (const interval of intervals) {
    const last = merged.at(-1);
    if (last && interval.start <= last.end)
      last.end = Math.max(last.end, interval.end);
    else merged.push({ ...interval });
  }
  const gaps: Interval[] = [];
  let cursor = 0;
  for (const interval of merged) {
    if (interval.start > cursor)
      gaps.push({ start: cursor, end: interval.start });
    cursor = interval.end;
  }
  if (cursor < totalMs) gaps.push({ start: cursor, end: totalMs });
  const coveredMs = merged.reduce((sum, i) => sum + i.end - i.start, 0);
  return {
    coveredMs,
    gaps,
    coveragePercent: totalMs > 0 ? Math.round((coveredMs / totalMs) * 100) : 0,
  };
}
