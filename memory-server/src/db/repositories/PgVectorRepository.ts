/**
 * PgVectorRepository
 *
 * IVectorRepository の PostgreSQL + pgvector 実装。
 *
 * - mem_vectors は observation_id + model を複合主キーとして扱う。
 * - 単数取得 API は互換のため残し、複数モデルがある場合は最新行を返す。
 * - pgvectorSearchAsync() は model / dimension 条件で絞り込める。
 */

import type { PgClientLike, PgvectorSearchResult } from "../postgres-adapter.js";
import { formatVectorForPg, parsePgvectorResult } from "../postgres-adapter.js";
import type {
  IVectorRepository,
  VectorCoverage,
  VectorRow,
  UpsertVectorInput,
} from "./IVectorRepository.js";

type PgVectorDbRow = {
  observation_id: string;
  model: string;
  dimension: number;
  embedding: string | null;
  created_at: Date | string;
  updated_at: Date | string;
};

export class PgVectorRepository implements IVectorRepository {
  constructor(
    private readonly client: PgClientLike,
    private readonly dimension: number,
  ) {}

  async upsert(input: UpsertVectorInput): Promise<void> {
    let vectorStr: string;
    try {
      const arr = JSON.parse(input.vector_json) as number[];
      vectorStr = formatVectorForPg(arr);
    } catch {
      vectorStr = formatVectorForPg(new Array(this.dimension).fill(0));
    }

    await this.client.query(
      `INSERT INTO mem_vectors(observation_id, model, dimension, embedding, created_at, updated_at)
       VALUES ($1, $2, $3, $4::vector, $5, $6)
       ON CONFLICT(observation_id, model) DO UPDATE SET
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

  async findByObservationId(observationId: string): Promise<VectorRow | null> {
    const result = await this.client.query(
      `SELECT observation_id, model, dimension, embedding, created_at, updated_at
       FROM mem_vectors
       WHERE observation_id = $1
       ORDER BY updated_at DESC, model ASC
       LIMIT 1`,
      [observationId],
    );

    if (result.rows.length === 0) return null;
    return this._toVectorRow(result.rows[0] as PgVectorDbRow);
  }

  async findAllByObservationId(observationId: string): Promise<VectorRow[]> {
    const result = await this.client.query(
      `SELECT observation_id, model, dimension, embedding, created_at, updated_at
       FROM mem_vectors
       WHERE observation_id = $1
       ORDER BY updated_at DESC, model ASC`,
      [observationId],
    );

    return (result.rows as PgVectorDbRow[]).map((row) => this._toVectorRow(row));
  }

  async findByObservationIdAndModel(
    observationId: string,
    model: string,
  ): Promise<VectorRow | null> {
    const result = await this.client.query(
      `SELECT observation_id, model, dimension, embedding, created_at, updated_at
       FROM mem_vectors
       WHERE observation_id = $1
         AND model = $2
       LIMIT 1`,
      [observationId, model],
    );

    if (result.rows.length === 0) return null;
    return this._toVectorRow(result.rows[0] as PgVectorDbRow);
  }

  async findByObservationIds(observationIds: string[]): Promise<VectorRow[]> {
    if (observationIds.length === 0) return [];

    const MAX_BATCH = 500;
    const results: VectorRow[] = [];

    for (let offset = 0; offset < observationIds.length; offset += MAX_BATCH) {
      const batch = observationIds.slice(offset, offset + MAX_BATCH);
      const placeholders = batch.map((_, i) => `$${i + 1}`).join(", ");
      const result = await this.client.query(
        `SELECT observation_id, model, dimension, embedding, created_at, updated_at
         FROM mem_vectors
         WHERE observation_id IN (${placeholders})
         ORDER BY observation_id ASC, updated_at DESC, model ASC`,
        batch,
      );
      for (const row of result.rows as PgVectorDbRow[]) {
        results.push(this._toVectorRow(row));
      }
    }

    return results;
  }

  async findLegacyObservationIds(currentModel: string, limit: number): Promise<string[]> {
    const safeLimit = Math.max(1, Math.trunc(limit));
    const result = await this.client.query(
      `SELECT observation_id
       FROM mem_vectors
       GROUP BY observation_id
       HAVING SUM(CASE WHEN model = $1 THEN 1 ELSE 0 END) = 0
       ORDER BY MIN(updated_at) ASC
       LIMIT $2`,
      [currentModel, safeLimit],
    );
    return (result.rows as Array<{ observation_id: string }>).map((row) => row.observation_id);
  }

  async coverage(currentModel: string): Promise<VectorCoverage> {
    const result = await this.client.query(
      `SELECT
         COUNT(DISTINCT observation_id) AS total,
         COUNT(DISTINCT CASE WHEN model = $1 THEN observation_id END) AS current_model_count
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

  async delete(observationId: string): Promise<void> {
    await this.client.query(
      `DELETE FROM mem_vectors WHERE observation_id = $1`,
      [observationId],
    );
  }

  async pgvectorSearchAsync(
    queryVector: number[],
    limit = 50,
    model?: string,
  ): Promise<PgvectorSearchResult[]> {
    const safeLimit = Math.max(1, Math.trunc(limit));
    const safeDimension = Math.max(1, Math.trunc(queryVector.length || this.dimension));
    const filters = ["v.dimension = $2"];
    const params: unknown[] = [formatVectorForPg(queryVector), safeDimension];

    if (model) {
      filters.push(`v.model = $${params.length + 1}`);
      params.push(model);
    }

    const sql = `
      SELECT
        v.observation_id,
        (v.embedding <=> $1::vector(${safeDimension})) AS distance
      FROM mem_vectors v
      WHERE ${filters.join(" AND ")}
      ORDER BY distance ASC
      LIMIT ${safeLimit}
    `.trim();

    const result = await this.client.query(sql, params);
    return parsePgvectorResult(
      result.rows as Array<{ observation_id: string; distance: string | number }>,
    );
  }

  private _toVectorRow(row: PgVectorDbRow): VectorRow {
    const rawEmbedding = row.embedding ?? "[]";
    let vectorJson: string;
    try {
      JSON.parse(rawEmbedding);
      vectorJson = rawEmbedding;
    } catch {
      vectorJson = "[]";
    }

    const toIso = (value: Date | string): string =>
      value instanceof Date ? value.toISOString() : value;

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
