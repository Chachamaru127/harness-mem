/**
 * event-recorder.ts
 *
 * イベント記録モジュール。
 * HarnessMemCore から物理移動されたイベント記録責務を担う。
 *
 * 担当 API (公開):
 *   - recordEvent
 *   - recordEventQueued
 *   - getStreamEventsSince
 *
 * 内部 API (HarnessMemCore から呼び出される):
 *   - appendStreamEvent
 *   - enqueueWrite
 *   - getWriteQueuePending
 */

import { createHash } from "node:crypto";
import type { Database } from "bun:sqlite";
import type { ApiResponse, Config, EventEnvelope, StreamEvent } from "./types.js";
import {
  clampLimit,
  ensureSession,
  generateEventId,
  isPrivateTag,
  makeResponse,
  makeErrorResponse,
  normalizeVectorDimension,
  nowIso,
  parseJsonSafe,
} from "./core-utils.js";
import {
  upsertSqliteVecRow,
  type VectorEngine,
} from "../vector/providers";
import type { StoredEvent } from "../projector/types";

// ---------------------------------------------------------------------------
// ローカルユーティリティ（recordEvent ロジックで使用する純粋関数）
// ---------------------------------------------------------------------------

function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) {
    return [];
  }
  const deduped = new Set<string>();
  for (const tag of tags) {
    if (typeof tag !== "string") {
      continue;
    }
    const normalized = tag.trim().toLowerCase();
    if (!normalized) {
      continue;
    }
    deduped.add(normalized);
  }
  return [...deduped];
}

function isBlockedTag(tags: string[]): boolean {
  return tags.includes("block") || tags.includes("no_mem");
}

function shouldRedact(tags: string[]): boolean {
  return tags.includes("redact") || tags.includes("mask");
}

function redactContent(raw: string, tags: string[]): string {
  if (!shouldRedact(tags)) {
    return raw;
  }

  const rules: Array<[RegExp, string]> = [
    [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]"],
    [/\b(sk|rk|pk)_[A-Za-z0-9]{16,}\b/g, "[REDACTED_KEY]"],
    [/\b(?:api[-_ ]?key|token|secret|password)\s*[:=]\s*[^\s,;]+/gi, "[REDACTED_SECRET]"],
    [/\b[0-9a-f]{32,}\b/gi, "[REDACTED_HEX]"],
  ];

  let content = raw;
  for (const [pattern, replacement] of rules) {
    content = content.replace(pattern, replacement);
  }
  return content;
}

function buildDedupeHash(event: EventEnvelope): string {
  const basis = {
    platform: (event.platform || "unknown").toString().trim().toLowerCase(),
    project: (event.project || "unknown").toString().trim(),
    session_id: (event.session_id || "unknown").toString().trim(),
    event_type: (event.event_type || "unknown").toString().trim().toLowerCase(),
    ts: (event.ts || "").toString().trim(),
    payload: event.payload ?? {},
    tags: normalizeTags(event.tags),
    privacy_tags: normalizeTags(event.privacy_tags),
  };

  const hash = createHash("sha256");
  hash.update(JSON.stringify(basis));
  return hash.digest("hex");
}


// IMP-009: Signal Extraction
const SIGNAL_BOOST_PATTERNS: RegExp[] = [
  /\bremember\b/i,
  /\barchitecture\b/i,
  /\bdecision\b/i,
  /\bbug\b/i,
  /\bfix\b/i,
];
const SIGNAL_BOOST_AMOUNT = 0.3;

const NOISE_DAMPEN_PATTERNS: RegExp[] = [
  /<environment_context>/i,
  /<AGENTS\.md>/i,
];
const NOISE_DAMPEN_AMOUNT = 0.2;

function extractSignalScore(content: string): number {
  let score = 0;

  const hasSignal = SIGNAL_BOOST_PATTERNS.some((pattern) => pattern.test(content));
  if (hasSignal) {
    score += SIGNAL_BOOST_AMOUNT;
  }

  const hasNoise = NOISE_DAMPEN_PATTERNS.some((pattern) => pattern.test(content));
  if (hasNoise) {
    score -= NOISE_DAMPEN_AMOUNT;
  }

  return score;
}

interface ExtractedEntity {
  name: string;
  type: string;
}

const FILE_EXT_RE = /(?:^|\s|["'`(])([\w./\\-]+\.(?:ts|js|py|rs|go|tsx|jsx|vue|sql|css|scss|html|json|yaml|yml|toml|md|sh))\b/g;
const PACKAGE_RE = /(?:npm|yarn|pnpm|pip|cargo|bun)\s+(?:install|add|i|remove)\s+([\w@/.+\-]+)/g;
const FUNC_RE = /(?:function|def|fn|func|const|let|var)\s+([A-Za-z_]\w{2,})/g;
const URL_RE = /https?:\/\/[^\s"'`<>)\]]+/g;

function extractEntities(content: string): ExtractedEntity[] {
  const seen = new Set<string>();
  const entities: ExtractedEntity[] = [];

  function add(name: string, type: string): void {
    const key = `${type}:${name}`;
    if (!seen.has(key) && entities.length < 50) {
      seen.add(key);
      entities.push({ name: name.slice(0, 255), type });
    }
  }

  for (const match of content.matchAll(FILE_EXT_RE)) {
    if (match[1]) add(match[1], "file");
  }
  for (const match of content.matchAll(PACKAGE_RE)) {
    if (match[1]) add(match[1], "package");
  }
  for (const match of content.matchAll(FUNC_RE)) {
    if (match[1]) add(match[1], "symbol");
  }
  for (const match of content.matchAll(URL_RE)) {
    if (match[0]) add(match[0].replace(/[.,;:!?]+$/, "").slice(0, 255), "url");
  }

  return entities;
}

// ---------------------------------------------------------------------------
// EventRecorderDeps: HarnessMemCore から渡される内部依存
// ---------------------------------------------------------------------------

export interface EventRecorderDeps {
  db: Database;
  config: Config;
  /** normalizeProjectInput のバインド済みバージョン */
  normalizeProject: (project: string) => string;
  /** プロジェクトパスが絶対パスかどうかを判定 */
  isAbsoluteProjectPath: (project: string) => boolean;
  /** 新しいプロジェクト正規化ルートを登録 */
  extendProjectNormalizationRoots: (candidates: string[]) => void;
  /** マネージドバックエンドが必須かどうか */
  getManagedRequired: () => boolean;
  /** マネージドバックエンドが接続済みかどうか */
  isManagedConnected: () => boolean;
  /** マネージドバックエンドへイベントをレプリケート（未接続なら no-op） */
  replicateManagedEvent: (event: StoredEvent) => void;
  /** ベクターエンジン種別 */
  getVectorEngine: () => VectorEngine;
  /** sqlite-vec テーブルが使用可能かどうか */
  getVecTableReady: () => boolean;
  /** sqlite-vec テーブルの使用可否を更新 */
  setVecTableReady: (value: boolean) => void;
  /** テキストをベクターに変換 */
  embedContent: (content: string) => number[];
  /** 埋め込みプロバイダ名 */
  getEmbeddingProviderName: () => string;
  /** 埋め込みヘルスステータス */
  getEmbeddingHealthStatus: () => string;
  /** ベクターモデルバージョン */
  getVectorModelVersion: () => string;
  /** 埋め込みヘルスを更新 */
  refreshEmbeddingHealth: () => void;
}

// ---------------------------------------------------------------------------
// EventRecorder クラス
// ---------------------------------------------------------------------------

export class EventRecorder {
  private streamEventCounter = 0;
  private streamEvents: StreamEvent[] = [];
  private readonly streamEventRetention = 600;

  private writeQueue: Promise<void> = Promise.resolve();
  private writeQueuePending = 0;
  private readonly writeQueueLimit = 100;

  // Cached prepared statements for extractAndStoreEntities
  private insertEntityStmt: ReturnType<Database["query"]> | null = null;
  private linkEntityStmt: ReturnType<Database["query"]> | null = null;

  constructor(private readonly deps: EventRecorderDeps) {}

  // ---------------------------------------------------------------------------
  // ストリームイベント管理
  // ---------------------------------------------------------------------------

  appendStreamEvent(
    type: StreamEvent["type"],
    data: Record<string, unknown>
  ): StreamEvent {
    const event: StreamEvent = {
      id: ++this.streamEventCounter,
      type,
      ts: new Date().toISOString(),
      data,
    };
    this.streamEvents.push(event);
    if (this.streamEvents.length > this.streamEventRetention) {
      this.streamEvents.splice(0, this.streamEvents.length - this.streamEventRetention);
    }
    return event;
  }

  getStreamEventsSince(lastEventId: number, limitInput?: number): StreamEvent[] {
    const limit = clampLimit(limitInput, 100, 1, 500);
    if (this.streamEvents.length === 0) {
      return [];
    }
    return this.streamEvents
      .filter((event) => event.id > lastEventId)
      .slice(0, limit)
      .map((event) => ({ ...event, data: { ...event.data } }));
  }

  // ---------------------------------------------------------------------------
  // 書き込みキュー管理
  // ---------------------------------------------------------------------------

  getWriteQueuePending(): number {
    return this.writeQueuePending;
  }

  enqueueWrite<T>(fn: () => T): Promise<T> {
    this.writeQueuePending += 1;
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const resultPromise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });

    this.writeQueue = this.writeQueue.then(() => {
      this.writeQueuePending -= 1;
      try {
        resolve(fn());
      } catch (err) {
        reject(err);
      }
    });

    return resultPromise;
  }

  // ---------------------------------------------------------------------------
  // recordEvent ロジック（コアから物理移動）
  // ---------------------------------------------------------------------------

  private buildObservationFromEvent(event: EventEnvelope, redactedContent: string): { title: string; content: string } {
    const payload = parseJsonSafe(event.payload);

    const titleRaw = payload.title;
    const promptRaw = payload.prompt;
    const contentRaw = payload.content;
    const commandRaw = payload.command;

    const title =
      (typeof titleRaw === "string" && titleRaw.trim()) ||
      (typeof promptRaw === "string" && promptRaw.trim().slice(0, 120)) ||
      (typeof commandRaw === "string" && commandRaw.trim().slice(0, 120)) ||
      `${event.event_type}`;

    const content =
      (typeof contentRaw === "string" && contentRaw.trim()) ||
      (typeof promptRaw === "string" && promptRaw.trim()) ||
      (typeof commandRaw === "string" && commandRaw.trim()) ||
      redactedContent ||
      JSON.stringify(payload).slice(0, 4000);

    return {
      title,
      content,
    };
  }

  private classifyObservation(eventType: string, title: string, content: string): string {
    if (eventType === "session_end") return "summary";
    if (eventType === "session_start") return "context";
    if (eventType === "tool_use") return "action";

    const text = `${title} ${content}`.toLowerCase();

    if (/(decided|chose|picked|switched to|方針|決定|採用|選択)/.test(text)) return "decision";
    if (/(pattern|usually|consistently|repeatedly|傾向|パターン|毎回|常に)/.test(text)) return "pattern";
    if (/(prefer|dislike|avoid|rather|preference|好み|希望|避けたい)/.test(text)) return "preference";
    if (/(learned|lesson|realized|gotcha|mistake|学び|反省|気づき|教訓)/.test(text)) return "lesson";
    if (/(next step|todo|next action|次対応|次の対応|アクション)/.test(text)) return "action";
    return "context";
  }

  // ensureSession は core-utils.ts の共有関数を使用

  private upsertVector(observationId: string, content: string, createdAt: string): void {
    if (this.deps.getVectorEngine() === "disabled") {
      return;
    }

    const vector = normalizeVectorDimension(this.deps.embedContent(content), this.deps.config.vectorDimension);
    this.deps.refreshEmbeddingHealth();
    const vectorJson = JSON.stringify(vector);
    const updatedAt = nowIso();

    this.deps.db
      .query(`
        INSERT INTO mem_vectors(observation_id, model, dimension, vector_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(observation_id) DO UPDATE SET
          model = excluded.model,
          dimension = excluded.dimension,
          vector_json = excluded.vector_json,
          updated_at = excluded.updated_at
      `)
      .run(observationId, this.deps.getVectorModelVersion(), this.deps.config.vectorDimension, vectorJson, createdAt, updatedAt);

    if (this.deps.getVectorEngine() === "sqlite-vec" && this.deps.getVecTableReady()) {
      const ok = upsertSqliteVecRow(this.deps.db, observationId, vectorJson, updatedAt);
      if (!ok) {
        this.deps.setVecTableReady(false);
      }
    }
  }

  /** reindexVectors などから呼び出す公開ラッパー */
  reindexObservationVector(observationId: string, content: string, createdAt: string): void {
    this.upsertVector(observationId, content, createdAt);
  }

  private extractAndStoreEntities(observationId: string, content: string, createdAt: string): void {
    const entities = extractEntities(content);
    if (entities.length === 0) return;

    try {
      if (!this.insertEntityStmt) {
        this.insertEntityStmt = this.deps.db.query(
          `INSERT OR IGNORE INTO mem_entities(name, entity_type, created_at) VALUES (?, ?, ?)`
        );
      }
      for (const entity of entities) {
        this.insertEntityStmt.run(entity.name, entity.type, createdAt);
      }

      const placeholders = entities.map(() => "(?, ?)").join(", ");
      const params: string[] = [];
      for (const entity of entities) {
        params.push(entity.name, entity.type);
      }
      const storedEntities = this.deps.db
        .query(`SELECT id FROM mem_entities WHERE (name, entity_type) IN (VALUES ${placeholders})`)
        .all(...params) as Array<{ id: number }>;

      if (!this.linkEntityStmt) {
        this.linkEntityStmt = this.deps.db.query(
          `INSERT OR IGNORE INTO mem_observation_entities(observation_id, entity_id, created_at) VALUES (?, ?, ?)`
        );
      }
      for (const stored of storedEntities) {
        this.linkEntityStmt.run(observationId, stored.id, createdAt);
      }
    } catch {
      // best effort
    }
  }

  private autoLinkObservation(observationId: string, sessionId: string, createdAt: string): void {
    try {
      const previous = this.deps.db
        .query(`
          SELECT id, title, content_redacted
          FROM mem_observations
          WHERE session_id = ? AND id <> ? AND created_at <= ?
          ORDER BY created_at DESC
          LIMIT 1
        `)
        .get(sessionId, observationId, createdAt) as { id: string; title: string | null; content_redacted: string } | null;

      if (previous?.id) {
        const current = this.deps.db
          .query(`SELECT title, content_redacted FROM mem_observations WHERE id = ?`)
          .get(observationId) as { title: string | null; content_redacted: string } | null;

        let relation = "follows";
        if (current && previous.title && current.title) {
          const prevTitle = previous.title.toLowerCase();
          const currTitle = current.title.toLowerCase();
          const prevWords = new Set(prevTitle.split(/\s+/).filter((w) => w.length > 2));
          const currWords = currTitle.split(/\s+/).filter((w) => w.length > 2);
          if (prevWords.size > 0 && currWords.length > 0) {
            const overlap = currWords.filter((w) => prevWords.has(w)).length;
            const similarity = overlap / Math.max(prevWords.size, currWords.length);
            if (similarity >= 0.6) {
              relation = "updates";
            } else if (similarity >= 0.3) {
              relation = "extends";
            }
          }
        }

        this.deps.db
          .query(`
            INSERT OR IGNORE INTO mem_links(from_observation_id, to_observation_id, relation, weight, created_at)
            VALUES (?, ?, ?, 1.0, ?)
          `)
          .run(observationId, previous.id, relation, createdAt);
      }
    } catch {
      // best effort
    }

    try {
      const sharedRows = this.deps.db
        .query(`
          SELECT DISTINCT oe2.observation_id AS id
          FROM mem_observation_entities oe1
          JOIN mem_observation_entities oe2 ON oe1.entity_id = oe2.entity_id
          WHERE oe1.observation_id = ? AND oe2.observation_id <> ?
          ORDER BY oe2.observation_id ASC
          LIMIT 20
        `)
        .all(observationId, observationId) as Array<{ id: string }>;

      for (const row of sharedRows) {
        this.deps.db
          .query(`
            INSERT OR IGNORE INTO mem_links(from_observation_id, to_observation_id, relation, weight, created_at)
            VALUES (?, ?, 'shared_entity', 0.7, ?)
          `)
          .run(observationId, row.id, createdAt);
      }
    } catch {
      // best effort
    }
  }

  private enqueueRetry(event: EventEnvelope, reason: string): void {
    const current = nowIso();
    this.deps.db
      .query(`
        INSERT INTO mem_retry_queue(event_json, reason, retry_count, next_retry_at, created_at, updated_at)
        VALUES (?, ?, 0, ?, ?, ?)
      `)
      .run(JSON.stringify(event), reason.slice(0, 500), current, current, current);
  }

  // ---------------------------------------------------------------------------
  // パブリック API
  // ---------------------------------------------------------------------------

  recordEvent(
    event: EventEnvelope,
    options: { allowQueue: boolean } = { allowQueue: true }
  ): ApiResponse {
    const startedAt = performance.now();

    if (!this.deps.config.captureEnabled) {
      return makeResponse(startedAt, [], {}, { capture_enabled: false });
    }

    if (!event.project || !event.session_id || !event.event_type || !event.platform) {
      return makeErrorResponse(startedAt, "event.project / event.session_id / event.event_type / event.platform are required", {});
    }

    let normalizedProject: string;
    try {
      normalizedProject = this.deps.normalizeProject(event.project);
    } catch (e) {
      return makeErrorResponse(startedAt, e instanceof Error ? e.message : String(e), { project: event.project });
    }
    if (this.deps.isAbsoluteProjectPath(normalizedProject)) {
      this.deps.extendProjectNormalizationRoots([normalizedProject]);
    }

    const tags = normalizeTags(event.tags);
    const privacyTags = normalizeTags(event.privacy_tags);

    if (isBlockedTag(privacyTags)) {
      return makeResponse(startedAt, [], { blocked: true }, { skipped: true });
    }

    // Fail-close in managed mode
    if (this.deps.getManagedRequired() && !this.deps.isManagedConnected()) {
      return makeErrorResponse(
        startedAt,
        "managed backend is required but not connected; write blocked (fail-close)",
        {
          project: normalizedProject,
          session_id: event.session_id,
          backend_mode: this.deps.config.backendMode || "local",
          write_durability: "blocked",
        }
      );
    }

    const timestamp = event.ts || nowIso();
    const payload = parseJsonSafe(event.payload);
    const payloadText = JSON.stringify(payload);
    const redactedPayload = redactContent(payloadText, privacyTags);

    const dedupeHash = (event.dedupe_hash || buildDedupeHash(event)).trim();
    const eventId = (event.event_id || generateEventId()).trim();

    const observationBase = this.buildObservationFromEvent(event, redactedPayload);
    const redactedContent = redactContent(observationBase.content, privacyTags);
    const observationType = this.classifyObservation(event.event_type, observationBase.title, observationBase.content);
    const observationId = `obs_${eventId}`;
    const current = nowIso();

    // IMP-009: Signal Extraction
    const signalScore = extractSignalScore(observationBase.content);

    // TEAM-009: イベントの user_id/team_id を config より優先して使用
    const userId = (typeof event.user_id === "string" && event.user_id.trim() ? event.user_id.trim() : null)
      ?? this.deps.config.userId
      ?? "default";
    const teamId = (typeof event.team_id === "string" && event.team_id.trim() ? event.team_id.trim() : null)
      ?? this.deps.config.teamId
      ?? null;

    try {
      const transaction = this.deps.db.transaction(() => {
        ensureSession(this.deps.db, event.session_id, event.platform, normalizedProject, timestamp, event.correlation_id, userId, teamId);

        const eventInsert = this.deps.db
          .query(`
            INSERT OR IGNORE INTO mem_events(
              event_id, platform, project, session_id, event_type, ts,
              payload_json, tags_json, privacy_tags_json, dedupe_hash, observation_id, correlation_id,
              user_id, team_id, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `)
          .run(
            eventId,
            event.platform,
            normalizedProject,
            event.session_id,
            event.event_type,
            timestamp,
            redactedPayload,
            JSON.stringify(tags),
            JSON.stringify(privacyTags),
            dedupeHash,
            observationId,
            event.correlation_id ?? null,
            userId,
            teamId,
            current
          );

        const eventChanges = Number((eventInsert as { changes?: number }).changes ?? 0);
        if (eventChanges === 0) {
          return { duplicated: true };
        }

        this.deps.db
          .query(`
            INSERT INTO mem_observations(
              id, event_id, platform, project, session_id,
              title, content, content_redacted, observation_type,
              tags_json, privacy_tags_json,
              signal_score, user_id, team_id,
              created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              title = excluded.title,
              content = excluded.content,
              content_redacted = excluded.content_redacted,
              observation_type = excluded.observation_type,
              tags_json = excluded.tags_json,
              privacy_tags_json = excluded.privacy_tags_json,
              signal_score = excluded.signal_score,
              updated_at = excluded.updated_at
          `)
          .run(
            observationId,
            eventId,
            event.platform,
            normalizedProject,
            event.session_id,
            observationBase.title,
            observationBase.content,
            redactedContent,
            observationType,
            JSON.stringify(tags),
            JSON.stringify(privacyTags),
            signalScore,
            userId,
            teamId,
            timestamp,
            current
          );

        for (const tag of tags) {
          this.deps.db
            .query(`
              INSERT OR IGNORE INTO mem_tags(observation_id, tag, tag_type, created_at)
              VALUES (?, ?, 'tag', ?)
            `)
            .run(observationId, tag, current);
        }

        for (const tag of privacyTags) {
          this.deps.db
            .query(`
              INSERT OR IGNORE INTO mem_tags(observation_id, tag, tag_type, created_at)
              VALUES (?, ?, 'privacy', ?)
            `)
            .run(observationId, tag, current);
        }

        this.upsertVector(observationId, redactedContent, timestamp);
        this.extractAndStoreEntities(observationId, redactedContent, timestamp);
        this.autoLinkObservation(observationId, event.session_id, timestamp);

        if (isPrivateTag(privacyTags)) {
          this.deps.db.query(`
            INSERT INTO mem_audit_log(action, actor, target_type, target_id, details_json, created_at)
            VALUES ('privacy_filter', ?, 'event', ?, ?, ?)
          `).run(
            event.platform,
            eventId,
            JSON.stringify({ reason: "private_tag", path: `${event.platform}/${normalizedProject}`, privacy_tags: privacyTags }),
            current
          );
        }

        return { duplicated: false, observationId };
      });

      const result = transaction() as { duplicated: boolean; observationId?: string };
      if (result.duplicated) {
        return makeResponse(startedAt, [], { dedupe_hash: dedupeHash }, { deduped: true });
      }

      const item = {
        id: result.observationId,
        event_id: eventId,
        dedupe_hash: dedupeHash,
        platform: event.platform,
        project: normalizedProject,
        session_id: event.session_id,
        event_type: event.event_type,
        card_type: event.event_type === "session_end" ? "session_summary" : event.event_type,
        ts: timestamp,
        created_at: timestamp,
        title: observationBase.title,
        content: redactedContent.slice(0, 1200),
        tags,
        privacy_tags: privacyTags,
      };

      this.appendStreamEvent("observation.created", item as unknown as Record<string, unknown>);

      // Dual-write: replicate to managed backend if hybrid/managed
      const storedEvent: StoredEvent = {
        event_id: eventId,
        platform: event.platform,
        project: normalizedProject,
        workspace_uid: "",
        session_id: event.session_id,
        event_type: event.event_type,
        ts: timestamp,
        payload_json: redactedPayload,
        tags_json: JSON.stringify(tags),
        privacy_tags_json: JSON.stringify(privacyTags),
        dedupe_hash: dedupeHash,
        observation_id: observationId,
        correlation_id: event.correlation_id || undefined,
        created_at: current,
      };
      this.deps.replicateManagedEvent(storedEvent);

      const writeDurability = this.deps.getManagedRequired() ? "managed" : "local";

      return makeResponse(
        startedAt,
        [item],
        {
          project: normalizedProject,
          session_id: event.session_id,
          event_type: event.event_type,
        },
        {
          vector_engine: this.deps.getVectorEngine(),
          embedding_provider: this.deps.getEmbeddingProviderName(),
          embedding_provider_status: this.deps.getEmbeddingHealthStatus(),
          write_durability: writeDurability,
        }
      );
    } catch (error) {
      if (options.allowQueue) {
        this.enqueueRetry(event, error instanceof Error ? error.message : String(error));
      }
      return makeErrorResponse(startedAt, error instanceof Error ? error.message : String(error), {
        project: normalizedProject,
        session_id: event.session_id,
      });
    }
  }

  async recordEventQueued(
    event: EventEnvelope,
    options: { allowQueue: boolean } = { allowQueue: true }
  ): Promise<ApiResponse | "queue_full"> {
    if (this.writeQueuePending >= this.writeQueueLimit) {
      return "queue_full";
    }
    return this.enqueueWrite(() => this.recordEvent(event, options));
  }
}
