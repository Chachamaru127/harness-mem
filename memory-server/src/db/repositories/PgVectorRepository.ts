/**
 * PgVectorRepository
 *
 * IVectorRepository の PostgreSQL + pgvector 実装。
 *
 * - mem_vectors テーブルは TEXT vector_json ではなく pgvector の vector 型（embedding カラム）を使用。
 * - upsert は $4::vector キャストで embedding を保存する。
 * - pgvectorSearchAsync() でコサイン距離ベースのベクトル検索を提供する。
 * - すべてのメソッドは async-first（PgClientLike を直接使用）。
 */

import type { PgClientLike, PgvectorSearchResult } from "../postgres-adapter.js";
import {
  buildPgvectorSearchSql,
  formatVectorForPg,
  parsePgvectorResult,
} from "../postgres-adapter.js";
import type {
  IVectorRepository,
  VectorRow,
  UpsertVectorInput,
  VectorCoverage,
} from "./IVectorRepository.js";

// ---------------------------------------------------------------------------
// PgVectorRepository
// ---------------------------------------------------------------------------

export class PgVectorRepository implements IVectorRepository {
  /**
   * @param client     pg ライブラリの Pool / Client（PgClientLike 準拠）
   * @param dimension  ベクトル次元数（pgvectorSearchAsync の SQL 生成に使用）
   */
  constructor(
    private readonly client: PgClientLike,
    private readonly dimension: number,
  ) {}

  // -------------------------------------------------------------------------
  // upsert
  // -------------------------------------------------------------------------

  async upsert(input: UpsertVectorInput): Promise<void> {
    // vector_json を number[] に変換し pgvector 形式文字列にキャスト
    let vectorStr: string;
    try {
      const arr = JSON.parse(input.vector_json) as number[];
      vectorStr = formatVectorForPg(arr);
    } catch {
      // パース失敗時は空ベクトルとして扱う
      vectorStr = formatVectorForPg(new Array(this.dimension).fill(0));
    }

    await this.client.query(
      `INSERT INTO mem_vectors(observation_id, model, dimension, embedding, created_at, updated_at)
       VALUES ($1, $2, $3, $4::vector, $5, $6)
       ON CONFLICT(observation_id) DO UPDATE SET
         model      = EXCLUDED.model,
         dimension  = EXCLUDED.dimension,
         embedding  = EXCLUDED.embedding,
         updated_at = EXCLUDED.updated_at`,
      [
        input.observation_id,
        input.model,
        input.dimension,
        vectorStr,
        input.created_at,
        input.updated_at,
      ],
    );
  }

  // -------------------------------------------------------------------------
  // findByObservationId
  // -------------------------------------------------------------------------

  async findByObservationId(observationId: string): Promise<VectorRow | null> {
    const result = await this.client.query(
      `SELECT observation_id, model, dimension, embedding, created_at, updated_at
       FROM mem_vectors
       WHERE observation_id = $1`,
      [observationId],
    );

    if (result.rows.length === 0) return null;

    const row = result.rows[0] as {
      observation_id: string;
      model: string;
      dimension: number;
      embedding: string | null;
      created_at: Date | string;
      updated_at: Date | string;
    };
    return this._toVectorRow(row);
  }

  // -------------------------------------------------------------------------
  // findByObservationIds
  // -------------------------------------------------------------------------

  async findByObservationIds(observationIds: string[]): Promise<VectorRow[]> {
    if (observationIds.length === 0) return [];

    const MAX_BATCH = 500;
    const results: VectorRow[] = [];

    for (let offset = 0; offset < observationIds.length; offset += MAX_BATCH) {
      const batch = observationIds.slice(offset, offset + MAX_BATCH);
      // $1, $2, ... のプレースホルダーを動的生成
      const placeholders = batch.map((_, i) => `$${i + 1}`).join(", ");
      const result = await this.client.query(
        `SELECT observation_id, model, dimension, embedding, created_at, updated_at
         FROM mem_vectors
         WHERE observation_id IN (${placeholders})`,
        batch,
      );
      for (const row of result.rows as Array<{
        observation_id: string;
        model: string;
        dimension: number;
        embedding: string | null;
        created_at: Date | string;
        updated_at: Date | string;
      }>) {
        results.push(this._toVectorRow(row));
      }
    }

    return results;
  }

  // -------------------------------------------------------------------------
  // findLegacyObservationIds
  // -------------------------------------------------------------------------

  async findLegacyObservationIds(currentModel: string, limit: number): Promise<string[]> {
    const safeLimit = Math.max(1, Math.trunc(limit));
    const result = await this.client.query(
      `SELECT observation_id
       FROM mem_vectors
       WHERE model != $1
       ORDER BY updated_at ASC
       LIMIT $2`,
      [currentModel, safeLimit],
    );
    return (result.rows as Array<{ observation_id: string }>).map((r) => r.observation_id);
  }

  // -------------------------------------------------------------------------
  // coverage
  // -------------------------------------------------------------------------

  async coverage(currentModel: string): Promise<VectorCoverage> {
    const result = await this.client.query(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN model = $1 THEN 1 ELSE 0 END) AS current_model_count
       FROM mem_vectors`,
      [currentModel],
    );
    const row = (result.rows[0] ?? { total: "0", current_model_count: "0" }) as {
      total: string | number;
      current_model_count: string | number;
    };
    return {
      total: Number(row.total),
      current_model_count: Number(row.current_model_count),
    };
  }

  // -------------------------------------------------------------------------
  // delete
  // -------------------------------------------------------------------------

  async delete(observationId: string): Promise<void> {
    await this.client.query(
      `DELETE FROM mem_vectors WHERE observation_id = $1`,
      [observationId],
    );
  }

  // -------------------------------------------------------------------------
  // pgvectorSearchAsync — pgvector コサイン距離ベースのベクトル検索
  // -------------------------------------------------------------------------

  /**
   * pgvector の <=> 演算子（コサイン距離）でベクトル検索を実行する。
   *
   * @param queryVector クエリ埋め込みベクトル
   * @param limit       最大取得件数（デフォルト 50）
   * @returns           observationId と distance（0=完全一致、2=正反対）のリスト
   */
  async pgvectorSearchAsync(
    queryVector: number[],
    limit = 50,
  ): Promise<PgvectorSearchResult[]> {
    const safeLimit = Math.max(1, Math.trunc(limit));
    const sql = buildPgvectorSearchSql(this.dimension, safeLimit);
    const vectorStr = formatVectorForPg(queryVector);
    const result = await this.client.query(sql, [vectorStr]);
    return parsePgvectorResult(
      result.rows as Array<{ observation_id: string; distance: string | number }>,
    );
  }

  // -------------------------------------------------------------------------
  // プライベートヘルパー
  // -------------------------------------------------------------------------

  /**
   * DB 行を VectorRow に変換する。
   * PostgreSQL では embedding は vector 型（pg ドライバーが文字列として返す）。
   * VectorRow.vector_json には JSON 文字列を格納する。
   */
  private _toVectorRow(row: {
    observation_id: string;
    model: string;
    dimension: number;
    embedding: string | null;
    created_at: Date | string;
    updated_at: Date | string;
  }): VectorRow {
    // pg driver は pgvector の vector 型を "[0.1,0.2,...]" の文字列で返す
    // VectorRow.vector_json は JSON 配列文字列を期待するため、
    // "[...]" 形式はそのまま、それ以外は "[]" にフォールバック
    const rawEmbedding = row.embedding ?? "[]";
    // pgvector は "[0.1,0.2]" 形式（最外のブラケットはあり）を返すため
    // そのままでも JSON.parse 可能だが、念のため妥当性確認
    let vectorJson: string;
    try {
      JSON.parse(rawEmbedding);
      vectorJson = rawEmbedding;
    } catch {
      vectorJson = "[]";
    }

    const toIso = (v: Date | string): string =>
      v instanceof Date ? v.toISOString() : v;

    return {
      observation_id: row.observation_id,
      model: row.model,
      dimension: Number(row.dimension),
      vector_json: vectorJson,
      created_at: toIso(row.created_at),
      updated_at: toIso(row.updated_at),
    };
  }
}
