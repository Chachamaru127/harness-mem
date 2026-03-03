/**
 * IVectorRepository
 *
 * ベクトル埋め込みデータの永続化に関する async-first リポジトリインターフェース。
 */

// ---------------------------------------------------------------------------
// 行型定義
// ---------------------------------------------------------------------------

export interface VectorRow {
  observation_id: string;
  model: string;
  dimension: number;
  vector_json: string;
  created_at: string;
  updated_at: string;
}

export interface UpsertVectorInput {
  observation_id: string;
  model: string;
  dimension: number;
  vector_json: string;
  created_at: string;
  updated_at: string;
}

export interface VectorCoverage {
  total: number;
  current_model_count: number;
}

// ---------------------------------------------------------------------------
// インターフェース
// ---------------------------------------------------------------------------

export interface IVectorRepository {
  /**
   * ベクトルを upsert する（observation_id が主キー）。
   */
  upsert(input: UpsertVectorInput): Promise<void>;

  /**
   * observation_id でベクトルを取得する。存在しない場合は null。
   */
  findByObservationId(observationId: string): Promise<VectorRow | null>;

  /**
   * 複数の observation_id でベクトルをまとめて取得する。
   */
  findByObservationIds(observationIds: string[]): Promise<VectorRow[]>;

  /**
   * 指定モデルと異なるモデルのベクトルを持つ観察 ID を返す（再インデックス対象）。
   * @param currentModel 現在のモデル名
   * @param limit 最大取得件数
   */
  findLegacyObservationIds(currentModel: string, limit: number): Promise<string[]>;

  /**
   * ベクトルの総数と現在モデルのカバレッジを返す。
   */
  coverage(currentModel: string): Promise<VectorCoverage>;

  /**
   * observation_id でベクトルを削除する（観察削除時のカスケード対応）。
   */
  delete(observationId: string): Promise<void>;
}
