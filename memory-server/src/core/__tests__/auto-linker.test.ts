/**
 * S74-003: auto-linker ユニットテスト
 *
 * テストケース:
 * 1. Strategy A: 同一 entity を持つ observation 間に shared_entity リンクが生成される
 * 2. Strategy A: entity が存在しない場合はリンクが生成されない
 * 3. Strategy A: 10 件上限 — 11 件以上共有しても最大 10 リンク
 * 4. Strategy A: 重複リンクが生成されない（同 link を 2 度 INSERT しても 1 件のみ）
 * 5. Strategy B: 同セッション内の直前 observation に follows リンクが生成される
 * 6. Strategy B: セッション内に先行 observation がない場合はリンクなし
 * 7. Strategy B: weight は 0.8
 * 8. Strategy C: semantic similarity が閾値以上の場合に extends リンクが生成される
 * 9. Strategy C: semantic similarity が閾値未満の場合はリンクなし
 * 10. Strategy C: semanticEnabled=false の場合は動作しない
 * 11. runAutoLinker: auto-linker エラーが event recording を中断しないこと（try/catch）
 * 12. runAutoLinker: 全 3 戦略の結果が AutoLinkResult として返却される
 */

import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { configureDatabase, initSchema, migrateSchema } from "../../db/schema.js";
import {
  runAutoLinker,
  linkByEntityCooccurrence,
  linkByTemporalProximity,
  linkBySemanticSimilarity,
} from "../auto-linker.js";

// ---------------------------------------------------------------------------
// テスト用 DB セットアップ
// ---------------------------------------------------------------------------

function createTestDb(): Database {
  const db = new Database(":memory:");
  configureDatabase(db);
  initSchema(db);
  migrateSchema(db);
  return db;
}

function nowIso(): string {
  return new Date().toISOString();
}

/** テスト用 observation を直接 DB に挿入 */
function insertObservation(
  db: Database,
  id: string,
  sessionId: string,
  createdAt?: string,
): void {
  const ts = createdAt ?? nowIso();
  db.query(`
    INSERT OR IGNORE INTO mem_sessions(session_id, platform, project, started_at, created_at, updated_at)
    VALUES (?, 'claude', 'test-project', ?, ?, ?)
  `).run(sessionId, ts, ts, ts);

  db.query(`
    INSERT OR IGNORE INTO mem_observations(
      id, platform, project, session_id,
      title, content, content_redacted,
      observation_type, memory_type,
      tags_json, privacy_tags_json,
      created_at, updated_at
    ) VALUES (?, 'claude', 'test-project', ?, ?, ?, ?, 'context', 'semantic', '[]', '[]', ?, ?)
  `).run(id, sessionId, `Title ${id}`, `Content ${id}`, `Content ${id}`, ts, ts);
}

/** テスト用 entity を挿入して observation に紐づける */
function insertEntityForObservation(
  db: Database,
  observationId: string,
  entityName: string,
  entityType = "file",
): void {
  const ts = nowIso();
  db.query(`
    INSERT OR IGNORE INTO mem_entities(name, entity_type, created_at)
    VALUES (?, ?, ?)
  `).run(entityName, entityType, ts);

  const entityRow = db
    .query<{ id: number }, [string, string]>(`
      SELECT id FROM mem_entities WHERE name = ? AND entity_type = ?
    `)
    .get(entityName, entityType);
  if (!entityRow) return;

  db.query(`
    INSERT OR IGNORE INTO mem_observation_entities(observation_id, entity_id, created_at)
    VALUES (?, ?, ?)
  `).run(observationId, entityRow.id, ts);
}

/** mem_links からリンクを取得 */
function getLinks(
  db: Database,
  fromId: string,
): Array<{ to_observation_id: string; relation: string; weight: number }> {
  return db
    .query<{ to_observation_id: string; relation: string; weight: number }, [string]>(`
      SELECT to_observation_id, relation, weight FROM mem_links WHERE from_observation_id = ?
    `)
    .all(fromId);
}

/** mem_vectors にベクターを挿入 */
function insertVector(db: Database, observationId: string, vector: number[]): void {
  const ts = nowIso();
  db.query(`
    INSERT OR REPLACE INTO mem_vectors(observation_id, model, dimension, vector_json, created_at, updated_at)
    VALUES (?, 'test-model', ?, ?, ?, ?)
  `).run(observationId, vector.length, JSON.stringify(vector), ts, ts);
}

// ---------------------------------------------------------------------------
// テスト
// ---------------------------------------------------------------------------

let db: Database;

afterEach(() => {
  db?.close();
});

describe("Strategy A: Entity Co-occurrence", () => {
  test("同一 entity を持つ observation 間に shared_entity リンクが生成される", () => {
    db = createTestDb();
    const ts = nowIso();

    insertObservation(db, "obs-1", "session-1", ts);
    insertObservation(db, "obs-2", "session-1", ts);

    insertEntityForObservation(db, "obs-1", "foo.ts");
    insertEntityForObservation(db, "obs-2", "foo.ts");

    const count = linkByEntityCooccurrence(db, "obs-2", ts);

    expect(count).toBe(1);
    const links = getLinks(db, "obs-2");
    expect(links).toHaveLength(1);
    expect(links[0].relation).toBe("shared_entity");
    expect(links[0].to_observation_id).toBe("obs-1");
  });

  test("entity が存在しない場合はリンクが生成されない", () => {
    db = createTestDb();
    const ts = nowIso();

    insertObservation(db, "obs-1", "session-1", ts);
    insertObservation(db, "obs-2", "session-1", ts);
    // obs-2 に entity を設定しない

    const count = linkByEntityCooccurrence(db, "obs-2", ts);

    expect(count).toBe(0);
    expect(getLinks(db, "obs-2")).toHaveLength(0);
  });

  test("上限 10 件 — 11 件の共有 observation があっても最大 10 リンク", () => {
    db = createTestDb();
    const ts = nowIso();

    // 11 件の既存 observation を同じ entity で登録
    for (let i = 1; i <= 11; i++) {
      insertObservation(db, `obs-old-${i}`, "session-1", ts);
      insertEntityForObservation(db, `obs-old-${i}`, "shared.ts");
    }

    insertObservation(db, "obs-new", "session-1", ts);
    insertEntityForObservation(db, "obs-new", "shared.ts");

    const count = linkByEntityCooccurrence(db, "obs-new", ts);

    expect(count).toBe(10);
    expect(getLinks(db, "obs-new")).toHaveLength(10);
  });

  test("重複リンクが生成されない（INSERT OR IGNORE による冪等性）", () => {
    db = createTestDb();
    const ts = nowIso();

    insertObservation(db, "obs-1", "session-1", ts);
    insertObservation(db, "obs-2", "session-1", ts);

    insertEntityForObservation(db, "obs-1", "foo.ts");
    insertEntityForObservation(db, "obs-2", "foo.ts");

    linkByEntityCooccurrence(db, "obs-2", ts);
    linkByEntityCooccurrence(db, "obs-2", ts); // 2 回目

    expect(getLinks(db, "obs-2")).toHaveLength(1);
  });

  test("entity_type=package の weight は 0.9", () => {
    db = createTestDb();
    const ts = nowIso();

    insertObservation(db, "obs-1", "session-1", ts);
    insertObservation(db, "obs-2", "session-1", ts);

    insertEntityForObservation(db, "obs-1", "react", "package");
    insertEntityForObservation(db, "obs-2", "react", "package");

    linkByEntityCooccurrence(db, "obs-2", ts);

    const links = getLinks(db, "obs-2");
    expect(links[0].weight).toBeCloseTo(0.9);
  });
});

describe("Strategy B: Temporal Proximity", () => {
  test("同セッション内の直前 observation に follows リンクが生成される", () => {
    db = createTestDb();
    const ts1 = "2026-01-01T00:00:00.000Z";
    const ts2 = "2026-01-01T00:01:00.000Z";

    insertObservation(db, "obs-1", "session-1", ts1);
    insertObservation(db, "obs-2", "session-1", ts2);

    const count = linkByTemporalProximity(db, "obs-2", "session-1", ts2);

    expect(count).toBe(1);
    const links = getLinks(db, "obs-2");
    expect(links).toHaveLength(1);
    expect(links[0].relation).toBe("follows");
    expect(links[0].to_observation_id).toBe("obs-1");
  });

  test("セッション内に先行 observation がない場合はリンクなし", () => {
    db = createTestDb();
    const ts = nowIso();

    insertObservation(db, "obs-1", "session-1", ts);

    const count = linkByTemporalProximity(db, "obs-1", "session-1", ts);

    expect(count).toBe(0);
    expect(getLinks(db, "obs-1")).toHaveLength(0);
  });

  test("follows リンクの weight は 0.8", () => {
    db = createTestDb();
    const ts1 = "2026-01-01T00:00:00.000Z";
    const ts2 = "2026-01-01T00:01:00.000Z";

    insertObservation(db, "obs-1", "session-1", ts1);
    insertObservation(db, "obs-2", "session-1", ts2);

    linkByTemporalProximity(db, "obs-2", "session-1", ts2);

    const links = getLinks(db, "obs-2");
    expect(links[0].weight).toBeCloseTo(0.8);
  });

  test("セッション跨ぎはリンクしない", () => {
    db = createTestDb();
    const ts1 = "2026-01-01T00:00:00.000Z";
    const ts2 = "2026-01-01T00:01:00.000Z";

    insertObservation(db, "obs-1", "session-A", ts1);
    insertObservation(db, "obs-2", "session-B", ts2);

    const count = linkByTemporalProximity(db, "obs-2", "session-B", ts2);

    expect(count).toBe(0);
    expect(getLinks(db, "obs-2")).toHaveLength(0);
  });

  test("重複 follows リンクが生成されない", () => {
    db = createTestDb();
    const ts1 = "2026-01-01T00:00:00.000Z";
    const ts2 = "2026-01-01T00:01:00.000Z";

    insertObservation(db, "obs-1", "session-1", ts1);
    insertObservation(db, "obs-2", "session-1", ts2);

    linkByTemporalProximity(db, "obs-2", "session-1", ts2);
    linkByTemporalProximity(db, "obs-2", "session-1", ts2); // 2 回目

    expect(getLinks(db, "obs-2")).toHaveLength(1);
  });
});

describe("Strategy C: Semantic Similarity", () => {
  function makeVector(length: number, value: number): number[] {
    return Array(length).fill(value);
  }

  /** 単位ベクトルを生成（cosine similarity 計算に適した形） */
  function normalizedVector(length: number, seed: number): number[] {
    const raw = Array.from({ length }, (_, i) => Math.sin(seed + i));
    const norm = Math.sqrt(raw.reduce((s, v) => s + v * v, 0));
    return raw.map((v) => v / norm);
  }

  test("cosine similarity が閾値 (0.85) 以上の場合に extends リンクが生成される", () => {
    db = createTestDb();
    const ts = nowIso();

    // 完全に同じベクトル → similarity = 1.0
    const vec = normalizedVector(64, 1);

    insertObservation(db, "obs-1", "session-1", ts);
    insertObservation(db, "obs-2", "session-1", ts);
    insertVector(db, "obs-1", vec);
    insertVector(db, "obs-2", vec);

    const getEmbedding = (id: string): number[] | null => {
      const row = db
        .query<{ vector_json: string }, [string]>(`SELECT vector_json FROM mem_vectors WHERE observation_id = ? LIMIT 1`)
        .get(id);
      return row ? (JSON.parse(row.vector_json) as number[]) : null;
    };

    const count = linkBySemanticSimilarity(db, "obs-2", ts, getEmbedding);

    expect(count).toBe(1);
    const links = getLinks(db, "obs-2");
    expect(links).toHaveLength(1);
    expect(links[0].relation).toBe("extends");
    expect(links[0].weight).toBeCloseTo(0.5);
  });

  test("cosine similarity が閾値未満の場合はリンクなし", () => {
    db = createTestDb();
    const ts = nowIso();

    // 直交ベクトル: v1 = [1, 0, 0, ...], v2 = [0, 1, 0, ...]
    const vec1 = Array(64).fill(0);
    vec1[0] = 1;
    const vec2 = Array(64).fill(0);
    vec2[1] = 1;

    insertObservation(db, "obs-1", "session-1", ts);
    insertObservation(db, "obs-2", "session-1", ts);
    insertVector(db, "obs-1", vec1);
    insertVector(db, "obs-2", vec2);

    const getEmbedding = (id: string): number[] | null => {
      const row = db
        .query<{ vector_json: string }, [string]>(`SELECT vector_json FROM mem_vectors WHERE observation_id = ? LIMIT 1`)
        .get(id);
      return row ? (JSON.parse(row.vector_json) as number[]) : null;
    };

    const count = linkBySemanticSimilarity(db, "obs-2", ts, getEmbedding);

    expect(count).toBe(0);
    expect(getLinks(db, "obs-2")).toHaveLength(0);
  });

  test("embedding が取得できない場合はリンクなし", () => {
    db = createTestDb();
    const ts = nowIso();

    insertObservation(db, "obs-1", "session-1", ts);
    insertObservation(db, "obs-2", "session-1", ts);
    // ベクターを登録しない

    const getEmbedding = (_id: string): number[] | null => null;
    const count = linkBySemanticSimilarity(db, "obs-2", ts, getEmbedding);

    expect(count).toBe(0);
  });
});

describe("runAutoLinker", () => {
  test("semanticEnabled=false の場合 Strategy C は実行されない", () => {
    db = createTestDb();
    const ts = nowIso();

    insertObservation(db, "obs-1", "session-1", ts);
    insertObservation(db, "obs-2", "session-1", ts);

    const getEmbeddingCalled: string[] = [];
    const result = runAutoLinker(
      {
        db,
        semanticEnabled: false,
        getEmbedding: (id) => {
          getEmbeddingCalled.push(id);
          return null;
        },
      },
      "obs-2",
      "session-1",
      ts,
    );

    expect(result.semanticLinks).toBe(0);
    expect(getEmbeddingCalled).toHaveLength(0);
  });

  test("全 3 戦略の結果が AutoLinkResult として返却される", () => {
    db = createTestDb();
    const ts1 = "2026-01-01T00:00:00.000Z";
    const ts2 = "2026-01-01T00:01:00.000Z";

    insertObservation(db, "obs-1", "session-1", ts1);
    insertObservation(db, "obs-2", "session-1", ts2);
    insertEntityForObservation(db, "obs-1", "shared.ts");
    insertEntityForObservation(db, "obs-2", "shared.ts");

    const vec = Array(64).fill(0.5);
    insertVector(db, "obs-1", vec);
    insertVector(db, "obs-2", vec);

    const result = runAutoLinker(
      {
        db,
        semanticEnabled: true,
        getEmbedding: (id) => {
          const row = db
            .query<{ vector_json: string }, [string]>(`SELECT vector_json FROM mem_vectors WHERE observation_id = ? LIMIT 1`)
            .get(id);
          return row ? (JSON.parse(row.vector_json) as number[]) : null;
        },
      },
      "obs-2",
      "session-1",
      ts2,
    );

    // AutoLinkResult の全フィールドが number として返却される
    expect(typeof result.entityLinks).toBe("number");
    expect(typeof result.temporalLinks).toBe("number");
    expect(typeof result.semanticLinks).toBe("number");
    expect(result.entityLinks).toBeGreaterThan(0);
    expect(result.temporalLinks).toBe(1);
    expect(result.semanticLinks).toBeGreaterThan(0);
  });

  test("auto-linker の内部エラーが event recording を中断しない", () => {
    db = createTestDb();
    const ts = nowIso();

    insertObservation(db, "obs-error", "session-1", ts);

    // getEmbedding がエラーをスローしても runAutoLinker は例外を飲み込む
    expect(() => {
      runAutoLinker(
        {
          db,
          semanticEnabled: true,
          getEmbedding: (_id) => {
            throw new Error("embedding provider unavailable");
          },
        },
        "obs-error",
        "session-1",
        ts,
      );
    }).not.toThrow();
  });

  test("重複リンクが生成されない（runAutoLinker を 2 回呼んでも同数）", () => {
    db = createTestDb();
    const ts1 = "2026-01-01T00:00:00.000Z";
    const ts2 = "2026-01-01T00:01:00.000Z";

    insertObservation(db, "obs-1", "session-1", ts1);
    insertObservation(db, "obs-2", "session-1", ts2);
    insertEntityForObservation(db, "obs-1", "dup.ts");
    insertEntityForObservation(db, "obs-2", "dup.ts");

    const deps = { db, semanticEnabled: false };

    runAutoLinker(deps, "obs-2", "session-1", ts2);
    const firstRunLinks = getLinks(db, "obs-2").length;

    runAutoLinker(deps, "obs-2", "session-1", ts2);
    const secondRunLinks = getLinks(db, "obs-2").length;

    expect(secondRunLinks).toBe(firstRunLinks);
    expect(firstRunLinks).toBeGreaterThan(0);
  });
});
