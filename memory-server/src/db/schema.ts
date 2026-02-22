import { type Database } from "bun:sqlite";

export function configureDatabase(db: Database): void {
  db.exec("PRAGMA journal_mode=WAL;");
  db.exec("PRAGMA synchronous=NORMAL;");
  db.exec("PRAGMA foreign_keys=ON;");
  db.exec("PRAGMA busy_timeout=5000;");
}

export function initSchema(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS mem_sessions (
      session_id TEXT PRIMARY KEY,
      platform TEXT NOT NULL,
      project TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      summary TEXT,
      summary_mode TEXT,
      correlation_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_mem_sessions_platform_project
      ON mem_sessions(platform, project, session_id, updated_at);

    CREATE TABLE IF NOT EXISTS mem_events (
      event_id TEXT PRIMARY KEY,
      platform TEXT NOT NULL,
      project TEXT NOT NULL,
      session_id TEXT NOT NULL,
      event_type TEXT NOT NULL,
      ts TEXT NOT NULL,
      payload_json TEXT NOT NULL,
      tags_json TEXT NOT NULL,
      privacy_tags_json TEXT NOT NULL,
      dedupe_hash TEXT NOT NULL UNIQUE,
      observation_id TEXT,
      correlation_id TEXT,
      created_at TEXT NOT NULL,
      FOREIGN KEY(session_id) REFERENCES mem_sessions(session_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_mem_events_lookup
      ON mem_events(platform, project, session_id, ts);

    CREATE TABLE IF NOT EXISTS mem_observations (
      id TEXT PRIMARY KEY,
      event_id TEXT,
      platform TEXT NOT NULL,
      project TEXT NOT NULL,
      session_id TEXT NOT NULL,
      title TEXT,
      content TEXT NOT NULL,
      content_redacted TEXT NOT NULL,
      observation_type TEXT NOT NULL DEFAULT 'context',
      tags_json TEXT NOT NULL,
      privacy_tags_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(event_id) REFERENCES mem_events(event_id) ON DELETE SET NULL,
      FOREIGN KEY(session_id) REFERENCES mem_sessions(session_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_mem_observations_lookup
      ON mem_observations(platform, project, session_id, created_at);

    CREATE INDEX IF NOT EXISTS idx_mem_obs_project_session_created
      ON mem_observations(project, session_id, created_at, id);

    CREATE TABLE IF NOT EXISTS mem_tags (
      observation_id TEXT NOT NULL,
      tag TEXT NOT NULL,
      tag_type TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(observation_id, tag, tag_type),
      FOREIGN KEY(observation_id) REFERENCES mem_observations(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS mem_entities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(name, entity_type)
    );

    CREATE TABLE IF NOT EXISTS mem_observation_entities (
      observation_id TEXT NOT NULL,
      entity_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(observation_id, entity_id),
      FOREIGN KEY(observation_id) REFERENCES mem_observations(id) ON DELETE CASCADE,
      FOREIGN KEY(entity_id) REFERENCES mem_entities(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_mem_observation_entities_entity
      ON mem_observation_entities(entity_id);

    CREATE TABLE IF NOT EXISTS mem_links (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_observation_id TEXT NOT NULL,
      to_observation_id TEXT NOT NULL,
      relation TEXT NOT NULL,
      weight REAL NOT NULL DEFAULT 1.0,
      created_at TEXT NOT NULL,
      FOREIGN KEY(from_observation_id) REFERENCES mem_observations(id) ON DELETE CASCADE,
      FOREIGN KEY(to_observation_id) REFERENCES mem_observations(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_mem_links_from_to
      ON mem_links(from_observation_id, to_observation_id);

    CREATE INDEX IF NOT EXISTS idx_mem_links_from_relation
      ON mem_links(from_observation_id, relation, to_observation_id);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_mem_links_unique_relation
      ON mem_links(from_observation_id, to_observation_id, relation);

    CREATE TABLE IF NOT EXISTS mem_vectors (
      observation_id TEXT PRIMARY KEY,
      model TEXT NOT NULL,
      dimension INTEGER NOT NULL,
      vector_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(observation_id) REFERENCES mem_observations(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_mem_vectors_model_dim_obs
      ON mem_vectors(model, dimension, observation_id);

    CREATE TABLE IF NOT EXISTS mem_facts (
      fact_id TEXT PRIMARY KEY,
      observation_id TEXT,
      project TEXT NOT NULL,
      session_id TEXT NOT NULL,
      fact_type TEXT NOT NULL,
      fact_key TEXT NOT NULL,
      fact_value TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0.5,
      merged_into_fact_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(observation_id) REFERENCES mem_observations(id) ON DELETE SET NULL,
      FOREIGN KEY(merged_into_fact_id) REFERENCES mem_facts(fact_id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_mem_facts_project_session_type
      ON mem_facts(project, session_id, fact_type, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_mem_facts_merged_into
      ON mem_facts(merged_into_fact_id);

    CREATE TABLE IF NOT EXISTS mem_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      actor TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL DEFAULT '',
      details_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_mem_audit_log_action_created
      ON mem_audit_log(action, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_mem_audit_log_target_created
      ON mem_audit_log(target_type, target_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS mem_consolidation_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project TEXT NOT NULL,
      session_id TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      requested_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      error TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_mem_consolidation_queue_status_requested
      ON mem_consolidation_queue(status, requested_at ASC, id ASC);

    CREATE TABLE IF NOT EXISTS mem_retry_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_json TEXT NOT NULL,
      reason TEXT NOT NULL,
      retry_count INTEGER NOT NULL DEFAULT 0,
      next_retry_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_mem_retry_due
      ON mem_retry_queue(next_retry_at, retry_count);

    CREATE TABLE IF NOT EXISTS mem_ingest_offsets (
      source_key TEXT PRIMARY KEY,
      offset INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS mem_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS mem_import_jobs (
      job_id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      source_db_path TEXT NOT NULL,
      status TEXT NOT NULL,
      dry_run INTEGER NOT NULL DEFAULT 0,
      requested_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      result_json TEXT NOT NULL DEFAULT '{}',
      error TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_mem_import_jobs_status_requested
      ON mem_import_jobs(status, requested_at DESC);

    CREATE TABLE IF NOT EXISTS mem_vectors_vec_map (
      rowid INTEGER PRIMARY KEY,
      observation_id TEXT NOT NULL UNIQUE,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(observation_id) REFERENCES mem_observations(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_mem_vectors_vec_map_observation
      ON mem_vectors_vec_map(observation_id);
  `);
}

export function migrateSchema(db: Database): void {
  try {
    db.exec(`ALTER TABLE mem_observations ADD COLUMN observation_type TEXT NOT NULL DEFAULT 'context'`);
  } catch {
    // already exists
  }

  try {
    db.exec(`ALTER TABLE mem_events ADD COLUMN correlation_id TEXT`);
  } catch {
    // already exists
  }

  try {
    db.exec(`ALTER TABLE mem_sessions ADD COLUMN correlation_id TEXT`);
  } catch {
    // already exists
  }

  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_mem_events_correlation_id ON mem_events(correlation_id, project, ts)`);
  } catch {
    // already exists
  }

  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_mem_sessions_correlation_id ON mem_sessions(correlation_id, project, started_at)`);
  } catch {
    // already exists
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS mem_entities (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(name, entity_type)
    );

    CREATE TABLE IF NOT EXISTS mem_observation_entities (
      observation_id TEXT NOT NULL,
      entity_id INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY(observation_id, entity_id),
      FOREIGN KEY(observation_id) REFERENCES mem_observations(id) ON DELETE CASCADE,
      FOREIGN KEY(entity_id) REFERENCES mem_entities(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_mem_observation_entities_entity
      ON mem_observation_entities(entity_id);

    CREATE INDEX IF NOT EXISTS idx_mem_obs_project_session_created
      ON mem_observations(project, session_id, created_at, id);

    CREATE INDEX IF NOT EXISTS idx_mem_links_from_relation
      ON mem_links(from_observation_id, relation, to_observation_id);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_mem_links_unique_relation
      ON mem_links(from_observation_id, to_observation_id, relation);

    CREATE INDEX IF NOT EXISTS idx_mem_vectors_model_dim_obs
      ON mem_vectors(model, dimension, observation_id);

    CREATE TABLE IF NOT EXISTS mem_facts (
      fact_id TEXT PRIMARY KEY,
      observation_id TEXT,
      project TEXT NOT NULL,
      session_id TEXT NOT NULL,
      fact_type TEXT NOT NULL,
      fact_key TEXT NOT NULL,
      fact_value TEXT NOT NULL,
      confidence REAL NOT NULL DEFAULT 0.5,
      merged_into_fact_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(observation_id) REFERENCES mem_observations(id) ON DELETE SET NULL,
      FOREIGN KEY(merged_into_fact_id) REFERENCES mem_facts(fact_id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_mem_facts_project_session_type
      ON mem_facts(project, session_id, fact_type, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_mem_facts_merged_into
      ON mem_facts(merged_into_fact_id);

    CREATE TABLE IF NOT EXISTS mem_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      actor TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT NOT NULL DEFAULT '',
      details_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_mem_audit_log_action_created
      ON mem_audit_log(action, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_mem_audit_log_target_created
      ON mem_audit_log(target_type, target_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS mem_consolidation_queue (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project TEXT NOT NULL,
      session_id TEXT NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'pending',
      requested_at TEXT NOT NULL,
      started_at TEXT,
      finished_at TEXT,
      error TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_mem_consolidation_queue_status_requested
      ON mem_consolidation_queue(status, requested_at ASC, id ASC);
  `);

  // プロジェクト名空文字のレコードがあれば警告ログ
  const emptyProjects = db.query(`SELECT COUNT(*) as cnt FROM mem_events WHERE trim(project) = ''`).get() as {cnt: number};
  if (emptyProjects.cnt > 0) {
    console.warn(`[harness-mem] WARNING: ${emptyProjects.cnt} events with empty project name detected`);
  }
}

export function initFtsIndex(db: Database): boolean {
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS mem_observations_fts
        USING fts5(observation_id UNINDEXED, title, content, tokenize = 'unicode61');

      DROP TRIGGER IF EXISTS mem_observations_ai;
      DROP TRIGGER IF EXISTS mem_observations_ad;
      DROP TRIGGER IF EXISTS mem_observations_au;

      CREATE TRIGGER mem_observations_ai AFTER INSERT ON mem_observations BEGIN
        INSERT INTO mem_observations_fts(rowid, observation_id, title, content)
        VALUES (new.rowid, new.id, new.title, new.content_redacted);
      END;

      CREATE TRIGGER mem_observations_ad AFTER DELETE ON mem_observations BEGIN
        DELETE FROM mem_observations_fts WHERE rowid = old.rowid;
      END;

      CREATE TRIGGER mem_observations_au AFTER UPDATE ON mem_observations BEGIN
        DELETE FROM mem_observations_fts WHERE rowid = old.rowid;
        INSERT INTO mem_observations_fts(rowid, observation_id, title, content)
        VALUES (new.rowid, new.id, new.title, new.content_redacted);
      END;
    `);

    const row = db
      .query(`SELECT COUNT(*) AS count FROM mem_observations_fts`)
      .get() as { count?: number } | null;
    const currentCount = Number(row?.count ?? 0);
    if (currentCount === 0) {
      db.exec(`
        INSERT INTO mem_observations_fts(rowid, observation_id, title, content)
        SELECT rowid, id, title, content_redacted
        FROM mem_observations;
      `);
    }

    return true;
  } catch {
    return false;
  }
}

export function initVecTable(db: Database, vectorDimension: number): boolean {
  try {
    const dim = Number.isFinite(vectorDimension) ? Math.max(1, Math.floor(vectorDimension)) : 64;
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS mem_vectors_vec
      USING vec0(embedding float[${dim}]);
    `);
    return true;
  } catch {
    return false;
  }
}
