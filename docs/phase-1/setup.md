# Phase 1: Running VerityCode

## Current implementation

React/TypeScript assessment UI with a locally bundled Monaco editor for Python, C++ and Java, an Express API, PostgreSQL persistence, and an asynchronous Judge0 adapter. No student code executes on the app host. This is a local, browser-session-owned prototype: clearing its session cookie loses access to its history. Account registration, identity recovery and public deployment are later work.

The single assessment is **Best streak**, a maximum-subarray problem with two public examples and eight server-held hidden tests. It lasts 30 minutes. Each passing hidden test contributes equally to a displayed score out of 100. Execution infrastructure failure produces no score.

## Start locally

Requires Node 22+, npm, and PostgreSQL. Dependencies are pinned in package-lock.json.

```sh
npm ci
cp .env.example .env
npm run db:start
npm run dev
```

Open http://127.0.0.1:5173. The API binds to 127.0.0.1:3001. Both `http://127.0.0.1:5173` and `http://localhost:5173` are accepted in development. They have separate browser cookies, so keep using the same hostname to retain access to your session. Production accepts only the configured APP_ORIGIN. Initial database tables are created by the API at startup.

The local database helper uses `/Library/PostgreSQL/18/bin` by default. Override `PG_BIN` with the directory containing your PostgreSQL executables when needed. It creates only the project's `.local/postgres` cluster on loopback port 54329, using development-only trust authentication. Do not expose this database or use trust authentication for deployment. Alternatively point `DATABASE_URL` to your own PostgreSQL database and skip `db:start`.

Stop the app with Ctrl+C. To stop this project's database:

```sh
/Library/PostgreSQL/18/bin/pg_ctl -D "$PWD/.local/postgres" stop
```

The app remains useful for editing, autosave and submission without Judge0. Run/submit attempts explicitly show execution unavailable until a real provider is connected. No demonstration scores are generated.

## Connect a Judge0 provider

1. Provision an approved, isolated Judge0-compatible instance or use a provider account. Verify its network isolation, current security updates, output limits, supported limits and language IDs. An API integration alone does not prove the provider is safely deployed.
2. Set `JUDGE0_URL` in `.env` to its base URL. For standard token-auth deployments set `JUDGE0_API_KEY` (sent as `X-Auth-Token`). For RapidAPI also set `JUDGE0_API_HOST` (key sent as `X-RapidAPI-Key`). Adapt the server adapter if your provider uses different authentication.
3. Set `JUDGE0_PYTHON_ID`, `JUDGE0_CPP_ID` and `JUDGE0_JAVA_ID` from the provider's language list. Defaults 71, 54 and 62 are compatibility defaults, not guarantees of runtime availability.
4. Restart the API after changing `.env`, then run `npm run runner:smoke`. This sends only the eight fixed diagnostic programs in `scripts/runner-smoke.ts` to the configured provider. Provider charges may apply under your plan.
5. Inspect the actual output-limit and timeout behaviour as part of F0. Only mark live execution verified after these results pass. Also validate memory/process limits on the chosen provider before public use.
6. Reload the dashboard. Open an unavailable submitted attempt and select **Retry grading**. This grades the frozen final code, not a new draft. Retries have a five-second cooldown.

Never place provider keys in web code, screenshots or Git. `.env` is ignored. No runner endpoint or credentials have been assumed or installed for you.

Adapter contract: batch submissions, base64 source/input/output, token-correlated polling, a maximum 60-second poll window, 12-second request timeouts, 2-second CPU and 5-second wall limits, 128,000 KB memory (512,000 for Java), 128 KB max file size, 32 processes/threads (64 for Java) and disabled networking. Provider defaults and implementation must be checked by the live smoke test. Temporary provider failures are distinct from wrong answers; grading can be retried without changing the submission.

## Behaviour to expect

- Starting again resumes an active attempt; its deadline never resets.
- Autosave uses revision checks. A stale tab cannot overwrite a newer acknowledged draft.
- Local recovery offers a choice if browser storage differs from the server. A conflict lets you download local code before loading the authoritative draft.
- Only server-acknowledged code is submitted at the deadline. The server checks deadlines even without an open browser. Server downtime delays processing but does not extend the deadline.
- Final submission requires the current saved revision. Repeated submissions return the original frozen attempt.
- Jobs persist in PostgreSQL; leases allow restart recovery. Interrupted execution may be sent to the provider again, but only the current lease can write the result. Exactly-once provider billing is not guaranteed.
- Hidden test diagnostics, output and expected values are omitted from API responses. Public example output is shown, with capped diagnostics.
- The coding foundation does not request camera/microphone/screen permission or run similarity analysis. Phase 2 now adds disclosed browser-event monitoring for new attempts; see ../phase-2/status.md.

## Verification commands

```sh
npm run build       # TypeScript check + production frontend bundle
npm test            # Real PostgreSQL API tests + controlled Judge0 HTTP contract test
npm run test:e2e    # Start npm run dev first; uses installed Google Chrome
npm run runner:smoke # Requires real configured provider
```

`npm test` creates a random isolated schema in the configured database and drops only that schema afterward; the database user needs schema-create permission. Browser tests use fresh guest sessions in the running development database. Do not run either suite against production. Browser tests for unavailable execution assume `JUDGE0_URL` is unset. Screenshots are written to ignored `test-results/`.

For a local production-build check, run `npm run build`, set `NODE_ENV=production`, set `APP_ORIGIN` to the actual HTTPS app origin, then run `npm start` behind an HTTPS reverse proxy. Production cookies require HTTPS. The prototype is not a public hosting configuration; no deployment was performed.

## Choosing a language

Use the **Coding language** dropdown above the editor to choose Python 3, C++ or Java. Switching saves the current draft and restores the separate draft for the selected language without resetting the timer. Java uses `public class Main` in `Main.java`. Submitting locks both code and language. Legacy attempts and jobs migrate to Python automatically.

The server snapshots the chosen language into each execution job. Runtime IDs and JVM resource behaviour must be checked with your actual provider before claiming live execution support. The browser and API tests verify selection/persistence with a controlled provider, not real compilation.
