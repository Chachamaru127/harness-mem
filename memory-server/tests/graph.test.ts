/**
 * V5-001: Graph 強化テスト
 *
 * テストケース:
 * 1-8. relation types 8種が createLink で受け付けられる
 * 9-14. autoLink 新キーワード検出（contradicts/causes/part_of）
 * 15-16. shared_entity weight 差別化（createLink で weight 指定）
 * 17-24. getSubgraph API の正常系・エッジケース
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HarnessMemCore, type Config, type EventEnvelope } from "../src/core/harness-mem-core";

const cleanupPaths: string[] = [];

afterEach(() => {
  while (cleanupPaths.length > 0) {
    const dir = cleanupPaths.pop();
    if (!dir) continue;
    rmSync(dir, { recursive: true, force: true });
  }
});

function createConfig(name: string): Config {
  const dir = mkdtempSync(join(tmpdir(), `harness-graph-${name}-`));
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

let evtCounter = 0;

function makeEvent(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  evtCounter++;
  return {
    event_id: `graph-test-${evtCounter}-${Date.now()}`,
    event_type: "checkpoint",
    session_id: "test-session",
    platform: "claude",
    project: "test-project",
    ts: new Date().toISOString(),
    payload: { title: "Test Event", content: "test content" },
    tags: [],
    privacy_tags: [],
    ...overrides,
  };
}

/** recordEvent の items[0].id で観察 ID を取得 */
function getObsId(res: ReturnType<HarnessMemCore["recordEvent"]>): string {
  if (!res.ok || res.items.length === 0) {
    throw new Error(`recordEvent failed or returned no items: ${res.error ?? JSON.stringify(res.meta)}`);
  }
  return (res.items[0] as { id: string }).id;
}

/** getLinks の items をリンク配列として取得 */
function getLinkItems(
  res: ReturnType<HarnessMemCore["getLinks"]>
): Array<{ from_observation_id: string; to_observation_id: string; relation: string; weight: number }> {
  return res.items as Array<{ from_observation_id: string; to_observation_id: string; relation: string; weight: number }>;
}

// ---------------------------------------------------------------------------
// 1. relation types 8種の createLink
// ---------------------------------------------------------------------------

describe("V5-001: relation types 8種", () => {
  const relations = ["follows", "extends", "updates", "shared_entity", "derives", "contradicts", "causes", "part_of"] as const;

  for (const rel of relations) {
    test(`createLink: relation="${rel}" が受け付けられる`, () => {
      const core = new HarnessMemCore(createConfig(`rel-${rel}`));
      const r1 = core.recordEvent(makeEvent({ session_id: "sA", project: "proj" }));
      const id1 = getObsId(r1);
      const r2 = core.recordEvent(makeEvent({ session_id: "sB", project: "proj" }));
      const id2 = getObsId(r2);
      const res = core.createLink({ from_observation_id: id1, to_observation_id: id2, relation: rel });
      expect(res.ok).toBe(true);
      const links = getLinkItems(core.getLinks({ observation_id: id1 }));
      const created = links.find((l) => l.relation === rel && l.to_observation_id === id2);
      expect(created).toBeDefined();
    });
  }
});

// ---------------------------------------------------------------------------
// 2. autoLink: 新キーワード検出
// ---------------------------------------------------------------------------

describe("V5-001: autoLink 新キーワード検出", () => {
  async function recordTwoInSession(
    core: HarnessMemCore,
    firstContent: string,
    secondContent: string,
    sessionId: string
  ): Promise<{ id1: string; id2: string }> {
    const r1 = core.recordEvent(
      makeEvent({
        session_id: sessionId,
        ts: new Date(Date.now() - 100).toISOString(),
        payload: { title: "First obs", content: firstContent },
      })
    );
    const id1 = getObsId(r1);
    await new Promise((r) => setTimeout(r, 15));
    const r2 = core.recordEvent(
      makeEvent({
        session_id: sessionId,
        ts: new Date().toISOString(),
        payload: { title: "Second obs", content: secondContent },
      })
    );
    const id2 = getObsId(r2);
    return { id1, id2 };
  }

  test("'however' を含むコンテンツで contradicts リンクが生成される", async () => {
    const core = new HarnessMemCore(createConfig("auto-however"));
    const { id1, id2 } = await recordTwoInSession(
      core,
      "initial observation about the topic",
      "however this contradicts the previous point",
      "sess-however"
    );
    const links = getLinkItems(core.getLinks({ observation_id: id2 }));
    const link = links.find((l) => l.relation === "contradicts" && l.to_observation_id === id1);
    expect(link).toBeDefined();
  });

  test("'しかし' を含むコンテンツで contradicts リンクが生成される", async () => {
    const core = new HarnessMemCore(createConfig("auto-shikashi"));
    const { id1, id2 } = await recordTwoInSession(
      core,
      "最初の観察内容",
      "しかし前の内容と矛盾する新たな事実が判明した",
      "sess-shikashi"
    );
    const links = getLinkItems(core.getLinks({ observation_id: id2 }));
    const link = links.find((l) => l.relation === "contradicts" && l.to_observation_id === id1);
    expect(link).toBeDefined();
  });

  test("'because' を含むコンテンツで causes リンクが生成される", async () => {
    const core = new HarnessMemCore(createConfig("auto-because"));
    const { id1, id2 } = await recordTwoInSession(
      core,
      "initial state of the system",
      "this happened because of the first event causing a chain reaction",
      "sess-because"
    );
    const links = getLinkItems(core.getLinks({ observation_id: id2 }));
    const link = links.find((l) => l.relation === "causes" && l.to_observation_id === id1);
    expect(link).toBeDefined();
  });

  test("'その結果' を含むコンテンツで causes リンクが生成される", async () => {
    const core = new HarnessMemCore(createConfig("auto-sonokekka"));
    const { id1, id2 } = await recordTwoInSession(
      core,
      "エラーの原因となった操作",
      "その結果、システム全体がダウンした",
      "sess-sonokekka"
    );
    const links = getLinkItems(core.getLinks({ observation_id: id2 }));
    const link = links.find((l) => l.relation === "causes" && l.to_observation_id === id1);
    expect(link).toBeDefined();
  });

  test("'part of' を含むコンテンツで part_of リンクが生成される", async () => {
    const core = new HarnessMemCore(createConfig("auto-partof"));
    const { id1, id2 } = await recordTwoInSession(
      core,
      "the larger system overview",
      "this module is part of the larger architecture",
      "sess-partof"
    );
    const links = getLinkItems(core.getLinks({ observation_id: id2 }));
    const link = links.find((l) => l.relation === "part_of" && l.to_observation_id === id1);
    expect(link).toBeDefined();
  });

  test("'に含まれる' を含むコンテンツで part_of リンクが生成される", async () => {
    const core = new HarnessMemCore(createConfig("auto-fukumareru"));
    const { id1, id2 } = await recordTwoInSession(
      core,
      "親システムの概要",
      "このコンポーネントはシステムに含まれる重要な部品だ",
      "sess-fukumareru"
    );
    const links = getLinkItems(core.getLinks({ observation_id: id2 }));
    const link = links.find((l) => l.relation === "part_of" && l.to_observation_id === id1);
    expect(link).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 3. weight 差別化: createLink の weight が正しく記録される
// ---------------------------------------------------------------------------

describe("V5-001: shared_entity weight 差別化", () => {
  test("weight=0.9 (package) で createLink するとその値が記録される", () => {
    const core = new HarnessMemCore(createConfig("weight-package"));
    const r1 = core.recordEvent(makeEvent({ session_id: "sA", project: "proj" }));
    const id1 = getObsId(r1);
    const r2 = core.recordEvent(makeEvent({ session_id: "sB", project: "proj" }));
    const id2 = getObsId(r2);
    const res = core.createLink({ from_observation_id: id1, to_observation_id: id2, relation: "shared_entity", weight: 0.9 });
    expect(res.ok).toBe(true);
    const links = getLinkItems(core.getLinks({ observation_id: id1 }));
    const link = links.find((l) => l.relation === "shared_entity" && l.to_observation_id === id2);
    expect(link).toBeDefined();
    expect(link?.weight).toBeCloseTo(0.9);
  });

  test("weight=0.8 (file) で createLink するとその値が記録される", () => {
    const core = new HarnessMemCore(createConfig("weight-file"));
    const r1 = core.recordEvent(makeEvent({ session_id: "sA", project: "proj" }));
    const id1 = getObsId(r1);
    const r2 = core.recordEvent(makeEvent({ session_id: "sB", project: "proj" }));
    const id2 = getObsId(r2);
    const res = core.createLink({ from_observation_id: id1, to_observation_id: id2, relation: "shared_entity", weight: 0.8 });
    expect(res.ok).toBe(true);
    const links = getLinkItems(core.getLinks({ observation_id: id1 }));
    const link = links.find((l) => l.relation === "shared_entity" && l.to_observation_id === id2);
    expect(link?.weight).toBeCloseTo(0.8);
  });
});

// ---------------------------------------------------------------------------
// 4. getSubgraph API
// ---------------------------------------------------------------------------

describe("V5-001: getSubgraph API", () => {
  test("存在しないエンティティで空グラフを返す", () => {
    const core = new HarnessMemCore(createConfig("subgraph-empty"));
    const result = core.getSubgraph("nonexistent-entity-xyz-999", 2);
    expect(result.nodes).toHaveLength(0);
    expect(result.edges).toHaveLength(0);
    expect(result.center_entity).toBe("nonexistent-entity-xyz-999");
    expect(result.depth).toBe(2);
  });

  test("depth 上限: 6 を指定しても depth=5 に制限される", () => {
    const core = new HarnessMemCore(createConfig("subgraph-depthlimit"));
    const result = core.getSubgraph("any-entity", 6);
    expect(result.depth).toBe(5);
  });

  test("depth 1 を指定したら depth=1 が返る", () => {
    const core = new HarnessMemCore(createConfig("subgraph-depth1val"));
    const result = core.getSubgraph("any-entity", 1);
    expect(result.depth).toBe(1);
  });

  test("depth 3 を指定したら depth=3 が返る", () => {
    const core = new HarnessMemCore(createConfig("subgraph-depth3val"));
    const result = core.getSubgraph("any-entity", 3);
    expect(result.depth).toBe(3);
  });

  test("nodes/edges/center_entity/depth フィールドが必ず存在する", () => {
    const core = new HarnessMemCore(createConfig("subgraph-fields"));
    const result = core.getSubgraph("any", 2);
    expect(result).toHaveProperty("nodes");
    expect(result).toHaveProperty("edges");
    expect(result).toHaveProperty("center_entity");
    expect(result).toHaveProperty("depth");
    expect(Array.isArray(result.nodes)).toBe(true);
    expect(Array.isArray(result.edges)).toBe(true);
  });

  test("limit=200 を指定しても nodes は最大 100 件", () => {
    const core = new HarnessMemCore(createConfig("subgraph-limit"));
    const result = core.getSubgraph("any-entity", 2, { limit: 200 });
    expect(result.nodes.length).toBeLessThanOrEqual(100);
  });

  test("project フィルタオプションが指定できる（エラーにならない）", () => {
    const core = new HarnessMemCore(createConfig("subgraph-project"));
    const result = core.getSubgraph("entity-proj", 2, { project: "my-project" });
    expect(Array.isArray(result.nodes)).toBe(true);
  });

  test("createLink で追加されたリンクは getLinks で relation が確認できる", () => {
    const core = new HarnessMemCore(createConfig("subgraph-linkcheck"));
    const r1 = core.recordEvent(makeEvent({ session_id: "sg-lc1", project: "proj" }));
    const id1 = getObsId(r1);
    const r2 = core.recordEvent(makeEvent({ session_id: "sg-lc2", project: "proj" }));
    const id2 = getObsId(r2);
    core.createLink({ from_observation_id: id1, to_observation_id: id2, relation: "causes" });
    const links = getLinkItems(core.getLinks({ observation_id: id1 }));
    expect(links.length).toBeGreaterThan(0);
    const causesLink = links.find((l) => l.relation === "causes");
    expect(causesLink).toBeDefined();
    expect(causesLink).toHaveProperty("from_observation_id");
    expect(causesLink).toHaveProperty("to_observation_id");
    expect(causesLink).toHaveProperty("relation");
    expect(causesLink).toHaveProperty("weight");
  });
});
