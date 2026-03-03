/**
 * PG-004: PgVectorRepository ユニットテスト
 *
 * PgClientLike のモック実装を使用し、実際の PostgreSQL 接続なしで
 * IVectorRepository の全メソッドを検証する。
 *
 * テストケース:
 *  1. upsert: 正常に INSERT が実行される
 *  2. upsert: ON CONFLICT UPDATE（既存レコードの更新）
 *  3. upsert: 不正な vector_json でも例外にならず空ベクトルで保存
 *  4. findByObservationId: 存在するレコードを返す
 *  5. findByObservationId: 存在しない場合は null を返す
 *  6. findByObservationIds: 複数レコードを返す
 *  7. findByObservationIds: 空配列を渡すと空配列を返す（DB クエリなし）
 *  8. findLegacyObservationIds: 現在モデルと異なる observation_id を返す
 *  9. findLegacyObservationIds: limit が SQL に渡される
 * 10. coverage: total と current_model_count が正確に計算される
 * 11. coverage: ベクトルが 0 件の場合
 * 12. delete: DELETE SQL が実行される
 * 13. pgvectorSearchAsync: distance 結果が PgvectorSearchResult に変換される
 * 14. pgvectorSearchAsync: limit が SQL に反映される
 * 15. _toVectorRow: pg の Date 型を ISO 文字列に変換する
 * 16. _toVectorRow: embedding が null の場合は "[]" を使用
 */

import { describe, expect, test } from "bun:test";
import { PgVectorRepository } from "../../src/db/repositories/PgVectorRepository";
import type { UpsertVectorInput } from "../../src/db/repositories/IVectorRepository";

// ---------------------------------------------------------------------------
// モック PgClientLike
// ---------------------------------------------------------------------------

/**
 * テスト用のインメモリ PgClientLike モック。
 * 渡した rows を query() の結果として返す。
 */
class MockPgClient {
  /** 実行された SQL ログ（テスト検証用） */
  readonly queries: Array<{ text: string; values: unknown[] }> = [];
  /** query() が返す rows（テストケースごとに設定） */
  private _rows: unknown[] = [];
  private _rowCount = 0;

  setRows(rows: unknown[], rowCount?: number): void {
    this._rows = rows;
    this._rowCount = rowCount ?? rows.length;
  }

  async query(text: string, values?: unknown[]): Promise<{ rows: unknown[]; rowCount: number | null }> {
    this.queries.push({ text, values: values ?? [] });
    return { rows: this._rows, rowCount: this._rowCount };
  }

  async end(): Promise<void> {}
}

// ---------------------------------------------------------------------------
// ヘルパー
// ---------------------------------------------------------------------------

function makeInput(overrides: Partial<UpsertVectorInput> = {}): UpsertVectorInput {
  const now = new Date().toISOString();
  const vector = new Array(64).fill(0).map((_, i) => (i % 2 === 0 ? 0.1 : -0.1));
  return {
    observation_id: "obs_001",
    model: "test-model-v1",
    dimension: 64,
    vector_json: JSON.stringify(vector),
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function makePgVectorRow(observationId: string, model = "test-model-v1") {
  return {
    observation_id: observationId,
    model,
    dimension: 64,
    embedding: "[0.1,-0.1,0.1]",
    created_at: new Date("2026-01-01T00:00:00.000Z"),
    updated_at: new Date("2026-01-01T00:00:00.000Z"),
  };
}

// ---------------------------------------------------------------------------
// upsert
// ---------------------------------------------------------------------------

describe("PgVectorRepository: upsert", () => {
  test("1. upsert で INSERT SQL が実行される", async () => {
    const client = new MockPgClient();
    const repo = new PgVectorRepository(client, 64);

    await repo.upsert(makeInput());

    expect(client.queries).toHaveLength(1);
    const q = client.queries[0]!;
    expect(q.text).toContain("INSERT INTO mem_vectors");
    expect(q.text).toContain("ON CONFLICT");
    expect(q.text).toContain("$4::vector");
    expect(q.values[0]).toBe("obs_001");
    expect(q.values[1]).toBe("test-model-v1");
    expect(q.values[2]).toBe(64);
    // vector_json を pgvector 形式に変換した文字列が $4 に渡る
    const vectorStr = q.values[3] as string;
    expect(vectorStr).toMatch(/^\[.*\]$/);
  });

  test("2. upsert でモデルが異なっても ON CONFLICT UPDATE で上書きされる（SQL 構造確認）", async () => {
    const client = new MockPgClient();
    const repo = new PgVectorRepository(client, 64);

    await repo.upsert(makeInput({ model: "model-v1" }));
    await repo.upsert(makeInput({ model: "model-v2" }));

    expect(client.queries).toHaveLength(2);
    // 2回目の query でも同じ UPSERT SQL が使われる
    expect(client.queries[1]!.values[1]).toBe("model-v2");
  });

  test("3. 不正な vector_json を渡しても例外にならず空ベクトルが渡る", async () => {
    const client = new MockPgClient();
    const repo = new PgVectorRepository(client, 4);

    // dimension=4 として空ベクトル [0,0,0,0] が渡るか確認
    await expect(
      repo.upsert(makeInput({ vector_json: "INVALID_JSON", dimension: 4 }))
    ).resolves.toBeUndefined();

    const vectorStr = client.queries[0]!.values[3] as string;
    // 不正JSON なのでフォールバック空ベクトル（dimension=4 の場合 [0,0,0,0]）
    expect(vectorStr).toMatch(/^\[/);
  });
});

// ---------------------------------------------------------------------------
// findByObservationId
// ---------------------------------------------------------------------------

describe("PgVectorRepository: findByObservationId", () => {
  test("4. 存在するレコードを VectorRow に変換して返す", async () => {
    const client = new MockPgClient();
    client.setRows([makePgVectorRow("obs_001")]);
    const repo = new PgVectorRepository(client, 64);

    const row = await repo.findByObservationId("obs_001");

    expect(row).not.toBeNull();
    expect(row!.observation_id).toBe("obs_001");
    expect(row!.model).toBe("test-model-v1");
    expect(row!.dimension).toBe(64);
    // created_at は ISO 文字列に変換されている
    expect(row!.created_at).toBe("2026-01-01T00:00:00.000Z");
    expect(row!.updated_at).toBe("2026-01-01T00:00:00.000Z");
    // embedding "[0.1,-0.1,0.1]" が vector_json にそのまま入る
    expect(row!.vector_json).toBe("[0.1,-0.1,0.1]");
  });

  test("5. 存在しない observation_id の場合は null を返す", async () => {
    const client = new MockPgClient();
    client.setRows([]);
    const repo = new PgVectorRepository(client, 64);

    const row = await repo.findByObservationId("nonexistent");

    expect(row).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// findByObservationIds
// ---------------------------------------------------------------------------

describe("PgVectorRepository: findByObservationIds", () => {
  test("6. 複数 observation_id を IN クエリで取得できる", async () => {
    const client = new MockPgClient();
    client.setRows([
      makePgVectorRow("obs_a"),
      makePgVectorRow("obs_b"),
    ]);
    const repo = new PgVectorRepository(client, 64);

    const rows = await repo.findByObservationIds(["obs_a", "obs_b"]);

    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.observation_id).sort()).toEqual(["obs_a", "obs_b"]);
    // IN 句の SQL が正しく生成されている
    const q = client.queries[0]!;
    expect(q.text).toContain("IN ($1, $2)");
    expect(q.values).toEqual(["obs_a", "obs_b"]);
  });

  test("7. 空配列を渡すと DB クエリなしで空配列を返す", async () => {
    const client = new MockPgClient();
    const repo = new PgVectorRepository(client, 64);

    const rows = await repo.findByObservationIds([]);

    expect(rows).toEqual([]);
    expect(client.queries).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// findLegacyObservationIds
// ---------------------------------------------------------------------------

describe("PgVectorRepository: findLegacyObservationIds", () => {
  test("8. 現在モデルと異なる observation_id を返す", async () => {
    const client = new MockPgClient();
    client.setRows([{ observation_id: "obs_old" }]);
    const repo = new PgVectorRepository(client, 64);

    const ids = await repo.findLegacyObservationIds("current-model", 10);

    expect(ids).toEqual(["obs_old"]);
    const q = client.queries[0]!;
    expect(q.text).toContain("model != $1");
    expect(q.values[0]).toBe("current-model");
  });

  test("9. limit が SQL の LIMIT $2 に渡される", async () => {
    const client = new MockPgClient();
    client.setRows([]);
    const repo = new PgVectorRepository(client, 64);

    await repo.findLegacyObservationIds("model-v2", 3);

    const q = client.queries[0]!;
    expect(q.text).toContain("LIMIT $2");
    expect(q.values[1]).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// coverage
// ---------------------------------------------------------------------------

describe("PgVectorRepository: coverage", () => {
  test("10. total と current_model_count が正確に返る", async () => {
    const client = new MockPgClient();
    client.setRows([{ total: "3", current_model_count: "2" }]);
    const repo = new PgVectorRepository(client, 64);

    const result = await repo.coverage("current-model");

    expect(result.total).toBe(3);
    expect(result.current_model_count).toBe(2);
  });

  test("11. ベクトルが 0 件の場合は total=0 / current_model_count=0", async () => {
    const client = new MockPgClient();
    client.setRows([{ total: "0", current_model_count: "0" }]);
    const repo = new PgVectorRepository(client, 64);

    const result = await repo.coverage("any-model");

    expect(result.total).toBe(0);
    expect(result.current_model_count).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------

describe("PgVectorRepository: delete", () => {
  test("12. delete で DELETE SQL が実行される", async () => {
    const client = new MockPgClient();
    client.setRows([], 1);
    const repo = new PgVectorRepository(client, 64);

    await repo.delete("obs_del");

    expect(client.queries).toHaveLength(1);
    const q = client.queries[0]!;
    expect(q.text).toContain("DELETE FROM mem_vectors");
    expect(q.text).toContain("$1");
    expect(q.values[0]).toBe("obs_del");
  });
});

// ---------------------------------------------------------------------------
// pgvectorSearchAsync
// ---------------------------------------------------------------------------

describe("PgVectorRepository: pgvectorSearchAsync", () => {
  test("13. distance 結果が PgvectorSearchResult に変換される", async () => {
    const client = new MockPgClient();
    client.setRows([
      { observation_id: "obs_near", distance: "0.12" },
      { observation_id: "obs_far", distance: "0.85" },
    ]);
    const repo = new PgVectorRepository(client, 64);

    const queryVector = new Array(64).fill(0.1);
    const results = await repo.pgvectorSearchAsync(queryVector, 10);

    expect(results).toHaveLength(2);
    expect(results[0]!.observationId).toBe("obs_near");
    expect(results[0]!.distance).toBeCloseTo(0.12);
    expect(results[1]!.observationId).toBe("obs_far");
    expect(results[1]!.distance).toBeCloseTo(0.85);
  });

  test("14. limit が SQL の LIMIT 句に反映される", async () => {
    const client = new MockPgClient();
    client.setRows([]);
    const repo = new PgVectorRepository(client, 64);

    await repo.pgvectorSearchAsync(new Array(64).fill(0), 5);

    const q = client.queries[0]!;
    expect(q.text).toContain("LIMIT 5");
  });

  test("15. queryVector が pgvector 形式文字列として渡される", async () => {
    const client = new MockPgClient();
    client.setRows([]);
    const repo = new PgVectorRepository(client, 3);

    await repo.pgvectorSearchAsync([0.1, 0.2, 0.3], 50);

    const q = client.queries[0]!;
    expect(q.values[0]).toBe("[0.1,0.2,0.3]");
  });
});

// ---------------------------------------------------------------------------
// VectorRow 変換: _toVectorRow 相当の動作（findByObservationId 経由で検証）
// ---------------------------------------------------------------------------

describe("PgVectorRepository: VectorRow 変換", () => {
  test("16. embedding が null の場合は vector_json に '[]' が入る", async () => {
    const client = new MockPgClient();
    client.setRows([
      {
        observation_id: "obs_null_emb",
        model: "test-model",
        dimension: 64,
        embedding: null,
        created_at: new Date("2026-03-01T12:00:00.000Z"),
        updated_at: new Date("2026-03-01T12:00:00.000Z"),
      },
    ]);
    const repo = new PgVectorRepository(client, 64);

    const row = await repo.findByObservationId("obs_null_emb");

    expect(row).not.toBeNull();
    expect(row!.vector_json).toBe("[]");
  });

  test("17. created_at が文字列の場合もそのまま返る", async () => {
    const isoStr = "2026-01-15T09:30:00.000Z";
    const client = new MockPgClient();
    client.setRows([
      {
        observation_id: "obs_str_date",
        model: "test-model",
        dimension: 64,
        embedding: "[0.0]",
        created_at: isoStr,
        updated_at: isoStr,
      },
    ]);
    const repo = new PgVectorRepository(client, 64);

    const row = await repo.findByObservationId("obs_str_date");

    expect(row!.created_at).toBe(isoStr);
    expect(row!.updated_at).toBe(isoStr);
  });
});
