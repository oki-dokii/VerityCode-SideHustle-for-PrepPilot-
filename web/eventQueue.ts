import type { BrowserEvent } from "../shared/monitoring";
/** Leave room for a loss marker and the next observation. */
export function enqueue(
  queue: BrowserEvent[],
  event: BrowserEvent,
  max = 500,
): BrowserEvent[] {
  if (queue.length < max) return [...queue, event];
  const removed = queue.slice(0, queue.length - max + 2);
  const retained = queue.slice(removed.length);
  const marker: BrowserEvent = {
    ...event,
    id: crypto.randomUUID(),
    type: "queue_overflow",
    dropped: removed.reduce((n, e) => n + 1 + (e.dropped || 0), 0),
  };
  // Marker consumes event.sequence; the observation follows it.
  return [...retained, marker, { ...event, sequence: event.sequence + 1 }];
}
export function acknowledge(queue: BrowserEvent[], ids: string[]) {
  const received = new Set(ids);
  return queue.filter((e) => !received.has(e.id));
}
