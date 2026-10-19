# Phase 0: Validation and roadmap

## Status and acceptance policy

Research and design are drafted. All empirical results are pending. Numerical targets below are proposed engineering gates, not measured performance or vendor benchmarks. Freeze the evaluation protocol before tuning final thresholds. A failed gate creates a remediation task; it does not justify weakening the target after viewing held-out results.

Phase 0 has two parts: the specification delivered here, and the feasibility experiments below. Phase 1 foundation work can start while experiments remain open, but full Phase 0 closure requires recorded experiment outcomes and dependency decisions.

## Early feasibility experiments

| Experiment | Procedure | Required artifact / decision |
|---|---|---|
| F0: execution provider | Submit correct, failing, timed-out and oversized-output Python programs to an isolated runner | Provider, supported runtime, resource limits, failure mapping, costs and credentials setup; no keys in repo |
| F1: face/head feasibility | Local camera harness; neutral baseline, turns, looking down, leaving frame and two faces; vary lighting, glasses and camera angle | Labelled event metrics, CPU/inference timings, orientation convention and multi-face smoothing choice |
| F2: gaze feasibility | Compare a browser gaze candidate such as WebGazer with an alternative if needed; train on calibration targets and validate on separate targets | Licence/model choice, calibration failure rate, error distribution and feasibility of broad on/off-screen classification |
| F3: phone feasibility | Select a browser-capable detector with an explicit phone class; evaluate full/partial visibility and phone-like negatives | Licence/model checksum, precision/recall by object size and occlusion, runtime and false alerts |
| F4: browser evidence | Test permissions, shared tab/window/display, permission revocation, background throttling and reload in target browsers | Capability matrix, fallback UX and confirmed capture boundaries |

These experiments are not yet executed. Camera experiments need consented participants or suitable licensed footage. Do not activate the user's camera just to fill the table. Prefer adult volunteers for the initial research cohort; production age handling remains a launch decision.

## Dataset and measurements

Initial feasibility pilot: at least 12 consenting participants, two 15-minute sessions each (one ordinary coding, one scripted observations). This small pilot is for feasibility, not a production accuracy claim. Recruit varied camera positions, glasses, lighting and hardware; document conditions without inferring sensitive characteristics from video.

Split by participant: eight for development and four held out. Do not let frames from one participant/session leak across splits. Keep calibration samples distinct from evaluation targets. Label event start/end, detector visibility and uncertainty; have a second annotator review ambiguous segments and a sample of the rest. Track consent and deletion for all recordings. Expand the cohort before general availability.

Match detected and labelled intervals one-to-one at temporal intersection-over-union ≥0.5. Report event precision/recall, duration error, onset delay, false review alerts per ordinary coding hour, coverage and calibration failure. Provide sample counts and confidence intervals; publish results by tested condition where sample size permits. False-alert rates cannot be hidden by disabling most monitoring, so always report coverage alongside them.

Gaze ground truth uses instructed target locations with adherence uncertainty documented; it does not establish what a person truly attended to. Phone ground truth is visible object presence, never whether a student cheated.

## Proposed acceptance matrix

| ID | Test and expected result | Gate |
|---|---|---|
| A1–A2 | Complete mock; refresh; resume; submit twice; cross deadline | All deterministic scenarios pass; unchanged deadline, correct score, no lost acknowledged draft or duplicate final submission |
| A2 | Correct/wrong/compile-error/timeout/memory/output-limit/provider-error fixtures | Every fixture maps to expected status; provider errors never score as wrong answer |
| B1 | Tab hidden, focus lost, fullscreen exit and paste, with supported permission states | 20 scripted repetitions per event per target browser recorded correctly, with observed limitations documented |
| B2 | Retry batch, reordered events, 60-second offline period, reload and queue overflow | No duplicate persisted IDs; recovered events reconciled; unrecoverable gaps explicit |
| V1 | Face absence and multiple faces in labelled clips | Pilot event precision and recall ≥0.90 on held-out usable conditions; no coverage gaps reported as absence |
| V2 | Sustained relative head orientation versus normal coding | Pilot event precision and recall ≥0.85; 95th-percentile duration error ≤2 seconds |
| V3 | Calibration on known targets, validation on withheld targets and natural screen reading | Pilot broad-region precision ≥0.90 and recall ≥0.80 on usable sessions; valid coverage ≥80%; failed calibration visibly disables gaze findings |
| V4 | Visible phones, partial phones, notebooks, calculators and empty hands | Pilot event precision ≥0.90 and recall ≥0.80 on specified visibility conditions; publish the partial-visibility result separately |
| V1–V4 | Ordinary coding, looking at keyboard, stretching, glasses adjustments | Combined false review alerts ≤2 per monitored hour in pilot; report per-detector rates and coverage |
| E1–E2 | Reject consent, revoke permission, failed upload, expiry and deletion | No media captured/uploaded outside consent; failures and expiry visible; active-store deletion verified within proposed 24-hour bound |
| C1–C2 | Original/copy/renamed/reformatted/reordered examples and independent standard solutions | At least 100 labelled pairs across 10 problems; separate held-out problems; precision ≥0.90, recall ≥0.80 for supported transformations; unsupported transformations reported |
| R1–R2 | Compare stored events and results with UI/PDF; dismiss findings; expire evidence | Every finding traces to observation/configuration; matching report values; reviewer history and evidence expiry preserved |
| Q1 | Access another user's attempt/evidence; inject HTML in code/report fields | Cross-user access denied, signed URLs scoped/expiring, untrusted content escaped |
| Q1 | 60-minute session on documented baseline laptop | No monitoring-caused editor freeze >100 ms attributable to main-thread inference; measure input latency and dropped frames |
| Q1 | Load test proposed pilot size: 20 active attempts, five concurrent execution jobs | No lost acknowledged data; bounded queues; event-ingestion p95 <1 second under stated test conditions |

Initial supported target: current desktop Chrome and Edge on Windows/macOS, with exact versions recorded during testing. Firefox/Safari need their own capability results before claiming monitored support. Mobile assessment is not part of the initial support matrix. Keyboard navigation, screen-reader labels and zoom must work; calibration accommodations and a non-gaze mode need explicit coverage labels.

## Testing tools and layers

- Unit tests for interval aggregation, scoring, event deduplication and report policy; synthetic clocks cover boundary cases.
- API/database integration tests for ownership, retries, deadline enforcement, durable jobs and deletion.
- Playwright end-to-end tests for the assessment and review journeys; mock detector outputs for deterministic assertions.
- Separate real-browser/manual tests for permissions, physical camera conditions and screen sharing. Mocked tests do not establish vision accuracy.
- Offline labelled-fixture evaluation for actual detector models. Model/config changes rerun their relevant regression suites.
- Controlled runner resource-limit tests outside the main application host.

## Phased implementation backlog

| Phase | Deliverable | Dependency and exit |
|---|---|---|
| 0 | Research, architecture, rules, test plan and F0–F4 experiments | Documents drafted; experiments and model/provider decisions pending |
| 1 | One Python coding mock, student journey, timer, autosave, sandboxed scoring | F0 passed; A1/A2 gates passed |
| 2 | Browser events, durable ingestion, basic timeline and coverage | Phase 1; B1/B2 gates passed |
| 3 | Face/head monitoring and optional webcam evidence | F1 and relevant F4 results; V1/V2/E1 gates passed |
| 4 | Calibrated gaze, visible-phone detection and optional screen evidence | F2/F3/F4 results; V3/V4/E2 gates passed; retain experimental label until passed |
| 5 | Token similarity, matching spans, curated corpus; expand languages | C1/C2 gates passed per language/problem family |
| 6 | Full student/reviewer reports, decisions and PDF | All finding contracts integrated; R1/R2 gates passed |
| 7 | Integrated pilot, release hardening and support documentation | Q1 passed; full-scope gates satisfied or explicit incomplete status |

Similarity development can proceed independently after the submission schema is stable. Review UI begins with the basic timeline in Phase 2, rather than waiting until Phase 6 to discover data gaps.

## Open decisions and defaults

| Decision | Working default | When it must be resolved |
|---|---|---|
| Pilot cohort and footage | Consenting adult volunteers; no existing student data assumed | Before real-camera experiments |
| Gaze and phone models | Adapter interfaces; no model selected as production-ready | F2/F3 |
| Runner hosting and budget | External isolated Judge0-compatible service | F0 / before live execution |
| Initial language | Python, then C++ and Java | Phase 1 |
| Evidence retention | 7 days images/PDF; 90 days metadata/code | Before real-user uploads |
| Deployment jurisdiction, age handling and backups | Undecided; no compliance claim | Before public launch |
| Dataset sufficient for release | Pilot is feasibility evidence only; expand evaluation | Phase 7 |

## Phase 0 closure checklist

- [x] Full agreed feature inventory and phase mapping.
- [x] Primary-source feature research with uncertainty identified.
- [x] Student/reviewer journeys and proposed architecture.
- [x] Event, capture, coverage and retention design.
- [x] Test protocol and measurable proposed gates.
- [ ] F0–F4 experiments executed and results saved.
- [ ] Runner/model/licence decisions recorded against evidence.
- [ ] Benchmark hardware/browser versions and pilot cohort finalized.

Next concrete task: build the isolated feasibility harnesses, beginning with F0 and F1, while keeping assessment application implementation in Phase 1.
