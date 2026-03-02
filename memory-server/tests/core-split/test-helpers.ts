/**
 * core-split 単体テスト用ヘルパー
 *
 * HarnessMemCore を使わずに各分割モジュールを直接テストするための
 * DB セットアップとモック deps ファクトリを提供する。
 */

import { Database } from "bun:sqlite";
import { configureDatabase, initSchema, migrateSchema, initFtsIndex } from "../../src/db/schema";
import type { Config, ApiResponse, EventEnvelope, StreamEvent } from "../../src/core/harness-mem-core";

/**
 * テスト用のインメモリ SQLite DB を作成し、スキーマを初期化する。
 */
export function createTestDb(): Database {
  const db = new Database(":memory:");
  configureDatabase(db);
  initSchema(db);
  migrateSchema(db);
  initFtsIndex(db);
  return db;
}

/**
 * テスト用の最小限 Config を作成する。
 */
export function createTestConfig(overrides: Partial<Config> = {}): Config {
  return {
    dbPath: ":memory:",
    bindHost: "127.0.0.1",
    bindPort: 37888,
    vectorDimension: 64,
    captureEnabled: true,
    retrievalEnabled: true,
    injectionEnabled: true,
    codexHistoryEnabled: false,
    codexProjectRoot: process.cwd(),
    codexSessionsRoot: process.cwd(),
    codexIngestIntervalMs: 5000,
    codexBackfillHours: 24,
    opencodeIngestEnabled: false,
    cursorIngestEnabled: false,
    antigravityIngestEnabled: false,
    ...overrides,
  };
}

/**
 * 標準的な成功 ApiResponse を作成する。
 */
export function okResponse(items: unknown[] = [], meta: Record<string, unknown> = {}): ApiResponse {
  return {
    ok: true,
    source: "core",
    items,
    meta: {
      count: items.length,
      latency_ms: 0,
      sla_latency_ms: 0,
      filters: {},
      ranking: "hybrid_v3",
      ...meta,
    },
  };
}

/**
 * 標準的なエラー ApiResponse を作成する。
 */
export function errorResponse(error: string): ApiResponse {
  return {
    ok: false,
    source: "core",
    items: [],
    meta: { count: 0, latency_ms: 0, sla_latency_ms: 0, filters: {}, ranking: "hybrid_v3" },
    error,
  };
}

/**
 * テスト用のイベントを作成する。
 */
export function makeEvent(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    platform: "claude",
    project: "test-project",
    session_id: "test-session-001",
    event_type: "user_prompt",
    ts: new Date().toISOString(),
    payload: { prompt: "test observation" },
    tags: [],
    privacy_tags: [],
    ...overrides,
  };
}

/**
 * テスト用 DB にイベント/セッション/オブザベーションを直接挿入する。
 * HarnessMemCore.recordEvent() を経由せずにテストデータを用意する。
 */
export function insertTestObservation(
  db: Database,
  opts: {
    id?: string;
    event_id?: string;
    platform?: string;
    project?: string;
    session_id?: string;
    title?: string;
    content?: string;
    observation_type?: string;
    tags?: string[];
    privacy_tags?: string[];
    created_at?: string;
  } = {}
): string {
  const now = new Date().toISOString();
  const id = opts.id || `obs_test-${Math.random().toString(36).slice(2, 8)}`;
  const eventId = opts.event_id || `evt_test-${Math.random().toString(36).slice(2, 8)}`;
  const platform = opts.platform || "claude";
  const project = opts.project || "test-project";
  const sessionId = opts.session_id || "test-session-001";
  const title = opts.title || "Test observation";
  const content = opts.content || "Test observation content";
  const observationType = opts.observation_type || "context";
  const tags = opts.tags || [];
  const privacyTags = opts.privacy_tags || [];
  const createdAt = opts.created_at || now;

  // Ensure session exists
  db.query(
    `INSERT OR IGNORE INTO mem_sessions (session_id, platform, project, started_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(sessionId, platform, project, createdAt, createdAt, createdAt);

  // Insert event
  const dedupeHash = `hash_${eventId}`;
  db.query(
    `INSERT OR IGNORE INTO mem_events (event_id, platform, project, session_id, event_type, ts, payload_json, tags_json, privacy_tags_json, dedupe_hash, observation_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(eventId, platform, project, sessionId, "user_prompt", createdAt, JSON.stringify({ prompt: content }), JSON.stringify(tags), JSON.stringify(privacyTags), dedupeHash, id, createdAt);

  // Insert observation
  db.query(
    `INSERT OR IGNORE INTO mem_observations (id, event_id, platform, project, session_id, title, content, content_redacted, observation_type, tags_json, privacy_tags_json, signal_score, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
  ).run(id, eventId, platform, project, sessionId, title, content, content, observationType, JSON.stringify(tags), JSON.stringify(privacyTags), createdAt, createdAt);

  return id;
}

/**
 * テスト用 DB に監査ログを直接挿入する。
 */
export function insertTestAuditLog(
  db: Database,
  action: string,
  targetType: string,
  targetId = "",
  details: Record<string, unknown> = {}
): void {
  const now = new Date().toISOString();
  db.query(
    `INSERT INTO mem_audit_log (action, actor, target_type, target_id, details_json, created_at) VALUES (?, ?, ?, ?, ?, ?)`
  ).run(action, "test", targetType, targetId, JSON.stringify(details), now);
}
