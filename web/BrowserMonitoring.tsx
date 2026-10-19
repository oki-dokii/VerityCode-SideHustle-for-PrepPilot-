import React from "react";
import {
  eventLabels,
  type BrowserEvent,
  type EventType,
  type MonitoringReport,
} from "../shared/monitoring";
import { enqueue, acknowledge } from "./eventQueue";
const stamp = (ms: number) =>
  `${Math.floor(ms / 60000)
    .toString()
    .padStart(2, "0")}:${Math.floor((ms / 1000) % 60)
    .toString()
    .padStart(2, "0")}`;
async function request(path: string, body?: unknown) {
  const res = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", "X-VerityCode": "1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Monitoring request failed (${res.status}).`);
  return res.json();
}
export default function BrowserMonitoring({
  id,
  active,
  enabled,
}: {
  id: string;
  active: boolean;
  enabled: boolean;
}) {
  const [report, setReport] = React.useState<MonitoringReport | null>(null);
  const [status, setStatus] = React.useState("Starting browser monitoring…");
  const [queued, setQueued] = React.useState(0);
  const [storageIssue, setStorageIssue] = React.useState(false);
  const [error, setError] = React.useState("");
  const [filter, setFilter] = React.useState("all");
  const [expanded, setExpanded] = React.useState(false);
  React.useEffect(() => {
    let disposed = false,
      ready = false,
      sending = false,
      initialising = false,
      sequence = 0;
    let anchor = 0,
      localAnchor = 0,
      deadline = Infinity;
    const sessionId = crypto.randomUUID(),
      prefix = `vc-events:${id}:`,
      key = prefix + sessionId;
    let memory: BrowserEvent[] = [];
    const read = (k: string): BrowserEvent[] => {
      if (k === key) return memory;
      try {
        return JSON.parse(localStorage.getItem(k) || "[]");
      } catch {
        setStorageIssue(true);
        return [];
      }
    };
    const write = (k: string, events: BrowserEvent[]) => {
      if (k === key) memory = events;
      try {
        if (events.length) localStorage.setItem(k, JSON.stringify(events));
        else localStorage.removeItem(k);
      } catch {
        if (!disposed) setStorageIssue(true);
      }
    };
    const keys = () => {
      const all = new Set([key]);
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k?.startsWith(prefix)) all.add(k);
        }
      } catch {
        if (!disposed) setStorageIssue(true);
      }
      return [...all];
    };
    function record(type: EventType) {
      if (!ready) return;
      const elapsedMs = Math.max(
        0,
        Math.floor(anchor + performance.now() - localAnchor),
      );
      if (elapsedMs > deadline) return;
      const event: BrowserEvent = {
        id: crypto.randomUUID(),
        sessionId,
        sequence: sequence++,
        elapsedMs,
        type,
        state: {
          visible: !document.hidden,
          focused: document.hasFocus(),
          fullscreen: Boolean(document.fullscreenElement),
        },
      };
      memory = enqueue(memory, event);
      sequence = memory.at(-1)!.sequence + 1;
      write(key, memory);
      if (!disposed) setQueued(keys().reduce((n, k) => n + read(k).length, 0));
    }
    async function upload() {
      if (sending) return;
      sending = true;
      try {
        for (const k of keys()) {
          const batch = read(k).slice(0, 50);
          if (!batch.length) continue;
          const result = await request(`/api/attempts/${id}/events/batch`, {
            events: batch,
          });
          write(k, acknowledge(read(k), result.acknowledged));
        }
        if (!disposed) {
          setQueued(keys().reduce((n, k) => n + read(k).length, 0));
          setError("");
        }
      } catch {
        if (!disposed)
          setError(
            "Monitoring upload interrupted. Buffered observations will retry; coverage may change when they arrive.",
          );
      } finally {
        sending = false;
      }
    }
    async function initialise() {
      if (!active || !enabled || ready || initialising) return;
      initialising = true;
      try {
        const data = await request(`/api/attempts/${id}/monitoring/sessions`, {
          sessionId,
        });
        if (disposed) return;
        anchor = Date.parse(data.serverNow) - Date.parse(data.startedAt);
        localAnchor = performance.now();
        deadline = Date.parse(data.deadline) - Date.parse(data.startedAt);
        ready = true;
        record("session_started");
        setStatus("Browser monitoring active");
      } catch {
        if (!disposed) setStatus("Monitoring unavailable · reconnecting");
      } finally {
        initialising = false;
      }
    }
    async function refresh() {
      try {
        const data = await request(`/api/attempts/${id}/monitoring`);
        if (!disposed) setReport(data);
      } catch {
        if (!disposed) setError("Monitoring report unavailable. Retrying…");
      }
    }
    const visibility = () => {
      record(document.hidden ? "visibility_hidden" : "visibility_visible");
      void upload();
    };
    const blur = () => record("window_blur"),
      focus = () => record("window_focus");
    const fullscreen = () =>
      record(
        document.fullscreenElement ? "fullscreen_enter" : "fullscreen_exit",
      );
    const paste = (event: Event) => {
      if ((event.target as Element | null)?.closest?.(".monaco-editor"))
        record("editor_paste");
    };
    const offline = () => record("connection_offline"),
      online = () => {
        record("connection_online");
        void initialise();
        void upload();
      };
    const hide = () => {
      record("session_stopped");
      void upload();
    };
    if (enabled && active) {
      document.addEventListener("visibilitychange", visibility);
      window.addEventListener("blur", blur);
      window.addEventListener("focus", focus);
      document.addEventListener("fullscreenchange", fullscreen);
      document.addEventListener("paste", paste, true);
      window.addEventListener("offline", offline);
      window.addEventListener("online", online);
      window.addEventListener("pagehide", hide);
    }
    void initialise();
    void upload();
    void refresh();
    const heartbeat = setInterval(() => {
      if (active && ready) record("heartbeat");
      else void initialise();
    }, 5000);
    const sender = setInterval(() => void upload(), 2000);
    const reporter = setInterval(() => void refresh(), 3000);
    return () => {
      record("session_stopped");
      ready = false;
      disposed = true;
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("blur", blur);
      window.removeEventListener("focus", focus);
      document.removeEventListener("fullscreenchange", fullscreen);
      document.removeEventListener("paste", paste, true);
      window.removeEventListener("offline", offline);
      window.removeEventListener("online", online);
      window.removeEventListener("pagehide", hide);
      clearInterval(heartbeat);
      clearInterval(sender);
      clearInterval(reporter);
      void upload();
    };
  }, [id, active, enabled]);
  async function fullscreen() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      setError("Fullscreen was not available or permission was declined.");
    }
  }
  if (!enabled)
    return (
      <section className="monitor-panel">
        <h2>Browser monitoring was not enabled for this attempt.</h2>
        <p>
          Start a new assessment to try Phase 2. Earlier attempts are not
          monitored retroactively.
        </p>
      </section>
    );
  const events = (report?.events || []).filter(
    (e) => filter === "all" || e.type === filter,
  );
  const visible = expanded ? events : events.slice(-12);
  return (
    <section className="monitor-panel" aria-labelledby="monitor-title">
      <div className="monitor-heading">
        <div>
          <span className="eyebrow">PHASE 02 · BROWSER OBSERVATIONS</span>
          <h2 id="monitor-title">Assessment timeline</h2>
        </div>
        {active && (
          <button className="outline" onClick={fullscreen}>
            Toggle fullscreen
          </button>
        )}
      </div>
      <p>
        This timeline records visibility, focus, fullscreen and editor paste
        events. Camera observations and optional selected-screen snapshots
        appear in their separate panels. Audio and clipboard contents are not
        collected. These observations do not establish cheating.
      </p>
      <div className="monitor-stats">
        <span>
          <strong>{active ? status : "Monitoring ended"}</strong>
          {queued
            ? `${queued} observation${queued === 1 ? "" : "s"} awaiting upload`
            : "No buffered observations"}
        </span>
        <span>
          <strong>{report ? `${report.coveragePercent}%` : "—"}</strong>
          Estimated browser coverage
        </span>
        <span>
          <strong>{report?.eventCount ?? "—"}</strong>Timeline observations
        </span>
      </div>
      {error && (
        <p className="monitor-warning" role="alert">
          {error}
        </p>
      )}
      {storageIssue && (
        <p className="monitor-warning">
          Local storage is unavailable. Observations can upload while this page
          stays open, but unsent events may be lost on reload.
        </p>
      )}
      <details className="coverage-details">
        <summary>Coverage and monitoring gaps</summary>
        <p>
          Coverage estimates intervals between consecutive observations no more
          than 15 seconds apart. Overlapping browser sessions are counted once.
          The newest interval may remain pending until the next heartbeat.
          Missing data is unknown, not misconduct. Browser telemetry can be
          altered and is not tamper-proof.
        </p>
        {report?.gaps.length ? (
          <ul>
            {report.gaps.slice(0, 50).map((gap, i) => (
              <li key={i}>
                {stamp(gap.start)}–{stamp(gap.end)} ·{" "}
                {((gap.end - gap.start) / 1000).toFixed(1)} seconds unknown or
                pending
              </li>
            ))}
          </ul>
        ) : (
          <p>No gaps recorded in the received observation intervals.</p>
        )}
        {(report?.gaps.length || 0) > 50 && <p>Showing the first 50 gaps.</p>}
      </details>
      <div className="timeline-controls">
        <label>
          Show{" "}
          <select
            aria-label="Filter timeline"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">All observations</option>
            {Object.entries(eventLabels)
              .filter(([type]) => type !== "heartbeat")
              .map(([type, label]) => (
                <option key={type} value={type}>
                  {label}
                </option>
              ))}
          </select>
        </label>
        <span>Elapsed assessment time</span>
      </div>
      {!report ? (
        <p>Loading monitoring report…</p>
      ) : visible.length ? (
        <ol className="timeline-list">
          {visible.map((event) => (
            <li key={event.id}>
              <time>{stamp(event.elapsedMs)}</time>
              <div>
                <strong>{eventLabels[event.type]}</strong>
                {event.dropped && (
                  <small>{event.dropped} buffered observations lost.</small>
                )}
                <small>
                  Browser session {event.sessionId.slice(0, 8)} · received{" "}
                  {new Date(event.receivedAt).toLocaleTimeString()}
                </small>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p>No matching observations received yet.</p>
      )}
      {events.length > 12 && (
        <button
          className="outline compact"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? "Show latest 12" : "Show more observations"}
        </button>
      )}
      {report?.timelineTruncated && (
        <p>
          Showing the latest 200 observations. Summary counts and coverage use
          all stored events.
        </p>
      )}
    </section>
  );
}
