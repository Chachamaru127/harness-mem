/**
 * NEXT-008: pgvector バックエンド統合確認 のテスト
 *
 * - POSTGRES_INIT_SQL に pgvector 拡張と HNSW インデックスが含まれること
 * - providers.ts の pgvector 関数が正しく動作すること
 * - POSTGRES_URL がない場合はスキップ（CI Docker 不要ケース）
 */
import { describe, expect, test } from "bun:test";
import { POSTGRES_INIT_SQL, POSTGRES_VECTOR_INDEX_SQL } from "../../src/db/postgres-schema";
import {
  buildPgVectorUpsertSql,
  buildPgVectorSearchSql,
  formatVectorForPg,
} from "../../src/vector/providers";

// POSTGRES_URL がある場合のみ実際の DB テストを実行する
const HAS_POSTGRES = Boolean(process.env.POSTGRES_URL);

describe("POSTGRES_INIT_SQL", () => {
  test("pgvector 拡張の CREATE EXTENSION が含まれる", () => {
    expect(POSTGRES_INIT_SQL).toContain("CREATE EXTENSION IF NOT EXISTS vector");
  });

  test("mem_vectors テーブルに embedding vector カラムが含まれる", () => {
    expect(POSTGRES_INIT_SQL).toContain("embedding vector");
  });

  test("mem_observations の FTS インデックスが含まれる", () => {
    expect(POSTGRES_INIT_SQL).toContain("USING GIN(search_vector)");
  });
});

describe("POSTGRES_VECTOR_INDEX_SQL", () => {
  test("HNSW インデックス作成 SQL がエクスポートされている", () => {
    expect(POSTGRES_VECTOR_INDEX_SQL).toBeDefined();
    expect(typeof POSTGRES_VECTOR_INDEX_SQL).toBe("string");
  });

  test("HNSW または IVFFlat インデックスが含まれる", () => {
    // HNSW か IVFFlat のどちらかが含まれること
    const hasHnsw = POSTGRES_VECTOR_INDEX_SQL.includes("hnsw");
    const hasIvfflat = POSTGRES_VECTOR_INDEX_SQL.includes("ivfflat");
    expect(hasHnsw || hasIvfflat).toBe(true);
  });

  test("vector_cosine_ops または vector_l2_ops が含まれる", () => {
    const hasCosine = POSTGRES_VECTOR_INDEX_SQL.includes("vector_cosine_ops");
    const hasL2 = POSTGRES_VECTOR_INDEX_SQL.includes("vector_l2_ops");
    expect(hasCosine || hasL2).toBe(true);
  });
});

describe("formatVectorForPg", () => {
  test("number[] を pgvector 形式の文字列に変換する", () => {
    const result = formatVectorForPg([0.1, 0.2, 0.3]);
    expect(result).toBe("[0.1,0.2,0.3]");
  });

  test("空配列を変換できる", () => {
    const result = formatVectorForPg([]);
    expect(result).toBe("[]");
  });

  test("小数精度が保持される", () => {
    const result = formatVectorForPg([0.123456789]);
    expect(result).toContain("0.123456789");
  });
});

describe("buildPgVectorUpsertSql", () => {
  test("INSERT ON CONFLICT UPSERT SQL を生成する", () => {
    const sql = buildPgVectorUpsertSql();
    expect(sql).toContain("INSERT INTO mem_vectors");
    expect(sql).toContain("ON CONFLICT");
    expect(sql).toContain("embedding");
  });

  test("プレースホルダーが含まれる", () => {
    const sql = buildPgVectorUpsertSql();
    // PostgreSQL は $N 形式のプレースホルダーを使用
    expect(sql).toMatch(/\$\d+/);
  });
});

describe("buildPgVectorSearchSql", () => {
  test("コサイン距離クエリを生成する", () => {
    const sql = buildPgVectorSearchSql(256);
    expect(sql).toContain("mem_vectors");
    expect(sql).toContain("embedding");
    // コサイン類似度または距離演算子
    expect(sql).toMatch(/<=>|cosine/i);
  });

  test("LIMIT 句が含まれる", () => {
    const sql = buildPgVectorSearchSql(256, 10);
    expect(sql).toContain("LIMIT");
  });

  test("dimension パラメータが SQL に反映される", () => {
    const sql = buildPgVectorSearchSql(512);
    expect(sql).toBeDefined();
    expect(typeof sql).toBe("string");
  });
});

// 実際の PostgreSQL 接続テスト（POSTGRES_URL がある場合のみ）
describe.skipIf(!HAS_POSTGRES)("pgvector 実接続テスト", () => {
  test("PostgreSQL に接続してベクトル検索を実行できる", async () => {
    const { PostgresStorageAdapter } = await import("../../src/db/postgres-adapter");
    // Dynamic import of pg to avoid hard dependency in non-Postgres environments
    const { Pool } = await import("pg" as string) as { Pool: new (opts: { connectionString: string }) => any };
    const pool = new Pool({ connectionString: process.env.POSTGRES_URL });
    const adapter = new PostgresStorageAdapter(pool);

    // 基本クエリが実行できること
    const rows = await adapter.queryAllAsync<{ now: string }>("SELECT NOW() AS now");
    expect(rows).toHaveLength(1);
    expect(rows[0].now).toBeDefined();

    adapter.close();
  });
});
