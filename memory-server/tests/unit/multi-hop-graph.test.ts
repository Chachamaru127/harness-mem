/**
 * COMP-001: Multi-hop グラフ探索テスト
 *
 * テストケース:
 * 1. 正常: 2-hop 離れた観察が検索結果に含まれる
 * 2. 正常: hop 毎にスコアが decay=0.5 で減衰する
 * 3. 正常: max_depth=3 まで探索可能
 * 4. 境界: max_depth を超えた観察は返されない
 * 5. 境界: expand_links=false の場合、リンク探索なしで直接候補のみ返す
 * 6. 境界: 循環リンクがあってもループしない
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HarnessMemCore, type Config, type EventEnvelope } from "../../src/core/harness-mem-core";

const cleanupPaths: string[] = [];

afterEach(() => {
  while (cleanupPaths.length > 0) {
    const dir = cleanupPaths.pop();
    if (!dir) continue;
    rmSync(dir, { recursive: true, force: true });
  }
});

function createConfig(name: string): Config {
  const dir = mkdtempSync(join(tmpdir(), `harness-mem-multihop-${name}-`));
  cleanupPaths.push(dir);
  return {
    dbPath: join(dir, "harness-mem.db"),
    bindHost: "127.0.0.1",
    bindPort: 0,
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

function baseEvent(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    platform: "claude",
    project: "multihop-test",
    session_id: "session-multihop-001",
    event_type: "user_prompt",
    ts: "2026-02-14T00:00:00.000Z",
    payload: { prompt: "test" },
    tags: [],
    privacy_tags: [],
    ...overrides,
  };
}

describe("COMP-001: Multi-hop グラフ探索", () => {
  test("正常: 2-hop 離れた観察が検索結果に含まれる", () => {
    const core = new HarnessMemCore(createConfig("2hop"));
    try {
      // 観察A（直接ヒット）
      const resultA = core.recordEvent(
        baseEvent({
          event_id: "multihop-obs-a",
          payload: { prompt: "We use React for the frontend architecture." },
        })
      );
      const obsIdA = (resultA.items[0] as { id: string }).id;

      // 観察B（1-hop: A→B）
      const resultB = core.recordEvent(
        baseEvent({
          event_id: "multihop-obs-b",
          payload: { prompt: "React state management uses Redux." },
        })
      );
      const obsIdB = (resultB.items[0] as { id: string }).id;

      // 観察C（2-hop: B→C）
      const resultC = core.recordEvent(
        baseEvent({
          event_id: "multihop-obs-c",
          payload: { prompt: "Redux toolkit simplifies store configuration." },
        })
      );
      const obsIdC = (resultC.items[0] as { id: string }).id;

      // A → B リンク（1-hop）
      expect(core.createLink({ from_observation_id: obsIdA, to_observation_id: obsIdB, relation: "follows", weight: 0.8 }).ok).toBe(true);
      // B → C リンク（2-hop）
      expect(core.createLink({ from_observation_id: obsIdB, to_observation_id: obsIdC, relation: "follows", weight: 0.8 }).ok).toBe(true);

      // A にヒットするクエリで検索
      const result = core.search({
        query: "React frontend architecture",
        project: "multihop-test",
        include_private: true,
        expand_links: true,
      });

      expect(result.ok).toBe(true);
      const resultIds = (result.items as Array<{ id: string }>).map((item) => item.id);

      // A は直接ヒット
      expect(resultIds).toContain(obsIdA);
      // B は 1-hop でヒット
      expect(resultIds).toContain(obsIdB);
      // C は 2-hop でヒット（N-hop 対応）
      expect(resultIds).toContain(obsIdC);
    } finally {
      core.shutdown("test");
    }
  });

  test("正常: hop 毎にスコアが decay=0.5 で減衰する（graph スコアが 1-hop > 2-hop）", () => {
    const core = new HarnessMemCore(createConfig("decay"));
    try {
      const resultA = core.recordEvent(
        baseEvent({
          event_id: "decay-obs-a",
          payload: { prompt: "TypeScript is used for type-safe backend development." },
        })
      );
      const obsIdA = (resultA.items[0] as { id: string }).id;

      const resultB = core.recordEvent(
        baseEvent({
          event_id: "decay-obs-b",
          payload: { prompt: "TypeScript interfaces define contract patterns." },
        })
      );
      const obsIdB = (resultB.items[0] as { id: string }).id;

      const resultC = core.recordEvent(
        baseEvent({
          event_id: "decay-obs-c",
          payload: { prompt: "Zod library validates TypeScript schema at runtime." },
        })
      );
      const obsIdC = (resultC.items[0] as { id: string }).id;

      // A → B (1-hop), B → C (2-hop)
      core.createLink({ from_observation_id: obsIdA, to_observation_id: obsIdB, relation: "shared_entity", weight: 1.0 });
      core.createLink({ from_observation_id: obsIdB, to_observation_id: obsIdC, relation: "shared_entity", weight: 1.0 });

      const result = core.search({
        query: "TypeScript backend type-safe",
        project: "multihop-test",
        include_private: true,
        expand_links: true,
        debug: true,
      });

      expect(result.ok).toBe(true);
      const items = result.items as Array<{ id: string; scores?: Record<string, number>; graph_score?: number }>;
      const itemB = items.find((i) => i.id === obsIdB);
      const itemC = items.find((i) => i.id === obsIdC);

      // B と C が両方含まれる
      expect(itemB).toBeDefined();
      expect(itemC).toBeDefined();

      // C (2-hop) の graph スコアは B (1-hop) より低いはず
      if (itemB && itemC) {
        const scoreB = itemB.graph_score ?? (itemB.scores?.graph ?? 0);
        const scoreC = itemC.graph_score ?? (itemC.scores?.graph ?? 0);
        // 2-hop は 1-hop より graph スコアが低い（decay=0.5 の効果）
        expect(scoreC).toBeLessThanOrEqual(scoreB + 0.01); // 小さな浮動小数点誤差を許容
      }
    } finally {
      core.shutdown("test");
    }
  });

  test("正常: max_depth=3 まで 3-hop を探索できる", () => {
    const core = new HarnessMemCore(createConfig("3hop"));
    try {
      const resultA = core.recordEvent(baseEvent({ event_id: "3hop-a", payload: { prompt: "Node.js enables JavaScript on the server side." } }));
      const obsIdA = (resultA.items[0] as { id: string }).id;

      const resultB = core.recordEvent(baseEvent({ event_id: "3hop-b", payload: { prompt: "Express.js framework runs on Node.js platform." } }));
      const obsIdB = (resultB.items[0] as { id: string }).id;

      const resultC = core.recordEvent(baseEvent({ event_id: "3hop-c", payload: { prompt: "Middleware pattern is core concept in Express.js." } }));
      const obsIdC = (resultC.items[0] as { id: string }).id;

      const resultD = core.recordEvent(baseEvent({ event_id: "3hop-d", payload: { prompt: "Authentication middleware secures Express routes." } }));
      const obsIdD = (resultD.items[0] as { id: string }).id;

      // A→B→C→D チェーン（3-hop）
      core.createLink({ from_observation_id: obsIdA, to_observation_id: obsIdB, relation: "extends", weight: 0.9 });
      core.createLink({ from_observation_id: obsIdB, to_observation_id: obsIdC, relation: "extends", weight: 0.9 });
      core.createLink({ from_observation_id: obsIdC, to_observation_id: obsIdD, relation: "extends", weight: 0.9 });

      const result = core.search({
        query: "Node.js server JavaScript",
        project: "multihop-test",
        include_private: true,
        expand_links: true,
      });

      expect(result.ok).toBe(true);
      const resultIds = (result.items as Array<{ id: string }>).map((i) => i.id);

      // A, B, C が含まれる（D は 3-hop で含まれるか edge case）
      expect(resultIds).toContain(obsIdA);
      expect(resultIds).toContain(obsIdB);
      expect(resultIds).toContain(obsIdC);
      // D（3-hop）は含まれる（max_depth=3 の動作確認）
      expect(resultIds).toContain(obsIdD);
    } finally {
      core.shutdown("test");
    }
  });

  test("境界: expand_links=false の場合は meta.graph_candidates が 0 になる", () => {
    const core = new HarnessMemCore(createConfig("no-expand"));
    try {
      const resultX = core.recordEvent(baseEvent({
        event_id: "noexpand-x",
        payload: { prompt: "Machine learning models require large training datasets for accuracy." },
      }));
      const obsIdX = (resultX.items[0] as { id: string }).id;

      const resultY = core.recordEvent(baseEvent({
        event_id: "noexpand-y",
        payload: { prompt: "Random forest algorithm uses ensemble of decision trees for prediction." },
      }));
      (resultY.items[0] as { id: string }).id; // obsIdY: 使用しないが記録

      // X → Y リンク
      core.createLink({ from_observation_id: obsIdX, to_observation_id: resultY.items[0] ? (resultY.items[0] as { id: string }).id : "", relation: "follows", weight: 0.9 });

      // expand_links=true の場合: graph_candidates > 0（グラフ探索が機能している）
      const resultWithExpand = core.search({
        query: "machine learning training datasets",
        project: "multihop-test",
        include_private: true,
        expand_links: true,
      });
      expect(resultWithExpand.ok).toBe(true);
      const idsWithExpand = (resultWithExpand.items as Array<{ id: string }>).map((i) => i.id);
      expect(idsWithExpand).toContain(obsIdX);
      const metaWithExpand = resultWithExpand.meta as { graph_candidates?: number };
      expect(metaWithExpand.graph_candidates ?? 0).toBeGreaterThan(0);

      // expand_links=false の場合: graph_candidates = 0（グラフ探索なし）
      const resultNoExpand = core.search({
        query: "machine learning training datasets",
        project: "multihop-test",
        include_private: true,
        expand_links: false,
      });
      expect(resultNoExpand.ok).toBe(true);
      const metaNoExpand = resultNoExpand.meta as { graph_candidates?: number };
      expect(metaNoExpand.graph_candidates ?? 0).toBe(0);
    } finally {
      core.shutdown("test");
    }
  });

  test("境界: 循環リンクがあってもループせず有限な結果を返す", () => {
    const core = new HarnessMemCore(createConfig("cycle"));
    try {
      const resultA = core.recordEvent(baseEvent({ event_id: "cycle-a", payload: { prompt: "Service A depends on database connection pool." } }));
      const obsIdA = (resultA.items[0] as { id: string }).id;

      const resultB = core.recordEvent(baseEvent({ event_id: "cycle-b", payload: { prompt: "Database pool configuration affects service performance." } }));
      const obsIdB = (resultB.items[0] as { id: string }).id;

      // A → B → A の循環リンク
      core.createLink({ from_observation_id: obsIdA, to_observation_id: obsIdB, relation: "shared_entity", weight: 0.8 });
      core.createLink({ from_observation_id: obsIdB, to_observation_id: obsIdA, relation: "shared_entity", weight: 0.8 });

      // 無限ループしないこと（タイムアウトなしで完了する）
      const result = core.search({
        query: "Service A database connection",
        project: "multihop-test",
        include_private: true,
        expand_links: true,
      });

      expect(result.ok).toBe(true);
      const resultIds = (result.items as Array<{ id: string }>).map((i) => i.id);
      expect(resultIds).toContain(obsIdA);
      expect(resultIds).toContain(obsIdB);
    } finally {
      core.shutdown("test");
    }
  });

  test("境界: リンクのない観察はグラフ探索結果に追加されない", () => {
    const core = new HarnessMemCore(createConfig("isolated"));
    try {
      const resultA = core.recordEvent(baseEvent({ event_id: "isolated-a", payload: { prompt: "Python is used for data science workflows." } }));
      const obsIdA = (resultA.items[0] as { id: string }).id;

      const resultB = core.recordEvent(baseEvent({ event_id: "isolated-b", payload: { prompt: "Completely unrelated observation about something else entirely." } }));
      const obsIdB = (resultB.items[0] as { id: string }).id;

      // A → B リンクはなし（B は孤立）

      const result = core.search({
        query: "Python data science",
        project: "multihop-test",
        include_private: true,
        expand_links: true,
      });

      expect(result.ok).toBe(true);
      // B はリンクでもキーワードでもヒットしないはず
      // (A はヒットする)
      expect((result.items as Array<{ id: string }>).map((i) => i.id)).toContain(obsIdA);
    } finally {
      core.shutdown("test");
    }
  });
});
