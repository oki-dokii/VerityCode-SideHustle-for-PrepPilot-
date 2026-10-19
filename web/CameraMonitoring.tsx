import {
  GazeTracker,
  PhoneTracker,
  gazeLabels,
  phoneLabels,
  type GazeState,
  type PhoneState,
} from "../shared/advancedVision";
import { useEffect, useRef, useState } from "react";
import {
  matrixPose,
  VisionRules,
  visionLabels,
  type VisionState,
} from "../shared/vision";
type Observation = {
  id: string;
  sessionId: string;
  sequence: number;
  elapsedMs: number;
  state: VisionState;
  calibrated: boolean;
  gaze?: GazeState;
  phone?: PhoneState;
  phoneScore?: number;
  gazeError?: number;
  reason?:
    | "usable"
    | "low_light"
    | "stale_frame"
    | "camera_muted"
    | "tab_hidden"
    | "pending_transition"
    | "stopped";
  inferenceMs: number;
};
async function request(path: string, method = "GET", body?: unknown) {
  const response = await fetch(path, {
    method,
    signal: AbortSignal.timeout(15000),
    headers: { "Content-Type": "application/json", "X-VerityCode": "1" },
    body: body === undefined ? undefined : JSON.stringify(body),
    keepalive: method === "POST" && path.endsWith("/stop"),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Camera request failed.");
  return data;
}
export default function CameraMonitoring({
  id,
  active,
}: {
  id: string;
  active: boolean;
}) {
  const bufferId = useRef(crypto.randomUUID());
  const base = `/api/attempts/${id}/camera`,
    prefix = `vc-camera:${id}`,
    key = `${prefix}:${bufferId.current}`;
  const video = useRef<HTMLVideoElement>(null),
    stopRef = useRef<() => void>(() => {}),
    rules = useRef(new VisionRules());
  const [enabled, setEnabled] = useState(false),
    [ack, setAck] = useState(false),
    [evidence, setEvidence] = useState(false);
  const [status, setStatus] = useState("Camera off"),
    [calibration, setCalibration] = useState(
      "Head orientation needs calibration",
    );
  const [report, setReport] = useState<any>(),
    [upload, setUpload] = useState(""),
    [evidenceNotice, setEvidenceNotice] = useState(""),
    [state, setState] = useState<VisionState>("unknown");
  const gazeTracker = useRef(new GazeTracker());
  const [gazeView, setGazeView] = useState({
    state: "uncalibrated" as GazeState,
    message: "Gaze needs its own calibration",
    target: undefined as { x: number; y: number } | undefined,
    step: -1,
  });
  const [phoneView, setPhoneView] = useState<PhoneState>("unknown");
  const syncGaze = () => {
    const g = gazeTracker.current;
    setGazeView({
      state: g.state,
      message: g.message,
      target: g.target,
      step: g.step,
    });
  };
  const queue = useRef<Observation[]>([]),
    uploading = useRef(false),
    evidenceAllowed = useRef(false);
  const persist = () => {
    try {
      localStorage.setItem(key, JSON.stringify(queue.current));
    } catch {
      setUpload(
        "Storage unavailable; queued camera metadata may be lost on reload.",
      );
    }
  };
  const refresh = async () => {
    try {
      setReport(await request(base));
    } catch {
      /* upload status reports connection errors */
    }
  };
  const flush = async () => {
    if (uploading.current) return;
    uploading.current = true;
    try {
      if (queue.current.length) {
        const batch = queue.current.slice(0, 50),
          result = await request(`${base}/batch`, "POST", {
            observations: batch,
          });
        const ids = new Set(result.acknowledged);
        queue.current = queue.current.filter((o) => !ids.has(o.id));
        persist();
        setUpload(
          queue.current.length
            ? `${queue.current.length} camera observations queued`
            : "Camera metadata saved",
        );
      }
      // Separate buffers prevent simultaneous assessment tabs from overwriting one another.
      // Also drain buffers left by a reload; acknowledgement is idempotent on the server.
      for (const storedKey of Object.keys(localStorage)
        .filter(
          (k) => (k === prefix || k.startsWith(prefix + ":")) && k !== key,
        )
        .slice(0, 20)) {
        const stored = JSON.parse(
          localStorage.getItem(storedKey) || "[]",
        ) as Observation[];
        if (!Array.isArray(stored) || !stored.length) {
          localStorage.removeItem(storedKey);
          continue;
        }
        const result = await request(`${base}/batch`, "POST", {
          observations: stored.slice(0, 50),
        });
        const acknowledged = new Set(result.acknowledged);
        const latest = JSON.parse(
          localStorage.getItem(storedKey) || "[]",
        ) as Observation[];
        const remaining = latest.filter((o) => !acknowledged.has(o.id));
        if (remaining.length)
          localStorage.setItem(storedKey, JSON.stringify(remaining));
        else localStorage.removeItem(storedKey);
      }
    } catch (error) {
      setUpload(`Camera metadata queued locally: ${(error as Error).message}`);
    } finally {
      uploading.current = false;
    }
  };
  useEffect(() => {
    void flush();
    void refresh();
    const timer = setInterval(() => {
      void flush();
      void refresh();
    }, 2000);
    return () => clearInterval(timer);
  }, [id]);
  useEffect(() => {
    if (!active) setEnabled(false);
  }, [active]);
  useEffect(() => {
    if (!enabled || !active) return;
    let disposed = false,
      stream: MediaStream | undefined,
      worker: Worker | undefined,
      timer: ReturnType<typeof setInterval> | undefined;
    let sessionId = "",
      anchor = 0,
      anchorPerformance = 0,
      sequence = 0,
      ready = false,
      busy = false,
      lastResult = 0,
      lastRecord = -Infinity,
      lastVideoTime = -1;
    let previousState: VisionState = "unknown",
      lastEvidence = -Infinity;
    const localRules = new VisionRules();
    const gaze = new GazeTracker(),
      phone = new PhoneTracker();
    gazeTracker.current = gaze;
    syncGaze();
    setPhoneView("unknown");
    let currentPhone: PhoneState = "unknown",
      score: number | undefined,
      phoneSampleTime = -Infinity;
    let reason: Observation["reason"] = "stale_frame",
      previousAdvanced = "";
    const resize = () => {
      gaze.invalidate("Window changed: recalibrate gaze.");
      syncGaze();
    };
    window.addEventListener("resize", resize);
    const escape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        gaze.invalidate("Gaze calibration cancelled.");
        syncGaze();
      }
    };
    window.addEventListener("keydown", escape);
    rules.current = localRules;
    evidenceAllowed.current = evidence;
    setEvidenceNotice("");
    setCalibration("Head orientation needs calibration");
    function record(s: VisionState, inferenceMs = 0) {
      const now = performance.now();
      if (
        !sessionId ||
        !anchorPerformance ||
        (now - lastRecord < 1000 &&
          s === previousState &&
          previousAdvanced === `${gaze.state}:${currentPhone}:${reason}`)
      )
        return;
      const o: Observation = {
        id: crypto.randomUUID(),
        sessionId,
        sequence: sequence++,
        elapsedMs: Math.max(0, Math.round(anchor + now - anchorPerformance)),
        state: s,
        calibrated: !!localRules.baseline,
        gaze: gaze.state,
        phone: currentPhone,
        phoneScore: score,
        gazeError: gaze.error,
        reason,
        inferenceMs: Math.min(60000, inferenceMs),
      };
      const transition =
        s !== previousState ||
        previousAdvanced !== `${gaze.state}:${currentPhone}:${reason}`;
      previousAdvanced = `${gaze.state}:${currentPhone}:${reason}`;
      previousState = s;
      lastRecord = now;
      if (queue.current.length >= 2000) {
        queue.current.shift();
        setUpload(
          "Camera buffer full; oldest observations lost. Report coverage will show gaps.",
        );
      }
      queue.current.push(o);
      persist();
      if (
        transition &&
        evidenceAllowed.current &&
        (["no_face", "multiple_faces", "head_turned"].includes(s) ||
          currentPhone === "detected" ||
          gaze.state === "repeated") &&
        now - lastEvidence >= 60000 &&
        video.current?.readyState === 4
      ) {
        lastEvidence = now;
        const canvas = document.createElement("canvas");
        canvas.width = 320;
        canvas.height = 240;
        canvas.getContext("2d")!.drawImage(video.current, 0, 0, 320, 240);
        const jpeg = canvas.toDataURL("image/jpeg", 0.6).split(",")[1];
        // Snapshots are never persisted in browser storage; upload only while this consent is active.
        void (async () => {
          try {
            await request(`${base}/batch`, "POST", { observations: [o] });
            if (!disposed && evidenceAllowed.current)
              await request(`${base}/evidence`, "POST", {
                observationId: o.id,
                jpeg,
              });
          } catch {
            if (!disposed)
              setUpload(
                "Snapshot was not saved; camera metadata will retry separately.",
              );
          }
        })();
      }
    }
    function cleanup() {
      if (disposed) return;
      disposed = true;
      window.removeEventListener("resize", resize);
      window.removeEventListener("keydown", escape);
      gaze.invalidate("Camera stopped; recalibrate after enabling.");
      syncGaze();
      currentPhone = "unknown";
      score = undefined;
      reason = "stopped";
      if (sessionId) {
        record("unknown");
        void flush();
        void request(`${base}/stop`, "POST", { sessionId }).catch(() => {});
      }
      clearInterval(timer);
      worker?.terminate();
      stream?.getTracks().forEach((t) => t.stop());
      if (video.current) video.current.srcObject = null;
    }
    stopRef.current = cleanup;
    const leave = () => {
      cleanup();
      setEnabled(false);
      setStatus("Camera off");
    };
    window.addEventListener("pagehide", leave);
    const fail = (message: string) => {
      cleanup();
      setEnabled(false);
      setStatus(message);
    };
    void (async () => {
      try {
        setStatus("Waiting for camera permission…");
        if (
          !navigator.mediaDevices?.getUserMedia ||
          !window.Worker ||
          !window.OffscreenCanvas
        )
          throw new Error(
            "Camera checks require a supported browser on localhost or HTTPS.",
          );
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 640 },
            height: { ideal: 480 },
            facingMode: "user",
          },
          audio: false,
        });
        if (disposed) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        sessionId = crypto.randomUUID();
        const handshake = await request(`${base}/sessions`, "POST", {
          sessionId,
          acknowledged: true,
          evidence,
        });
        anchor =
          Date.parse(handshake.serverNow) - Date.parse(handshake.startedAt);
        anchorPerformance = performance.now();
        if (disposed) {
          void request(`${base}/stop`, "POST", { sessionId }).catch(() => {});
          return;
        }
        const track = stream.getVideoTracks()[0];
        track.onended = () =>
          fail("Camera disconnected. Enable camera checks to try again.");
        if (video.current) {
          video.current.srcObject = stream;
          await video.current.play();
        }
        if (disposed) return;
        setStatus("Loading local face model…");
        worker = new Worker("/vision-worker.js");
        worker.onerror = () =>
          fail(
            "Camera model failed. Check local model assets and enable again.",
          );
        worker.onmessage = ({ data }) => {
          if (disposed) return;
          if (data.type === "ready") {
            ready = true;
            lastResult = performance.now();
            setStatus("Camera checks running locally");
            if (!data.phoneReady)
              setUpload(
                "Phone detector unavailable. Face checks remain active; check model assets.",
              );
          }
          if (data.type === "error") {
            fail(
              "Camera model unavailable. Check assets with npm run vision:setup and try again.",
            );
            return;
          }
          if (data.type === "sample") {
            busy = false;
            const now = performance.now();
            const usable =
              data.usable &&
              now - data.time <= 1500 &&
              !track.muted &&
              !document.hidden;
            const next = localRules.update(
              {
                faces: data.faces,
                usable,
                pose: data.matrix ? matrixPose(data.matrix) : undefined,
                inferenceMs: data.inferenceMs,
              },
              now,
            );
            const pose = data.matrix ? matrixPose(data.matrix) : undefined;
            gaze.update(
              usable && data.faces === 1 && data.eyes && pose
                ? { ...data.eyes, pose }
                : undefined,
              now,
            );
            syncGaze();
            if (!usable || !data.phoneReady || now - data.phoneTime > 2500) {
              currentPhone = phone.update(undefined, now);
              score = undefined;
            } else if (data.phoneTime !== phoneSampleTime) {
              phoneSampleTime = data.phoneTime;
              score = data.phoneScore;
              currentPhone = phone.update(score, now);
            }
            setPhoneView(currentPhone);
            reason = document.hidden
              ? "tab_hidden"
              : track.muted
                ? "camera_muted"
                : now - data.time > 1500
                  ? "stale_frame"
                  : !data.usable
                    ? "low_light"
                    : next === "unknown"
                      ? "pending_transition"
                      : "usable";
            lastResult = now;
            setState(next);
            record(next, data.inferenceMs);
            setCalibration(
              localRules.calibrating
                ? "Hold one steady, forward-facing pose for 3 seconds…"
                : localRules.baseline
                  ? "Neutral head pose calibrated"
                  : "Head orientation needs calibration",
            );
          }
        };
        worker.postMessage({ type: "init" });
        const started = performance.now();
        timer = setInterval(() => {
          const now = performance.now();
          if (!ready) {
            if (now - started > 30000)
              fail(
                "Local model loading timed out. Check assets and try again.",
              );
            return;
          }
          if (now - lastResult > 1500 || track.muted || document.hidden) {
            localRules.update({ faces: 0, usable: false, inferenceMs: 0 }, now);
            gaze.update(undefined, now);
            syncGaze();
            currentPhone = phone.update(undefined, now);
            score = undefined;
            setPhoneView(currentPhone);
            reason = document.hidden
              ? "tab_hidden"
              : track.muted
                ? "camera_muted"
                : "stale_frame";
            setState("unknown");
            record("unknown");
          }
          if (busy && now - lastResult > 10000) {
            fail("Camera processing stalled. Enable again to restart.");
            return;
          }
          if (
            busy ||
            document.hidden ||
            track.muted ||
            !video.current ||
            video.current.readyState < 2 ||
            video.current.currentTime === lastVideoTime
          )
            return;
          busy = true;
          lastVideoTime = video.current.currentTime;
          void createImageBitmap(video.current)
            .then((bitmap) => {
              if (disposed) {
                bitmap.close();
                return;
              }
              worker!.postMessage({ type: "frame", bitmap, time: now }, [
                bitmap,
              ]);
            })
            .catch(() =>
              fail("Camera frame could not be read. Enable again to retry."),
            );
        }, 200);
      } catch (error) {
        fail(
          (error as Error).name === "NotAllowedError"
            ? "Camera permission denied. You can continue coding and enable it later."
            : (error as Error).message,
        );
      }
    })();
    return () => {
      window.removeEventListener("pagehide", leave);
      cleanup();
    };
  }, [enabled, active, id]);
  async function revoke() {
    evidenceAllowed.current = false;
    setEvidence(false);
    try {
      await request(`${base}/evidence`, "DELETE");
      setEvidenceNotice("Snapshots deleted and upload consent revoked.");
      void refresh();
    } catch {
      setEvidenceNotice(
        "Snapshot deletion could not reach the server. Retry when connected.",
      );
    }
  }
  return (
    <section className="camera-panel" aria-labelledby="camera-title">
      <div>
        <span className="eyebrow">PHASE 3–4 · EXPERIMENTAL</span>
        <h2 id="camera-title">Camera observations</h2>
        <p>
          Face visibility, multiple faces and calibrated head orientation. These
          observations need context and do not establish misconduct. Gaze
          requires its own calibration. A possible visible phone does not
          establish its use or outside assistance.
        </p>
      </div>
      {gazeView.target && enabled && (
        <div
          className="gaze-calibration"
          role="dialog"
          aria-modal="true"
          aria-label="Gaze calibration"
          onKeyDown={(e) => {
            if (e.key === "Tab") {
              e.preventDefault();
              e.currentTarget.querySelector("button")?.focus();
            }
          }}
        >
          <div className="gaze-instructions">
            <strong>
              {gazeView.step < 9 ? "Calibration" : "Validation"} target{" "}
              {gazeView.step + 1}/13
            </strong>
            <p>
              Look at the dot. Keep your head still; do not follow it with your
              head.
            </p>
            <button
              className="outline"
              autoFocus
              onClick={() => {
                gazeTracker.current.invalidate("Gaze calibration cancelled.");
                syncGaze();
              }}
            >
              Cancel calibration
            </button>
          </div>
          <div
            className="gaze-target"
            style={{
              left: `${gazeView.target.x * 100}%`,
              top: `${gazeView.target.y * 100}%`,
            }}
          />
        </div>
      )}
      <div className="camera-grid">
        <div>
          <video
            ref={video}
            muted
            playsInline
            aria-label="Local camera preview"
            className={
              enabled ? "camera-preview" : "camera-preview camera-hidden"
            }
          />
          <p aria-live="polite">
            <strong>{status}</strong>
            {enabled && <> · {visionLabels[state]}</>}
          </p>
          {active && !enabled && (
            <>
              <label className="camera-consent">
                <input
                  type="checkbox"
                  checked={ack}
                  onChange={(e) => setAck(e.target.checked)}
                />{" "}
                I agree to local camera processing for face, head, experimental
                gaze and visible-phone checks, and storing timestamped
                observation metadata. Video, audio and face landmarks are not
                uploaded.
              </label>
              <label className="camera-consent">
                <input
                  type="checkbox"
                  checked={evidence}
                  onChange={(e) => setEvidence(e.target.checked)}
                />{" "}
                Also save optional webcam snapshots for sustained review
                observations (one per minute, up to 20). Private to this
                attempt; deleted after 7 days or when I revoke consent.
              </label>
              <button
                className="primary"
                disabled={!ack}
                onClick={() => setEnabled(true)}
              >
                Enable camera checks
              </button>
            </>
          )}
          {enabled && (
            <div className="camera-actions">
              <button
                className="outline"
                onClick={() => {
                  rules.current.calibrate();
                  setCalibration(
                    "Hold one steady, forward-facing pose for 3 seconds…",
                  );
                }}
              >
                Calibrate neutral pose
              </button>
              <button
                className="outline"
                onClick={() => {
                  stopRef.current();
                  setEnabled(false);
                  setStatus("Camera off");
                }}
              >
                Stop camera
              </button>
              <p>{calibration}</p>
              <button
                className="outline"
                onClick={() => {
                  gazeTracker.current.start(performance.now());
                  syncGaze();
                }}
              >
                Calibrate gaze
              </button>
              <button
                className="outline"
                onClick={() => {
                  gazeTracker.current.invalidate("Gaze disabled by you.");
                  syncGaze();
                }}
              >
                Disable gaze
              </button>
              <p>{gazeView.message}</p>
              <p>
                {gazeLabels[gazeView.state]} · {phoneLabels[phoneView]}
              </p>
              <p>
                {evidence
                  ? "Optional snapshots enabled"
                  : "Frames stay on this device; metadata only"}
              </p>
            </div>
          )}
          <button
            className="outline camera-delete"
            onClick={() => void revoke()}
          >
            Delete snapshots & revoke consent
          </button>
          <p aria-live="polite">{evidenceNotice}</p>
          <p className="hidden-note">{upload}</p>
        </div>
        <div>
          <h3>Camera timeline</h3>
          <p>
            {Math.round((report?.coveredMs || 0) / 1000)} seconds with usable
            observations · {Math.round((report?.totalMs || 0) / 1000)} seconds
            in assessment. Coverage is an estimate; dark frames, pauses and
            missing uploads are unknown.
          </p>
          <p>
            Usable gaze estimates:{" "}
            {Math.round((report?.gazeCoveredMs || 0) / 1000)} seconds. Usable
            phone checks: {Math.round((report?.phoneCoveredMs || 0) / 1000)}{" "}
            seconds. Neither indicates what happened outside the visible frame.
          </p>
          {!report?.sessions?.length && (
            <p>Camera checks have not been enabled for this attempt.</p>
          )}
          <details>
            <summary>Observation gaps ({report?.gaps?.length || 0})</summary>
            {report?.gaps?.map((g: any) => (
              <p key={g.start}>
                {(g.start / 1000).toFixed(1)}–{(g.end / 1000).toFixed(1)}{" "}
                seconds · unknown
              </p>
            ))}
          </details>
          <ol className="camera-timeline">
            {report?.events
              ?.slice(-30)
              .reverse()
              .map((o: any) => (
                <li key={o.id}>
                  <strong>
                    {(o.elapsedMs / 1000).toFixed(1)}s ·{" "}
                    {visionLabels[o.state as VisionState]}
                  </strong>
                  <span>
                    {o.calibrated
                      ? "Head pose calibrated"
                      : "Head pose not calibrated"}
                  </span>
                  {o.gaze && <span>{gazeLabels[o.gaze as GazeState]}</span>}
                  {o.phone && (
                    <span>
                      {phoneLabels[o.phone as PhoneState]}
                      {o.phoneScore > 0
                        ? ` · model score ${Math.round(o.phoneScore * 100)}%`
                        : ""}
                    </span>
                  )}
                  {o.reason && o.reason !== "usable" && (
                    <span>Reason: {o.reason.replaceAll("_", " ")}</span>
                  )}
                  {o.evidenceId &&
                    (o.evidenceAvailable ? (
                      <a
                        href={`${base}/evidence/${o.evidenceId}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        View optional snapshot
                      </a>
                    ) : (
                      <span>Snapshot deleted or expired</span>
                    ))}
                </li>
              ))}
          </ol>
          {(report?.eventCount || 0) > 30 && (
            <p>
              Showing latest 30 transitions; up to 200 retained in the report
              response.
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
