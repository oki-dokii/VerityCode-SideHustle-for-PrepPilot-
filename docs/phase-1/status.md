# Phase 1 implementation status

Date: 17 October 2026.

## Implemented

- Dashboard, assessment instructions and acknowledgement, attempt history and resume.
- Locally bundled Monaco editor with Python, C++ and Java highlighting and separate drafts, question/examples and server-owned timer.
- Persistent PostgreSQL browser sessions, drafts, revisions, immutable final submissions and jobs.
- Autosave, local recovery, stale revision rejection, deadline finalisation and duplicate submission protection.
- Judge0 batch adapter with resource settings and token-correlated polling; no local execution of student code.
- Public run feedback, private hidden-test grading, results and explicit unavailable/retry state.
- Durable job leases and stale-completion fencing.
- Session ownership checks, mutation origin/header validation, code-size limits and hidden-diagnostic filtering.

## Validation

- TypeScript and Vite production build: passed.
- Backend/API/provider-contract tests: 13 passed after language persistence, runner selection and development-origin regression checks.
- Chrome browser tests: 4 passed (full student journey; offline local recovery and stale-tab protection; small viewport and keyboard dialog dismissal; C++/Java draft switching, refresh and submission locking).
- Real Judge0 execution: pending external provider configuration. User chose integration plus setup instructions for now.

## Limits and outstanding gates

Phase 1 implementation is usable locally. Phase 1's full acceptance gate remains open because F0 live-provider tests have not run. Do not call the platform's sandbox or scoring independently validated until they do.

Authentication is a local anonymous session, not a production account system. No public deployment, production security review, broad browser qualification, account recovery or retention sweeper is included in this milestone. The Phase 0 retention proposal must be implemented before real-user launch. Schema migration 2 adds language selection and per-language drafts without deleting existing attempts; existing records default to Python.

Phase 0 vision experiments remain pending. Head movement, gaze, phone detection and similarity analysis remain planned. Browser monitoring is now implemented in Phase 2; see ../phase-2/status.md.

Development origin fix: both localhost:5173 and 127.0.0.1:5173 are accepted; production remains restricted to APP_ORIGIN. Other hosts, schemes and ports remain rejected.
