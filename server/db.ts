import pg from "pg";
export const pool = new pg.Pool({
  connectionString:
    process.env.DATABASE_URL ||
    "postgresql://veritycode@127.0.0.1:54329/veritycode",
  max: 10,
});
export async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (id text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now());
    CREATE TABLE IF NOT EXISTS attempts (
      id uuid PRIMARY KEY, owner text NOT NULL REFERENCES sessions(id),
      status text NOT NULL DEFAULT 'active', started_at timestamptz NOT NULL DEFAULT now(),
      deadline timestamptz NOT NULL, draft text NOT NULL, revision integer NOT NULL DEFAULT 0,
      saved_at timestamptz NOT NULL DEFAULT now(), final_code text, final_hash text,
      submitted_at timestamptz, end_reason text, problem_version integer NOT NULL DEFAULT 1,
      submission_key uuid, CHECK (status IN ('active','submitted','completed'))
    );
    CREATE INDEX IF NOT EXISTS attempts_owner ON attempts(owner, started_at DESC);
    CREATE TABLE IF NOT EXISTS jobs (
      id uuid PRIMARY KEY, attempt_id uuid NOT NULL REFERENCES attempts(id), kind text NOT NULL,
      code text NOT NULL, state text NOT NULL DEFAULT 'queued', results jsonb,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      lease_until timestamptz, tries integer NOT NULL DEFAULT 0, lease_token uuid,
      error text, CHECK(kind IN ('run','submit')), CHECK(state IN ('queued','running','completed','unavailable'))
    );
    CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
    ALTER TABLE attempts ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'python' CHECK(language IN ('python','cpp','java'));
    ALTER TABLE attempts ADD COLUMN IF NOT EXISTS drafts jsonb NOT NULL DEFAULT '{}'::jsonb;
    ALTER TABLE jobs ADD COLUMN IF NOT EXISTS language text NOT NULL DEFAULT 'python' CHECK(language IN ('python','cpp','java'));
    INSERT INTO schema_migrations(version) VALUES (2) ON CONFLICT DO NOTHING;
    ALTER TABLE attempts ADD COLUMN IF NOT EXISTS monitoring_enabled boolean NOT NULL DEFAULT false;
    CREATE TABLE IF NOT EXISTS monitoring_sessions (
      id uuid PRIMARY KEY, attempt_id uuid NOT NULL REFERENCES attempts(id), started_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS browser_events (
      id uuid PRIMARY KEY, attempt_id uuid NOT NULL REFERENCES attempts(id), session_id uuid NOT NULL REFERENCES monitoring_sessions(id),
      sequence integer NOT NULL, elapsed_ms integer NOT NULL, type text NOT NULL, payload jsonb NOT NULL,
      received_at timestamptz NOT NULL DEFAULT now(), UNIQUE(session_id,sequence)
    );
    CREATE INDEX IF NOT EXISTS browser_events_attempt ON browser_events(attempt_id,elapsed_ms);
    INSERT INTO schema_migrations(version) VALUES (3) ON CONFLICT DO NOTHING;
    CREATE TABLE IF NOT EXISTS camera_sessions (
      id uuid PRIMARY KEY, attempt_id uuid NOT NULL REFERENCES attempts(id),
      started_at timestamptz NOT NULL DEFAULT now(), stopped_at timestamptz,
      evidence_consent boolean NOT NULL, version text NOT NULL
    );
    CREATE TABLE IF NOT EXISTS camera_observations (
      id uuid PRIMARY KEY, session_id uuid NOT NULL REFERENCES camera_sessions(id),
      attempt_id uuid NOT NULL REFERENCES attempts(id), sequence integer NOT NULL,
      elapsed_ms integer NOT NULL, payload jsonb NOT NULL, received_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(session_id,sequence)
    );
    CREATE INDEX IF NOT EXISTS camera_observations_attempt ON camera_observations(attempt_id,elapsed_ms);
    CREATE TABLE IF NOT EXISTS camera_evidence (
      id uuid PRIMARY KEY REFERENCES camera_observations(id), attempt_id uuid NOT NULL REFERENCES attempts(id),
      session_id uuid NOT NULL REFERENCES camera_sessions(id), image bytea,
      created_at timestamptz NOT NULL DEFAULT now(), expires_at timestamptz NOT NULL DEFAULT now()+interval '7 days',
      deleted_at timestamptz
    );
    INSERT INTO schema_migrations(version) VALUES (4) ON CONFLICT DO NOTHING;
    CREATE TABLE IF NOT EXISTS screen_sessions (
      id uuid PRIMARY KEY, attempt_id uuid NOT NULL REFERENCES attempts(id),
      started_at timestamptz NOT NULL DEFAULT now(), stopped_at timestamptz,
      stop_reason text, consent boolean NOT NULL DEFAULT true, surface text NOT NULL
    );
    CREATE TABLE IF NOT EXISTS screen_evidence (
      id uuid PRIMARY KEY, session_id uuid NOT NULL REFERENCES screen_sessions(id),
      attempt_id uuid NOT NULL REFERENCES attempts(id), elapsed_ms integer NOT NULL,
      reason text NOT NULL, image bytea, created_at timestamptz NOT NULL DEFAULT now(),
      expires_at timestamptz NOT NULL DEFAULT now()+interval '7 days', deleted_at timestamptz
    );
    CREATE INDEX IF NOT EXISTS screen_evidence_attempt ON screen_evidence(attempt_id,elapsed_ms);
    INSERT INTO schema_migrations(version) VALUES (5) ON CONFLICT DO NOTHING;
    CREATE UNIQUE INDEX IF NOT EXISTS one_submission ON jobs(attempt_id) WHERE kind='submit';
    CREATE UNIQUE INDEX IF NOT EXISTS one_active_run ON jobs(attempt_id) WHERE kind='run' AND state IN ('queued','running');
  `);
}
export async function transaction<T>(
  work: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
