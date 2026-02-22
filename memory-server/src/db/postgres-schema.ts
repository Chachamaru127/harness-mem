/**
 * postgres-schema.ts - PostgreSQL + pgvector schema definitions.
 *
 * Mirrors the SQLite schema structure but uses PostgreSQL-native types:
 * - TEXT PRIMARY KEY → TEXT PRIMARY KEY (same)
 * - INTEGER PRIMARY KEY AUTOINCREMENT → SERIAL PRIMARY KEY
 * - REAL → DOUBLE PRECISION
 * - FTS5 → tsvector + GIN index
 * - sqlite-vec → pgvector extension
 */

/**
 * SQL to initialize the pgvector extension and core tables.
 * Run once when setting up a new managed backend database.
 */
export const POSTGRES_INIT_SQL = `
  CREATE EXTENSION IF NOT EXISTS vector;

  CREATE TABLE IF NOT EXISTS mem_sessions (
    session_id TEXT PRIMARY KEY,
    platform TEXT NOT NULL,
    project TEXT NOT NULL,
    workspace_uid TEXT NOT NULL DEFAULT '',
    started_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ,
    summary TEXT,
    summary_mode TEXT,
    correlation_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_pg_sessions_platform_project
    ON mem_sessions(platform, project, session_id, updated_at);
  CREATE INDEX IF NOT EXISTS idx_pg_sessions_workspace_uid
    ON mem_sessions(workspace_uid);
  CREATE INDEX IF NOT EXISTS idx_pg_sessions_correlation_id
    ON mem_sessions(correlation_id, project, started_at);

  CREATE TABLE IF NOT EXISTS mem_events (
    event_id TEXT PRIMARY KEY,
    platform TEXT NOT NULL,
    project TEXT NOT NULL,
    workspace_uid TEXT NOT NULL DEFAULT '',
    session_id TEXT NOT NULL REFERENCES mem_sessions(session_id) ON DELETE CASCADE,
    event_type TEXT NOT NULL,
    ts TIMESTAMPTZ NOT NULL,
    payload_json JSONB NOT NULL DEFAULT '{}',
    tags_json JSONB NOT NULL DEFAULT '[]',
    privacy_tags_json JSONB NOT NULL DEFAULT '[]',
    dedupe_hash TEXT NOT NULL UNIQUE,
    observation_id TEXT,
    correlation_id TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_pg_events_lookup
    ON mem_events(platform, project, session_id, ts);
  CREATE INDEX IF NOT EXISTS idx_pg_events_workspace_uid
    ON mem_events(workspace_uid);
  CREATE INDEX IF NOT EXISTS idx_pg_events_correlation_id
    ON mem_events(correlation_id, project, ts);

  CREATE TABLE IF NOT EXISTS mem_observations (
    id TEXT PRIMARY KEY,
    event_id TEXT REFERENCES mem_events(event_id) ON DELETE SET NULL,
    platform TEXT NOT NULL,
    project TEXT NOT NULL,
    workspace_uid TEXT NOT NULL DEFAULT '',
    session_id TEXT NOT NULL REFERENCES mem_sessions(session_id) ON DELETE CASCADE,
    title TEXT,
    content TEXT NOT NULL,
    content_redacted TEXT NOT NULL,
    observation_type TEXT NOT NULL DEFAULT 'context',
    tags_json JSONB NOT NULL DEFAULT '[]',
    privacy_tags_json JSONB NOT NULL DEFAULT '[]',
    search_vector tsvector GENERATED ALWAYS AS (
      setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
      setweight(to_tsvector('simple', content_redacted), 'B')
    ) STORED,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_pg_observations_lookup
    ON mem_observations(platform, project, session_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_pg_observations_workspace_uid
    ON mem_observations(workspace_uid);
  CREATE INDEX IF NOT EXISTS idx_pg_obs_project_session_created
    ON mem_observations(project, session_id, created_at, id);
  CREATE INDEX IF NOT EXISTS idx_pg_observations_fts
    ON mem_observations USING GIN(search_vector);

  CREATE TABLE IF NOT EXISTS mem_tags (
    observation_id TEXT NOT NULL REFERENCES mem_observations(id) ON DELETE CASCADE,
    tag TEXT NOT NULL,
    tag_type TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY(observation_id, tag, tag_type)
  );

  CREATE TABLE IF NOT EXISTS mem_entities (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(name, entity_type)
  );

  CREATE TABLE IF NOT EXISTS mem_observation_entities (
    observation_id TEXT NOT NULL REFERENCES mem_observations(id) ON DELETE CASCADE,
    entity_id INTEGER NOT NULL REFERENCES mem_entities(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY(observation_id, entity_id)
  );

  CREATE INDEX IF NOT EXISTS idx_pg_observation_entities_entity
    ON mem_observation_entities(entity_id);

  CREATE TABLE IF NOT EXISTS mem_links (
    id SERIAL PRIMARY KEY,
    from_observation_id TEXT NOT NULL REFERENCES mem_observations(id) ON DELETE CASCADE,
    to_observation_id TEXT NOT NULL REFERENCES mem_observations(id) ON DELETE CASCADE,
    relation TEXT NOT NULL,
    weight DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_pg_links_from_to
    ON mem_links(from_observation_id, to_observation_id);
  CREATE INDEX IF NOT EXISTS idx_pg_links_from_relation
    ON mem_links(from_observation_id, relation, to_observation_id);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_pg_links_unique_relation
    ON mem_links(from_observation_id, to_observation_id, relation);

  CREATE TABLE IF NOT EXISTS mem_vectors (
    observation_id TEXT PRIMARY KEY REFERENCES mem_observations(id) ON DELETE CASCADE,
    model TEXT NOT NULL,
    dimension INTEGER NOT NULL,
    embedding vector,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_pg_vectors_model_dim_obs
    ON mem_vectors(model, dimension, observation_id);

  CREATE TABLE IF NOT EXISTS mem_facts (
    fact_id TEXT PRIMARY KEY,
    observation_id TEXT REFERENCES mem_observations(id) ON DELETE SET NULL,
    project TEXT NOT NULL,
    workspace_uid TEXT NOT NULL DEFAULT '',
    session_id TEXT NOT NULL,
    fact_type TEXT NOT NULL,
    fact_key TEXT NOT NULL,
    fact_value TEXT NOT NULL,
    confidence DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    merged_into_fact_id TEXT REFERENCES mem_facts(fact_id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_pg_facts_project_session_type
    ON mem_facts(project, session_id, fact_type, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_pg_facts_workspace_uid
    ON mem_facts(workspace_uid);
  CREATE INDEX IF NOT EXISTS idx_pg_facts_merged_into
    ON mem_facts(merged_into_fact_id);

  CREATE TABLE IF NOT EXISTS mem_audit_log (
    id SERIAL PRIMARY KEY,
    action TEXT NOT NULL,
    actor TEXT NOT NULL,
    target_type TEXT NOT NULL,
    target_id TEXT NOT NULL DEFAULT '',
    details_json JSONB NOT NULL DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_pg_audit_log_action_created
    ON mem_audit_log(action, created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_pg_audit_log_target_created
    ON mem_audit_log(target_type, target_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS mem_consolidation_queue (
    id SERIAL PRIMARY KEY,
    project TEXT NOT NULL,
    session_id TEXT NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    requested_at TIMESTAMPTZ NOT NULL,
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    error TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_pg_consolidation_queue_status_requested
    ON mem_consolidation_queue(status, requested_at ASC, id ASC);

  CREATE TABLE IF NOT EXISTS mem_retry_queue (
    id SERIAL PRIMARY KEY,
    event_json JSONB NOT NULL,
    reason TEXT NOT NULL,
    retry_count INTEGER NOT NULL DEFAULT 0,
    next_retry_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE INDEX IF NOT EXISTS idx_pg_retry_due
    ON mem_retry_queue(next_retry_at, retry_count);

  CREATE TABLE IF NOT EXISTS mem_ingest_offsets (
    source_key TEXT PRIMARY KEY,
    "offset" INTEGER NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS mem_meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS mem_import_jobs (
    job_id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    source_db_path TEXT NOT NULL,
    status TEXT NOT NULL,
    dry_run BOOLEAN NOT NULL DEFAULT FALSE,
    requested_at TIMESTAMPTZ NOT NULL,
    started_at TIMESTAMPTZ,
    finished_at TIMESTAMPTZ,
    result_json JSONB NOT NULL DEFAULT '{}',
    error TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_pg_import_jobs_status_requested
    ON mem_import_jobs(status, requested_at DESC);
`;
