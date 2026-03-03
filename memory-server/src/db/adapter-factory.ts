/**
 * adapter-factory.ts - creates the appropriate StorageAdapter based on config.
 *
 * All modes use SQLite for synchronous reads (local cache).
 * ManagedBackend (separate layer) handles async PostgreSQL replication.
 *
 * managed mode: SQLite is local cache ONLY. Write SoT is PostgreSQL via ManagedBackend.
 *               HarnessMemCore MUST verify ManagedBackend is connected before treating
 *               writes as durable.
 *
 * PG-005: When HARNESS_MEM_PG_URL is set, createRepositories() returns Pg*Repository
 *         instances backed by a PostgresStorageAdapter. Otherwise SQLite repositories
 *         are returned. This allows ObservationStore / SessionManager to receive the
 *         correct Repository via DI without knowing which backend is in use.
 */
import type { Database } from "bun:sqlite";
import type { StorageAdapter, StorageAdapterConfig } from "./storage-adapter";
import { SqliteStorageAdapter } from "./sqlite-adapter";
import type { IObservationRepository } from "./repositories/IObservationRepository.js";
import type { ISessionRepository } from "./repositories/ISessionRepository.js";
import type { IVectorRepository } from "./repositories/IVectorRepository.js";
import { SqliteObservationRepository } from "./repositories/SqliteObservationRepository.js";
import { SqliteSessionRepository } from "./repositories/sqlite-session-repository.js";
import { SqliteVectorRepository } from "./repositories/sqlite-vector-repository.js";

export interface AdapterFactoryResult {
  adapter: StorageAdapter;
  /** True when managed backend MUST be connected for writes to be considered durable. */
  managedRequired: boolean;
}

export function createStorageAdapter(config: StorageAdapterConfig): AdapterFactoryResult {
  switch (config.backendMode) {
    case "local":
    case "hybrid":
      if (!config.dbPath) {
        throw new Error("dbPath is required for local/hybrid backend mode");
      }
      return {
        adapter: new SqliteStorageAdapter(config.dbPath),
        managedRequired: false,
      };

    case "managed":
      if (!config.dbPath) {
        throw new Error("dbPath is required (local cache) for managed backend mode");
      }
      if (!config.managedEndpoint) {
        throw new Error(
          "managedEndpoint is required for managed backend mode. " +
          "Set HARNESS_MEM_MANAGED_ENDPOINT or configure managed.endpoint in config.json"
        );
      }
      return {
        adapter: new SqliteStorageAdapter(config.dbPath),
        managedRequired: true,
      };

    default:
      throw new Error(`Unknown backend mode: ${config.backendMode}`);
  }
}

// ---------------------------------------------------------------------------
// PG-005: Repository bundle
// ---------------------------------------------------------------------------

/**
 * Repository セット — ObservationStore / SessionManager へ DI で注入される。
 */
export interface RepositoryBundle {
  observation: IObservationRepository;
  session: ISessionRepository;
  vector: IVectorRepository;
}

/**
 * `HARNESS_MEM_PG_URL` が設定されている場合は PostgreSQL Repository を返す。
 * 未設定の場合は SQLite Repository を返す。
 *
 * @param db           SQLite Database インスタンス（SQLite モード時に使用）
 * @param pgUrl        PostgreSQL 接続文字列。省略時は環境変数 `HARNESS_MEM_PG_URL` を参照。
 * @param vectorDimension  ベクトル次元数（PgVectorRepository の pgvector 検索 SQL 生成に使用）
 */
export function createRepositories(
  db: Database,
  pgUrl?: string,
  vectorDimension = 1536,
): RepositoryBundle {
  const envPgUrl = (process.env.HARNESS_MEM_PG_URL ?? "").trim() || undefined;
  const resolvedPgUrl = pgUrl !== undefined ? pgUrl : envPgUrl;

  if (resolvedPgUrl) {
    return createPgRepositories(resolvedPgUrl, vectorDimension);
  }

  return createSqliteRepositories(db, vectorDimension);
}

/**
 * SQLite バックエンド用 RepositoryBundle を生成する。
 *
 * @param vecTableReady  sqlite-vec 仮想テーブルが利用可能か否か。
 *                       初期化タイミングでは不明なため false を渡し、
 *                       HarnessMemCore.initVectorEngine() 後に setVecTableReady() で更新される。
 */
function createSqliteRepositories(db: Database, vectorDimension: number, vecTableReady = false): RepositoryBundle {
  return {
    observation: new SqliteObservationRepository(db),
    session: new SqliteSessionRepository(db),
    vector: new SqliteVectorRepository(db, vectorDimension, vecTableReady),
  };
}

/**
 * PostgreSQL バックエンド用 RepositoryBundle を生成する。
 *
 * `pg` パッケージは動的インポートで読み込む。
 * Docker なしでテストできるよう、pgUrl の形式チェックのみ行い
 * 実接続は repository のメソッド呼び出し時まで遅延する。
 *
 * @throws {Error} `pg` パッケージが見つからない場合
 */
function createPgRepositories(pgUrl: string, vectorDimension: number): RepositoryBundle {
  // 循環 import を避けるため、PG 実装クラスはここで初めて import する。
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { PostgresStorageAdapter } = require("./postgres-adapter.js") as typeof import("./postgres-adapter.js");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { PgObservationRepository } = require("./repositories/PgObservationRepository.js") as typeof import("./repositories/PgObservationRepository.js");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { PgSessionRepository } = require("./repositories/PgSessionRepository.js") as typeof import("./repositories/PgSessionRepository.js");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { PgVectorRepository } = require("./repositories/PgVectorRepository.js") as typeof import("./repositories/PgVectorRepository.js");

  // pg パッケージを動的に require する。インストールされていない場合は明示的エラーを出す。
  let Pool: { new(options: { connectionString: string }): import("./postgres-adapter.js").PgClientLike };
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pg = require("pg") as { Pool: typeof Pool };
    Pool = pg.Pool;
  } catch {
    throw new Error(
      "HARNESS_MEM_PG_URL が設定されていますが pg パッケージが見つかりません。" +
      " `npm install pg` または `bun add pg` を実行してください。"
    );
  }

  const client = new Pool({ connectionString: pgUrl });
  const pgAdapter = new PostgresStorageAdapter(client);

  return {
    observation: new PgObservationRepository(pgAdapter),
    session: new PgSessionRepository(pgAdapter),
    vector: new PgVectorRepository(client, vectorDimension),
  };
}
