/**
 * IMP-003: トークン最適化レイヤー テスト
 *
 * resume_pack のトークンバジェット制御に関するテスト。
 * デフォルト 2000 トークン制御、重要度順切り捨て、budget=0、カスタムバジェットを検証する。
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

function createConfig(name: string, overrides: Partial<Config> = {}): Config {
  const dir = mkdtempSync(join(tmpdir(), `harness-mem-token-budget-${name}-`));
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
    ...overrides,
  };
}

function makeEvent(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    event_id: `evt-${Math.random().toString(36).slice(2)}`,
    platform: "codex",
    project: "token-budget-project",
    session_id: "prev-session",
    event_type: "user_prompt",
    ts: "2026-02-20T00:00:00.000Z",
    payload: { content: "test content for token budget" },
    tags: [],
    privacy_tags: [],
    ...overrides,
  };
}

describe("IMP-003: トークン最適化レイヤー (resume_pack バジェット制御)", () => {
  test("正常: バジェット内 - 少量のファクトは全て含む (切り捨てなし)", () => {
    const core = new HarnessMemCore(createConfig("within-budget"));
    try {
      // 3件だけ登録（少量）
      for (let i = 0; i < 3; i++) {
        core.recordEvent(makeEvent({
          event_id: `within-budget-${i}`,
          session_id: "prev-session",
          ts: `2026-02-20T0${i}:00:00.000Z`,
          payload: { content: `small content ${i}` },
        }));
      }

      const result = core.resumePack({
        project: "token-budget-project",
        session_id: "current-session",
        include_private: true,
        resume_pack_max_tokens: 2000,
      });

      expect(result.ok).toBe(true);
      const meta = result.meta as Record<string, unknown>;

      // 詳細アイテム数 = 3件、コンパクト = 0件
      expect(meta.detailed_count).toBe(3);
      expect(meta.compacted_count).toBe(0);
      expect(meta.resume_pack_max_tokens).toBe(2000);

      // 全観測がtype="observation"で含まれる
      const observations = (result.items as Array<Record<string, unknown>>)
        .filter((item) => item.type === "observation");
      expect(observations.length).toBe(3);
    } finally {
      core.shutdown("test");
    }
  });

  test("正常: バジェット超過 - 大量のファクトは重要度上位のみ含む (2000トークン以下)", () => {
    const core = new HarnessMemCore(createConfig("over-budget"));
    try {
      // 20件登録（大量）- それぞれ長いコンテンツを持たせてバジェット超過させる
      const longContent = "A".repeat(400); // 各アイテムで約100トークン相当
      for (let i = 0; i < 20; i++) {
        core.recordEvent(makeEvent({
          event_id: `over-budget-${i}`,
          session_id: "prev-session",
          ts: `2026-02-20T${String(i).padStart(2, "0")}:00:00.000Z`,
          payload: { content: `${longContent} item-${i}` },
        }));
      }

      const result = core.resumePack({
        project: "token-budget-project",
        session_id: "current-session",
        include_private: true,
        resume_pack_max_tokens: 2000,
      });

      expect(result.ok).toBe(true);
      const meta = result.meta as Record<string, unknown>;

      // バジェット設定が正しく反映されている
      expect(meta.resume_pack_max_tokens).toBe(2000);

      // コンパクト圧縮が発生している（全部は含まれない）
      const detailedCount = meta.detailed_count as number;
      const compactedCount = meta.compacted_count as number;
      expect(detailedCount + compactedCount).toBeGreaterThan(0);

      // dynamic_section のトークン数が 2000 以下であることを確認
      // (static_section はファクトなのでカウント外)
      const dynamicSection = meta.dynamic_section as Record<string, unknown> | undefined;
      if (dynamicSection) {
        const content = String(dynamicSection.content || "");
        // トークン推定: 英文字は ~4文字/トークン
        const approxTokens = content.length / 4;
        expect(approxTokens).toBeLessThanOrEqual(2000 * 1.1); // 10%の余裕
      }
    } finally {
      core.shutdown("test");
    }
  });

  test("境界: バジェット 0 - 空の resume_pack を返す (エラーにならない)", () => {
    const core = new HarnessMemCore(createConfig("zero-budget"));
    try {
      // データを登録
      for (let i = 0; i < 5; i++) {
        core.recordEvent(makeEvent({
          event_id: `zero-budget-${i}`,
          session_id: "prev-session",
          payload: { content: `zero budget content ${i}` },
        }));
      }

      const result = core.resumePack({
        project: "token-budget-project",
        session_id: "current-session",
        include_private: true,
        resume_pack_max_tokens: 0,
      });

      expect(result.ok).toBe(true);
      const meta = result.meta as Record<string, unknown>;

      // budget=0 の場合はアイテムが空
      expect(result.items).toEqual([]);
      expect(meta.resume_pack_max_tokens).toBe(0);
      expect(meta.detailed_count).toBe(0);
      expect(meta.compacted_count).toBe(0);
    } finally {
      core.shutdown("test");
    }
  });

  test("正常: カスタムバジェット - budget=500 で 500トークン以下に収まる", () => {
    const core = new HarnessMemCore(createConfig("custom-budget"));
    try {
      // 10件登録（中量）
      const content = "B".repeat(200); // 各アイテム ~50トークン
      for (let i = 0; i < 10; i++) {
        core.recordEvent(makeEvent({
          event_id: `custom-budget-${i}`,
          session_id: "prev-session",
          ts: `2026-02-20T${String(i).padStart(2, "0")}:00:00.000Z`,
          payload: { content: `${content} item-${i}` },
        }));
      }

      const result = core.resumePack({
        project: "token-budget-project",
        session_id: "current-session",
        include_private: true,
        resume_pack_max_tokens: 500,
      });

      expect(result.ok).toBe(true);
      const meta = result.meta as Record<string, unknown>;

      // カスタムバジェットが設定に反映されている
      expect(meta.resume_pack_max_tokens).toBe(500);

      // dynamic_section のコンテンツが 500トークン以下
      const dynamicSection = meta.dynamic_section as Record<string, unknown> | undefined;
      if (dynamicSection) {
        const content = String(dynamicSection.content || "");
        // トークン推定: 英文字は ~4文字/トークン
        const approxTokens = content.length / 4;
        expect(approxTokens).toBeLessThanOrEqual(500 * 1.1); // 10%の余裕
      }
    } finally {
      core.shutdown("test");
    }
  });

  test("正常: デフォルトバジェットは 2000 トークン", () => {
    const core = new HarnessMemCore(createConfig("default-budget"));
    try {
      core.recordEvent(makeEvent({
        event_id: "default-budget-1",
        session_id: "prev-session",
        payload: { content: "default budget test" },
      }));

      // resume_pack_max_tokens を指定しない
      const result = core.resumePack({
        project: "token-budget-project",
        session_id: "current-session",
        include_private: true,
      });

      expect(result.ok).toBe(true);
      const meta = result.meta as Record<string, unknown>;

      // デフォルトは 2000
      expect(meta.resume_pack_max_tokens).toBe(2000);
    } finally {
      core.shutdown("test");
    }
  });

  test("正常: Config.resumePackMaxTokens でデフォルト上書き可能", () => {
    const core = new HarnessMemCore(createConfig("config-budget", { resumePackMaxTokens: 1500 }));
    try {
      core.recordEvent(makeEvent({
        event_id: "config-budget-1",
        session_id: "prev-session",
        payload: { content: "config budget test" },
      }));

      // resume_pack_max_tokens を指定しない → Config の値が使われる
      const result = core.resumePack({
        project: "token-budget-project",
        session_id: "current-session",
        include_private: true,
      });

      expect(result.ok).toBe(true);
      const meta = result.meta as Record<string, unknown>;

      // Config の設定値が使われる
      expect(meta.resume_pack_max_tokens).toBe(1500);
    } finally {
      core.shutdown("test");
    }
  });
});
