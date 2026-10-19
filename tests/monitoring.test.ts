import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { coverage } from "../server/coverage.js";
import { enqueue, acknowledge } from "../web/eventQueue.js";
import type { BrowserEvent } from "../shared/monitoring.js";
const event = (
  sequence: number,
  elapsedMs: number,
  sessionId = "s",
  type: BrowserEvent["type"] = "heartbeat",
): BrowserEvent => ({
  id: randomUUID(),
  sessionId,
  sequence,
  elapsedMs,
  type,
  state: { visible: true, focused: true, fullscreen: false },
});
test("coverage unions overlapping sessions and does not count missing sequences or long gaps", () => {
  const events = [
    event(0, 0),
    event(1, 5000),
    event(3, 10000),
    event(4, 30000),
    event(0, 2000, "other"),
    event(1, 7000, "other"),
  ];
  assert.deepEqual(coverage(events, 35000), {
    coveredMs: 7000,
    gaps: [{ start: 7000, end: 35000 }],
    coveragePercent: 20,
  });
  events.push(event(2, 8000));
  assert.equal(coverage(events, 35000).coveredMs, 10000);
});
test("coverage does not bridge a stop, overflow or post-deadline interval", () => {
  const events = [
    event(0, 0),
    event(1, 5000, "s", "session_stopped"),
    event(2, 10000),
    event(3, 12000, "s", "queue_overflow"),
    event(4, 15000),
  ];
  assert.equal(coverage(events, 14000).coveredMs, 7000);
  assert.deepEqual(coverage([], 0), {
    coveredMs: 0,
    gaps: [],
    coveragePercent: 0,
  });
});
test("bounded queue marks losses and acknowledgements preserve newly added events", () => {
  const queue = [event(0, 0), event(1, 1000), event(2, 2000)];
  const next = enqueue(queue, event(3, 3000), 3);
  assert.equal(next.length, 3);
  assert.equal(next[1].type, "queue_overflow");
  assert.equal(next[1].dropped, 2);
  assert.equal(next[2].sequence, 4);
  const fresh = event(5, 4000);
  assert.deepEqual(
    acknowledge(
      [...next, fresh],
      next.map((e) => e.id),
    ),
    [fresh],
  );
});
