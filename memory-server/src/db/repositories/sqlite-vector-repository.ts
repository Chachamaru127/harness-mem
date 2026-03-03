/**
 * SqliteVectorRepository
 *
 * IVectorRepository の SQLite 実装。
 *
 * - sqlite-vec 拡張が利用可能な場合はネイティブ vec0 仮想テーブルを使用。
 * - 拡張が利用不可の場合は mem_vectors テーブルへの JS fallback（コサイン類似度）を使用。
 * - エンジン切り替えは外部から透過的（呼び出し元はエンジン種別を意識しない）。
 */

import type { Database } from "bun:sqlite";
import type {
  IVectorRepository,
  VectorRow,
  UpsertVectorInput,
  VectorCoverage,
} from "./IVectorRepository.js";

// ---------------------------------------------------------------------------
// SqliteVectorRepository
// ---------------------------------------------------------------------------

export class SqliteVectorRepository implements IVectorRepository {
  /**
   * @param db             bun:sqlite Database インスタンス
   * @param vectorDimension ベクトル次元数（sqlite-vec 仮想テーブル作成に使用）
   * @param vecTableReady  sqlite-vec 仮想テーブルが利用可能か否か（外部から注入）
   */
  constructor(
    private readonly db: Database,
    private readonly vectorDimension: number,
    private readonly vecTableReady: boolean,
  ) {}

  // -------------------------------------------------------------------------
  // upsert
  // -------------------------------------------------------------------------

  async upsert(input: UpsertVectorInput): Promise<void> {
    // mem_vectors（JS fallback 用の通常テーブル）に常に書き込む
    this.db
      .query(
        `INSERT INTO mem_vectors(observation_id, model, dimension, vector_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(observation_id) DO UPDATE SET
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

    // sqlite-vec が使える場合は仮想テーブルにも書き込む
    if (this.vecTableReady) {
      this._upsertVecRow(input.observation_id, input.vector_json, input.updated_at);
    }
  }

  // -------------------------------------------------------------------------
  // findByObservationId
  // -------------------------------------------------------------------------

  async findByObservationId(observationId: string): Promise<VectorRow | null> {
    const row = this.db
      .query<VectorRow, [string]>(
        `SELECT observation_id, model, dimension, vector_json, created_at, updated_at
         FROM mem_vectors
         WHERE observation_id = ?`,
      )
      .get(observationId);
    return row ?? null;
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
      const placeholders = batch.map(() => "?").join(", ");
      const rows = this.db
        .query<VectorRow, string[]>(
          `SELECT observation_id, model, dimension, vector_json, created_at, updated_at
           FROM mem_vectors
           WHERE observation_id IN (${placeholders})`,
        )
        .all(...batch);
      results.push(...rows);
    }

    return results;
  }

  // -------------------------------------------------------------------------
  // findLegacyObservationIds
  // -------------------------------------------------------------------------

  async findLegacyObservationIds(currentModel: string, limit: number): Promise<string[]> {
    const safeLimit = Math.max(1, Math.trunc(limit));
    const rows = this.db
      .query<{ observation_id: string }, [string, number]>(
        `SELECT observation_id
         FROM mem_vectors
         WHERE model != ?
         ORDER BY updated_at ASC
         LIMIT ?`,
      )
      .all(currentModel, safeLimit);
    return rows.map((r) => r.observation_id);
  }

  // -------------------------------------------------------------------------
  // coverage
  // -------------------------------------------------------------------------

  async coverage(currentModel: string): Promise<VectorCoverage> {
    const row = this.db
      .query<{ total: number; current_model_count: number }, [string]>(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN model = ? THEN 1 ELSE 0 END) AS current_model_count
         FROM mem_vectors`,
      )
      .get(currentModel);

    return {
      total: Number(row?.total ?? 0),
      current_model_count: Number(row?.current_model_count ?? 0),
    };
  }

  // -------------------------------------------------------------------------
  // delete
  // -------------------------------------------------------------------------

  async delete(observationId: string): Promise<void> {
    // mem_vectors からの削除（カスケード制約があるが明示削除）
    this.db
      .query(`DELETE FROM mem_vectors WHERE observation_id = ?`)
      .run(observationId);

    // sqlite-vec 仮想テーブル側も削除
    if (this.vecTableReady) {
      try {
        const mapRow = this.db
          .query<{ rowid: number }, [string]>(
            `SELECT rowid FROM mem_vectors_vec_map WHERE observation_id = ?`,
          )
          .get(observationId);
        if (mapRow) {
          this.db
            .query(`DELETE FROM mem_vectors_vec WHERE rowid = ?`)
            .run(mapRow.rowid);
          this.db
            .query(`DELETE FROM mem_vectors_vec_map WHERE rowid = ?`)
            .run(mapRow.rowid);
        }
      } catch {
        // vec テーブルが存在しない環境では無視
      }
    }
  }

  // -------------------------------------------------------------------------
  // プライベートヘルパー: sqlite-vec 仮想テーブルへの upsert
  // -------------------------------------------------------------------------

  private _upsertVecRow(
    observationId: string,
    vectorJson: string,
    updatedAt: string,
  ): void {
    try {
      const mapRow = this.db
        .query<{ rowid: number }, [string]>(
          `SELECT rowid FROM mem_vectors_vec_map WHERE observation_id = ?`,
        )
        .get(observationId);

      if (mapRow) {
        this.db
          .query(`INSERT OR REPLACE INTO mem_vectors_vec(rowid, embedding) VALUES (?, ?)`)
          .run(mapRow.rowid, vectorJson);
        this.db
          .query(`UPDATE mem_vectors_vec_map SET updated_at = ? WHERE rowid = ?`)
          .run(updatedAt, mapRow.rowid);
      } else {
        this.db
          .query(`INSERT INTO mem_vectors_vec(embedding) VALUES (?)`)
          .run(vectorJson);
        const lastRow = this.db
          .query<{ rowid: number }, []>(`SELECT last_insert_rowid() AS rowid`)
          .get();
        if (lastRow) {
          this.db
            .query(
              `INSERT OR REPLACE INTO mem_vectors_vec_map(rowid, observation_id, updated_at)
               VALUES (?, ?, ?)`,
            )
            .run(lastRow.rowid, observationId, updatedAt);
        }
      }
    } catch {
      // sqlite-vec 操作が失敗しても mem_vectors への書き込みは成功済み
    }
  }
}
