# Phase 3 — Experimental face and head monitoring

Implemented 17 October 2026. This is the working prototype, not completion of the human accuracy gates F1/V1/V2. Gaze, visible-phone detection, screen evidence, similarity and the full reviewer/PDF workflow remain on the agreed roadmap.

## Use it

Refresh the local assessment, scroll to **Camera observations**, read the disclosure and tick camera consent. Click **Enable camera checks**, then allow the browser camera permission. The camera is never enabled automatically on load, resume or reload. To use head orientation, look at the screen with one face in good lighting and click **Calibrate neutral pose**; keep still for roughly three seconds. Stop releases all tracks and terminates the worker. Navigation, language changes and submission also stop it; starting again requires a click and a new calibration.

The independent snapshot checkbox is off by default. With it enabled, a sustained review observation can save a 320×240 JPEG, limited to one per minute and 20 per attempt. No continuous video, microphone audio, face landmarks, face recognition or gaze inference. With snapshots off, camera frames stay in memory on the device. Timestamped observation metadata is sent to the local server, including state, calibration status and inference time. Camera coverage and its timeline are separate from browser focus events and coding scores.

If the model cannot initialize, the camera fails, or permission is denied, coding remains available and the error is displayed. A lost/stale frame, hidden tab, dark/overexposed image or processing failure is unknown, not evidence of absence. No camera result affects a score or automatically terminates an attempt.

## Reproducible assets

After `npm ci`, run `npm run vision:setup` before development or a production build. This copies the pinned MediaPipe 0.10.32 WASM/runtime into ignored `public/vision/` and downloads the official float16 face-landmarker version 1 bundle, verifying SHA-256:

`64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff`

The local setup has already been run. A deployed browser fetches assets only from its own application origin. Model download at setup time requires internet access. The classic worker is intentional: the package's WASM loader uses `importScripts`. The prototype runs CPU inference in an isolated worker, at most five frames per second with one frame in flight. It preserves the source aspect ratio, limits input width to 640px and uses a mirrored preview only; inference sees the unmirrored frame.

References: [MediaPipe web guide](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js), [model bundle](https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task), [JS matrix adapter](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/tasks/web/vision/face_landmarker/face_landmarker.ts), [matrix serialization](https://github.com/google-ai-edge/mediapipe/blob/master/mediapipe/framework/formats/matrix.cc).

## Observation rules, version 1

- Model detection/presence/tracking thresholds 0.6; at most two faces. Thus “multiple” means two or more and is not an exact crowd count. MediaPipe's single-face smoothing is not used with this configuration; duration filtering is explicit in our rules.
- No face for 3 seconds, or multiple faces for 1 second, creates the respective state. Brief transitions remain unknown. There is no phone-use inference from looking down.
- Neutral calibration uses 15 consecutive usable single-face poses, stable within 5° on all axes. Failure to achieve that leaves head checks uncalibrated while face visibility checks continue. Use a new calibration after moving the camera.
- Matrix data follows MediaPipe's packed Eigen column-major transform. Remove scale, decompose as `Rz(roll) Ry(yaw) Rx(pitch)` and compare wrapped angular differences against the local neutral pose. Names are model axes; the UI does not claim a person's gaze direction. Degenerate/gimbal-lock matrices cannot establish calibration.
- Sustained relative absolute yaw >25° or pitch >20° for 3 seconds produces a head-orientation observation. A 5° hysteresis applies once established. These are initial engineering thresholds, not validated behavioural boundaries.
- Global mean brightness outside 25–240 is unusable. This simple gate does not establish sharpness, occlusion, skin/face exposure or image quality generally. Those limitations require pilot characterization.
- More than 1.5 seconds between processed samples resets pending durations/calibration samples. Hidden tabs and muted tracks contribute unknown observations. Worker timeout releases the camera and exposes a restart action.

Metadata is sampled about once per second and on state changes. Coverage joins consecutive sequence numbers only when both endpoints are usable and at most 1.5 seconds apart. Overlaps are unioned; missing sequences, pending thresholds, unusable samples and the live tail are unknown. This estimates usable observations, not continuous supervision, and does not imply head pose was calibrated throughout. The timeline distinguishes calibration status.

## Storage and evidence

Migration 4 adds camera sessions, observations and evidence separately from Phase 2. Session records retain the model/rule version and consent state. Strict allowlisted metadata, timestamp checks, ownership checks and duplicate/conflict handling apply to uploads. Metadata retries use separate localStorage buffers per panel instance, bounded at 2,000 observations; gaps remain visible if oldest entries are dropped or storage is unavailable. Revisit the attempt to retry pending metadata; there is no background service worker. Server limits are 100 sessions and 20,000 observations per attempt, 50 per batch, with a seven-day late metadata upload window.

Optional JPEG evidence is linked to an accepted review observation and authorized camera session. Snapshots upload only while the attempt/session/consent are active, within ten seconds of that observation. Failed image uploads are reported and are not persisted in localStorage or silently retried. Observation metadata can still retry. Images are bounded to 48 KB; camera-generated images are JPEG, while the API only validates size and JPEG framing, not a full image decode.

Prototype storage uses private PostgreSQL `bytea`, not a public media directory or cloud bucket. The owner-only read endpoint sends no-store and nosniff headers. Expired bytes are denied immediately and nulled on startup and a one-minute server sweep. **Delete snapshots & revoke consent** revokes all existing camera sessions' image-upload consent and clears their image bytes transactionally. Metadata remains so the timeline can say deleted/expired. Camera processing can continue with metadata only. A deliberate new enable action can grant new consent. Stop ends collection but does not delete earlier consented evidence.

Deletion is from the live application store, not a guarantee of physical disk erasure or removal from database backups. Production backup policy, encryption/key management, real account/reviewer authorization and 90-day metadata retention still belong to release hardening. Browser-origin metadata remains client-supplied and can be altered; no tamper-proof claim.

## Validation and remaining gates

- Backend/pure suite: 32 tests passed, including matrix axes/scale, calibration stability, sustained thresholds, hysteresis, stale/unknown samples, consent, ownership, idempotency, bounded schemas, private media, revocation, actual expiry of stored bytes and coverage gaps.
- Isolated headless Chrome with its synthetic camera exercised the actual locally hosted model/WASM, sustained no-face observations, optional snapshot storage/deletion, Stop releasing tracks and reload leaving camera off. A targeted rerun also passed after adding failed-upload buffering and reload recovery. A separate permission-denial scenario leaves coding usable. No human webcam was activated by the agent.
- Production TypeScript/Vite build passed. All 9 browser scenarios passed, including Python/C++/Java coding regressions and a 60-second browser-monitoring network outage; the 2 camera scenarios also passed the final targeted rerun.
- Synthetic tests establish plumbing and rule correctness only. They do not establish face-count/head-pose accuracy. F1, V1/V2 and the real-device parts of E1 are **pending**, as are cross-browser/hardware checks, consented ordinary-coding/labelled clips, false-alert rates and the 60-minute editor-latency gate. Capture participant consent and evaluate the Phase 0 held-out protocol before making accuracy claims.

For manual qualification: test no permission, camera denied, empty frame, one face, two faces, brief glance, sustained turns, keyboard reading, glasses adjustment, dark/bright lighting, camera unplug, sleep/resume, hidden tab, offline upload recovery, evidence off/on/revoke, submission and language change. Record browser/version/hardware, expected/observed state, timestamps, unknown coverage and inference timings. Include normal behaviour as negatives; movement alone never establishes outside assistance.
