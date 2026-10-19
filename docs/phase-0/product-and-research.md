# Phase 0: Product and research

Date: 17 October 2026. Status: design baseline; implementation and empirical validation pending.

## Product objective

Let students rehearse a realistic proctored coding assessment and receive separate coding results and an explainable integrity report. Reproduce the familiar workflow: instructions, permissions, system checks, timed coding, submission, results, and evidence review.

Success means completing that journey with traceable observations and measured detector performance. It does not mean guaranteeing that all outside assistance is detectable.

## Source-backed platform comparison

The following describes published capabilities, not independent verification of vendor accuracy. Availability varies by configuration and product tier. Sources accessed on the date above.

| Capability | Documented reference | VerityCode approach |
|---|---|---|
| Rules and permissions before starting | HackerRank documents onboarding and permissions [1] | Rules, consent, capability checks, and explicit monitoring mode |
| Browser restrictions | Both document fullscreen and leaving-test controls [1,2] | Log visibility, focus and fullscreen separately; configurable warnings |
| Face absence / multiple faces | HackerRank documents webcam anomaly detection [1] | Local face detection with duration aggregation |
| Gaze patterns | HackerRank documents eye/head behaviour analysis; gaze is listed as limited availability [1] | Separate calibrated gaze estimator and head-pose detector, each evaluated |
| Visible phones/tablets | HackerRank describes object detection and captured images for review [1] | Separate object detector and consented event snapshots |
| Evidence capture | HackerRank describes periodic webcam/screen images and denser screen capture around events [1]. HackerEarth documents random webcam snapshots [2] | Configurable periodic and event-based snapshots; no claim of complete video replay |
| Similarity | HackerEarth documents within-test and internet-source comparisons [3] | Same-problem comparisons first, curated reference corpus next |
| Review interface | HackerRank describes synchronized findings and session evidence [1] | Event timeline, linked evidence, reviewer decisions and PDF export |

Neither these documents nor a dot-calibration exercise reveal a proprietary algorithm, threshold or error rate. We will not copy vendor percentage thresholds as if they were validated for our tokenizer or tasks. Public-code comparison coverage must identify the actual corpus searched.

## Scope commitments

| ID | Required capability | Integration phase |
|---|---|---|
| A1 | Student dashboard, assessment rules and system checks | 1 |
| A2 | Editor, questions, timer, autosave, run, submit, hidden tests and scores | 1 |
| B1 | Tab visibility, window focus, fullscreen and paste events | 2 |
| B2 | Reliable event ingestion, camera/share interruption and monitoring coverage | 2–3 |
| V1 | Face visibility and multiple faces | 3 |
| V2 | Head yaw/pitch/roll relative to baseline | 3 |
| E1 | Consented webcam snapshots, capture failure and evidence expiry | 3 |
| V3 | Gaze calibration, estimate quality and sustained/repeated deviations | 4 |
| V4 | Visible-phone detection and contextual event grouping | 4 |
| E2 | Optional screen sharing and timestamped screenshots | 4 |
| C1 | Normalized code comparisons with matching source regions | 5 |
| C2 | Curated public/reference-code corpus comparisons | 5 |
| R1 | Coding results, coverage and basic event timeline | 1–2 |
| R2 | Full evidence viewer, similarity viewer, human decisions and PDF | 6 |
| Q1 | Reliability, accessibility, security and detector validation | Every phase; release gate in 7 |

Gaze and phone features cannot be silently removed when difficult. A failed evaluation means an explicitly experimental feature, a remediation task, and no full-scope completion claim.

Additional competitor capabilities are tracked separately: automatic screenshot-content analysis, native desktop lockdown, comprehensive monitor detection, microphone analysis, identity verification and editor-conversation inference. These were not part of the agreed core feature set. They require separate scope and feasibility decisions rather than implied parity. Screen evidence collection does not by itself implement automatic content analysis.

## Student and reviewer journeys

1. Student selects a mock, sees allowed resources, duration, languages and monitoring requirements.
2. Student sees what data is processed locally, what is uploaded, who may review it and when it expires. Camera and evidence permissions are distinct.
3. System checks editor, runner availability, connectivity and selected monitoring capabilities. Calibration is required only for the relevant detectors.
4. A server-created attempt starts. The student sees a timer, autosave status, question, editor, run results and monitoring status.
5. Recoverable interruptions produce clear status messages. If a required capability is unavailable before starting, offer retry or an explicitly unmonitored practice attempt; never silently downgrade.
6. Submission or deadline closes the attempt. Coding results can appear before similarity analysis finishes; pending work is labelled.
7. Student sees coding performance, coverage and findings. A reviewer can inspect evidence and dismiss or confirm a policy concern, recording a reason. Students can request correction.

Mock rules should allow accommodations without penalizing ordinary movement. Default warnings concern actionable setup problems, not every glance. Review decisions never modify the independently computed coding score.

## Sources and what they establish

1. [HackerRank Proctor Mode](https://support.hackerrank.com/articles/5663779659-Proctor-Mode) — published workflow, monitoring and report features; not their measured accuracy or model internals.
2. [HackerEarth Proctoring settings](https://help.hackerearth.com/hc/en-us/articles/360002987633-Proctoring-settings) — configurable browser controls and candidate snapshots.
3. [HackerEarth Plagiarism insights](https://help.hackerearth.com/hc/en-us/articles/360003777793-plagiarism-insights) — within-test and internet comparisons and review output.
4. [MediaPipe Face Landmarker for Web](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js) — landmarks, optional transformation matrices and multi-face configuration. This is not a calibrated screen-gaze API. Multiple-face mode changes smoothing behaviour; our aggregation must be tested.
5. [MDN Page Visibility](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API) — visibility differs from focus, and background tabs may be throttled.
6. [MDN Screen Capture](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Capture_API/Using_Screen_Capture) — user-selected sharing surface and capture constraints. A website cannot force the browser's picker to expose only one source.
7. [Judge0 API](https://ce.judge0.com/) — execution jobs and resource limits. Deployment security still requires configuration and review.
8. [Stanford MOSS](https://theory.stanford.edu/~aiken/moss/) — similarity is not proof of plagiarism; human examination matters. Reference only, not a selected dependency.
9. [Brown WebGazer](https://webgazer.cs.brown.edu/) — candidate browser gaze-estimation research implementation. Evaluate licence, runtime, calibration and accuracy before adopting.
