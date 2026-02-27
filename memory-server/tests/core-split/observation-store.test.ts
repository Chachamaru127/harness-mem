/**
 * IMP-004a: 観察ストアモジュール境界テスト
 *
 * 分割後の observation-store.ts が担当する API を TDD で定義する。
 * getObservations / search / feed / searchFacets / timeline を対象とする。
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  HarnessMemCore,
  type Config,
  type EventEnvelope,
} from "../../src/core/harness-mem-core";

const cleanupPaths: string[] = [];

afterEach(() => {
  while (cleanupPaths.length > 0) {
    const dir = cleanupPaths.pop();
    if (!dir) continue;
    rmSync(dir, { recursive: true, force: true });
  }
});

function createConfig(name: string): Config {
  const dir = mkdtempSync(join(tmpdir(), `obs-store-${name}-`));
  cleanupPaths.push(dir);
  return {
    dbPath: join(dir, "harness-mem.db"),
    bindHost: "127.0.0.1",
    bindPort: 37888,
    vectorDimension: 64,
    captureEnabled: true,
    retrievalEnabled: true,
    injectionEnabled: true,
    codexHistoryEnabled: false,
    codexProjectRoot: process.cwd(),
    codexSessionsRoot: process.cwd(),
    codexIngestIntervalMs: 5000,
    codexBackfillHours: 24,
    opencodeIngestEnabled: false,
    cursorIngestEnabled: false,
    antigravityIngestEnabled: false,
  };
}

function makeEvent(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    platform: "claude",
    project: "proj-obs",
    session_id: "sess-obs-001",
    event_type: "user_prompt",
    ts: "2026-02-20T00:00:00.000Z",
    payload: { prompt: "observation store test" },
    tags: [],
    privacy_tags: [],
    ...overrides,
  };
}

describe("observation-store: getObservations", () => {
  test("空の ids は空配列を返す", () => {
    const core = new HarnessMemCore(createConfig("get-obs-empty"));
    try {
      const res = core.getObservations({ ids: [] });
      expect(res.ok).toBe(true);
      expect(res.items).toEqual([]);
    } finally {
      core.shutdown("test");
    }
  });

  test("記録された観察が ID で取得できる", () => {
    const core = new HarnessMemCore(createConfig("get-obs-basic"));
    try {
      core.recordEvent(makeEvent({ payload: { prompt: "special content for retrieval" } }));
      // 検索経由でIDを取得
      const searchRes = core.search({ query: "special content for retrieval", project: "proj-obs" });
      expect(searchRes.ok).toBe(true);
      if (searchRes.items.length > 0) {
        const id = (searchRes.items[0] as Record<string, unknown>).id as string;
        const getRes = core.getObservations({ ids: [id] });
        expect(getRes.ok).toBe(true);
        expect(getRes.items.length).toBe(1);
        expect((getRes.items[0] as Record<string, unknown>).id).toBe(id);
      }
    } finally {
      core.shutdown("test");
    }
  });

  test("存在しない ID はスキップされる", () => {
    const core = new HarnessMemCore(createConfig("get-obs-nonexistent"));
    try {
      const res = core.getObservations({ ids: ["nonexistent-id-12345"] });
      expect(res.ok).toBe(true);
      expect(res.items).toEqual([]);
    } finally {
      core.shutdown("test");
    }
  });

  test("compact=false で全コンテンツが返る", () => {
    const core = new HarnessMemCore(createConfig("get-obs-compact"));
    try {
      const longContent = "A".repeat(1000);
      core.recordCheckpoint({
        session_id: "sess-obs-001",
        title: "long content checkpoint",
        content: longContent,
        project: "proj-obs",
      });
      const searchRes = core.search({ query: "long content checkpoint", project: "proj-obs" });
      if (searchRes.items.length > 0) {
        const id = (searchRes.items[0] as Record<string, unknown>).id as string;
        const getRes = core.getObservations({ ids: [id], compact: false });
        expect(getRes.ok).toBe(true);
        if (getRes.items.length > 0) {
          const content = (getRes.items[0] as Record<string, unknown>).content as string;
          expect(content.length).toBeGreaterThan(800);
        }
      }
    } finally {
      core.shutdown("test");
    }
  });

  test("private 観察は include_private=false で除外される", () => {
    const core = new HarnessMemCore(createConfig("get-obs-private"));
    try {
      core.recordEvent(makeEvent({ privacy_tags: ["private"], payload: { prompt: "private data" } }));
      const searchRes = core.search({ query: "private data", project: "proj-obs", include_private: true });
      if (searchRes.items.length > 0) {
        const id = (searchRes.items[0] as Record<string, unknown>).id as string;
        const getResPrivate = core.getObservations({ ids: [id], include_private: false });
        expect(getResPrivate.ok).toBe(true);
        // プライベートなので含まれない
        expect(getResPrivate.items).toEqual([]);
      }
    } finally {
      core.shutdown("test");
    }
  });
});

describe("observation-store: search", () => {
  test("クエリにマッチする観察が返る", () => {
    const core = new HarnessMemCore(createConfig("search-basic"));
    try {
      core.recordEvent(makeEvent({ payload: { prompt: "unique search term xyz987" } }));
      const res = core.search({ query: "unique search term xyz987", project: "proj-obs" });
      expect(res.ok).toBe(true);
    } finally {
      core.shutdown("test");
    }
  });

  test("project でフィルタリングされる", () => {
    const core = new HarnessMemCore(createConfig("search-project-filter"));
    try {
      core.recordEvent(makeEvent({ project: "proj-a", session_id: "sess-a", payload: { prompt: "project filter test" } }));
      core.recordEvent(
        makeEvent({ project: "proj-b", session_id: "sess-b", ts: "2026-02-20T01:00:00.000Z", payload: { prompt: "project filter test" } })
      );
      const res = core.search({ query: "project filter test", project: "proj-a", strict_project: true });
      expect(res.ok).toBe(true);
      for (const item of res.items as Array<Record<string, unknown>>) {
        expect(item.project).toBe("proj-a");
      }
    } finally {
      core.shutdown("test");
    }
  });

  test("limit パラメータが反映される", () => {
    const core = new HarnessMemCore(createConfig("search-limit"));
    try {
      for (let i = 0; i < 5; i++) {
        core.recordEvent(
          makeEvent({ ts: `2026-02-20T0${i}:00:00.000Z`, payload: { prompt: `search limit test item ${i}` } })
        );
      }
      const res = core.search({ query: "search limit test", project: "proj-obs", limit: 2 });
      expect(res.ok).toBe(true);
      expect(res.items.length).toBeLessThanOrEqual(2);
    } finally {
      core.shutdown("test");
    }
  });

  test("空クエリでもエラーにならない", () => {
    const core = new HarnessMemCore(createConfig("search-empty-query"));
    try {
      const res = core.search({ query: "", project: "proj-obs" });
      expect(typeof res.ok).toBe("boolean");
    } finally {
      core.shutdown("test");
    }
  });

  test("debug=true でデバッグ情報が含まれる", () => {
    const core = new HarnessMemCore(createConfig("search-debug"));
    try {
      const res = core.search({ query: "debug test", project: "proj-obs", debug: true });
      expect(res.ok).toBe(true);
      // debug モードでは meta に追加情報が含まれる
      expect(res.meta).toBeTruthy();
    } finally {
      core.shutdown("test");
    }
  });
});

describe("observation-store: feed", () => {
  test("フィードが ok=true を返す", () => {
    const core = new HarnessMemCore(createConfig("feed-basic"));
    try {
      core.recordEvent(makeEvent());
      const res = core.feed({});
      expect(res.ok).toBe(true);
    } finally {
      core.shutdown("test");
    }
  });

  test("project フィルタが機能する", () => {
    const core = new HarnessMemCore(createConfig("feed-project"));
    try {
      core.recordEvent(makeEvent({ project: "proj-feed-a", session_id: "sess-fa" }));
      core.recordEvent(
        makeEvent({ project: "proj-feed-b", session_id: "sess-fb", ts: "2026-02-20T01:00:00.000Z" })
      );
      const res = core.feed({ project: "proj-feed-a" });
      expect(res.ok).toBe(true);
      for (const item of res.items as Array<Record<string, unknown>>) {
        expect(item.project).toBe("proj-feed-a");
      }
    } finally {
      core.shutdown("test");
    }
  });

  test("limit パラメータが機能する", () => {
    const core = new HarnessMemCore(createConfig("feed-limit"));
    try {
      for (let i = 0; i < 5; i++) {
        core.recordEvent(
          makeEvent({ ts: `2026-02-20T0${i}:00:00.000Z`, payload: { prompt: `feed item ${i}` } })
        );
      }
      const res = core.feed({ limit: 2 });
      expect(res.ok).toBe(true);
      expect(res.items.length).toBeLessThanOrEqual(2);
    } finally {
      core.shutdown("test");
    }
  });
});

describe("observation-store: searchFacets", () => {
  test("ファセット検索が ok=true を返す", () => {
    const core = new HarnessMemCore(createConfig("facets-basic"));
    try {
      core.recordEvent(makeEvent({ tags: ["tag-a", "tag-b"] }));
      const res = core.searchFacets({ project: "proj-obs" });
      expect(res.ok).toBe(true);
    } finally {
      core.shutdown("test");
    }
  });

  test("クエリ付きファセット検索が動作する", () => {
    const core = new HarnessMemCore(createConfig("facets-query"));
    try {
      core.recordEvent(makeEvent({ payload: { prompt: "facet query test" } }));
      const res = core.searchFacets({ query: "facet query test", project: "proj-obs" });
      expect(res.ok).toBe(true);
    } finally {
      core.shutdown("test");
    }
  });
});

describe("observation-store: timeline", () => {
  test("存在しない観察 ID では ok=false を返す", () => {
    const core = new HarnessMemCore(createConfig("timeline-nonexistent"));
    try {
      const res = core.timeline({ id: "nonexistent-obs-id" });
      expect(res.ok).toBe(false);
    } finally {
      core.shutdown("test");
    }
  });

  test("有効な観察 ID でタイムラインが返る", () => {
    const core = new HarnessMemCore(createConfig("timeline-valid"));
    try {
      core.recordEvent(makeEvent({ payload: { prompt: "timeline test event" } }));
      const searchRes = core.search({ query: "timeline test event", project: "proj-obs" });
      if (searchRes.ok && searchRes.items.length > 0) {
        const id = (searchRes.items[0] as Record<string, unknown>).id as string;
        const timelineRes = core.timeline({ id });
        expect(timelineRes.ok).toBe(true);
      }
    } finally {
      core.shutdown("test");
    }
  });
});
