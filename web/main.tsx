import ScreenEvidence from "./ScreenEvidence";
import CameraMonitoring from "./CameraMonitoring";
import BrowserMonitoring from "./BrowserMonitoring";
import { languages, type Language } from "../shared/languages";
import React from "react";
import { createRoot } from "react-dom/client";
import "./style.css";
const Editor = React.lazy(() => import("./CodeEditor"));

type Problem = {
  id: string;
  title: string;
  difficulty: string;
  topic: string;
  durationMinutes: number;
  description: string;
  input: string;
  output: string;
  constraints: string[];
  starter: string;
  examples: { input: string; output: string; explanation: string }[];
};
type Case = {
  index: number;
  status: string;
  passed: boolean;
  stdout?: string;
  expected?: string;
  stderr?: string;
};
type Job = {
  language: Language;
  id: string;
  kind: "run" | "submit";
  state: string;
  results: Case[] | null;
  error: string | null;
  created_at: string;
};
type Attempt = {
  monitoring_enabled: boolean;
  language: Language;
  id: string;
  status: string;
  started_at: string;
  deadline: string;
  draft: string;
  revision: number;
  saved_at: string;
  end_reason: string | null;
  serverNow: string;
  jobs: Job[];
};
type Summary = Pick<Attempt, "id" | "status" | "started_at" | "deadline">;
class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    headers: { "Content-Type": "application/json", "X-VerityCode": "1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json();
  if (!response.ok)
    throw new ApiError(data.error || "Request failed.", response.status);
  return data;
}
function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    grid: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </>
    ),
    code: (
      <>
        <path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-14-2 18" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    arrow: <path d="M4 12h15m-5-5 5 5-5 5" />,
    check: <path d="m5 12 4 4L19 6" />,
    shield: (
      <>
        <path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3Z" />
        <path d="m8 12 3 3 5-5" />
      </>
    ),
    play: <path d="m8 4 12 8-12 8V4Z" />,
    file: (
      <>
        <path d="M14 3H5v18h14V8l-5-5Z" />
        <path d="M14 3v5h5M8 12h8M8 16h6" />
      </>
    ),
    back: <path d="M20 12H4m6-6-6 6 6 6" />,
    bolt: <path d="m13 2-9 12h7l-1 8 10-12h-7l1-8Z" />,
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] || paths.file}
    </svg>
  );
}
function useDialog(open: boolean, onClose: () => void) {
  const close = React.useRef(onClose);
  close.current = onClose;
  React.useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const focusables = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),input:not(:disabled),a[href],[tabindex="0"]',
        ) || [],
      );
    focusables()[0]?.focus();
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close.current();
      }
      if (event.key === "Tab") {
        const items = focusables();
        const first = items[0],
          last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      document.body.style.overflow = oldOverflow;
      previous?.focus();
    };
  }, [open]);
}
function Brand() {
  return (
    <div className="brand">
      <span className="brand-icon">
        <Icon name="code" size={22} />
      </span>
      verity<span>code</span>
      <sup>β</sup>
    </div>
  );
}
function App() {
  const [problem, setProblem] = React.useState<Problem | null>(null);
  const [attempts, setAttempts] = React.useState<Summary[]>([]);
  const [configured, setConfigured] = React.useState(false);
  const [attempt, setAttempt] = React.useState<Attempt | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const [preflight, setPreflight] = React.useState(false);
  const [ack, setAck] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  useDialog(preflight, () => {
    if (!busy) setPreflight(false);
  });
  const bootstrap = React.useCallback(async () => {
    const data = await api<{
      problem: Problem;
      attempts: Summary[];
      runnerConfigured: boolean;
    }>("/bootstrap");
    setProblem(data.problem);
    setAttempts(data.attempts);
    setConfigured(data.runnerConfigured);
  }, []);
  React.useEffect(() => {
    async function load() {
      setLoading(true);
      setError("");
      try {
        await bootstrap();
        const id = location.hash.match(/^#\/attempt\/([\w-]+)$/)?.[1];
        setAttempt(id ? await api<Attempt>(`/attempts/${id}`) : null);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    }
    void load();
    window.addEventListener("hashchange", load);
    return () => window.removeEventListener("hashchange", load);
  }, [bootstrap]);
  function open(id: string) {
    location.hash = `/attempt/${id}`;
  }
  async function start() {
    setBusy(true);
    setError("");
    try {
      const a = await api<Attempt>("/attempts", "POST", { acknowledged: true });
      setPreflight(false);
      open(a.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (loading)
    return (
      <div className="loading">
        <Brand />
        <div className="spinner" />
        <p>Preparing your workspace…</p>
      </div>
    );
  if (attempt && problem)
    return (
      <Workspace
        key={`${attempt.id}-${attempt.language}`}
        initial={attempt}
        onLanguageChange={setAttempt}
        problem={problem}
        configured={configured}
        onBack={() => {
          location.hash = "";
        }}
      />
    );
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <Brand />
        <div className="nav-label">YOUR WORKSPACE</div>
        <button
          className="nav-item selected"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        >
          <Icon name="grid" />
          Overview
        </button>
        <a
          className="nav-item"
          href="#practice"
          onClick={(e) => {
            e.preventDefault();
            document
              .getElementById("practice")
              ?.scrollIntoView({ behavior: "smooth" });
          }}
        >
          <Icon name="code" />
          Practice assessments
        </a>
        <a
          className="nav-item"
          href="#history"
          onClick={(e) => {
            e.preventDefault();
            document
              .getElementById("history")
              ?.scrollIntoView({ behavior: "smooth" });
          }}
        >
          <Icon name="file" />
          My attempts <span className="count">{attempts.length}</span>
        </a>
        <div className="sidebar-bottom">
          <span className="tiny-label">
            BUILD CONFIDENCE, ONE MOCK AT A TIME
          </span>
          <p>
            A little practice.
            <br />A clearer next step.
          </p>
          <div className="profile">
            <div className="avatar">Y</div>
            <div>
              <strong>Your workspace</strong>
              <small>Local practice session</small>
            </div>
            <span className="online-dot" />
          </div>
        </div>
      </aside>
      <main className="dashboard">
        <header className="topbar">
          <div>
            <span className="breadcrumb">Workspace</span>
            <span className="slash">/</span>Overview
          </div>
          <span className="phase-label">
            <span className="online-dot" />
            Phase 02 · Browser monitoring
          </span>
        </header>
        <div className="dashboard-content">
          <div className="page-heading">
            <div className="eyebrow">PRACTICE WITH PURPOSE</div>
            <h1>Your next step starts here.</h1>
            <p>
              Make room for focused practice. We’ll help you see your progress.
            </p>
          </div>
          {error && (
            <div role="alert" className="alert">
              {error}
              <button className="text-button" onClick={() => location.reload()}>
                Retry
              </button>
            </div>
          )}
          <section className="hero">
            <div className="hero-copy">
              <span className="hero-label">
                <span className="online-dot" />
                YOUR PRACTICE GROUND
              </span>
              <h2>
                Think it through.
                <br />
                Make it work.
              </h2>
              <p>
                A focused coding environment. Real test cases.
                <br />
                Feedback that gives your next attempt direction.
              </p>
              <button
                className="primary"
                onClick={() => {
                  setPreflight(true);
                  setAck(false);
                }}
              >
                Start a practice assessment <Icon name="arrow" />
              </button>
              <div className="hero-foot">
                <Icon name="clock" size={14} />
                30 minutes <span>·</span>Python · C++ · Java <span>·</span>
                Beginner friendly
              </div>
            </div>
            <div className="hero-art" aria-hidden="true">
              <div className="orbit orbit-one" />
              <div className="orbit orbit-two" />
              <div className="art-dot" />
              <div className="code-card">
                <div className="code-card-header">
                  <div className="window-dots">
                    <i />
                    <i />
                    <i />
                  </div>
                  <span>progress.py</span>
                </div>
                <div className="art-code">
                  <span className="line-no">01</span>
                  <span>
                    <b>def</b> next_step(you):
                  </span>
                  <span className="line-no">02</span>
                  <span>
                    {" "}
                    practice = you.<em>try</em>()
                  </span>
                  <span className="line-no">03</span>
                  <span>
                    {" "}
                    insight = <em>reflect</em>(practice)
                  </span>
                  <span className="line-no">04</span>
                  <span>
                    {" "}
                    <b>return</b> you + insight
                  </span>
                </div>
              </div>
              <div className="art-badge">
                <span>
                  <Icon name="check" size={20} />
                </span>
                Progress, one attempt at a time.
              </div>
            </div>
          </section>
          <section className="stats">
            <div>
              <span className="stat-icon">
                <Icon name="code" />
              </span>
              <div>
                <strong>01</strong>
                <span>Available assessment</span>
              </div>
            </div>
            <div>
              <span className="stat-icon">
                <Icon name="file" />
              </span>
              <div>
                <strong>{String(attempts.length).padStart(2, "0")}</strong>
                <span>Your recent attempts</span>
              </div>
            </div>
            <div>
              <span className="stat-icon">
                <Icon name="shield" />
              </span>
              <div>
                <strong className="small-stat">Practice mode</strong>
                <span>Browser events · optional camera checks</span>
              </div>
            </div>
          </section>
          <section id="practice">
            <div className="section-title">
              <h2>Find your focus</h2>
              <span>Start small. Build momentum.</span>
            </div>
            <div className="assessment-card">
              <div className="assessment-mark">
                <Icon name="code" size={30} />
              </div>
              <div className="assessment-info">
                <div className="tags">
                  <span className="tag green">FOUNDATIONS</span>
                  <span className="tag">{problem?.difficulty}</span>
                </div>
                <h3>Arrays & problem solving</h3>
                <p>
                  Find the best streak. Practice turning a simple idea into an
                  efficient solution.
                </p>
                <div className="metadata">
                  <span>
                    <Icon name="clock" size={14} />
                    30 min
                  </span>
                  <span>
                    <Icon name="file" size={14} />1 coding question
                  </span>
                  <span>Python · C++ · Java</span>
                </div>
              </div>
              <button
                className="outline"
                onClick={() => {
                  setPreflight(true);
                  setAck(false);
                }}
              >
                View assessment <Icon name="arrow" />
              </button>
            </div>
          </section>
          <section id="history" className="history-section">
            <div className="section-title">
              <h2>Your recent attempts</h2>
              <span>
                {attempts.length
                  ? "Pick up where you left off"
                  : "Your progress will appear here"}
              </span>
            </div>
            {attempts.length ? (
              <div className="history-list">
                {attempts.map((a) => (
                  <button
                    key={a.id}
                    className="history-row"
                    onClick={() => open(a.id)}
                  >
                    <span className="history-icon">
                      <Icon name="file" />
                    </span>
                    <span>
                      <strong>Arrays & problem solving</strong>
                      <small>{new Date(a.started_at).toLocaleString()}</small>
                    </span>
                    <span
                      className={`status ${a.status === "completed" ? "success" : ""}`}
                    >
                      {a.status === "active" &&
                      Date.parse(a.deadline) <= Date.now()
                        ? "Time ended"
                        : a.status === "active"
                          ? "In progress"
                          : a.status === "completed"
                            ? "Graded"
                            : "Submitted"}
                    </span>
                    <Icon name="arrow" />
                  </button>
                ))}
              </div>
            ) : (
              <div className="empty-history">
                <Icon name="file" size={24} />
                <div>
                  <strong>A fresh page. A good place to start.</strong>
                  <p>
                    Complete your first mock to start building your practice
                    history.
                  </p>
                </div>
              </div>
            )}
          </section>
          <footer className="dashboard-footer">
            <span>Built for learning. Designed for clarity.</span>
            <span>VerityCode · Phase 02</span>
          </footer>
        </div>
      </main>
      {preflight && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="preflight-title"
          >
            <span className="eyebrow">BEFORE YOU BEGIN</span>
            <h2 id="preflight-title">
              A little preparation.
              <br />A focused 30 minutes.
            </h2>
            <p>Arrays & problem solving · 1 question · Python, C++ or Java</p>
            <ul className="checklist">
              <li>
                <Icon name="check" />
                Your timer continues if you refresh or leave.
              </li>
              <li>
                <Icon name="check" />
                Drafts save automatically while connected.
              </li>
              <li>
                <Icon name="check" />
                Run checks examples; submit grades 8 hidden tests.
              </li>
              <li>
                <Icon name="check" />
                Browser visibility, focus, fullscreen and editor paste events
                are recorded. Camera and screen checks have separate opt-ins
                inside the assessment. No audio or clipboard contents are
                collected.
              </li>
            </ul>
            <div className={configured ? "notice" : "notice amber"}>
              <strong>
                {configured
                  ? "Execution provider configured"
                  : "Code execution needs setup"}
              </strong>
              <p>
                {configured
                  ? "The runner’s availability is checked when you run code."
                  : "You can write and save code now. Runs and grading will be unavailable until Judge0 is configured. No results will be simulated."}
              </p>
            </div>
            <label className="ack">
              <input
                type="checkbox"
                checked={ack}
                onChange={(e) => setAck(e.target.checked)}
              />
              I understand the timer, saving behaviour, execution status and
              browser monitoring.
            </label>
            <div className="modal-actions">
              <button className="outline" onClick={() => setPreflight(false)}>
                Not now
              </button>
              <button
                className="primary"
                disabled={!ack || busy}
                onClick={start}
              >
                {busy ? "Starting…" : "Begin assessment"}
                <Icon name="arrow" />
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
function Workspace({
  initial,
  problem,
  configured,
  onLanguageChange,
  onBack,
}: {
  initial: Attempt;
  problem: Problem;
  configured: boolean;
  onLanguageChange: (attempt: Attempt) => void;
  onBack: () => void;
}) {
  const [attempt, setAttempt] = React.useState(initial);
  const [code, setCode] = React.useState(initial.draft);
  const codeRef = React.useRef(initial.draft),
    savedCode = React.useRef(initial.draft),
    revision = React.useRef(initial.revision);
  const saving = React.useRef<Promise<void> | null>(null);
  const [saveStatus, setSaveStatus] = React.useState("All changes saved");
  const [error, setError] = React.useState("");
  const [conflict, setConflict] = React.useState(false);
  const [recovery, setRecovery] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false),
    [confirm, setConfirm] = React.useState(false);
  useDialog(confirm, () => {
    if (!busy) setConfirm(false);
  });
  const [now, setNow] = React.useState(Date.parse(initial.serverNow));
  const anchor = React.useRef({
    server: Date.parse(initial.serverNow),
    local: performance.now(),
  });
  const localKey = `veritycode-draft-${initial.id}${initial.language === "python" ? "" : `-${initial.language}`}`;
  const active = attempt.status === "active";
  const language = active ? initial.language : attempt.language;
  const languageInfo = languages[language];
  const remaining = Math.max(
    0,
    Math.ceil((Date.parse(attempt.deadline) - now) / 1000),
  );
  const finalJob = attempt.jobs.find((j) => j.kind === "submit");
  const latestRun = attempt.jobs.find(
    (j) => j.kind === "run" && j.language === language,
  );
  const job = active ? latestRun : finalJob;
  const pending = job?.state === "queued" || job?.state === "running";
  const path = `/attempts/${attempt.id}`;
  React.useEffect(() => {
    try {
      const cached = JSON.parse(localStorage.getItem(localKey) || "null");
      if (
        cached &&
        cached.code !== initial.draft &&
        typeof cached.code === "string"
      )
        setRecovery(cached.code);
    } catch {
      setSaveStatus("Local recovery storage unavailable");
    }
  }, []);
  const refresh = React.useCallback(async () => {
    const fresh = await api<Attempt>(`/attempts/${initial.id}`);
    setAttempt(fresh);
    if (fresh.status === "active" && fresh.language !== initial.language)
      setConflict(true);
    anchor.current = {
      server: Date.parse(fresh.serverNow),
      local: performance.now(),
    };
    return fresh;
  }, [initial.id, initial.language]);
  React.useEffect(() => {
    const timer = setInterval(
      () =>
        setNow(
          anchor.current.server + performance.now() - anchor.current.local,
        ),
      250,
    );
    const poll = setInterval(() => {
      void refresh().catch(() =>
        setError(
          "Connection interrupted. Local edits are preserved where browser storage is available.",
        ),
      );
    }, 2000);
    return () => {
      clearInterval(timer);
      clearInterval(poll);
    };
  }, [refresh]);
  async function flush() {
    while (saving.current) await saving.current;
    if (codeRef.current === savedCode.current) return;
    if (conflict || recovery !== null)
      throw new Error("Resolve the saved-draft choice before continuing.");
    const snapshot = codeRef.current;
    setSaveStatus("Saving…");
    const promise = (async () => {
      const result = await api<{ revision: number; saved_at: string }>(
        `${path}/draft`,
        "PUT",
        { code: snapshot, revision: revision.current },
      );
      revision.current = result.revision;
      savedCode.current = snapshot;
      setSaveStatus(
        codeRef.current === snapshot ? "All changes saved" : "Unsaved changes",
      );
      // Keep the latest text, not an older in-flight snapshot.
      try {
        localStorage.setItem(
          localKey,
          JSON.stringify({ code: codeRef.current }),
        );
      } catch {
        setSaveStatus("Saved to server · local recovery unavailable");
      }
    })();
    saving.current = promise;
    try {
      await promise;
    } catch (e) {
      setSaveStatus("Not saved to server");
      if (e instanceof ApiError && e.status === 409) {
        setConflict(true);
        void refresh();
      }
      throw e;
    } finally {
      if (saving.current === promise) saving.current = null;
    }
  }
  React.useEffect(() => {
    if (!active || conflict || recovery !== null) return;
    const timeout = setTimeout(() => {
      void flush().catch((e) => setError(e.message));
    }, 700);
    // Retry offline saves even if the text has not changed.
    const retry = setInterval(() => {
      void flush().catch((e) => setError(e.message));
    }, 5000);
    return () => {
      clearTimeout(timeout);
      clearInterval(retry);
    };
  }, [code, active, conflict, recovery]);
  React.useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (codeRef.current !== savedCode.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  function edit(value: string | undefined) {
    const next = value || "";
    codeRef.current = next;
    setCode(next);
    setSaveStatus("Unsaved changes");
    try {
      localStorage.setItem(localKey, JSON.stringify({ code: next }));
    } catch {
      setSaveStatus("Local recovery unavailable · saving to server");
    }
  }
  async function perform(kind: "run" | "submit" | "retry") {
    setBusy(true);
    setError("");
    try {
      if (kind !== "retry") await flush();
      if (kind === "run")
        await api(`${path}/runs`, "POST", {
          code: codeRef.current,
          revision: revision.current,
        });
      if (kind === "submit") {
        await api(`${path}/submit`, "POST", {
          key: crypto.randomUUID(),
          revision: revision.current,
        });
        setConfirm(false);
      }
      if (kind === "retry") await api(`${path}/retry`, "POST", {});
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function selectLanguage(next: Language) {
    if (next === language) return;
    setBusy(true);
    setError("");
    try {
      await flush();
      const fresh = await api<Attempt>(`${path}/language`, "PUT", {
        language: next,
        revision: revision.current,
      });
      onLanguageChange(fresh);
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof ApiError && e.status === 409) setConflict(true);
    } finally {
      setBusy(false);
    }
  }
  async function useServerDraft() {
    try {
      const fresh = await refresh();
      if (fresh.language !== initial.language) {
        onLanguageChange(fresh);
        return;
      }
      codeRef.current = fresh.draft;
      savedCode.current = fresh.draft;
      revision.current = fresh.revision;
      setCode(fresh.draft);
      setConflict(false);
      setRecovery(null);
      setError("");
      setSaveStatus("All changes saved");
      localStorage.setItem(localKey, JSON.stringify({ code: fresh.draft }));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  const passed = finalJob?.results?.filter((c) => c.passed).length || 0;
  return (
    <div className="workspace">
      <header className="workspace-header">
        <button
          className="brand-button"
          onClick={onBack}
          aria-label="Back to dashboard"
        >
          <Brand />
        </button>
        <div className="workspace-title">
          <span>ASSESSMENT 01</span>
          <strong>Arrays & problem solving</strong>
        </div>
        <div className={`timer ${remaining < 300 && active ? "urgent" : ""}`}>
          <Icon name="clock" />
          <span>
            {active
              ? `${Math.floor(remaining / 60)
                  .toString()
                  .padStart(
                    2,
                    "0",
                  )}:${(remaining % 60).toString().padStart(2, "0")}`
              : "Finished"}
          </span>
          <small>{active ? "remaining" : "assessment"}</small>
        </div>
        <button className="outline compact" onClick={onBack}>
          Dashboard
        </button>
      </header>
      <div className="workspace-strip">
        <span>
          <span className="online-dot" />
          {languageInfo.label} practice environment
        </span>
        <span>
          <Icon name="shield" size={14} />
          {initial.monitoring_enabled
            ? "Browser monitoring · Camera opt-in"
            : "Monitoring off · Earlier attempt"}
        </span>
      </div>
      {!configured && (
        <div className="runner-notice">
          <span>
            <strong>Execution service not connected.</strong> You can write and
            save code. Results will be available after Judge0 is configured.
          </span>
          <details>
            <summary>Setup details</summary>
            <p>
              Set JUDGE0_URL and credentials in the server’s .env file, restart
              the API, then run the provider smoke test. See
              docs/phase-1/setup.md.
            </p>
          </details>
        </div>
      )}
      {error && (
        <div className="alert" role="alert">
          {error}
          <button
            onClick={() => setError("")}
            className="text-button"
            aria-label="Dismiss message"
          >
            Dismiss
          </button>
        </div>
      )}
      {conflict && active && (
        <div className="alert">
          Another save or deadline changed this attempt. Your local text remains
          in the editor.{" "}
          <button
            className="outline compact"
            onClick={() => {
              const blob = new Blob([codeRef.current], { type: "text/plain" });
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = languageInfo.filename;
              a.click();
              URL.revokeObjectURL(url);
            }}
          >
            Download local draft
          </button>
          <button className="outline compact" onClick={useServerDraft}>
            Load saved draft
          </button>
        </div>
      )}
      {recovery !== null && active && !conflict && (
        <div className="recovery">
          <span>
            A different local draft was recovered. Choose which version to
            continue with.
          </span>
          <button
            className="outline compact"
            onClick={() => {
              const text = recovery;
              setRecovery(null);
              edit(text);
            }}
          >
            Restore local draft
          </button>
          <button className="outline compact" onClick={useServerDraft}>
            Use server draft
          </button>
        </div>
      )}
      {!active && (
        <section className="result-banner">
          <div className="result-emblem">
            <Icon
              name={finalJob?.state === "completed" ? "check" : "file"}
              size={24}
            />
          </div>
          <div>
            <span className="eyebrow">
              {attempt.end_reason === "deadline"
                ? "TIME COMPLETED"
                : "ASSESSMENT SUBMITTED"}
            </span>
            <h2>
              {finalJob?.state === "completed"
                ? `${passed} of ${finalJob.results!.length} hidden tests passed`
                : finalJob?.state === "unavailable"
                  ? "Your submission is safe. Grading is unavailable."
                  : "Your submission is being graded."}
            </h2>
            <p>
              {attempt.end_reason === "deadline"
                ? "The last server-acknowledged draft was submitted at the deadline."
                : "Your final code is locked. You can return to this result from the dashboard."}{" "}
              Optional camera and selected-screen checks are available below.
              Gaze and visible-phone detection are experimental; similarity
              analysis is not enabled.
            </p>
          </div>
          {finalJob?.state === "completed" ? (
            <div className="score">
              <strong>
                {Math.round((passed / finalJob.results!.length) * 100)}
              </strong>
              <span>/ 100</span>
            </div>
          ) : finalJob?.state === "unavailable" ? (
            <button
              className="outline"
              disabled={busy}
              onClick={() => perform("retry")}
            >
              Retry grading
            </button>
          ) : (
            <div className="spinner" />
          )}
        </section>
      )}
      <main className="assessment-layout">
        <section className="question-panel">
          <div className="panel-heading">
            <span>
              <Icon name="file" />
              Problem statement
            </span>
            <span className="question-number">01 / 01</span>
          </div>
          <div className="question-content">
            <div className="tags">
              <span className="tag green">EASY</span>
              <span className="tag">ARRAYS</span>
            </div>
            <h1>
              {problem.title}
              <span>.</span>
            </h1>
            <p>{problem.description}</p>
            <h3>Input format</h3>
            <p>{problem.input}</p>
            <h3>Output format</h3>
            <p>{problem.output}</p>
            <h3>Constraints</h3>
            <ul className="constraints">
              {problem.constraints.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
            <h3>Examples</h3>
            {problem.examples.map((ex, i) => (
              <div className="example" key={i}>
                <div className="example-title">EXAMPLE {i + 1}</div>
                <div className="example-io">
                  <div>
                    <label>Input</label>
                    <pre>{ex.input}</pre>
                  </div>
                  <div>
                    <label>Output</label>
                    <pre>{ex.output}</pre>
                  </div>
                </div>
                <p>{ex.explanation}</p>
              </div>
            ))}
            <div className="question-note">
              <Icon name="bolt" />
              <p>
                Focus on a solution that visits each day once. Watch out for
                all-negative scores.
              </p>
            </div>
          </div>
        </section>
        <section className="coding-panel">
          <div className="panel-heading">
            <span>
              <Icon name="code" />
              {languageInfo.filename}
            </span>
            <select
              className="language-pill"
              aria-label="Coding language"
              value={language}
              disabled={
                !active ||
                busy ||
                pending ||
                conflict ||
                recovery !== null ||
                remaining === 0
              }
              onChange={(e) => void selectLanguage(e.target.value as Language)}
            >
              {Object.entries(languages).map(([id, config]) => (
                <option key={id} value={id}>
                  {config.label}
                </option>
              ))}
            </select>
          </div>
          <div className="editor-meta">
            <span>Write your solution below</span>
            <span className="saved-state" role="status">
              <span
                className={`online-dot ${saveStatus.includes("Not") ? "orange" : ""}`}
              />
              {active ? saveStatus : "Read-only submission"}
            </span>
          </div>
          <div className="editor-wrap">
            <React.Suspense
              fallback={<p className="editor-loading">Loading code editor…</p>}
            >
              <Editor
                height="100%"
                language={languageInfo.editor}
                theme="vs"
                value={active ? code : attempt.draft}
                onChange={edit}
                loading={<p className="editor-loading">Loading code editor…</p>}
                options={{
                  fontSize: 14,
                  fontFamily: '"SFMono-Regular", Consolas, monospace',
                  minimap: { enabled: false },
                  padding: { top: 22 },
                  scrollBeyondLastLine: false,
                  automaticLayout: true,
                  lineNumbersMinChars: 3,
                  tabSize: 4,
                  readOnly: !active || busy,
                  wordWrap: "on",
                  renderLineHighlight: "gutter",
                  overviewRulerLanes: 0,
                  ariaLabel: `${language === "python" ? "Python" : languageInfo.label} solution editor`,
                }}
              />
            </React.Suspense>
          </div>
          <div className="editor-actions">
            <span>
              {active ? "Changes save automatically" : "Final submission"}
            </span>
            <div>
              {active && (
                <>
                  <button
                    className="outline"
                    disabled={
                      busy ||
                      pending ||
                      conflict ||
                      recovery !== null ||
                      remaining === 0
                    }
                    onClick={() => perform("run")}
                  >
                    <Icon name="play" size={15} />
                    {pending ? "Running…" : "Run examples"}
                  </button>
                  <button
                    className="primary"
                    disabled={
                      busy || conflict || recovery !== null || remaining === 0
                    }
                    onClick={() => setConfirm(true)}
                  >
                    Submit solution
                    <Icon name="arrow" size={16} />
                  </button>
                </>
              )}
            </div>
          </div>
          <div className="test-panel">
            <div className="test-heading">
              <span>Test results</span>
              <span>{active ? "EXAMPLE TESTS" : "HIDDEN TESTS"}</span>
            </div>
            {!job ? (
              <div className="test-empty">
                <span className="terminal-mark">›_</span>
                <div>
                  <strong>Ready when you are.</strong>
                  <p>Run your code to check it against the examples.</p>
                </div>
              </div>
            ) : pending ? (
              <div className="test-empty">
                <div className="spinner" />
                <p>Waiting for the execution service…</p>
              </div>
            ) : job.state === "unavailable" ? (
              <div className="test-empty unavailable">
                <Icon name="file" />
                <div>
                  <strong>Execution unavailable</strong>
                  <p>{job.error} No score has been assigned.</p>
                </div>
              </div>
            ) : (
              <div className="test-results">
                {job.results?.map((c) => (
                  <details
                    key={c.index}
                    className={`case ${c.passed ? "passed" : "failed"}`}
                  >
                    <summary>
                      <span>
                        {c.passed ? "✓" : "×"} Test {c.index + 1}
                      </span>
                      <strong>{c.status}</strong>
                    </summary>
                    {c.stdout !== undefined ? (
                      <div className="case-details">
                        <label>Your output</label>
                        <pre>{c.stdout || "(empty)"}</pre>
                        <label>Expected output</label>
                        <pre>{c.expected}</pre>
                        {c.stderr && (
                          <>
                            <label>Diagnostic</label>
                            <pre>{c.stderr}</pre>
                          </>
                        )}
                      </div>
                    ) : (
                      <p className="hidden-note">
                        Hidden test input and output are kept private.
                      </p>
                    )}
                  </details>
                ))}
              </div>
            )}
          </div>
        </section>
      </main>
      <CameraMonitoring id={attempt.id} active={active} />
      <ScreenEvidence id={attempt.id} active={active} />
      <BrowserMonitoring
        id={attempt.id}
        active={active}
        enabled={initial.monitoring_enabled}
      />
      {confirm && (
        <div className="modal-backdrop">
          <section
            className="modal small"
            role="dialog"
            aria-modal="true"
            aria-labelledby="submit-title"
          >
            <span className="eyebrow">READY TO FINISH?</span>
            <h2 id="submit-title">Submit your solution.</h2>
            <p>
              We’ll save your current code and lock this attempt. Your solution
              will be checked against 8 hidden tests.
            </p>
            {!configured && (
              <div className="notice amber">
                Grading will remain unavailable until the execution provider is
                connected. Your submission will be saved.
              </div>
            )}
            <div className="modal-actions">
              <button
                autoFocus
                className="outline"
                onClick={() => setConfirm(false)}
                disabled={busy}
              >
                Keep working
              </button>
              <button
                className="primary"
                disabled={busy}
                onClick={() => perform("submit")}
              >
                {busy ? "Submitting…" : "Confirm submission"}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
