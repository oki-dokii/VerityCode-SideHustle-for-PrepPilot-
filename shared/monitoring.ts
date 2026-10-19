export const eventTypes = [
  "session_started",
  "heartbeat",
  "visibility_hidden",
  "visibility_visible",
  "window_blur",
  "window_focus",
  "fullscreen_enter",
  "fullscreen_exit",
  "editor_paste",
  "connection_offline",
  "connection_online",
  "session_stopped",
  "queue_overflow",
] as const;
export type EventType = (typeof eventTypes)[number];
export type BrowserEvent = {
  id: string;
  sessionId: string;
  sequence: number;
  elapsedMs: number;
  type: EventType;
  state: { visible: boolean; focused: boolean; fullscreen: boolean };
  dropped?: number;
};
export const eventLabels: Record<EventType, string> = {
  session_started: "Browser monitoring started",
  heartbeat: "Monitoring heartbeat",
  visibility_hidden: "Assessment tab became hidden",
  visibility_visible: "Assessment tab became visible",
  window_blur: "Assessment window lost focus",
  window_focus: "Assessment window regained focus",
  fullscreen_enter: "Entered fullscreen",
  fullscreen_exit: "Exited fullscreen",
  editor_paste: "Pasted into the code editor",
  connection_offline: "Browser reported offline",
  connection_online: "Browser reported online",
  session_stopped: "Browser monitoring stopped",
  queue_overflow: "Buffered monitoring events were lost",
};
export type Interval = { start: number; end: number };
export type MonitoringReport = {
  enabled: boolean;
  totalMs: number;
  coveredMs: number;
  coveragePercent: number;
  gaps: Interval[];
  counts: Partial<Record<EventType, number>>;
  events: (BrowserEvent & { receivedAt: string })[];
  eventCount: number;
  sessions: number;
  timelineTruncated: boolean;
};
