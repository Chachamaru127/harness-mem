/**
 * SqliteVectorRepository
 *
 * IVectorRepository の SQLite 実装。
 *
 * - sqlite-vec 拡張が利用可能な場合は model ごとの vec0 仮想テーブルを使う。
 * - 拡張が利用不可の場合は mem_vectors テーブルへの JS fallback を使う。
 * - 単数取得 API は互換のため残しつつ、内部保存は observation_id + model を主キーとする。
 */

import type { Database } from "bun:sqlite";
import type {
  IVectorRepository,
  VectorCoverage,
  VectorRow,
  UpsertVectorInput,
} from "./IVectorRepository.js";
import { deleteSqliteVecRow, upsertSqliteVecRow } from "../../vector/providers.js";

export class SqliteVectorRepository implements IVectorRepository {
  constructor(
    private readonly db: Database,
    private readonly vectorDimension: number,
    private readonly vecTableReady: boolean,
  ) {}

  async upsert(input: UpsertVectorInput): Promise<void> {
    this.db
      .query(
        `INSERT INTO mem_vectors(observation_id, model, dimension, vector_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(observation_id, model) DO UPDATE SET
           model       = excluded.model,
           dimension   = excluded.dimension,
           vector_json = excluded.vector_json,
           updated_at  = excluded.updated_at`,
      )
      .run(
        input.observation_id,
        input.model,
        input.dimension,
        input.vector_json,
        input.created_at,
        input.updated_at,
      );

    if (this.vecTableReady) {
      upsertSqliteVecRow(
        this.db,
        input.observation_id,
        input.vector_json,
        input.updated_at,
        {
          model: input.model,
          vectorDimension: input.dimension || this.vectorDimension,
        },
      );
    }
  }

  async findByObservationId(observationId: string): Promise<VectorRow | null> {
    const row = this.db
      .query<VectorRow, [string]>(
        `SELECT observation_id, model, dimension, vector_json, created_at, updated_at
         FROM mem_vectors
         WHERE observation_id = ?
         ORDER BY updated_at DESC, model ASC
         LIMIT 1`,
      )
      .get(observationId);
    return row ?? null;
  }

  async findAllByObservationId(observationId: string): Promise<VectorRow[]> {
    return this.db
      .query<VectorRow, [string]>(
        `SELECT observation_id, model, dimension, vector_json, created_at, updated_at
         FROM mem_vectors
         WHERE observation_id = ?
         ORDER BY updated_at DESC, model ASC`,
      )
      .all(observationId);
  }

  async findByObservationIdAndModel(
    observationId: string,
    model: string,
  ): Promise<VectorRow | null> {
    const row = this.db
      .query<VectorRow, [string, string]>(
        `SELECT observation_id, model, dimension, vector_json, created_at, updated_at
         FROM mem_vectors
         WHERE observation_id = ?
           AND model = ?
         LIMIT 1`,
      )
      .get(observationId, model);
    return row ?? null;
  }

  async findByObservationIds(observationIds: string[]): Promise<VectorRow[]> {
    if (observationIds.length === 0) return [];

    const MAX_BATCH = 500;
    const results: VectorRow[] = [];

    for (let offset = 0; offset < observationIds.length; offset += MAX_BATCH) {
      const batch = observationIds.slice(offset, offset + MAX_BATCH);
      const placeholders = batch.map(() => "?").join(", ");
      const rows = this.db
        .query<VectorRow, string[]>(
          `SELECT observation_id, model, dimension, vector_json, created_at, updated_at
           FROM mem_vectors
           WHERE observation_id IN (${placeholders})
           ORDER BY observation_id ASC, updated_at DESC, model ASC`,
        )
        .all(...batch);
      results.push(...rows);
    }

    return results;
  }

  async findLegacyObservationIds(currentModel: string, limit: number): Promise<string[]> {
    const safeLimit = Math.max(1, Math.trunc(limit));
    const rows = this.db
      .query<{ observation_id: string }, [string, number]>(
        `SELECT observation_id
         FROM mem_vectors
         GROUP BY observation_id
         HAVING SUM(CASE WHEN model = ? THEN 1 ELSE 0 END) = 0
         ORDER BY MIN(updated_at) ASC
         LIMIT ?`,
      )
      .all(currentModel, safeLimit);
    return rows.map((row) => row.observation_id);
  }

  async coverage(currentModel: string): Promise<VectorCoverage> {
    const row = this.db
      .query<{ total: number; current_model_count: number }, [string]>(
        `SELECT
           COUNT(DISTINCT observation_id) AS total,
           COUNT(DISTINCT CASE WHEN model = ? THEN observation_id END) AS current_model_count
         FROM mem_vectors`,
      )
      .get(currentModel);

    return {
      total: Number(row?.total ?? 0),
      current_model_count: Number(row?.current_model_count ?? 0),
    };
  }

  async delete(observationId: string): Promise<void> {
    const models = this.db
      .query<{ model: string }, [string]>(
        `SELECT model
         FROM mem_vectors
         WHERE observation_id = ?`,
      )
      .all(observationId)
      .map((row) => row.model);

    this.db
      .query(`DELETE FROM mem_vectors WHERE observation_id = ?`)
      .run(observationId);

    if (this.vecTableReady) {
      deleteSqliteVecRow(this.db, observationId);
      for (const model of models) {
        deleteSqliteVecRow(this.db, observationId, model);
      }
    }
  }
}
