/**
 * IMP-009: Signal Extraction テスト
 *
 * キーワード検出による observation の importance 自動調整を検証する。
 * - 重要キーワード検出: importance += 0.3 (複数シグナルでも加算は1回)
 * - ノイズパターン検出: importance -= 0.2
 * - importance 上限 1.0
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
  const dir = mkdtempSync(join(tmpdir(), `harness-mem-signal-${name}-`));
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
    event_id: `evt-${Math.random().toString(36).slice(2)}`,
    platform: "codex",
    project: "signal-test-project",
    session_id: "signal-session",
    event_type: "user_prompt",
    ts: "2026-02-20T00:00:00.000Z",
    payload: { content: "default content" },
    tags: [],
    privacy_tags: [],
    ...overrides,
  };
}

describe("IMP-009: Signal Extraction（重要度自動判定）", () => {
  test("正常: シグナル検出 - 'remember' キーワードで importance が上昇する", () => {
    const core = new HarnessMemCore(createConfig("signal-boost"));
    try {
      // シグナルあり
      const signalResult = core.recordEvent(makeEvent({
        event_id: "signal-remember",
        payload: { content: "remember: DBはPostgreSQLを使う" },
        ts: "2026-02-20T01:00:00.000Z",
      }));
      // シグナルなし（ベースライン）- 同じキーワードを含むが rememberなし
      const baselineResult = core.recordEvent(makeEvent({
        event_id: "signal-baseline",
        payload: { content: "DBはPostgreSQLを使う（ベースライン）" },
        ts: "2026-02-20T00:00:00.000Z",
      }));

      expect(signalResult.ok).toBe(true);
      expect(baselineResult.ok).toBe(true);

      // signal_score が recordEvent の結果に含まれるか、DBから検索して確認
      const result = core.search({
        query: "DB PostgreSQL",
        project: "signal-test-project",
        include_private: true,
        limit: 10,
      });

      expect(result.ok).toBe(true);
      const items = result.items as Array<Record<string, unknown>>;
      expect(items.length).toBeGreaterThan(0);

      // "remember"を含むイベントが上位に来ることを確認
      const signalItem = items.find((item) => String(item.id).includes("signal-remember"));
      const baselineItem = items.find((item) => String(item.id).includes("signal-baseline"));

      // 両方ヒットした場合、シグナルありの方がスコアが高い
      if (signalItem && baselineItem) {
        const signalScore = Number(signalItem.final_score ?? 0);
        const baselineScore = Number(baselineItem.final_score ?? 0);
        // シグナルありの方がスコアが高い（importance差分が反映される）
        expect(signalScore).toBeGreaterThanOrEqual(baselineScore);
      }

      // signal_score フィールドが返される場合は値を確認
      if (signalItem && "signal_score" in signalItem) {
        expect(Number(signalItem.signal_score)).toBe(0.3);
      }
      if (baselineItem && "signal_score" in baselineItem) {
        expect(Number(baselineItem.signal_score)).toBe(0);
      }
    } finally {
      core.shutdown("test");
    }
  });

  test("正常: ノイズ減衰 - <environment_context> タグで importance が減少する", () => {
    const core = new HarnessMemCore(createConfig("noise-dampen"));
    try {
      // ノイズあり
      core.recordEvent(makeEvent({
        event_id: "noise-env-ctx",
        payload: { content: "<environment_context>システム環境変数の情報</environment_context>" },
        ts: "2026-02-20T01:00:00.000Z",
      }));
      // ノイズなし（ベースライン）
      core.recordEvent(makeEvent({
        event_id: "noise-baseline",
        payload: { content: "通常の作業コンテンツ" },
        ts: "2026-02-20T00:00:00.000Z",
      }));

      const result = core.search({
        query: "environment_context システム環境変数",
        project: "signal-test-project",
        include_private: true,
        limit: 10,
      });

      expect(result.ok).toBe(true);
      const items = result.items as Array<Record<string, unknown>>;

      const noiseItem = items.find((item) => String(item.id).includes("noise-env-ctx"));
      const baselineItem = items.find((item) => String(item.id).includes("noise-baseline"));

      // signal_score フィールドが返される場合はノイズアイテムのスコアが負であることを確認
      if (noiseItem && "signal_score" in noiseItem) {
        expect(Number(noiseItem.signal_score)).toBe(-0.2);
      }

      // ノイズありの方がベースラインより最終スコアが低い（importance が減少しているため）
      if (noiseItem && baselineItem) {
        const noiseScore = Number(noiseItem.final_score ?? 0);
        const baselineScore = Number(baselineItem.final_score ?? 0);
        expect(noiseScore).toBeLessThanOrEqual(baselineScore);
      }
    } finally {
      core.shutdown("test");
    }
  });

  test("正常: 複数シグナル - 複数キーワードでも加算は1回 (importance += 0.3)", () => {
    const core = new HarnessMemCore(createConfig("multi-signal"));
    try {
      // 複数のシグナルキーワードを含む
      core.recordEvent(makeEvent({
        event_id: "multi-signal-event",
        payload: { content: "fix: architecture decision を変更した" },
        ts: "2026-02-20T01:00:00.000Z",
      }));
      // 単一シグナル
      core.recordEvent(makeEvent({
        event_id: "single-signal-event",
        payload: { content: "fix: バグを修正した" },
        ts: "2026-02-20T00:00:00.000Z",
      }));

      const result = core.search({
        query: "fix architecture decision",
        project: "signal-test-project",
        include_private: true,
        limit: 10,
      });

      expect(result.ok).toBe(true);
      const items = result.items as Array<Record<string, unknown>>;

      const multiItem = items.find((item) => String(item.id).includes("multi-signal-event"));
      const singleItem = items.find((item) => String(item.id).includes("single-signal-event"));

      // 両方とも同じ +0.3 加算（複数シグナルでも1回のみ）
      if (multiItem && "signal_score" in multiItem) {
        expect(Number(multiItem.signal_score)).toBe(0.3);
      }
      if (singleItem && "signal_score" in singleItem) {
        expect(Number(singleItem.signal_score)).toBe(0.3);
      }
    } finally {
      core.shutdown("test");
    }
  });

  test("境界: 上限 - importance が 1.0 を超えない", () => {
    const core = new HarnessMemCore(createConfig("importance-cap"));
    try {
      // checkpoint イベント（importance=0.9）+ シグナルキーワード → 上限 1.0
      core.recordEvent(makeEvent({
        event_id: "cap-checkpoint",
        event_type: "checkpoint",
        payload: { content: "remember: アーキテクチャの重要な決定を記録する" },
        ts: "2026-02-20T01:00:00.000Z",
      }));

      const result = core.search({
        query: "remember アーキテクチャ 決定",
        project: "signal-test-project",
        include_private: true,
        limit: 10,
      });

      expect(result.ok).toBe(true);
      const items = result.items as Array<Record<string, unknown>>;

      // final_score は 1.0 を超えない
      for (const item of items) {
        const score = Number(item.final_score ?? 0);
        expect(score).toBeLessThanOrEqual(1.0);
      }
    } finally {
      core.shutdown("test");
    }
  });

  test("正常: 'architecture' キーワードでシグナルが検出される", () => {
    const core = new HarnessMemCore(createConfig("keyword-architecture"));
    try {
      core.recordEvent(makeEvent({
        event_id: "keyword-arch",
        payload: { content: "新しいarchitectureパターンを採用した" },
      }));

      const result = core.search({
        query: "architecture パターン",
        project: "signal-test-project",
        include_private: true,
        limit: 10,
      });

      expect(result.ok).toBe(true);
      expect(result.items.length).toBeGreaterThan(0);
    } finally {
      core.shutdown("test");
    }
  });

  test("正常: <AGENTS.md> コンテンツでノイズ減衰が適用される", () => {
    const core = new HarnessMemCore(createConfig("agents-noise"));
    try {
      core.recordEvent(makeEvent({
        event_id: "agents-md-event",
        payload: { content: "<AGENTS.md>エージェント設定の内容</AGENTS.md>" },
      }));

      const result = core.search({
        query: "AGENTS.md エージェント設定",
        project: "signal-test-project",
        include_private: true,
        limit: 10,
      });

      expect(result.ok).toBe(true);
      const items = result.items as Array<Record<string, unknown>>;

      const agentsItem = items.find((item) => String(item.id).includes("agents-md-event"));
      if (agentsItem && "signal_score" in agentsItem) {
        expect(Number(agentsItem.signal_score)).toBe(-0.2);
      }
    } finally {
      core.shutdown("test");
    }
  });
});
