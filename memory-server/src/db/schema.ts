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
      user_id TEXT NOT NULL DEFAULT 'default',
      team_id TEXT DEFAULT NULL,
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
      user_id TEXT NOT NULL DEFAULT 'default',
      team_id TEXT DEFAULT NULL,
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
        content_dedupe_hash TEXT DEFAULT NULL,
        raw_text TEXT,
      observation_type TEXT NOT NULL DEFAULT 'context',
      memory_type TEXT NOT NULL DEFAULT 'semantic',
      tags_json TEXT NOT NULL,
      privacy_tags_json TEXT NOT NULL,
      user_id TEXT NOT NULL DEFAULT 'default',
      team_id TEXT DEFAULT NULL,
      event_time TEXT DEFAULT NULL,
      observed_at TEXT DEFAULT NULL,
      valid_from TEXT DEFAULT NULL,
      valid_to TEXT DEFAULT NULL,
      supersedes TEXT DEFAULT NULL,
      invalidated_at TEXT DEFAULT NULL,
      -- S81-B02: soft-archive marker written by the forget policy. NULL
      -- for live rows, ISO timestamp once wet-mode eviction runs. Kept
      -- in the base CREATE TABLE so fresh test DBs that call initSchema()
      -- without migrateSchema() still have the column.
      archived_at TEXT DEFAULT NULL,
      -- §78-D01 / S81-B02 temporal-forgetting specialisation: ISO
      -- timestamp after which the row must be treated as expired. NULL
      -- means "never expires". Expired rows are excluded from reads
      -- even before the forget policy sweeps them into archived_at.
      expires_at TEXT DEFAULT NULL,
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
      event_time TEXT DEFAULT NULL,
      observed_at TEXT DEFAULT NULL,
      valid_from TEXT DEFAULT NULL,
      valid_to TEXT DEFAULT NULL,
      supersedes TEXT DEFAULT NULL,
      invalidated_at TEXT DEFAULT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(from_observation_id) REFERENCES mem_observations(id) ON DELETE CASCADE,
      FOREIGN KEY(to_observation_id) REFERENCES mem_observations(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_mem_links_from_to
      ON mem_links(from_observation_id, to_observation_id);

    CREATE INDEX IF NOT EXISTS idx_mem_links_from_relation
      ON mem_links(from_observation_id, relation, to_observation_id);

    CREATE INDEX IF NOT EXISTS idx_mem_links_to_relation
      ON mem_links(to_observation_id, relation, from_observation_id);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_mem_links_unique_relation
      ON mem_links(from_observation_id, to_observation_id, relation);

    CREATE TABLE IF NOT EXISTS mem_vectors (
      observation_id TEXT NOT NULL,
      model TEXT NOT NULL,
      dimension INTEGER NOT NULL,
      vector_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(observation_id, model),
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
      superseded_by TEXT,
      event_time TEXT,
      observed_at TEXT,
      valid_from TEXT,
      valid_to TEXT,
      supersedes TEXT,
      invalidated_at TEXT,
      merged_into_fact_id TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY(observation_id) REFERENCES mem_observations(id) ON DELETE SET NULL,
      FOREIGN KEY(merged_into_fact_id) REFERENCES mem_facts(fact_id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_mem_facts_project_session_type
      ON mem_facts(project, session_id, fact_type, created_at DESC);

    CREATE INDEX IF NOT EXISTS idx_mem_facts_observation_active
      ON mem_facts(observation_id, project, merged_into_fact_id);

    CREATE INDEX IF NOT EXISTS idx_mem_facts_merged_into
      ON mem_facts(merged_into_fact_id);

    CREATE INDEX IF NOT EXISTS idx_mem_facts_key_project
      ON mem_facts(fact_key, project, created_at ASC);

    CREATE TABLE IF NOT EXISTS mem_relations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      src TEXT NOT NULL,
      dst TEXT NOT NULL,
      kind TEXT NOT NULL,
      strength REAL NOT NULL DEFAULT 1.0,
      observation_id TEXT NOT NULL,
      event_time TEXT DEFAULT NULL,
      observed_at TEXT DEFAULT NULL,
      valid_from TEXT DEFAULT NULL,
      valid_to TEXT DEFAULT NULL,
      supersedes TEXT DEFAULT NULL,
      invalidated_at TEXT DEFAULT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(observation_id) REFERENCES mem_observations(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_mem_relations_src ON mem_relations(src, kind);

    CREATE INDEX IF NOT EXISTS idx_mem_relations_obs ON mem_relations(observation_id);

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

    CREATE TABLE IF NOT EXISTS mem_nuggets (
      nugget_id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
      observation_id TEXT NOT NULL REFERENCES mem_observations(id) ON DELETE CASCADE,
      seq INTEGER NOT NULL,
      content TEXT NOT NULL,
      content_hash TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(observation_id, seq)
    );

    CREATE INDEX IF NOT EXISTS idx_nuggets_observation ON mem_nuggets(observation_id);

    CREATE TABLE IF NOT EXISTS mem_nugget_vectors (
      nugget_id TEXT NOT NULL,
      observation_id TEXT NOT NULL,
      model TEXT NOT NULL,
      dimension INTEGER NOT NULL,
      vector_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(nugget_id, model),
      FOREIGN KEY(nugget_id) REFERENCES mem_nuggets(nugget_id) ON DELETE CASCADE,
      FOREIGN KEY(observation_id) REFERENCES mem_observations(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_mem_nugget_vectors_observation
      ON mem_nugget_vectors(observation_id, model);

    CREATE TABLE IF NOT EXISTS mem_teams (
      team_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_mem_teams_name
      ON mem_teams(name);

    CREATE TABLE IF NOT EXISTS mem_team_members (
      team_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      joined_at TEXT NOT NULL,
      PRIMARY KEY(team_id, user_id),
      FOREIGN KEY(team_id) REFERENCES mem_teams(team_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_mem_team_members_user
      ON mem_team_members(user_id);

    CREATE TABLE IF NOT EXISTS mem_team_invitations (
      id TEXT PRIMARY KEY,
      team_id TEXT NOT NULL,
      invitee_identifier TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'member',
      token TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      FOREIGN KEY(team_id) REFERENCES mem_teams(team_id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_mem_team_invitations_token
      ON mem_team_invitations(token);

    CREATE INDEX IF NOT EXISTS idx_mem_team_invitations_team_status
      ON mem_team_invitations(team_id, status);

    -- S81-A02: Lease primitive for inter-agent coordination.
    -- A lease is a time-bounded exclusive claim on a string "target"
    -- (file path, action id, or arbitrary key). A second agent trying
    -- to acquire the same active target gets {error:"already_leased"}.
    CREATE TABLE IF NOT EXISTS mem_leases (
      lease_id TEXT PRIMARY KEY,
      target TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      project TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      ttl_ms INTEGER NOT NULL,
      acquired_at TEXT NOT NULL,
      renewed_at TEXT,
      expires_at TEXT NOT NULL,
      released_at TEXT,
      metadata_json TEXT,
      -- S81-A02 tenant columns (Codex round 6 P1): when auth config
      -- is enabled these are populated from resolveAccess() so release
      -- / renew cannot be performed by other tenants.
      user_id TEXT,
      team_id TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_mem_leases_target_status_exp
      ON mem_leases(target, status, expires_at);

    CREATE INDEX IF NOT EXISTS idx_mem_leases_agent
      ON mem_leases(agent_id, status);

    -- S81-A03: Signal primitive for inter-agent messaging.
    -- Signals are append-only messages between agents. A signal becomes
    -- invisible to _read once ack'ed. reply_to links threaded signals.
    CREATE TABLE IF NOT EXISTS mem_signals (
      signal_id TEXT PRIMARY KEY,
      thread_id TEXT,
      from_agent TEXT NOT NULL,
      to_agent TEXT,
      reply_to TEXT,
      content TEXT NOT NULL,
      project TEXT,
      sent_at TEXT NOT NULL,
      expires_at TEXT,
      acked_at TEXT,
      acked_by TEXT,
      -- S81-A03 tenant columns (Codex round 6 P1): populated from the
      -- sender's resolveAccess() so read/ack refuse cross-tenant access
      -- when auth config is enabled.
      user_id TEXT,
      team_id TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_mem_signals_to_ack
      ON mem_signals(to_agent, acked_at, sent_at);

    CREATE INDEX IF NOT EXISTS idx_mem_signals_thread
      ON mem_signals(thread_id, sent_at);

    CREATE INDEX IF NOT EXISTS idx_mem_signals_broadcast
      ON mem_signals(to_agent, sent_at) WHERE to_agent IS NULL;
  `);
}

function addColumnIfMissing(db: Database, tableName: string, columnName: string, definition: string): void {
  try {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  } catch {
    // already exists
  }
}

function migrateTemporalAnchorColumns(db: Database): void {
  for (const [tableName, columns] of [
    [
      "mem_observations",
      [
        ["event_time", "TEXT DEFAULT NULL"],
        ["observed_at", "TEXT DEFAULT NULL"],
        ["valid_from", "TEXT DEFAULT NULL"],
        ["valid_to", "TEXT DEFAULT NULL"],
        ["supersedes", "TEXT DEFAULT NULL"],
        ["invalidated_at", "TEXT DEFAULT NULL"],
      ],
    ],
    [
      "mem_facts",
      [
        ["event_time", "TEXT"],
        ["observed_at", "TEXT"],
        ["supersedes", "TEXT"],
        ["invalidated_at", "TEXT"],
      ],
    ],
    [
      "mem_links",
      [
        ["event_time", "TEXT DEFAULT NULL"],
        ["observed_at", "TEXT DEFAULT NULL"],
        ["valid_from", "TEXT DEFAULT NULL"],
        ["valid_to", "TEXT DEFAULT NULL"],
        ["supersedes", "TEXT DEFAULT NULL"],
        ["invalidated_at", "TEXT DEFAULT NULL"],
      ],
    ],
    [
      "mem_relations",
      [
        ["event_time", "TEXT DEFAULT NULL"],
        ["observed_at", "TEXT DEFAULT NULL"],
        ["valid_from", "TEXT DEFAULT NULL"],
        ["valid_to", "TEXT DEFAULT NULL"],
        ["supersedes", "TEXT DEFAULT NULL"],
        ["invalidated_at", "TEXT DEFAULT NULL"],
      ],
    ],
  ] as const) {
    for (const [columnName, definition] of columns) {
      addColumnIfMissing(db, tableName, columnName, definition);
    }
  }

  db.exec(`
    UPDATE mem_observations SET observed_at = created_at WHERE observed_at IS NULL;
    UPDATE mem_facts SET observed_at = COALESCE(valid_from, created_at) WHERE observed_at IS NULL;
    UPDATE mem_links SET observed_at = created_at WHERE observed_at IS NULL;
    UPDATE mem_relations SET observed_at = created_at WHERE observed_at IS NULL;

    CREATE INDEX IF NOT EXISTS idx_mem_obs_event_time
      ON mem_observations(event_time) WHERE event_time IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_mem_obs_observed_at
      ON mem_observations(observed_at);
    CREATE INDEX IF NOT EXISTS idx_mem_obs_valid_to
      ON mem_observations(valid_to) WHERE valid_to IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_mem_facts_event_time
      ON mem_facts(event_time) WHERE event_time IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_mem_facts_observed_at
      ON mem_facts(observed_at);
    CREATE INDEX IF NOT EXISTS idx_mem_facts_invalidated_at
      ON mem_facts(invalidated_at) WHERE invalidated_at IS NOT NULL;

    CREATE INDEX IF NOT EXISTS idx_mem_links_observed_at
      ON mem_links(observed_at);
    CREATE INDEX IF NOT EXISTS idx_mem_links_valid_to
      ON mem_links(valid_to) WHERE valid_to IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_mem_links_to_relation
      ON mem_links(to_observation_id, relation, from_observation_id);

    CREATE INDEX IF NOT EXISTS idx_mem_relations_observed_at
      ON mem_relations(observed_at);
    CREATE INDEX IF NOT EXISTS idx_mem_relations_valid_to
      ON mem_relations(valid_to) WHERE valid_to IS NOT NULL;

    CREATE TRIGGER IF NOT EXISTS mem_observations_s108_observed_at_ai
    AFTER INSERT ON mem_observations
    FOR EACH ROW
    WHEN NEW.observed_at IS NULL
    BEGIN
      UPDATE mem_observations SET observed_at = NEW.created_at WHERE id = NEW.id;
    END;

    CREATE TRIGGER IF NOT EXISTS mem_facts_s108_observed_at_ai
    AFTER INSERT ON mem_facts
    FOR EACH ROW
    WHEN NEW.observed_at IS NULL
    BEGIN
      UPDATE mem_facts SET observed_at = COALESCE(NEW.valid_from, NEW.created_at) WHERE fact_id = NEW.fact_id;
    END;

    CREATE TRIGGER IF NOT EXISTS mem_links_s108_observed_at_ai
    AFTER INSERT ON mem_links
    FOR EACH ROW
    WHEN NEW.observed_at IS NULL
    BEGIN
      UPDATE mem_links SET observed_at = NEW.created_at WHERE id = NEW.id;
    END;

    CREATE TRIGGER IF NOT EXISTS mem_relations_s108_observed_at_ai
    AFTER INSERT ON mem_relations
    FOR EACH ROW
    WHEN NEW.observed_at IS NULL
    BEGIN
      UPDATE mem_relations SET observed_at = NEW.created_at WHERE id = NEW.id;
    END;
  `);
}

export function migrateSchema(db: Database): void {
  migrateMemVectorsPrimaryKey(db);

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

  // Tables and indexes below are already created by initSchema (CREATE TABLE/INDEX IF NOT EXISTS).
  // For pre-existing DBs that were created before these tables existed, initSchema is always called
  // first, so no duplicate DDL is needed here. Only ALTER TABLE and genuinely new indexes belong
  // in migrateSchema.

  // Additional indexes that may not exist in older DBs (safe idempotent creation)
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_mem_obs_project_session_created
      ON mem_observations(project, session_id, created_at, id);

    CREATE INDEX IF NOT EXISTS idx_mem_vectors_model_dim_obs
      ON mem_vectors(model, dimension, observation_id);
  `);

  // MAJOR-4: user_id / team_id 複合インデックス（プロジェクト横断検索の高速化）
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_mem_obs_project_user ON mem_observations(project, user_id, created_at DESC)`);
  } catch {
    // already exists
  }

  // S81-A02/A03 (Codex round 6 P1): add tenant columns to the new
  // coordination tables. Pre-existing DBs created the tables before
  // tenant tracking existed; newly-created DBs already have them via
  // initSchema. Both paths are idempotent.
  for (const stmt of [
    `ALTER TABLE mem_leases ADD COLUMN user_id TEXT`,
    `ALTER TABLE mem_leases ADD COLUMN team_id TEXT`,
    `ALTER TABLE mem_signals ADD COLUMN user_id TEXT`,
    `ALTER TABLE mem_signals ADD COLUMN team_id TEXT`,
  ]) {
    try { db.exec(stmt); } catch { /* already exists */ }
  }

  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_mem_obs_project_team ON mem_observations(project, team_id, created_at DESC)`);
  } catch {
    // already exists
  }

  // W2-004: mem_facts に superseded_by カラムを追加（矛盾ファクト追跡用）
  try {
    db.exec(`ALTER TABLE mem_facts ADD COLUMN superseded_by TEXT`);
  } catch {
    // already exists
  }

  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_mem_facts_superseded_by ON mem_facts(superseded_by)`);
  } catch {
    // already exists
  }

  // W2-005: mem_facts に valid_from / valid_to カラムを追加（時間的有効期間管理）
  try {
    db.exec(`ALTER TABLE mem_facts ADD COLUMN valid_from TEXT`);
  } catch {
    // already exists
  }

  try {
    db.exec(`ALTER TABLE mem_facts ADD COLUMN valid_to TEXT`);
  } catch {
    // already exists
  }

  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_mem_facts_valid_to ON mem_facts(valid_to)`);
  } catch {
    // already exists
  }

  // IMP-009: Signal Extraction - キーワード検出による重要度スコアを保存
  try {
    db.exec(`ALTER TABLE mem_observations ADD COLUMN signal_score REAL NOT NULL DEFAULT 0`);
  } catch {
    // already exists
  }

  // COMP-002: Adaptive Decay - アクセス頻度と最終アクセス時刻を管理
  try {
    db.exec(`ALTER TABLE mem_observations ADD COLUMN access_count INTEGER NOT NULL DEFAULT 0`);
  } catch {
    // already exists
  }

  try {
    db.exec(`ALTER TABLE mem_observations ADD COLUMN last_accessed_at TEXT`);
  } catch {
    // already exists
  }

  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_mem_obs_last_accessed ON mem_observations(last_accessed_at)`);
  } catch {
    // already exists
  }

  // TEAM-003: ユーザー識別 - user_id / team_id カラムを追加
  try {
    db.exec(`ALTER TABLE mem_sessions ADD COLUMN user_id TEXT NOT NULL DEFAULT 'default'`);
  } catch {
    // already exists
  }

  try {
    db.exec(`ALTER TABLE mem_sessions ADD COLUMN team_id TEXT DEFAULT NULL`);
  } catch {
    // already exists
  }

  try {
    db.exec(`ALTER TABLE mem_events ADD COLUMN user_id TEXT NOT NULL DEFAULT 'default'`);
  } catch {
    // already exists
  }

  try {
    db.exec(`ALTER TABLE mem_events ADD COLUMN team_id TEXT DEFAULT NULL`);
  } catch {
    // already exists
  }

  try {
    db.exec(`ALTER TABLE mem_observations ADD COLUMN user_id TEXT NOT NULL DEFAULT 'default'`);
  } catch {
    // already exists
  }

  try {
    db.exec(`ALTER TABLE mem_observations ADD COLUMN team_id TEXT DEFAULT NULL`);
  } catch {
    // already exists
  }

  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_mem_observations_user ON mem_observations(user_id)`);
  } catch {
    // already exists
  }

  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_mem_observations_team ON mem_observations(team_id)`);
  } catch {
    // already exists
  }

  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_mem_sessions_user ON mem_sessions(user_id)`);
  } catch {
    // already exists
  }

  // NEXT-001: Cognitive セクター自動分類 - cognitive_sector カラムを追加
  try {
    db.exec(`ALTER TABLE mem_observations ADD COLUMN cognitive_sector TEXT NOT NULL DEFAULT 'meta'`);
  } catch {
    // already exists
  }

  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_mem_obs_cognitive_sector ON mem_observations(cognitive_sector)`);
  } catch {
    // already exists
  }

  // PERF-001: search() 内 audit_log フルスキャン対策 - action/target_type/target_id の複合インデックス
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_mem_audit_log_action_target ON mem_audit_log(action, target_type, target_id)`);
  } catch {
    // already exists
  }

  // V5-004: Memory Model — episodic/semantic/procedural 自動分類
  try {
    db.exec(`ALTER TABLE mem_observations ADD COLUMN memory_type TEXT NOT NULL DEFAULT 'semantic'`);
  } catch {
    // already exists
  }

  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_mem_obs_memory_type ON mem_observations(memory_type)`);
  } catch {
    // already exists
  }

  // V5-005: Cloud Sync コネクタ接続情報テーブル
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS mem_sync_connections (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL,
        config TEXT NOT NULL,
        last_synced_at TEXT,
        status TEXT DEFAULT 'active',
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);
  } catch {
    // already exists
  }

  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_mem_sync_connections_type ON mem_sync_connections(type, status)`);
  } catch {
    // already exists
  }

  // PG-001: workspace_uid カラムを追加（PG スキーマとの整合）
  try {
    db.exec(`ALTER TABLE mem_sessions ADD COLUMN workspace_uid TEXT NOT NULL DEFAULT ''`);
  } catch {
    // already exists
  }

  try {
    db.exec(`ALTER TABLE mem_events ADD COLUMN workspace_uid TEXT NOT NULL DEFAULT ''`);
  } catch {
    // already exists
  }

  try {
    db.exec(`ALTER TABLE mem_observations ADD COLUMN workspace_uid TEXT NOT NULL DEFAULT ''`);
  } catch {
    // already exists
  }

  // TEAM-001: チーム管理テーブル追加（既存DBへの後付け）
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS mem_teams (
        team_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
  } catch {
    // already exists
  }

  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_mem_teams_name ON mem_teams(name)`);
  } catch {
    // already exists
  }

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS mem_team_members (
        team_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member',
        joined_at TEXT NOT NULL,
        PRIMARY KEY(team_id, user_id),
        FOREIGN KEY(team_id) REFERENCES mem_teams(team_id) ON DELETE CASCADE
      )
    `);
  } catch {
    // already exists
  }

  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_mem_team_members_user ON mem_team_members(user_id)`);
  } catch {
    // already exists
  }

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS mem_team_invitations (
        id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL,
        invitee_identifier TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member',
        token TEXT NOT NULL UNIQUE,
        expires_at TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT NOT NULL,
        FOREIGN KEY(team_id) REFERENCES mem_teams(team_id) ON DELETE CASCADE
      )
    `);
  } catch {
    // already exists
  }

  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_mem_team_invitations_token ON mem_team_invitations(token)`);
  } catch {
    // already exists
  }

  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_mem_team_invitations_team_status ON mem_team_invitations(team_id, status)`);
  } catch {
    // already exists
  }

  // プロジェクト名空文字のレコードがあれば警告ログ
  const emptyProjects = db.query(`SELECT COUNT(*) as cnt FROM mem_events WHERE trim(project) = ''`).get() as {cnt: number};
  if (emptyProjects.cnt > 0) {
    console.warn(`[harness-mem] WARNING: ${emptyProjects.cnt} events with empty project name detected`);
  }

  // §45: FTS 用日本語形態素解析テキストカラム（INSERT 時に常に参照されるため migrateSchema で追加）
  try {
    db.exec(`ALTER TABLE mem_observations ADD COLUMN title_fts TEXT`);
  } catch {
    // already exists
  }
  try {
    db.exec(`ALTER TABLE mem_observations ADD COLUMN content_fts TEXT`);
  } catch {
    // already exists
  }

  // S74-001: Nugget Extraction — サブチャンク分割テーブル
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS mem_nuggets (
        nugget_id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
        observation_id TEXT NOT NULL REFERENCES mem_observations(id) ON DELETE CASCADE,
        seq INTEGER NOT NULL,
        content TEXT NOT NULL,
        content_hash TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(observation_id, seq)
      )
    `);
  } catch {
    // already exists
  }

  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_nuggets_observation ON mem_nuggets(observation_id)`);
  } catch {
    // already exists
  }

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS mem_nugget_vectors (
        nugget_id TEXT NOT NULL,
        observation_id TEXT NOT NULL,
        model TEXT NOT NULL,
        dimension INTEGER NOT NULL,
        vector_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY(nugget_id, model),
        FOREIGN KEY(nugget_id) REFERENCES mem_nuggets(nugget_id) ON DELETE CASCADE,
        FOREIGN KEY(observation_id) REFERENCES mem_observations(id) ON DELETE CASCADE
      )
    `);
  } catch {
    // already exists
  }

  try {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_mem_nugget_vectors_observation
        ON mem_nugget_vectors(observation_id, model)
    `);
  } catch {
    // already exists
  }

  // S74-004: fact_key + project で高速にヒストリー検索するためのインデックス
  try {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_mem_facts_key_project
        ON mem_facts(fact_key, project, created_at ASC)
    `);
  } catch {
    // already exists
  }

    // S105: content-level dedupe — hash column + live-row partial unique index
    try {
      db.exec(`ALTER TABLE mem_observations ADD COLUMN content_dedupe_hash TEXT`);
    } catch {
      // already exists
    }
    try {
      db.exec(`DROP INDEX IF EXISTS idx_mem_obs_content_dedupe_hash`);
      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_mem_obs_content_dedupe_hash
          ON mem_observations(content_dedupe_hash)
          WHERE content_dedupe_hash IS NOT NULL AND archived_at IS NULL
      `);
    } catch {
      // already exists
    }

    // S78-B01: Verbatim raw storage — raw_text カラムを追加（nullable, 後方互換）
    try {
      db.exec(`ALTER TABLE mem_observations ADD COLUMN raw_text TEXT`);
  } catch {
    // already exists
  }

  // S78-B02: Hierarchical metadata — thread_id + topic カラム追加
  try {
    db.exec(`ALTER TABLE mem_observations ADD COLUMN thread_id TEXT`);
  } catch {
    // already exists
  }
  try {
    db.exec(`ALTER TABLE mem_observations ADD COLUMN topic TEXT`);
  } catch {
    // already exists
  }
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_mem_obs_thread_id ON mem_observations(thread_id) WHERE thread_id IS NOT NULL`);
  } catch {
    // already exists
  }
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_mem_obs_topic ON mem_observations(topic) WHERE topic IS NOT NULL`);
  } catch {
    // already exists
  }

  // S78-D01: Temporal forgetting — expires_at カラム追加（nullable TEXT, ISO-8601）
  try {
    db.exec(`ALTER TABLE mem_observations ADD COLUMN expires_at TEXT`);
  } catch {
    // already exists
  }
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_mem_obs_expires_at ON mem_observations(expires_at) WHERE expires_at IS NOT NULL`);
  } catch {
    // already exists
  }

  // S78-E02: Branch-scoped memory — branch カラム追加（nullable TEXT）
  // null = ブランチスコープなし（レガシー行と同等）
  try {
    db.exec(`ALTER TABLE mem_observations ADD COLUMN branch TEXT`);
  } catch {
    // already exists
  }
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_mem_obs_branch ON mem_observations(branch) WHERE branch IS NOT NULL`);
  } catch {
    // already exists
  }

  // S78-C02: Entity-relation graph — co-occurrence relations between extracted entities
  // mem_entities already exists (id INTEGER PK, name, entity_type, created_at).
  // mem_relations is new: src/dst reference entity name+kind via mem_entities.name.
  // (PG upgrade path: out of scope for §78-C02; see §78-C02b spike for partitioned PG table.)
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS mem_relations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        src TEXT NOT NULL,
        dst TEXT NOT NULL,
        kind TEXT NOT NULL,
        strength REAL NOT NULL DEFAULT 1.0,
        observation_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY(observation_id) REFERENCES mem_observations(id) ON DELETE CASCADE
      )
    `);
  } catch {
    // already exists
  }

  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_mem_relations_src ON mem_relations(src, kind)`);
  } catch {
    // already exists
  }

  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_mem_relations_obs ON mem_relations(observation_id)`);
  } catch {
    // already exists
  }

  // S108-007: Temporal anchor persistence contract across observations,
  // facts, observation links, and entity relations.
  migrateTemporalAnchorColumns(db);

  // S81-B02: Low-value eviction — soft-delete marker for archived observations.
  // `archived_at` is NULL for active rows; ISO timestamp for rows the forget
  // policy has demoted. Coexists with `archived_by_score` in audit-log payloads.
  try {
    db.exec(`ALTER TABLE mem_observations ADD COLUMN archived_at TEXT`);
  } catch {
    // already exists
  }
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_mem_obs_archived_at ON mem_observations(archived_at)`);
  } catch {
    // already exists
  }
}

export function initFtsIndex(db: Database): boolean {
  try {
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS mem_observations_fts
        USING fts5(observation_id UNINDEXED, title, content, tokenize = 'unicode61');
    `);

    // §45: title_fts / content_fts カラムは migrateSchema で追加済み

    // トリガー更新: title_fts / content_fts を優先し、未設定なら title / content_redacted にフォールバック
    db.exec(`
      DROP TRIGGER IF EXISTS mem_observations_ai;
      DROP TRIGGER IF EXISTS mem_observations_ad;
      DROP TRIGGER IF EXISTS mem_observations_au;

      CREATE TRIGGER mem_observations_ai AFTER INSERT ON mem_observations BEGIN
        INSERT INTO mem_observations_fts(rowid, observation_id, title, content)
        VALUES (new.rowid, new.id,
                COALESCE(new.title_fts, new.title),
                COALESCE(new.content_fts, new.content_redacted));
      END;

      CREATE TRIGGER mem_observations_ad AFTER DELETE ON mem_observations BEGIN
        DELETE FROM mem_observations_fts WHERE rowid = old.rowid;
      END;

      CREATE TRIGGER mem_observations_au AFTER UPDATE ON mem_observations BEGIN
        DELETE FROM mem_observations_fts WHERE rowid = old.rowid;
        INSERT INTO mem_observations_fts(rowid, observation_id, title, content)
        VALUES (new.rowid, new.id,
                COALESCE(new.title_fts, new.title),
                COALESCE(new.content_fts, new.content_redacted));
      END;
    `);

    const row = db
      .query(`SELECT COUNT(*) AS count FROM mem_observations_fts`)
      .get() as { count?: number } | null;
    const currentCount = Number(row?.count ?? 0);
    if (currentCount === 0) {
      db.exec(`
        INSERT INTO mem_observations_fts(rowid, observation_id, title, content)
        SELECT rowid, id,
               COALESCE(title_fts, title),
               COALESCE(content_fts, content_redacted)
        FROM mem_observations;
      `);
    }

    return true;
  } catch {
    return false;
  }
}

/**
 * §45: 既存データの FTS インデックスを日本語形態素解析済みテキストで再構築する。
 * segmentFn は segmentJapaneseForFts を渡す（循環依存回避のため関数注入）。
 */
export function reindexFtsWithSegmentation(
  db: Database,
  segmentFn: (text: string) => string,
): number {
  // Step 1: mem_observations の title_fts / content_fts を更新
  const rows = db
    .query<{ rowid: number; id: string; title: string | null; content_redacted: string }, []>(
      `SELECT rowid, id, title, content_redacted FROM mem_observations`
    )
    .all();

  const updateStmt = db.query(
    `UPDATE mem_observations SET title_fts = ?, content_fts = ? WHERE id = ?`
  );

  let updated = 0;
  for (const row of rows) {
    const titleFts = row.title ? segmentFn(row.title) : null;
    const contentFts = segmentFn(row.content_redacted);
    updateStmt.run(titleFts, contentFts, row.id);
    updated++;
  }

  // Step 2: FTS テーブルを再構築
  db.exec(`DELETE FROM mem_observations_fts`);
  db.exec(`
    INSERT INTO mem_observations_fts(rowid, observation_id, title, content)
    SELECT rowid, id,
           COALESCE(title_fts, title),
           COALESCE(content_fts, content_redacted)
    FROM mem_observations;
  `);

  return updated;
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

function migrateMemVectorsPrimaryKey(db: Database): void {
  const tableExists = db
    .query<{ name: string }, [string]>(
      `SELECT name
       FROM sqlite_master
       WHERE type = 'table'
         AND name = ?`,
    )
    .get("mem_vectors");

  if (!tableExists) {
    return;
  }

  const pkColumns = db
    .query<{ name: string; pk: number }, []>(`PRAGMA table_info(mem_vectors)`)
    .all()
    .filter((row) => Number(row.pk) > 0)
    .sort((lhs, rhs) => lhs.pk - rhs.pk)
    .map((row) => row.name);

  if (pkColumns.length === 2 && pkColumns[0] === "observation_id" && pkColumns[1] === "model") {
    return;
  }

  db.exec(`
    ALTER TABLE mem_vectors RENAME TO mem_vectors_legacy_s70;

    CREATE TABLE mem_vectors (
      observation_id TEXT NOT NULL,
      model TEXT NOT NULL,
      dimension INTEGER NOT NULL,
      vector_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(observation_id, model),
      FOREIGN KEY(observation_id) REFERENCES mem_observations(id) ON DELETE CASCADE
    );

    INSERT INTO mem_vectors(observation_id, model, dimension, vector_json, created_at, updated_at)
    SELECT observation_id, model, dimension, vector_json, created_at, updated_at
    FROM mem_vectors_legacy_s70;

    DROP TABLE mem_vectors_legacy_s70;

    CREATE INDEX IF NOT EXISTS idx_mem_vectors_model_dim_obs
      ON mem_vectors(model, dimension, observation_id);
  `);
}
