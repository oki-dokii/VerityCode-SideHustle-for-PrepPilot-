# Phase 4 — Experimental gaze, visible phones and selected-screen evidence

Implemented 18 October 2026 as a working prototype. This does **not** complete the human accuracy/feasibility gates F2/F3/V3/V4 or the real-device screen-sharing matrix F4/E2. No automatic cheating verdict, penalty or score combines these signals.

## Try it

Refresh the local assessment. Enable camera checks through its existing consent control. The updated disclosure includes face, head, experimental gaze and visible-phone processing. Head calibration remains separate. Choose **Calibrate gaze**, keep your head still and follow the dot through nine training targets and four separate validation targets. Cancel or Escape disables the procedure. Gaze also has an explicit Disable control. Gaze findings stay disabled if calibration fails. Camera frames, landmarks, eye features and fitted calibration coefficients stay local; only timestamped observation states, calibration error and phone model scores join the metadata timeline.

Phone detection runs locally alongside face processing. Its “not detected” state means no qualifying detection in the current visible frame; it says nothing about hidden devices, another display, phone activity or whether a model/LLM was used. A model score is not the probability of cheating, nor a calibrated correctness probability.

The independent **Selected-screen snapshots** panel requires another checkbox and **Choose screen to share**. The browser picker controls the actual selected surface. A declined or cancelled picker starts no screen session. Snapshots may include anything visible on the selected surface. Use **Stop screen sharing**, the browser's own stop control, or **Delete screen snapshots & revoke consent**. Capture stops on submission, navigation and language changes; reload never reopens a camera or display stream.

## Gaze adapter and limits

MediaPipe's iris landmarks do not directly infer gaze. This prototype adds a small per-session ridge-regression adapter from normalized binocular iris positions plus head yaw/pitch to browser-viewport coordinates. It uses no WebGazer dependency and is not a validated pretrained gaze estimator. The alternate-model comparison required by F2 remains pending. The current adapter may fail calibration on ordinary webcams, glasses, small eye images or changing posture; those failures should remain visible rather than generating findings.

- A local worker extracts eye ratios from the 478-point face result; small/closed eyes and absent/multiple faces suppress gaze input. Images are not sent to a remote inference service.
- Each target settles for 600 ms, then collects ten consecutive stable samples. Head motion beyond 12° from the initial calibration pose fails calibration. Each target has a 15-second timeout.
- Nine grid targets fit the adapter; four held-out targets test it. Every held-out normalized Euclidean error must be ≤0.18. That is a local fit gate, not an accuracy claim, angular error measurement or ground-truth attention label. Insufficient feature variation fails the fit.
- Outside the viewport plus a margin `max(0.12, 1.5 × maximum validation error)` for three seconds yields a sustained outside estimate. Three distinct departures in 60 seconds yield a repeated-estimate observation. A usable return inside is required before another episode can count; missing frames cannot manufacture repeated departures.
- A >1.5-second sample gap interrupts duration accumulation. Missing/closed eyes, poor exposure, multiple faces and head movement beyond 15° of the calibration baseline suppress estimates. Window resize invalidates calibration. Move the camera or change viewing position: manually recalibrate. Drift is not otherwise fully detected.
- Fitted coefficients and eye features are discarded on stop/reload. Successful validation error is retained with observations. Calibration failure is shown locally; the server records uncalibrated/calibrating state, not the full target-by-target experiment.
- Extrapolating beyond screen calibration targets is particularly uncertain. No inference about another device or intent follows from these estimates.

## Phone adapter

Pinned MediaPipe Tasks Vision 0.10.32 with official EfficientDet-Lite0 float16 version 1. `npm run vision:setup` downloads and verifies the additional model, then serves it from the local application origin. SHA-256:

`4b59100025bea1235a84c1038879a6cccc9f6c49f5e41144e91e74d99e780993`

CPU inference in the existing worker, at most once per second, `cell phone` category allowlist and model output threshold 0.35. A review state requires score ≥0.60 across fresh detections spanning one second. Gaps >2.5 seconds reset it. Detection is independent of whether a face is visible. Phone-model initialization failure leaves face checks running with phone observations unavailable. The face and phone tasks share worker time, so slow hardware can reduce sampling and usable coverage; full performance qualification remains pending.

Partial visibility, tiny objects, low light, objects resembling phones and changes in framing have not been characterized. We have not measured held-out phone precision/recall. The positive phone-rule tests use injected scores; synthetic browser camera tests check actual model startup and negative-frame processing, not positive-object accuracy.

## Screen evidence and retention

Screen permission and camera permission are independent. `getDisplayMedia({video:true,audio:false})` runs directly from the user's click; the application cannot silently choose a desktop. Store `displaySurface` when the browser reports it; otherwise label it unknown. Captures are attempted immediately, every 15 seconds and on window focus loss, with a global per-attempt minimum five-second interval and maximum 240 entries. Background throttling and OS/browser policy can suppress captures. A screenshot is a momentary observation of one selected surface, not continuous desktop coverage.

Frames are reduced to maximum width 640px, JPEG encoded and bounded to 48 KB. Oversized, muted or unavailable frames become capture-unavailable metadata where upload is possible. Failed uploads are displayed and not queued as private images in localStorage. Missing snapshots are unknown. Small snapshots may not preserve readable code or text; no OCR or content classification is performed.

Migration 5 adds separate consented screen sessions and image records. API authorization uses the existing attempt owner; creation/upload requires an active attempt and consented active session. Upload timestamps must be recent and within the session. Bounded strict schemas, immutable-ID conflict checks, per-attempt limits, no-store and nosniff apply. Images live in private PostgreSQL storage, never public asset directories. Expired images are denied immediately; the existing startup/minute sweep clears image bytes. Revoke clears image bytes and closes all existing screen sessions transactionally. Metadata remains to display deleted/expired states. A new explicit share can grant new consent. This is active-store deletion; backup/physical erasure policy remains release work.

## Timeline improvements

New camera observations include a reason for unusable data: exposure, stale frame, muted camera, hidden tab, pending duration confirmation or stopped monitoring. Older observations have no stored reason, so their cause cannot be reconstructed. An uncalibrated head does not disable face visibility, and an uncalibrated gaze does not disable phone detection.

Usable face, gaze and phone duration estimates are reported separately. Only consecutive samples ≤1.5 seconds apart with usable endpoints contribute. Overlapping sessions are unioned. These durations estimate available observations, never accurate continuous supervision. All metadata is browser-supplied and is not tamper proof.

## Validation status

Production build passed; all 42 backend/rule tests and all 11 browser scenarios passed. The full browser run includes Python/C++/Java regressions and the 60-second monitoring outage. A final targeted camera run also passed after separating persistent consent confirmations from background upload status and serving the runtime with a JavaScript MIME type.

- Unit/API tests cover calibration fit/rejection, held-out failure, stable versus repeated departures, interruptions, phone thresholds/staleness, consent, ownership, rate limits, immutable evidence IDs, expiry and revocation.
- Isolated Chrome uses a synthetic webcam to exercise the actual locally served face and phone models, camera consent and release, offline metadata recovery and gaze calibration controls.
- Screen browser tests replace the display picker with a generated canvas stream and a cancellation fixture. They verify no sharing without consent, snapshots, deletion, track release and no restart on reload. They do not establish browser-picker or OS capture compatibility.
- Human accuracy tests, labelled full/partial phones and similar-object negatives, real gaze calibration and drift, physical tab/window/monitor selection, OS permission revocation and long-run CPU/editor latency remain pending. Use the Phase 0 consented held-out pilot before claiming the V3/V4 gates pass.
- The agent did not activate the user's webcam or capture the user's desktop during implementation/testing.

## Sources and model provenance

- [MediaPipe object detector guide](https://developers.google.com/edge/mediapipe/solutions/vision/object_detector) and [official model asset](https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float16/1/efficientdet_lite0.tflite).
- [Google's iris-tracking limitations](https://research.google/blog/mediapipe-iris-real-time-iris-tracking-depth-estimation/): iris tracking is not itself gaze estimation.
- The runtime is pinned by the npm lockfile and copied to a `.js` asset so production static serving uses a JavaScript MIME type; both model hashes are verified by the setup script. Distribution/licensing and production privacy review remain part of release preparation; no new production-readiness claim is made here.

Next planned phase: token-based code similarity with matching spans and evaluation fixtures, preserving Python, C++ and Java support.
