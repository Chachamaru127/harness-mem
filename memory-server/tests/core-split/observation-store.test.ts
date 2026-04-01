/**
 * IMP-004a: 観察ストアモジュール境界テスト
 *
 * ObservationStore を直接インスタンス化して単体テストする。
 * getObservations / search / feed / searchFacets / timeline を対象とする。
 */

import { afterEach, describe, expect, test } from "bun:test";
import type { Database } from "bun:sqlite";
import { ObservationStore, type ObservationStoreDeps } from "../../src/core/observation-store";
import { SqliteObservationRepository } from "../../src/db/repositories/SqliteObservationRepository";
import type { Config } from "../../src/core/types";
import type { Reranker } from "../../src/rerank/types";
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

function canonicalizeProject(project: string): string {
  return normalizeProject(project);
}

function expandProjectSelection(project: string): string[] {
  return [normalizeProject(project)];
}

function platformVisibilityFilterSql(_alias: string): string {
  return " AND 1=1";
}

function createDeps(
  db: Database,
  config: Config,
  overrides: Partial<ObservationStoreDeps> & {
    rerankerEnabled?: boolean;
    reranker?: Reranker | null;
  } = {}
): ObservationStoreDeps {
  const deps: ObservationStoreDeps = {
    db,
    repo: new SqliteObservationRepository(db),
    config,
    ftsEnabled: false,
    normalizeProject,
    canonicalizeProject,
    expandProjectSelection,
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
    getRerankerEnabled: () => overrides.rerankerEnabled ?? false,
    getReranker: () => overrides.reranker ?? null,
    managedShadowRead: null,
    searchRanking: "hybrid_v3",
    searchExpandLinks: false,
  };
  return {
    ...deps,
    ...overrides,
    getRerankerEnabled: () => overrides.rerankerEnabled ?? deps.getRerankerEnabled(),
    getReranker: () => overrides.reranker ?? deps.getReranker(),
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
  configOverrides: Partial<Config> = {},
  depOverrides: Parameters<typeof createDeps>[2] = {}
): { store: ObservationStore; db: Database } {
  const db = createTestDb();
  testDbs.push(db);
  const config = createTestConfig(configOverrides);
  const deps = createDeps(db, config, depOverrides);
  const store = new ObservationStore(deps);
  return { store, db };
}

function insertTestFact(
  db: Database,
  opts: {
    fact_id?: string;
    observation_id: string;
    project?: string;
    session_id?: string;
    fact_type?: string;
    fact_key: string;
    fact_value: string;
    confidence?: number;
    created_at?: string;
  }
): void {
  const now = opts.created_at || "2026-03-06T00:00:00.000Z";
  db.query(
    `INSERT INTO mem_facts(
      fact_id, observation_id, project, session_id, fact_type, fact_key, fact_value, confidence, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    opts.fact_id || `fact-${Math.random().toString(36).slice(2, 8)}`,
    opts.observation_id,
    opts.project || "proj-obs",
    opts.session_id || "test-session-001",
    opts.fact_type || "profile",
    opts.fact_key,
    opts.fact_value,
    opts.confidence ?? 0.95,
    now,
    now
  );
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

  test("adaptive ensemble query は primary / secondary の両モデル結果を融合する", () => {
    const { store, db } = makeStore(
      {},
      {
        getVectorEngine: () => "js-fallback",
        getVectorModelVersion: () => "local:ruri-v3-30m",
        vectorDimension: 2,
        buildQueryEmbeddings: () => ({
          route: "ensemble",
          analysis: { jaRatio: 0.7 },
          primary: { model: "local:ruri-v3-30m", vector: [1, 0] },
          secondary: { model: "openai:text-embedding-3-small", vector: [0, 1] },
        }),
      },
    );
    insertTestObservation(db, {
      id: "obs-ja",
      title: "alpha",
      content: "alpha content",
      project: "proj-obs",
    });
    insertTestObservation(db, {
      id: "obs-en",
      title: "beta",
      content: "beta content",
      project: "proj-obs",
    });
    db.query(
      `INSERT INTO mem_vectors(observation_id, model, dimension, vector_json, created_at, updated_at)
       VALUES (?, ?, 2, ?, '2026-02-20T00:00:00.000Z', '2026-02-20T00:00:00.000Z')`
    ).run("obs-ja", "local:ruri-v3-30m", "[1,0]");
    db.query(
      `INSERT INTO mem_vectors(observation_id, model, dimension, vector_json, created_at, updated_at)
       VALUES (?, ?, 2, ?, '2026-02-20T00:00:00.000Z', '2026-02-20T00:00:00.000Z')`
    ).run("obs-en", "openai:text-embedding-3-small", "[0,1]");

    const res = store.search({ query: "mixed bilingual retrieval", project: "proj-obs", limit: 5 });
    expect(res.ok).toBe(true);
    const ids = (res.items as Array<Record<string, unknown>>).map((item) => String(item.id));
    expect(ids).toContain("obs-ja");
    expect(ids).toContain("obs-en");
  });

  test("active facts を持つ exact-value 候補を company query で優先する", () => {
    const { store, db } = makeStore();
    insertTestObservation(db, {
      id: "obs-generic",
      title: "Career summary",
      content: "I joined a startup recently and the team is moving quickly with strong momentum.",
      project: "proj-obs",
    });
    insertTestObservation(db, {
      id: "obs-company",
      title: "New company",
      content: "I joined NeuralBridge in February 2024 as a backend engineer.",
      project: "proj-obs",
    });
    insertTestFact(db, {
      observation_id: "obs-company",
      project: "proj-obs",
      fact_key: "company",
      fact_value: "NeuralBridge",
    });

    const res = store.search({ query: "What company did I join?", project: "proj-obs", limit: 2 });
    expect(res.ok).toBe(true);
    expect((res.items[0] as Record<string, unknown>).id).toBe("obs-company");
  });

  test("numeric exact-value candidate を count query で優先する", () => {
    const { store, db } = makeStore();
    insertTestObservation(db, {
      id: "obs-summary",
      title: "Launch recap",
      content: "We reviewed the launch, discussed performance, and shared several follow-up tasks.",
      project: "proj-obs",
    });
    insertTestObservation(db, {
      id: "obs-rate",
      title: "Conversion rate",
      content: "The launch report says the conversion rate was 65% after the final experiment.",
      project: "proj-obs",
    });

    const res = store.search({ query: "What percentage was the conversion rate?", project: "proj-obs", limit: 2 });
    expect(res.ok).toBe(true);
    expect((res.items[0] as Record<string, unknown>).id).toBe("obs-rate");
  });

  test("alias query を canonical benchmark term へ展開して relevant result を返す", () => {
    const { store, db } = makeStore();
    insertTestObservation(db, {
      id: "obs-locomo",
      title: "LoCoMo benchmark freeze",
      content: "Backboard-Locomo-Benchmark based locomo benchmark freeze report.",
      project: "proj-obs",
    });

    const res = store.search({ query: "まさおベンチ", project: "proj-obs", limit: 3 });
    expect(res.ok).toBe(true);
    expect((res.items[0] as Record<string, unknown>).id).toBe("obs-locomo");
  });

  test("metric-focused natural fact query prefers focused numeric line over generic numeric summary", () => {
    const { store, db } = makeStore();
    insertTestObservation(db, {
      id: "obs-generic-number",
      title: "General release summary",
      content: "3回連続で同じ結果が出ており、全体としては実用レベルです。",
      project: "proj-obs",
    });
    insertTestObservation(db, {
      id: "obs-ja-gate-metric",
      title: "Japanese release gate metrics",
      content: "| overall F1 mean | 0.7645 |\n| cross_lingual F1 mean | 0.7563 |",
      project: "proj-obs",
    });

    const res = store.search({ query: "日本語 release gate の overall F1 はいくつ", project: "proj-obs", limit: 2 });
    expect(res.ok).toBe(true);
    expect((res.items[0] as Record<string, unknown>).id).toBe("obs-ja-gate-metric");
  });

  test("metric-focused natural fact query prefers exact metric phrase over nearby but different F1 summary", () => {
    const { store, db } = makeStore();
    insertTestObservation(db, {
      id: "obs-shadow-f1",
      title: "Japanese release gate review",
      content: "日本語 release gate の検討では shadow pack の F1=0.2407 と bilingual_recall=0.9 を見ました。",
      project: "proj-obs",
    });
    insertTestObservation(db, {
      id: "obs-overall-f1",
      title: "Japanese release gate metrics",
      content: "overall F1 mean=0.7645\ncross_lingual F1 mean=0.7563",
      project: "proj-obs",
    });

    const res = store.search({ query: "日本語 release gate の overall F1 はいくつ", project: "proj-obs", limit: 2 });
    expect(res.ok).toBe(true);
    expect((res.items[0] as Record<string, unknown>).id).toBe("obs-overall-f1");
  });

  test("freshness metric query prefers matching metric line over unrelated repeated counts", () => {
    const { store, db } = makeStore();
    insertTestObservation(db, {
      id: "obs-repeat-count",
      title: "General quality summary",
      content: "3回連続で同じ結果が出ているので、かなり安定しています。",
      project: "proj-obs",
    });
    insertTestObservation(db, {
      id: "obs-freshness-go",
      title: "S39 final GO metrics",
      content: "Freshness = 1.0000 で final GO を通過しました。",
      project: "proj-obs",
    });

    const res = store.search({ query: "§39 の最終GO時の freshness はいくつ", project: "proj-obs", limit: 2 });
    expect(res.ok).toBe(true);
    expect((res.items[0] as Record<string, unknown>).id).toBe("obs-freshness-go");
  });

  test("current-value query prefers concise current answer over verbose or previous statements", () => {
    const { store, db } = makeStore();
    insertTestObservation(db, {
      id: "obs-current-verbose",
      title: "Region rollout note",
      content:
        "ちなみに今の default region は Tokyo です。以前は us-east-1 でした。いまは運用の都合で Tokyo を選んでいます。",
      project: "proj-obs",
    });
    insertTestObservation(db, {
      id: "obs-current-concise",
      title: "Current region",
      content: "今の default region は Tokyo です。",
      project: "proj-obs",
    });
    insertTestObservation(db, {
      id: "obs-previous-region",
      title: "Previous region",
      content: "以前は us-east-1 でした。",
      project: "proj-obs",
    });

    const res = store.search({ query: "今の default region はどこですか？", project: "proj-obs", limit: 3 });
    expect(res.ok).toBe(true);
    expect((res.items[0] as Record<string, unknown>).id).toBe("obs-current-concise");
  });

  test("previous-value query prefers previous evidence over current statement", () => {
    const { store, db } = makeStore();
    insertTestObservation(db, {
      id: "obs-current-region",
      title: "Current region",
      content: "今の default region は Tokyo です。",
      project: "proj-obs",
      session_id: "test-session-current",
      created_at: "2026-03-01T00:00:00.000Z",
    });
    insertTestObservation(db, {
      id: "obs-previous-region-concise",
      title: "Previous default region",
      content: "以前の default region は us-east-1 でした。",
      project: "proj-obs",
      session_id: "test-session-previous",
      created_at: "2026-03-03T00:00:00.000Z",
    });
    insertTestObservation(db, {
      id: "obs-previous-region-verbose",
      title: "Region migration note",
      content: "今の default region は Tokyo です。以前は us-east-1 でした。",
      project: "proj-obs",
      session_id: "test-session-verbose",
      created_at: "2026-03-02T00:00:00.000Z",
    });

    const res = store.search({ query: "以前の default region は何でしたか？", project: "proj-obs", limit: 3 });
    expect(res.ok).toBe(true);
    const ids = res.items.map((item) => (item as Record<string, unknown>).id);
    expect(ids[0]).toMatch(/^obs-previous-region/);
    expect(ids.indexOf("obs-current-region")).toBeGreaterThan(0);
  });

  test("temporal ordering query prefers explicit ordinal answer over generic timeline chatter", () => {
    const { store, db } = makeStore();
    insertTestObservation(db, {
      id: "obs-temporal-generic",
      title: "Identity roadmap",
      content: "SSO と team workspaces を計画していました。あとで team workspaces を出しました。",
      project: "proj-obs",
    });
    insertTestObservation(db, {
      id: "obs-temporal-ordinal",
      title: "Identity ordering",
      content: "team workspaces が先に出ました。",
      project: "proj-obs",
    });

    const res = store.search({
      query: "SSO と team workspaces では、どちらが先に出ましたか？",
      project: "proj-obs",
      limit: 3,
    });
    expect(res.ok).toBe(true);
    expect((res.items[0] as Record<string, unknown>).id).toBe("obs-temporal-ordinal");
  });

  test("timeline query では semantic rerank より時系列順を優先する", () => {
    const reverseReranker: Reranker = {
      name: "reverse-test",
      rerank(input) {
        return [...input.items]
          .reverse()
          .map((item, index) => ({ ...item, rerank_score: 1 - index * 0.1 }));
      },
    };
    const { store, db } = makeStore({}, { rerankerEnabled: true, reranker: reverseReranker });
    insertTestObservation(db, {
      id: "obs-old",
      title: "Rollout timeline kickoff",
      content: "Rollout timeline kickoff milestone",
      project: "proj-obs",
      created_at: "2026-01-01T00:00:00.000Z",
    });
    insertTestObservation(db, {
      id: "obs-mid",
      title: "Rollout timeline beta",
      content: "Rollout timeline beta milestone",
      project: "proj-obs",
      created_at: "2026-02-01T00:00:00.000Z",
    });
    insertTestObservation(db, {
      id: "obs-new",
      title: "Rollout timeline launch",
      content: "Rollout timeline launch milestone",
      project: "proj-obs",
      created_at: "2026-03-01T00:00:00.000Z",
    });

    const res = store.search({
      query: "show the rollout timeline",
      project: "proj-obs",
      question_kind: "timeline",
      limit: 3,
    });

    expect(res.ok).toBe(true);
    const ids = (res.items as Array<Record<string, unknown>>).map((item) => String(item.id));
    expect(ids.slice(0, 3)).toEqual(["obs-old", "obs-mid", "obs-new"]);
  });
});

describe("observation-store: precision boost", () => {
  test("Japanese current-value hint prefers current statement over previous statement", () => {
    const { store } = makeStore();
    const hints = {
      intent: "current_value",
      exactValuePreferred: true,
      activeFactPreferred: true,
      slotKeywords: ["current", "今", "使っている", "ci"],
      focusKeywords: ["ci", "github actions"],
      metricKeywords: [],
    };

    const currentScore = (store as any).computePrecisionBoost("今、使っている CI は何ですか？", hints, {
      title: "",
      content_redacted: "今は GitHub Actions を使っています。",
    });
    const previousScore = (store as any).computePrecisionBoost("今、使っている CI は何ですか？", hints, {
      title: "",
      content_redacted: "ベータ版のビルドでは CircleCI を使っていました。",
    });

    expect(currentScore).toBeGreaterThan(previousScore);
  });

  test("temporal previous-value hint prefers previous statement over current statement", () => {
    const { store } = makeStore();
    const hints = {
      intent: "temporal_value",
      exactValuePreferred: true,
      activeFactPreferred: false,
      slotKeywords: ["previous", "before", "以前", "前の", "変える前"],
      focusKeywords: ["default", "region"],
      metricKeywords: [],
    };

    const previousScore = (store as any).computePrecisionBoost("以前の default region は何でしたか？", hints, {
      title: "",
      content_redacted: "以前は us-east-1 でした。",
    });
    const currentScore = (store as any).computePrecisionBoost("以前の default region は何でしたか？", hints, {
      title: "",
      content_redacted: "今の default region は Tokyo です。",
    });

    expect(previousScore).toBeGreaterThan(currentScore);
  });

  test("Japanese reason hint prefers causal sentence", () => {
    const { store } = makeStore();
    const hints = {
      intent: "reason",
      exactValuePreferred: true,
      activeFactPreferred: true,
      slotKeywords: ["reason", "理由", "because"],
      focusKeywords: ["circleci", "理由"],
      metricKeywords: [],
    };

    const causalScore = (store as any).computePrecisionBoost("CircleCI から移行した理由は何ですか？", hints, {
      title: "",
      content_redacted: "CircleCI の parallel build costs が上がり続けたからです。",
    });
    const neutralScore = (store as any).computePrecisionBoost("CircleCI から移行した理由は何ですか？", hints, {
      title: "",
      content_redacted: "ベータ版のビルドでは CircleCI を使っていました。",
    });

    expect(causalScore).toBeGreaterThan(neutralScore);
  });

  test("metric-value hint prefers focused metric line over unrelated numbers", () => {
    const { store } = makeStore();
    const hints = {
      intent: "metric_value",
      exactValuePreferred: true,
      activeFactPreferred: true,
      slotKeywords: ["f1", "overall f1", "score"],
      focusKeywords: ["overall f1", "ja-release-pack"],
      metricKeywords: ["overall f1"],
    };

    const focusedScore = (store as any).computePrecisionBoost("日本語 release gate の overall F1 はいくつ", hints, {
      title: "Japanese release gate metrics",
      content_redacted: "| overall F1 mean | 0.7645 |",
    });
    const genericScore = (store as any).computePrecisionBoost("日本語 release gate の overall F1 はいくつ", hints, {
      title: "General release summary",
      content_redacted: "3回連続で同じ結果が出ています。",
    });

    expect(focusedScore).toBeGreaterThan(genericScore);
  });

  test("metric-value hint penalizes command-like observations even when metric token appears", () => {
    const { store } = makeStore();
    const hints = {
      intent: "metric_value",
      exactValuePreferred: true,
      activeFactPreferred: true,
      slotKeywords: ["f1", "overall f1", "score"],
      focusKeywords: ["overall f1", "ja-release-pack"],
      metricKeywords: ["overall f1"],
    };

    const summaryScore = (store as any).computePrecisionBoost("日本語 release gate の overall F1 はいくつ", hints, {
      title: "Japanese release gate metrics",
      content_redacted: "`overall F1 mean=0.7645` を確認済みです。",
    });
    const commandScore = (store as any).computePrecisionBoost("日本語 release gate の overall F1 はいくつ", hints, {
      title: "Shell: jq overall_f1 extractor",
      content_redacted: "jq '{overall_f1:.metrics.overall.f1}' score-report.json",
    });

    expect(summaryScore).toBeGreaterThan(commandScore);
  });

  test("metric-value hint prefers exact metric phrase over generic F1 mention", () => {
    const { store } = makeStore();
    const hints = {
      intent: "metric_value",
      exactValuePreferred: true,
      activeFactPreferred: true,
      slotKeywords: ["f1", "overall f1", "score"],
      focusKeywords: ["overall f1", "overall f1 mean", "ja-release-pack", "日本語 release gate", "japanese release gate", "日本語"],
      metricKeywords: ["overall f1", "overall f1 mean", "overall", "f1"],
    };

    const exactMetricScore = (store as any).computePrecisionBoost("日本語 release gate の overall F1 はいくつ", hints, {
      title: "Japanese release gate metrics",
      content_redacted: "overall F1 mean=0.7645\ncross_lingual F1 mean=0.7563",
    });
    const genericMetricScore = (store as any).computePrecisionBoost("日本語 release gate の overall F1 はいくつ", hints, {
      title: "Japanese release gate review",
      content_redacted: "日本語 release gate の検討では shadow pack の F1=0.2407 と bilingual_recall=0.9 を見ました。",
    });

    expect(exactMetricScore).toBeGreaterThan(genericMetricScore);
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
// S43-005: temporal retrieval alignment — candidate depth + evidence coverage
// ---------------------------------------------------------------------------

describe("S43-005: temporal retrieval alignment", () => {
  // candidate depth: temporal クエリは通常クエリより多くの候補を取り込む
  test("temporal anchor クエリはアンカー後の観察を時系列順に返す", () => {
    const { store, db } = makeStore();
    // アンカー: "deployment"
    insertTestObservation(db, {
      id: "obs-anchor",
      title: "deployment completed",
      content: "The deployment to production was completed successfully.",
      project: "proj-s43",
      created_at: "2026-02-01T10:00:00.000Z",
    });
    // アンカー後の観察（時系列順）
    insertTestObservation(db, {
      id: "obs-after-1",
      title: "smoke test passed",
      content: "Smoke tests passed after deployment.",
      project: "proj-s43",
      created_at: "2026-02-01T11:00:00.000Z",
    });
    insertTestObservation(db, {
      id: "obs-after-2",
      title: "monitoring confirmed",
      content: "Monitoring confirmed stable after deployment.",
      project: "proj-s43",
      created_at: "2026-02-01T12:00:00.000Z",
    });
    insertTestObservation(db, {
      id: "obs-after-3",
      title: "incident report filed",
      content: "Incident report was filed after deployment review.",
      project: "proj-s43",
      created_at: "2026-02-01T13:00:00.000Z",
    });

    const res = store.search({
      query: "deployment の後に何が起きましたか？",
      project: "proj-s43",
      question_kind: "timeline",
      limit: 3,
    });

    expect(res.ok).toBe(true);
    // アンカー後の観察が含まれること
    const ids = (res.items as Array<Record<string, unknown>>).map((i) => String(i.id));
    const afterIds = ids.filter((id) => id.startsWith("obs-after"));
    expect(afterIds.length).toBeGreaterThanOrEqual(1);
  });

  // evidence coverage: top-3 quality candidate を確保する
  test("temporal クエリが limit=3 のとき少なくとも 1 件の関連観察を返す", () => {
    const { store, db } = makeStore();
    // テンポラルクエリに関連するコンテンツを持つ観察を複数挿入
    for (let i = 1; i <= 6; i++) {
      insertTestObservation(db, {
        id: `obs-seq-${i}`,
        title: `Step ${i}: localize the content`,
        content: `Localization step ${i}: content localized for region ${i}.`,
        project: "proj-seq",
        created_at: `2026-02-0${i}T10:00:00.000Z`,
      });
    }

    const res = store.search({
      query: "最初に localize したものは何ですか？",
      project: "proj-seq",
      question_kind: "timeline",
      limit: 3,
    });

    expect(res.ok).toBe(true);
    expect((res.items as unknown[]).length).toBeGreaterThanOrEqual(1);
  });

  // multi-observation evidence merge: 複数観察から証拠を統合
  test("後続の観察が anchor より前の観察を上書きせずに補完する", () => {
    const { store, db } = makeStore();
    insertTestObservation(db, {
      id: "obs-base",
      title: "initial setup done",
      content: "Initial setup was completed for the project.",
      project: "proj-merge",
      created_at: "2026-01-10T00:00:00.000Z",
    });
    insertTestObservation(db, {
      id: "obs-next-1",
      title: "launch playbook localized",
      content: "The launch playbook was localized for APAC.",
      project: "proj-merge",
      created_at: "2026-01-20T00:00:00.000Z",
    });
    insertTestObservation(db, {
      id: "obs-next-2",
      title: "invoice emails localized",
      content: "Invoice emails were localized as the next step after launch playbook.",
      project: "proj-merge",
      created_at: "2026-01-30T00:00:00.000Z",
    });

    const res = store.search({
      query: "launch playbook の次に localize したものは何ですか？",
      project: "proj-merge",
      question_kind: "timeline",
      limit: 5,
    });

    expect(res.ok).toBe(true);
    const items = res.items as Array<Record<string, unknown>>;
    // invoice emails の観察が含まれること（後続の証拠）
    const found = items.some((item) => String(item.id) === "obs-next-2");
    expect(found).toBe(true);
  });

  // internalLimit 拡張: temporal クエリでは候補が十分に集まること
  test("temporal クエリの meta に candidate_counts が含まれる", () => {
    const { store, db } = makeStore();
    insertTestObservation(db, {
      id: "obs-meta-1",
      title: "alert triggered",
      content: "Alert was triggered in the monitoring system.",
      project: "proj-meta",
      created_at: "2026-03-01T08:00:00.000Z",
    });
    insertTestObservation(db, {
      id: "obs-meta-2",
      title: "first response to alert",
      content: "The first response was to redirect read traffic.",
      project: "proj-meta",
      created_at: "2026-03-01T08:05:00.000Z",
    });

    const res = store.search({
      query: "alert の直後に最初にやったことは何ですか？",
      project: "proj-meta",
      question_kind: "timeline",
      limit: 5,
    });

    expect(res.ok).toBe(true);
    expect(res.meta).toBeDefined();
    // candidate_counts が含まれること
    const meta = res.meta as Record<string, unknown>;
    expect(meta.candidate_counts).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// timeline
// ---------------------------------------------------------------------------

describe("observation-store: timeline", () => {
  test("存在しない観察 ID では ok=false を返す", async () => {
    const { store } = makeStore();
    const res = await store.timeline({ id: "nonexistent-obs-id" });
    expect(res.ok).toBe(false);
  });

  test("有効な観察 ID でタイムラインが返る", async () => {
    const { store, db } = makeStore();
    const id = insertTestObservation(db, {
      project: "proj-obs",
      session_id: "sess-timeline",
      title: "timeline test event",
      content: "timeline test event",
      created_at: "2026-02-20T00:00:00.000Z",
    });
    const res = await store.timeline({ id });
    expect(res.ok).toBe(true);
    expect(res.items.length).toBeGreaterThan(0);
    const center = (res.items as Array<Record<string, unknown>>).find((i) => i.position === "center");
    expect(center).toBeDefined();
    expect(center?.id).toBe(id);
  });
});
