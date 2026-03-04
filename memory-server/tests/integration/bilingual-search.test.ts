/**
 * bilingual-search.test.ts
 *
 * BM-011: 日英混在検索の回帰テスト。
 * BM-008（SYNONYM_MAP 日英エントリ追加）と BM-010（tokenize CJKバイグラム展開）の
 * 動作を保証する。
 */

import { describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir, homedir } from "node:os";
import { mkdtempSync } from "node:fs";
import { HarnessMemCore, type Config, type EventEnvelope } from "../../src/core/harness-mem-core";

function createCore(name: string): { core: HarnessMemCore; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), `harness-mem-bilingual-${name}-`));
  const config: Config = {
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
  return { core: new HarnessMemCore(config), dir };
}

function makeEvent(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    platform: "claude",
    project: "bilingual-test",
    session_id: "bi-session-1",
    event_type: "user_prompt",
    ts: "2026-03-04T00:00:00.000Z",
    payload: { content: "default" },
    tags: [],
    privacy_tags: [],
    ...overrides,
  };
}

describe("bilingual search regression (BM-011)", () => {
  // テスト1: 日本語コンテンツ（スペース区切り）→ 英語クエリでヒット
  test("Japanese content (space-separated) matched by English query via SYNONYM_MAP", () => {
    const { core, dir } = createCore("ja-en");
    try {
      // スペース区切り日本語コンテンツ（unicode61 tokenizer が各単語を分割できる形式）
      core.recordEvent(
        makeEvent({
          event_id: "bi-ja-deploy",
          payload: { content: "デプロイ 設定 を 更新 して 本番 環境 に 反映 した" },
        })
      );
      core.recordEvent(
        makeEvent({
          event_id: "bi-ja-auth",
          payload: { content: "認証 バグ が ログイン フロー で 発生 した ため 修正 を 適用 した" },
        })
      );
      // ノイズ（無関係なコンテンツ）
      core.recordEvent(
        makeEvent({
          event_id: "bi-noise-1",
          payload: { content: "meeting notes from last week discussed project roadmap" },
        })
      );

      // 英語クエリで日本語コンテンツを検索（SYNONYM_MAP: deploy → デプロイ）
      const result = core.search({
        query: "deploy config",
        project: "bilingual-test",
        include_private: true,
        strict_project: true,
        limit: 10,
      });

      expect(result.ok).toBe(true);
      const ids = result.items.map((item) => String((item as Record<string, unknown>).id ?? ""));
      expect(ids).toContain("obs_bi-ja-deploy");
    } finally {
      core.shutdown("test");
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // テスト2: 英語コンテンツ → 日本語クエリでヒット（SYNONYM_MAP逆引き）
  test("English content matched by Japanese query via SYNONYM_MAP reverse lookup", () => {
    const { core, dir } = createCore("en-ja");
    try {
      core.recordEvent(
        makeEvent({
          event_id: "bi-en-auth",
          payload: { content: "Fixed authentication bug in login flow by updating JWT token validation" },
        })
      );
      core.recordEvent(
        makeEvent({
          event_id: "bi-en-db",
          payload: { content: "Database migration completed successfully, added index for performance" },
        })
      );
      core.recordEvent(
        makeEvent({
          event_id: "bi-noise-2",
          payload: { content: "quarterly business review presentation slides updated" },
        })
      );

      // 日本語クエリで英語コンテンツを検索（SYNONYM_MAP: 認証 → auth, authentication）
      const result = core.search({
        query: "認証 バグ",
        project: "bilingual-test",
        include_private: true,
        strict_project: true,
        limit: 10,
      });

      expect(result.ok).toBe(true);
      const ids = result.items.map((item) => String((item as Record<string, unknown>).id ?? ""));
      expect(ids).toContain("obs_bi-en-auth");
    } finally {
      core.shutdown("test");
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // テスト3: 混在コンテンツ（スペース区切り）→ 英語クエリでヒット
  test("Mixed content matched by English query", () => {
    const { core, dir } = createCore("mixed-en");
    try {
      core.recordEvent(
        makeEvent({
          event_id: "bi-mixed-aws",
          payload: { content: "AWS Tokyo リージョン に deploy した 際 に エラー が 発生 した" },
        })
      );
      core.recordEvent(
        makeEvent({
          event_id: "bi-noise-3",
          payload: { content: "ランチ の メニュー を 決めた 今日 は 天気 が 良い" },
        })
      );

      const result = core.search({
        query: "AWS deploy error",
        project: "bilingual-test",
        include_private: true,
        strict_project: true,
        limit: 10,
      });

      expect(result.ok).toBe(true);
      const ids = result.items.map((item) => String((item as Record<string, unknown>).id ?? ""));
      expect(ids).toContain("obs_bi-mixed-aws");
    } finally {
      core.shutdown("test");
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // テスト4: カタカナ技術用語の SYNONYM_MAP 展開が動作すること
  test("Katakana technical terms expand via SYNONYM_MAP to English equivalents", () => {
    const { core, dir } = createCore("katakana-synonym");
    try {
      // 英語のみのコンテンツ
      core.recordEvent(
        makeEvent({
          event_id: "bi-kata-deploy",
          payload: { content: "deployment to production kubernetes cluster succeeded" },
        })
      );
      core.recordEvent(
        makeEvent({
          event_id: "bi-kata-db",
          payload: { content: "database schema migration applied with zero downtime" },
        })
      );
      core.recordEvent(
        makeEvent({
          event_id: "bi-noise-4",
          payload: { content: "project planning session for next quarter goals" },
        })
      );

      // カタカナクエリ → 英語コンテンツへの検索
      const deployResult = core.search({
        query: "デプロイ",
        project: "bilingual-test",
        include_private: true,
        strict_project: true,
        limit: 10,
      });

      expect(deployResult.ok).toBe(true);
      const deployIds = deployResult.items.map((item) => String((item as Record<string, unknown>).id ?? ""));
      expect(deployIds).toContain("obs_bi-kata-deploy");

      const dbResult = core.search({
        query: "データベース マイグレーション",
        project: "bilingual-test",
        include_private: true,
        strict_project: true,
        limit: 10,
      });

      expect(dbResult.ok).toBe(true);
      const dbIds = dbResult.items.map((item) => String((item as Record<string, unknown>).id ?? ""));
      expect(dbIds).toContain("obs_bi-kata-db");
    } finally {
      core.shutdown("test");
      rmSync(dir, { recursive: true, force: true });
    }
  });

  // テスト5: 漢字技術用語の SYNONYM_MAP 展開が動作すること
  test("Kanji technical terms expand via SYNONYM_MAP to English equivalents", () => {
    const { core, dir } = createCore("kanji-synonym");
    try {
      core.recordEvent(
        makeEvent({
          event_id: "bi-kanji-auth",
          payload: { content: "authentication system updated with new login flow and JWT refresh" },
        })
      );
      core.recordEvent(
        makeEvent({
          event_id: "bi-kanji-fix",
          payload: { content: "fix applied to resolve the critical error in payment processing" },
        })
      );
      core.recordEvent(
        makeEvent({
          event_id: "bi-noise-5",
          payload: { content: "team lunch scheduled for friday afternoon at the new restaurant" },
        })
      );

      // 漢字クエリ → 英語コンテンツへの検索（認証 → auth, authentication）
      const authResult = core.search({
        query: "認証",
        project: "bilingual-test",
        include_private: true,
        strict_project: true,
        limit: 10,
      });

      expect(authResult.ok).toBe(true);
      const authIds = authResult.items.map((item) => String((item as Record<string, unknown>).id ?? ""));
      expect(authIds).toContain("obs_bi-kanji-auth");

      // 修正 → fix, patch, resolve
      const fixResult = core.search({
        query: "修正",
        project: "bilingual-test",
        include_private: true,
        strict_project: true,
        limit: 10,
      });

      expect(fixResult.ok).toBe(true);
      const fixIds = fixResult.items.map((item) => String((item as Record<string, unknown>).id ?? ""));
      expect(fixIds).toContain("obs_bi-kanji-fix");
    } finally {
      core.shutdown("test");
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
