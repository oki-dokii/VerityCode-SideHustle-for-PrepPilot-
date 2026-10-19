import { useEffect, useRef, useState } from "react";
async function request(path: string, method = "GET", body?: unknown) {
  const r = await fetch(path, {
    method,
    signal: AbortSignal.timeout(15000),
    headers: { "Content-Type": "application/json", "X-VerityCode": "1" },
    body: body === undefined ? undefined : JSON.stringify(body),
    keepalive: path.endsWith("/stop"),
  });
  const b = await r.json();
  if (!r.ok) throw new Error(b.error || "Screen request failed");
  return b;
}
export default function ScreenEvidence({
  id,
  active,
}: {
  id: string;
  active: boolean;
}) {
  const base = `/api/attempts/${id}/screen`;
  const [consent, setConsent] = useState(false),
    [sharing, setSharing] = useState(false),
    [pending, setPending] = useState(false),
    [status, setStatus] = useState("Screen sharing off"),
    [report, setReport] = useState<any>();
  const cleanup = useRef<(reason?: string) => void>(() => {}),
    generation = useRef(0);
  const refresh = async () => {
    try {
      setReport(await request(base));
    } catch {}
  };
  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 3000);
    const leave = () => {
      generation.current++;
      cleanup.current("page_left");
    };
    window.addEventListener("pagehide", leave);
    return () => {
      leave();
      window.removeEventListener("pagehide", leave);
      clearInterval(t);
    };
  }, [id]);
  useEffect(() => {
    if (!active) {
      generation.current++;
      cleanup.current("attempt_ended");
      setPending(false);
    }
  }, [active]);
  async function start() {
    const current = ++generation.current;
    setPending(true);
    setStatus("Choose a surface in the browser picker.");
    let stream: MediaStream | undefined,
      sessionId = "",
      timer: ReturnType<typeof setInterval> | undefined,
      disposed = false;
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    const stop = (reason = "user_stopped") => {
      if (disposed) return;
      disposed = true;
      clearInterval(timer);
      window.removeEventListener("blur", onBlur);
      stream?.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
      if (sessionId)
        void request(`${base}/stop`, "POST", { sessionId, reason }).catch(() =>
          setStatus("Screen stopped locally; server stop could not be saved."),
        );
      setSharing(false);
      setPending(false);
      setStatus("Screen sharing stopped");
    };
    cleanup.current = stop;
    let anchor = 0,
      at = 0,
      last = -Infinity,
      busy = false,
      lastVideoTime = -1;
    async function capture(reason: "periodic" | "window_blur") {
      if (disposed || busy || performance.now() - last < 5200) return;
      busy = true;
      last = performance.now();
      try {
        const usable =
          video.readyState >= 2 &&
          !stream!.getVideoTracks()[0].muted &&
          video.currentTime !== lastVideoTime;
        lastVideoTime = video.currentTime;
        let jpeg: string | undefined;
        if (usable) {
          const canvas = document.createElement("canvas");
          canvas.width = Math.min(640, video.videoWidth);
          canvas.height = Math.round(
            (canvas.width * video.videoHeight) / video.videoWidth,
          );
          canvas
            .getContext("2d")!
            .drawImage(video, 0, 0, canvas.width, canvas.height);
          jpeg = canvas.toDataURL("image/jpeg", 0.55).split(",")[1];
          if (jpeg.length > 64000)
            jpeg = canvas.toDataURL("image/jpeg", 0.25).split(",")[1];
          if (jpeg.length > 64000) jpeg = undefined;
        }
        if (disposed) return;
        await request(`${base}/captures`, "POST", {
          id: crypto.randomUUID(),
          sessionId,
          elapsedMs: Math.max(0, Math.round(anchor + performance.now() - at)),
          reason: jpeg ? reason : "capture_unavailable",
          jpeg,
        });
        if (!disposed)
          setStatus(
            jpeg
              ? "Selected surface shared · latest snapshot saved"
              : "Selected surface shared · frame unavailable",
          );
        void refresh();
      } catch (e) {
        if (!disposed)
          setStatus(`Screen snapshot not saved: ${(e as Error).message}`);
      } finally {
        busy = false;
      }
    }
    function onBlur() {
      void capture("window_blur");
    }
    try {
      if (!navigator.mediaDevices?.getDisplayMedia)
        throw new Error(
          "Screen sharing is unsupported here. Use a supported desktop browser.",
        );
      // Must be called directly within this user activation, never automatically or after a network await.
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: false,
      });
      if (disposed || generation.current !== current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const track = stream.getVideoTracks()[0];
      track.onended = () => stop("stream_ended");
      const settings = track.getSettings();
      const surface = ["browser", "window", "monitor"].includes(
        settings.displaySurface || "",
      )
        ? settings.displaySurface
        : "unknown";
      sessionId = crypto.randomUUID();
      const h = await request(`${base}/sessions`, "POST", {
        sessionId,
        acknowledged: true,
        surface,
      });
      if (disposed || generation.current !== current) {
        stream.getTracks().forEach((t) => t.stop());
        void request(`${base}/stop`, "POST", {
          sessionId,
          reason: "page_left",
        }).catch(() => {});
        return;
      }
      anchor = Date.parse(h.serverNow) - Date.parse(h.startedAt);
      at = performance.now();
      video.srcObject = stream;
      await video.play();
      if (disposed) return;
      setSharing(true);
      setPending(false);
      setStatus("Selected surface shared");
      void capture("periodic");
      timer = setInterval(() => void capture("periodic"), 15000);
      window.addEventListener("blur", onBlur);
    } catch (e) {
      stop("error");
      setStatus(
        (e as Error).name === "NotAllowedError"
          ? "Screen sharing cancelled or denied. Nothing will be captured."
          : (e as Error).message,
      );
    }
  }
  async function revoke() {
    generation.current++;
    cleanup.current();
    setConsent(false);
    try {
      await request(`${base}/evidence`, "DELETE");
      setStatus("Screen snapshots deleted and consent revoked.");
      void refresh();
    } catch {
      setStatus(
        "Screen stopped. Deletion could not reach the server; retry when connected.",
      );
    }
  }
  return (
    <section className="camera-panel" aria-labelledby="screen-title">
      <span className="eyebrow">PHASE 4 · OPTIONAL EVIDENCE</span>
      <h2 id="screen-title">Selected-screen snapshots</h2>
      <p>
        Only the tab, window or display you select is shared. Snapshots may
        include private information visible there. No audio or continuous video
        is stored. Snapshots are attempted every 15 seconds and on focus loss,
        at most once per 5 seconds (240 per attempt), and deleted after 7 days.
        They do not prove what happened between captures or on other displays.
      </p>
      {active && !sharing && !pending && (
        <>
          <label className="camera-consent">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />{" "}
            I consent to uploading snapshots of my selected surface.
          </label>
          <button
            className="primary"
            disabled={!consent}
            onClick={() => void start()}
          >
            Choose screen to share
          </button>
        </>
      )}
      {(sharing || pending) && (
        <button
          className="outline"
          onClick={() => {
            generation.current++;
            cleanup.current();
          }}
        >
          Stop screen sharing
        </button>
      )}
      <button className="outline camera-delete" onClick={() => void revoke()}>
        Delete screen snapshots & revoke consent
      </button>
      <p aria-live="polite">{status}</p>
      <p>
        {report?.events?.filter((e: any) => e.available).length || 0} available
        snapshots. Missing or failed captures are unavailable, never a
        continuous coverage claim.
      </p>
      <details>
        <summary>
          Shared surfaces and stops ({report?.sessions?.length || 0})
        </summary>
        {report?.sessions?.map((s: any) => (
          <p key={s.id}>
            {s.surface} · {new Date(s.started_at).toLocaleTimeString()} ·{" "}
            {s.stop_reason?.replaceAll("_", " ") ||
              "No stop acknowledgement yet; see snapshot timestamps"}
          </p>
        ))}
      </details>
      <ol className="camera-timeline">
        {report?.events
          ?.slice(-30)
          .reverse()
          .map((e: any) => (
            <li key={e.id}>
              {(e.elapsed_ms / 1000).toFixed(1)}s ·{" "}
              {e.reason.replaceAll("_", " ")}{" "}
              {e.available ? (
                <a
                  href={`${base}/evidence/${e.id}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View screen snapshot
                </a>
              ) : (
                <span>Unavailable, deleted or expired</span>
              )}
            </li>
          ))}
      </ol>
    </section>
  );
}
