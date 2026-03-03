/**
 * db/repositories - Repository インターフェース群
 *
 * async-first な永続化抽象レイヤー。
 * 実装クラス（SQLite / PostgreSQL 等）は別モジュールで提供する。
 */

export type {
  ObservationRow,
  InsertObservationInput,
  FindObservationsFilter,
  IObservationRepository,
} from "./IObservationRepository.js";
export { SqliteObservationRepository } from "./SqliteObservationRepository.js";

export type {
  SessionRow,
  UpsertSessionInput,
  FinalizeSessionInput,
  FindSessionsFilter,
  ISessionRepository,
} from "./ISessionRepository.js";
export { SqliteSessionRepository } from "./sqlite-session-repository.js";

export type {
  VectorRow,
  UpsertVectorInput,
  VectorCoverage,
  IVectorRepository,
} from "./IVectorRepository.js";
export { SqliteVectorRepository } from "./sqlite-vector-repository.js";
