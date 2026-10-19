# Phase 2 — Browser monitoring and timeline

Implemented 17 October 2026. This phase adds browser observations, not computer-vision analysis or a cheating classifier.

## Available behaviour

- New assessments disclose browser monitoring before the student acknowledges and begins. Existing Phase 1 attempts remain unmonitored. Finish/submit an existing active attempt, then start a new attempt to use this phase; the start button otherwise resumes the active attempt.
- Separate events for page hidden/visible, window blur/focus, fullscreen enter/exit, editor paste, online/offline, session start/stop and queue overflow.
- Paste events record only that a paste occurred inside Monaco. Clipboard text, screenshots, camera frames, microphone audio, other tabs and other applications are not collected.
- Optional fullscreen toggle. Leaving fullscreen is logged; fullscreen is not required and does not control the operating system.
- Five-second heartbeats and two-second batch-upload retries. A bounded browser-local queue survives reload and retains events until the server acknowledges their IDs.
- PostgreSQL stores sessions, event IDs, sequences, elapsed times, state snapshots and server receipt times. Duplicate retries are acknowledged without duplication; conflicting identities are rejected atomically.
- Events are accepted after submission when they were observed during the attempt, within a seven-day upload window. Observations after the assessment ended are acknowledged as discarded. New monitoring sessions cannot start after submission/deadline.
- Timeline below the editor, event filters, elapsed timestamps, session attribution, received times, overflow counts and expandable history. Latest 200 non-heartbeat events are displayed; counts and coverage use all stored observations.
- Estimated coverage and explicit unknown/pending intervals, separate from the coding result.

## Coverage method and limits

For each session, join consecutive sequence numbers only if their timestamps are no more than 15 seconds apart. Do not bridge stopped sessions, missing sequences or dropped-data markers. Clip intervals to assessment time, union overlaps across sessions, then compute observed duration / assessment duration. Heartbeats are included in the calculation but hidden from the timeline.

A heartbeat connection is an estimate between samples, not proof of continuous supervision. Background throttling, a sleeping computer or a closed page can produce unknown intervals. A failed upload alone does not imply failed local observation: delayed uploads can revise coverage upward. The live tail is pending until the next sample arrives. Browser events are client-supplied and can be altered; no tamper-proof claim is made.

Each session holds up to 500 queued observations. Overflow preserves a loss marker and the newest observations. Server caps: 50 events per batch, 100 sessions per attempt and 20,000 stored events per attempt. Only the attempt owner can initialize monitoring, upload events or read its report. No service worker is installed: pending events retry while the assessment/report page is open, or when it is revisited. Browser storage loss can remove unsent events; those intervals remain unknown. When browser storage is unavailable, the UI warns that memory-only buffering will not survive reload.

The seven-day upload window is not automatic deletion. Production retention/deletion remains a release task, as already recorded in Phase 1.

## API and implementation

- `POST /api/attempts/:id/monitoring/sessions`: idempotent session registration and server-time anchor.
- `POST /api/attempts/:id/events/batch`: strict bounded schema, ownership/timestamp validation and explicit acknowledgements/discards.
- `GET /api/attempts/:id/monitoring`: coverage, gaps, all-event counts and bounded timeline.
- Schema migration 3 adds monitoring sessions/events and an opt-in-at-creation flag without enabling old attempts.
- Source: `server/monitoring.ts`, `server/coverage.ts`, `web/BrowserMonitoring.tsx`, `web/eventQueue.ts`, `shared/monitoring.ts`.

## Verification

- Backend and pure-function suite: 22 tests passed, including retries, reordering, identity conflicts, transaction rollback, ownership, late uploads, post-submission cutoff, legacy attempts, overlap merging, sequence gaps and overflow accounting.
- Production build: passed.
- Browser suite: all 7 scenarios passed across the initial run and targeted rerun: four coding/language regressions, event instrumentation/fullscreen, reload/retry recovery, and a full 60-second browser network outage. Controlled focus, visibility and paste dispatches check instrumentation; they are not evidence of OS-level or cross-browser detection accuracy. Fullscreen is exercised through the browser API. The outage test disables the browser context network, buffers at least ten heartbeats, restores the network and verifies recovered coverage with one offline/online event each.
- Still required for broad release: manual real-tab/window transitions across the supported browser/OS matrix, physical network interruption outside browser emulation, storage-quota cases on multiple browsers, longer-session performance/load checks and retention sweeps. No camera/browser-monitoring accuracy claim beyond these tests is made.

Judge0 configuration is still required for live code execution. Phase 3 face/head monitoring and later gaze, phone detection, similarity and full report features remain in the roadmap.
