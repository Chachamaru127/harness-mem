/**
 * auto-linker.ts
 *
 * S74-003: 自動リンク生成モジュール。
 *
 * observation が作成されたとき、3つの戦略でグラフリンクを自動生成する:
 *
 * Strategy A: Entity Co-occurrence
 *   同じ entity を持つ observation 間に shared_entity リンクを追加 (weight: entity_type 依存)
 *   上限: 1 observation あたり最大 10 リンク
 *
 * Strategy B: Temporal Proximity
 *   同セッション内で直前の observation に follows リンクを追加 (weight: 0.8)
 *   セッション跨ぎはリンクしない
 *
 * Strategy C: Semantic Similarity (optional)
 *   cosine similarity >= 0.85 の observation に extends リンクを追加 (weight: 0.5)
 *   環境変数 HARNESS_MEM_AUTO_LINK_SEMANTIC=true で有効化
 *   パフォーマンス考慮: 最新 100 件のみ比較
 */

import type { Database } from "bun:sqlite";
import { cosineSimilarity } from "./core-utils.js";

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------

/** Strategy A: entity co-occurrence の上限リンク数 */
const ENTITY_COOCCURRENCE_LIMIT = 10;

/** Strategy B: temporal proximity の weight */
const TEMPORAL_PROXIMITY_WEIGHT = 0.8;

/** Strategy C: semantic similarity の閾値 */
const SEMANTIC_SIMILARITY_THRESHOLD = 0.85;

/** Strategy C: 比較対象の最大件数 */
const SEMANTIC_COMPARISON_LIMIT = 100;

/** Strategy C: semantic similarity リンクの weight */
const SEMANTIC_SIMILARITY_WEIGHT = 0.5;

/** Strategy A: entity_type 別 weight */
const ENTITY_TYPE_WEIGHTS: Record<string, number> = {
  file: 0.8,
  package: 0.9,
  symbol: 0.7,
  url: 0.6,
};

const DEFAULT_ENTITY_WEIGHT = 0.6;

// ---------------------------------------------------------------------------
// 型定義
// ---------------------------------------------------------------------------

export interface AutoLinkerDeps {
  db: Database;
  /** Strategy C を有効にするかどうか（env HARNESS_MEM_AUTO_LINK_SEMANTIC から設定） */
  semanticEnabled?: boolean;
  /** observation の embedding を取得する（Strategy C 用） */
  getEmbedding?: (observationId: string) => number[] | null;
}

export interface AutoLinkResult {
  entityLinks: number;
  temporalLinks: number;
  semanticLinks: number;
}

// ---------------------------------------------------------------------------
// 内部ユーティリティ
// ---------------------------------------------------------------------------

/** INSERT OR IGNORE で安全にリンクを挿入する */
function insertLink(
  db: Database,
  fromId: string,
  toId: string,
  relation: string,
  weight: number,
  createdAt: string,
): void {
  db.query(`
    INSERT OR IGNORE INTO mem_links(from_observation_id, to_observation_id, relation, weight, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(fromId, toId, relation, weight, createdAt);
}

// ---------------------------------------------------------------------------
// Strategy A: Entity Co-occurrence
// ---------------------------------------------------------------------------

/**
 * 新しい observation と同じ entity を持つ他の observation を検索し、
 * shared_entity リンクを追加する。
 *
 * - 上限: ENTITY_COOCCURRENCE_LIMIT 件（最新の observation を優先）
 * - entity_type ごとに weight を差別化
 */
export function linkByEntityCooccurrence(
  db: Database,
  observationId: string,
  createdAt: string,
): number {
  // この observation に紐づく entity ID を取得
  const ownEntities = db
    .query<{ entity_id: number }, [string]>(`
      SELECT entity_id
      FROM mem_observation_entities
      WHERE observation_id = ?
    `)
    .all(observationId);

  if (ownEntities.length === 0) return 0;

  // 同じ entity を持つ他の observation を最新順で取得（上限付き）
  const entityIds = ownEntities.map((r) => r.entity_id);
  const placeholders = entityIds.map(() => "?").join(", ");

  const sharedRows = db
    .query<{ observation_id: string; entity_type: string | null }, (string | number)[]>(`
      SELECT DISTINCT oe2.observation_id, e.entity_type
      FROM mem_observation_entities oe2
      JOIN mem_entities e ON e.id = oe2.entity_id
      WHERE oe2.entity_id IN (${placeholders})
        AND oe2.observation_id <> ?
      ORDER BY oe2.observation_id DESC
      LIMIT ${ENTITY_COOCCURRENCE_LIMIT}
    `)
    .all(...entityIds, observationId) as Array<{ observation_id: string; entity_type: string | null }>;

  if (sharedRows.length === 0) return 0;

  let count = 0;
  for (const row of sharedRows) {
    const weight = ENTITY_TYPE_WEIGHTS[row.entity_type ?? ""] ?? DEFAULT_ENTITY_WEIGHT;
    insertLink(db, observationId, row.observation_id, "shared_entity", weight, createdAt);
    count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Strategy B: Temporal Proximity
// ---------------------------------------------------------------------------

/**
 * 同じセッション内の直前の observation に follows リンクを追加する。
 * セッション跨ぎはリンクしない。
 */
export function linkByTemporalProximity(
  db: Database,
  observationId: string,
  sessionId: string,
  createdAt: string,
): number {
  const previous = db
    .query<{ id: string }, [string, string, string]>(`
      SELECT id
      FROM mem_observations
      WHERE session_id = ?
        AND id <> ?
        AND created_at <= ?
      ORDER BY created_at DESC
      LIMIT 1
    `)
    .get(sessionId, observationId, createdAt);

  if (!previous?.id) return 0;

  insertLink(db, observationId, previous.id, "follows", TEMPORAL_PROXIMITY_WEIGHT, createdAt);
  return 1;
}

// ---------------------------------------------------------------------------
// Strategy C: Semantic Similarity
// ---------------------------------------------------------------------------

/**
 * 既存 observation との cosine similarity を計算し、
 * 閾値以上なら extends リンクを追加する。
 *
 * - HARNESS_MEM_AUTO_LINK_SEMANTIC=true の場合のみ動作
 * - パフォーマンス考慮: 最新 SEMANTIC_COMPARISON_LIMIT 件のみ比較
 */
export function linkBySemanticSimilarity(
  db: Database,
  observationId: string,
  createdAt: string,
  getEmbedding: (observationId: string) => number[] | null,
): number {
  // 対象 observation の embedding を取得
  const newVector = getEmbedding(observationId);
  if (!newVector || newVector.length === 0) return 0;

  // 最新 SEMANTIC_COMPARISON_LIMIT 件の observation の embedding を取得（自分自身を除く）
  const rows = db
    .query<{ observation_id: string; vector_json: string }, [string, number]>(`
      SELECT mv.observation_id, mv.vector_json
      FROM mem_vectors mv
      WHERE mv.observation_id <> ?
      ORDER BY mv.observation_id DESC
      LIMIT ?
    `)
    .all(observationId, SEMANTIC_COMPARISON_LIMIT);

  if (rows.length === 0) return 0;

  let count = 0;
  for (const row of rows) {
    let vector: number[];
    try {
      vector = JSON.parse(row.vector_json) as number[];
    } catch {
      continue;
    }

    const similarity = cosineSimilarity(newVector, vector);
    if (similarity >= SEMANTIC_SIMILARITY_THRESHOLD) {
      insertLink(db, observationId, row.observation_id, "extends", SEMANTIC_SIMILARITY_WEIGHT, createdAt);
      count++;
    }
  }

  return count;
}

// ---------------------------------------------------------------------------
// メインエントリポイント
// ---------------------------------------------------------------------------

/**
 * 3つの戦略で自動リンクを生成する。
 *
 * このメソッドは recordEvent の後に呼び出される想定。
 * エラーはログ出力のみで、呼び出し元の処理は中断しない。
 */
export function runAutoLinker(
  deps: AutoLinkerDeps,
  observationId: string,
  sessionId: string,
  createdAt: string,
): AutoLinkResult {
  const result: AutoLinkResult = {
    entityLinks: 0,
    temporalLinks: 0,
    semanticLinks: 0,
  };

  // Strategy A: Entity Co-occurrence
  try {
    result.entityLinks = linkByEntityCooccurrence(deps.db, observationId, createdAt);
  } catch (err) {
    console.warn(`[auto-linker] Strategy A (entity co-occurrence) failed for ${observationId}:`, err);
  }

  // Strategy B: Temporal Proximity
  try {
    result.temporalLinks = linkByTemporalProximity(deps.db, observationId, sessionId, createdAt);
  } catch (err) {
    console.warn(`[auto-linker] Strategy B (temporal proximity) failed for ${observationId}:`, err);
  }

  // Strategy C: Semantic Similarity (optional)
  const semanticEnabled =
    deps.semanticEnabled ??
    process.env["HARNESS_MEM_AUTO_LINK_SEMANTIC"] === "true";

  if (semanticEnabled && deps.getEmbedding) {
    try {
      result.semanticLinks = linkBySemanticSimilarity(
        deps.db,
        observationId,
        createdAt,
        deps.getEmbedding,
      );
    } catch (err) {
      console.warn(`[auto-linker] Strategy C (semantic similarity) failed for ${observationId}:`, err);
    }
  }

  return result;
}
