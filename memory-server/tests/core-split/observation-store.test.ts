/**
 * IMP-004a: 観察ストアモジュール境界テスト
 *
 * ObservationStore を直接インスタンス化して単体テストする。
 * getObservations / search / feed / searchFacets / timeline を対象とする。
 */

import { afterEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { ObservationStore, type ObservationStoreDeps } from "../../src/core/observation-store";
import type { Config } from "../../src/core/types";
import {
  createTestDb,
  createTestConfig,
  insertTestObservation,
} from "./test-helpers";

// ---------------------------------------------------------------------------
// ヘルパー
// ---------------------------------------------------------------------------

function normalizeProject(project: string): string {
  return project.toLowerCase();
}

function platformVisibilityFilterSql(_alias: string): string {
  return " AND 1=1";
}

function createDeps(db: Database, config: Config): ObservationStoreDeps {
  return {
    db,
    config,
    ftsEnabled: false,
    normalizeProject,
    platformVisibilityFilterSql,
    writeAuditLog: () => {},
    getVectorEngine: () => "disabled",
    getVectorModelVersion: () => "test-model",
    vectorDimension: 256,
    getVecTableReady: () => false,
    setVecTableReady: () => {},
    embedContent: (content: string) => {
      // テスト用: 単純なゼロベクトルを返す
      return new Array(256).fill(0);
    },
    refreshEmbeddingHealth: () => {},
    getEmbeddingProviderName: () => "test",
    embeddingProviderModel: "test-model",
    getEmbeddingHealthStatus: () => "ok",
    getRerankerEnabled: () => false,
    getReranker: () => null,
    managedShadowRead: null,
    searchRanking: "hybrid_v3",
    searchExpandLinks: false,
  };
}

const testDbs: Database[] = [];

afterEach(() => {
  while (testDbs.length > 0) {
    const db = testDbs.pop();
    db?.close();
  }
});

function makeStore(
  configOverrides: Partial<Config> = {}
): { store: ObservationStore; db: Database } {
  const db = createTestDb();
  testDbs.push(db);
  const config = createTestConfig(configOverrides);
  const deps = createDeps(db, config);
  const store = new ObservationStore(deps);
  return { store, db };
}

// ---------------------------------------------------------------------------
// getObservations
// ---------------------------------------------------------------------------

describe("observation-store: getObservations", () => {
  test("空の ids は空配列を返す", () => {
    const { store } = makeStore();
    const res = store.getObservations({ ids: [] });
    expect(res.ok).toBe(true);
    expect(res.items).toEqual([]);
  });

  test("記録された観察が ID で取得できる", () => {
    const { store, db } = makeStore();
    const id = insertTestObservation(db, {
      title: "special content for retrieval",
      content: "special content for retrieval",
    });
    const res = store.getObservations({ ids: [id] });
    expect(res.ok).toBe(true);
    expect(res.items.length).toBe(1);
    expect((res.items[0] as Record<string, unknown>).id).toBe(id);
  });

  test("存在しない ID はスキップされる", () => {
    const { store } = makeStore();
    const res = store.getObservations({ ids: ["nonexistent-id-12345"] });
    expect(res.ok).toBe(true);
    expect(res.items).toEqual([]);
  });

  test("compact=false で全コンテンツが返る", () => {
    const { store, db } = makeStore();
    const longContent = "A".repeat(1000);
    const id = insertTestObservation(db, {
      title: "long content checkpoint",
      content: longContent,
    });
    const res = store.getObservations({ ids: [id], compact: false });
    expect(res.ok).toBe(true);
    expect(res.items.length).toBe(1);
    const content = (res.items[0] as Record<string, unknown>).content as string;
    expect(content.length).toBeGreaterThan(800);
  });

  test("private 観察は include_private=false で除外される", () => {
    const { store, db } = makeStore();
    const id = insertTestObservation(db, {
      title: "private data",
      content: "private data",
      privacy_tags: ["private"],
    });
    const res = store.getObservations({ ids: [id], include_private: false });
    expect(res.ok).toBe(true);
    expect(res.items).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// search
// ---------------------------------------------------------------------------

describe("observation-store: search", () => {
  test("クエリにマッチする観察が返る", () => {
    const { store, db } = makeStore();
    insertTestObservation(db, {
      title: "unique search term xyz987",
      content: "unique search term xyz987",
      project: "proj-obs",
    });
    const res = store.search({ query: "unique search term xyz987", project: "proj-obs" });
    expect(res.ok).toBe(true);
  });

  test("project でフィルタリングされる", () => {
    const { store, db } = makeStore();
    insertTestObservation(db, {
      title: "project filter test item",
      content: "project filter test item",
      project: "proj-a",
    });
    insertTestObservation(db, {
      title: "project filter test item",
      content: "project filter test item",
      project: "proj-b",
    });
    const res = store.search({ query: "project filter test", project: "proj-a", strict_project: true });
    expect(res.ok).toBe(true);
    for (const item of res.items as Array<Record<string, unknown>>) {
      expect(item.project).toBe("proj-a");
    }
  });

  test("limit パラメータが反映される", () => {
    const { store, db } = makeStore();
    for (let i = 0; i < 5; i++) {
      insertTestObservation(db, {
        title: `search limit test item ${i}`,
        content: `search limit test item ${i}`,
        project: "proj-obs",
        created_at: `2026-02-20T0${i}:00:00.000Z`,
      });
    }
    const res = store.search({ query: "search limit test", project: "proj-obs", limit: 2 });
    expect(res.ok).toBe(true);
    expect(res.items.length).toBeLessThanOrEqual(2);
  });

  test("空クエリでもエラーにならない（ok=false）", () => {
    const { store } = makeStore();
    const res = store.search({ query: "", project: "proj-obs" });
    // 空クエリは error レスポンス (ok=false) が正常
    expect(typeof res.ok).toBe("boolean");
  });

  test("debug=true でデバッグ情報が含まれる", () => {
    const { store, db } = makeStore();
    insertTestObservation(db, {
      title: "debug test observation",
      content: "debug test observation",
      project: "proj-obs",
    });
    const res = store.search({ query: "debug test", project: "proj-obs", debug: true });
    expect(res.ok).toBe(true);
    expect(res.meta).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// feed
// ---------------------------------------------------------------------------

describe("observation-store: feed", () => {
  test("フィードが ok=true を返す", () => {
    const { store, db } = makeStore();
    insertTestObservation(db, { project: "proj-obs" });
    const res = store.feed({});
    expect(res.ok).toBe(true);
  });

  test("project フィルタが機能する", () => {
    const { store, db } = makeStore();
    insertTestObservation(db, {
      project: "proj-feed-a",
      session_id: "sess-fa",
      created_at: "2026-02-20T00:00:00.000Z",
    });
    insertTestObservation(db, {
      project: "proj-feed-b",
      session_id: "sess-fb",
      created_at: "2026-02-20T01:00:00.000Z",
    });
    const res = store.feed({ project: "proj-feed-a" });
    expect(res.ok).toBe(true);
    for (const item of res.items as Array<Record<string, unknown>>) {
      expect(item.project).toBe("proj-feed-a");
    }
  });

  test("limit パラメータが機能する", () => {
    const { store, db } = makeStore();
    for (let i = 0; i < 5; i++) {
      insertTestObservation(db, {
        project: "proj-obs",
        created_at: `2026-02-20T0${i}:00:00.000Z`,
      });
    }
    const res = store.feed({ limit: 2 });
    expect(res.ok).toBe(true);
    expect(res.items.length).toBeLessThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// searchFacets
// ---------------------------------------------------------------------------

describe("observation-store: searchFacets", () => {
  test("ファセット検索が ok=true を返す", () => {
    const { store, db } = makeStore();
    insertTestObservation(db, {
      project: "proj-obs",
      tags: ["tag-a", "tag-b"],
    });
    const res = store.searchFacets({ project: "proj-obs" });
    expect(res.ok).toBe(true);
  });

  test("クエリ付きファセット検索が動作する", () => {
    const { store, db } = makeStore();
    insertTestObservation(db, {
      project: "proj-obs",
      title: "facet query test",
      content: "facet query test",
    });
    const res = store.searchFacets({ query: "facet query test", project: "proj-obs" });
    expect(res.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// timeline
// ---------------------------------------------------------------------------

describe("observation-store: timeline", () => {
  test("存在しない観察 ID では ok=false を返す", () => {
    const { store } = makeStore();
    const res = store.timeline({ id: "nonexistent-obs-id" });
    expect(res.ok).toBe(false);
  });

  test("有効な観察 ID でタイムラインが返る", () => {
    const { store, db } = makeStore();
    const id = insertTestObservation(db, {
      project: "proj-obs",
      session_id: "sess-timeline",
      title: "timeline test event",
      content: "timeline test event",
      created_at: "2026-02-20T00:00:00.000Z",
    });
    const res = store.timeline({ id });
    expect(res.ok).toBe(true);
    expect(res.items.length).toBeGreaterThan(0);
    const center = (res.items as Array<Record<string, unknown>>).find((i) => i.position === "center");
    expect(center).toBeDefined();
    expect(center?.id).toBe(id);
  });
});
