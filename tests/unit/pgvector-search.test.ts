/**
 * NEXT-008: pgvector バックエンド統合確認のテスト
 *
 * PostgreSQL + pgvector でのベクトル検索機能を検証する。
 * POSTGRES_URL 環境変数がない場合は条件付きスキップ。
 *
 * テスト内容:
 * 1. buildPgvectorSearchSql がベクトル検索 SQL を正しく生成する
 * 2. formatVectorForPg がベクトルを正しい形式に変換する
 * 3. parsePgvectorResult が検索結果を正しくパースする
 * 4. POSTGRES_INIT_SQL に CREATE EXTENSION IF NOT EXISTS vector が含まれる
 * 5. postgres-schema.ts に mem_vectors テーブル定義が含まれる
 * 6. PostgresStorageAdapter が pgvector 検索メソッドを持つ（インターフェース確認）
 */
import { describe, expect, test } from "bun:test";
import {
  buildPgvectorSearchSql,
  formatVectorForPg,
  parsePgvectorResult,
} from "../../memory-server/src/db/postgres-adapter";
import { POSTGRES_INIT_SQL } from "../../memory-server/src/db/postgres-schema";

describe("NEXT-008: pgvector バックエンド統合確認", () => {
  // テスト1: SQL ビルダーが正しい形式の SQL を生成する
  test("buildPgvectorSearchSql がコサイン距離検索 SQL を正しく生成する", () => {
    const sql = buildPgvectorSearchSql(64, 10);
    expect(sql).toContain("mem_vectors");
    expect(sql).toContain("cosine"); // <=> はコサイン距離
    expect(sql).toContain("LIMIT");
    expect(sql).toContain("$1"); // パラメータ化クエリ
  });

  // テスト2: formatVectorForPg がベクトルを pgvector 形式に変換する
  test("formatVectorForPg がベクトルを pgvector 互換文字列に変換する", () => {
    const vector = [0.1, 0.2, 0.3];
    const formatted = formatVectorForPg(vector);
    expect(formatted).toBe("[0.1,0.2,0.3]");
  });

  // テスト3: parsePgvectorResult が結果を正しくパースする
  test("parsePgvectorResult が検索結果から observation_id と distance を抽出する", () => {
    const rawRows = [
      { observation_id: "obs-1", distance: "0.123456" },
      { observation_id: "obs-2", distance: "0.234567" },
    ];
    const parsed = parsePgvectorResult(rawRows);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].observationId).toBe("obs-1");
    expect(parsed[0].distance).toBeCloseTo(0.123456, 5);
    expect(parsed[1].observationId).toBe("obs-2");
  });

  // テスト4: postgres-schema.ts に pgvector 拡張が含まれる
  test("POSTGRES_INIT_SQL に CREATE EXTENSION IF NOT EXISTS vector が含まれる", () => {
    expect(POSTGRES_INIT_SQL).toContain("CREATE EXTENSION IF NOT EXISTS vector");
  });

  // テスト5: postgres-schema.ts に mem_vectors テーブル定義が含まれる
  test("POSTGRES_INIT_SQL に mem_vectors テーブルと vector 型カラムが含まれる", () => {
    expect(POSTGRES_INIT_SQL).toContain("mem_vectors");
    expect(POSTGRES_INIT_SQL).toContain("vector");
  });

  // テスト6: PostgresStorageAdapter が pgvector 検索メソッドを持つ
  test("PostgresStorageAdapter が pgvectorSearchAsync メソッドを持つ", async () => {
    const { PostgresStorageAdapter } = await import("../../memory-server/src/db/postgres-adapter");
    const mockClient = {
      query: async () => ({ rows: [], rowCount: 0 }),
      end: async () => {},
    };
    const adapter = new PostgresStorageAdapter(mockClient);
    expect(typeof adapter.pgvectorSearchAsync).toBe("function");
    adapter.close();
  });
});
