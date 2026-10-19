# VerityCode

A student-focused mock coding assessment platform with browser monitoring, computer vision, code similarity analysis, and explainable integrity reports.

## Project status

Phase 4 experimental gaze calibration, visible-phone detection and optional selected-screen snapshots are implemented alongside face/head monitoring, the coding foundation and browser monitoring. Live execution awaits Judge0 configuration. Human vision-accuracy gates remain pending.

- [Product scope and platform research](docs/phase-0/product-and-research.md)
- [Architecture and evidence design](docs/phase-0/architecture.md)
- [Acceptance tests, feasibility experiments and phased backlog](docs/phase-0/validation-and-roadmap.md)

The full scope includes gaze calibration and visible-phone detection. Early milestones do not replace this scope. Detection findings support review; they do not establish cheating. Competitor documentation is a feature reference, not evidence that our implementation has equivalent accuracy.

## Run the app

```sh
npm ci
npm run vision:setup
cp .env.example .env
npm run db:start
npm run dev
```

Open http://127.0.0.1:5173. See [setup instructions](docs/phase-1/setup.md) for database options, runner configuration and tests, and [implementation status](docs/phase-1/status.md) for remaining acceptance gates.

## Browser monitoring

New assessments include disclosed browser-event monitoring and an assessment timeline. Existing Phase 1 attempts remain unmonitored. See [Phase 2 details and validation](docs/phase-2/status.md). The local server should remain running while you use the preview.

## Camera monitoring

Explicit opt-in camera checks run locally with a pretrained MediaPipe model. Calibrate a neutral pose for head checks; snapshots need a separate opt-in. See [Phase 3 behaviour, setup, privacy and validation](docs/phase-3/status.md). See [Phase 4 behaviour and limitations](docs/phase-4/status.md) for gaze calibration, phone detection and separate screen-sharing consent.
