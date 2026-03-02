/**
 * NEXT-008 / HARDEN-004: pgvector バックエンド統合確認のテスト
 *
 * PostgreSQL + pgvector でのベクトル検索機能を検証する。
 * POSTGRES_URL 環境変数がない場合は統合テストをスキップ。
 *
 * テスト内容:
 * 1. buildPgvectorSearchSql がベクトル検索 SQL を正しく生成する
 * 2. formatVectorForPg がベクトルを正しい形式に変換する
 * 3. parsePgvectorResult が検索結果を正しくパースする
 * 4. POSTGRES_INIT_SQL に CREATE EXTENSION IF NOT EXISTS vector が含まれる
 * 5. postgres-schema.ts に mem_vectors テーブル定義が含まれる
 * 6. PostgresStorageAdapter が pgvector 検索メソッドを持つ（インターフェース確認）
 *
 * HARDEN-004 統合テスト (POSTGRES_URL 必須):
 * I1. DDL 適用 → エラーなし
 * I2. ベクトル INSERT + 検索 → 最近傍が先頭
 * I3. 直交ベクトル [1,0,0] vs [0,1,0] → distance ≈ 1.0
 * I4. 大量データ 100件 → LIMIT 10 返却
 */
import { describe, expect, test } from "bun:test";
import {
  buildPgvectorSearchSql,
  formatVectorForPg,
  parsePgvectorResult,
  PostgresStorageAdapter,
} from "../../memory-server/src/db/postgres-adapter";
import { POSTGRES_INIT_SQL } from "../../memory-server/src/db/postgres-schema";

const HAS_POSTGRES = !!process.env.POSTGRES_URL;

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
    const mockClient = {
      query: async () => ({ rows: [], rowCount: 0 }),
      end: async () => {},
    };
    const adapter = new PostgresStorageAdapter(mockClient);
    expect(typeof adapter.pgvectorSearchAsync).toBe("function");
    adapter.close();
  });
});

describe.skipIf(!HAS_POSTGRES)("HARDEN-004: pgvector Docker CI 統合テスト", () => {
  /**
   * pg クライアントを動的 import して接続を確立する。
   * POSTGRES_URL が未設定の場合はこの describe ブロック全体がスキップされる。
   */
  async function connect(): Promise<import("pg").Client> {
    const { Client } = await import("pg");
    const client = new Client({ connectionString: process.env.POSTGRES_URL });
    await client.connect();
    return client;
  }

  // テスト I1: DDL 適用 → エラーなし
  test("POSTGRES_INIT_SQL を実行してスキーマを初期化できる", async () => {
    const client = await connect();
    try {
      await client.query(POSTGRES_INIT_SQL);
      // エラーなく完了すれば OK
    } finally {
      await client.end();
    }
  });

  // テスト I2: ベクトル INSERT + 検索 → 最近傍が先頭
  test("ベクトルを INSERT して類似検索で最近傍が先頭に返る", async () => {
    const client = await connect();
    try {
      // スキーマ初期化
      await client.query(POSTGRES_INIT_SQL);

      // テスト用の一時テーブル（mem_vectors と同構造）
      await client.query(`
        CREATE TEMP TABLE IF NOT EXISTS test_vectors_i2 (
          observation_id TEXT PRIMARY KEY,
          embedding vector(3)
        )
      `);
      await client.query("TRUNCATE test_vectors_i2");

      // 3件のベクトルを INSERT
      await client.query(
        "INSERT INTO test_vectors_i2 (observation_id, embedding) VALUES ($1, $2::vector(3))",
        ["obs-far", "[0,0,1]"]
      );
      await client.query(
        "INSERT INTO test_vectors_i2 (observation_id, embedding) VALUES ($1, $2::vector(3))",
        ["obs-near", "[1,0,0]"]
      );
      await client.query(
        "INSERT INTO test_vectors_i2 (observation_id, embedding) VALUES ($1, $2::vector(3))",
        ["obs-mid", "[0.7,0.7,0]"]
      );

      // クエリベクトル [1,0,0] に最も近い obs-near が先頭に来ること
      const result = await client.query(
        `SELECT observation_id, (embedding <=> $1::vector(3)) AS distance
         FROM test_vectors_i2
         ORDER BY distance ASC
         LIMIT 3`,
        ["[1,0,0]"]
      );
      expect(result.rows[0].observation_id).toBe("obs-near");
      expect(parseFloat(result.rows[0].distance)).toBeCloseTo(0, 5);
    } finally {
      await client.end();
    }
  });

  // テスト I3: 直交ベクトル [1,0,0] vs [0,1,0] → distance ≈ 1.0
  test("直交ベクトル同士のコサイン距離が 1.0 に近い", async () => {
    const client = await connect();
    try {
      await client.query(`
        CREATE TEMP TABLE IF NOT EXISTS test_vectors_i3 (
          observation_id TEXT PRIMARY KEY,
          embedding vector(3)
        )
      `);
      await client.query("TRUNCATE test_vectors_i3");

      await client.query(
        "INSERT INTO test_vectors_i3 (observation_id, embedding) VALUES ($1, $2::vector(3))",
        ["orth", "[0,1,0]"]
      );

      const result = await client.query(
        `SELECT (embedding <=> $1::vector(3)) AS distance FROM test_vectors_i3`,
        ["[1,0,0]"]
      );
      const distance = parseFloat(result.rows[0].distance);
      // コサイン距離 = 1 - cos(90°) = 1.0
      expect(distance).toBeCloseTo(1.0, 2);
    } finally {
      await client.end();
    }
  });

  // テスト I4: 大量データ 100件 → LIMIT 10 返却
  test("100件挿入後に LIMIT 10 で 10件のみ返却される", async () => {
    const client = await connect();
    try {
      await client.query(`
        CREATE TEMP TABLE IF NOT EXISTS test_vectors_i4 (
          observation_id TEXT PRIMARY KEY,
          embedding vector(3)
        )
      `);
      await client.query("TRUNCATE test_vectors_i4");

      // 100件一括 INSERT
      const values: string[] = [];
      const params: string[] = [];
      for (let i = 0; i < 100; i++) {
        // ランダムに近いベクトルを生成（正規化不要）
        const v = [Math.random(), Math.random(), Math.random()];
        values.push(`($${i * 2 + 1}, $${i * 2 + 2}::vector(3))`);
        params.push(`obs-bulk-${i}`, `[${v.join(",")}]`);
      }
      await client.query(
        `INSERT INTO test_vectors_i4 (observation_id, embedding) VALUES ${values.join(",")}`,
        params
      );

      const result = await client.query(
        `SELECT observation_id FROM test_vectors_i4
         ORDER BY (embedding <=> $1::vector(3)) ASC
         LIMIT 10`,
        ["[1,0,0]"]
      );
      expect(result.rows).toHaveLength(10);
    } finally {
      await client.end();
    }
  });
});
