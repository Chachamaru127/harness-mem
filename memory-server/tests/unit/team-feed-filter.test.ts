/**
 * TEAM-009: チームフィード + ユーザーフィルター テスト
 *
 * テストケース:
 * 1. 正常: user_id フィルターなし時は全ユーザーの観察が返る
 * 2. 正常: user_id フィルターありで特定ユーザーの観察のみ返る
 * 3. 正常: team_id フィルターありで特定チームの観察のみ返る
 * 4. 正常: user_id + team_id の組み合わせフィルターが動作する
 * 5. 境界: 存在しない user_id は空の結果を返す
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
  const dir = mkdtempSync(join(tmpdir(), `harness-mem-teamfeed-${name}-`));
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
    localModelsEnabled: false,
    antigravityEnabled: false,
  };
}

function makeEventForUser(title: string, content: string, userId?: string, teamId?: string): EventEnvelope {
  return {
    event_type: "observation",
    platform: "claude",
    project: "team-project",
    session_id: `sess-${userId || "anon"}`,
    payload: { title, content, observation_type: "context" },
    metadata: {},
    user_id: userId,
    team_id: teamId,
  };
}

describe("TEAM-009: チームフィード + ユーザーフィルター", () => {
  test("正常: user_id フィルターなし時は全ユーザーの観察が返る", () => {
    const core = new HarnessMemCore(createConfig("all-users"));
    core.recordEvent(makeEventForUser("UserA Obs", "Content A", "user-alice", "team-eng"));
    core.recordEvent(makeEventForUser("UserB Obs", "Content B", "user-bob", "team-eng"));
    core.recordEvent(makeEventForUser("UserC Obs", "Content C", "user-carol", "team-mkt"));

    const result = core.feed({ project: "team-project", limit: 10 });
    expect(result.ok).toBe(true);
    expect(result.items.length).toBe(3);
  });

  test("正常: user_id フィルターで特定ユーザーの観察のみ返る", () => {
    const core = new HarnessMemCore(createConfig("user-filter"));
    core.recordEvent(makeEventForUser("Alice Obs 1", "Alice content 1", "user-alice", "team-eng"));
    core.recordEvent(makeEventForUser("Alice Obs 2", "Alice content 2", "user-alice", "team-eng"));
    core.recordEvent(makeEventForUser("Bob Obs", "Bob content", "user-bob", "team-eng"));

    const result = core.feed({ project: "team-project", user_id: "user-alice", limit: 10 });
    expect(result.ok).toBe(true);
    expect(result.items.length).toBe(2);
    const items = result.items as Array<Record<string, unknown>>;
    for (const item of items) {
      expect(item.user_id).toBe("user-alice");
    }
  });

  test("正常: team_id フィルターで特定チームの観察のみ返る", () => {
    const core = new HarnessMemCore(createConfig("team-filter"));
    core.recordEvent(makeEventForUser("Eng Obs 1", "Engineering content", "user-alice", "team-eng"));
    core.recordEvent(makeEventForUser("Eng Obs 2", "Engineering content 2", "user-bob", "team-eng"));
    core.recordEvent(makeEventForUser("Mkt Obs", "Marketing content", "user-carol", "team-mkt"));

    const result = core.feed({ project: "team-project", team_id: "team-eng", limit: 10 });
    expect(result.ok).toBe(true);
    expect(result.items.length).toBe(2);
    const items = result.items as Array<Record<string, unknown>>;
    for (const item of items) {
      expect(item.team_id).toBe("team-eng");
    }
  });

  test("正常: user_id + team_id の組み合わせフィルターが動作する", () => {
    const core = new HarnessMemCore(createConfig("combo-filter"));
    core.recordEvent(makeEventForUser("Alice Eng", "Alice eng content", "user-alice", "team-eng"));
    core.recordEvent(makeEventForUser("Alice Mkt", "Alice mkt content", "user-alice", "team-mkt"));
    core.recordEvent(makeEventForUser("Bob Eng", "Bob eng content", "user-bob", "team-eng"));

    const result = core.feed({ project: "team-project", user_id: "user-alice", team_id: "team-eng", limit: 10 });
    expect(result.ok).toBe(true);
    expect(result.items.length).toBe(1);
    const item = result.items[0] as Record<string, unknown>;
    expect(item.user_id).toBe("user-alice");
    expect(item.team_id).toBe("team-eng");
  });

  test("境界: 存在しない user_id は空の結果を返す", () => {
    const core = new HarnessMemCore(createConfig("empty-user"));
    core.recordEvent(makeEventForUser("Obs", "Content", "user-alice", "team-eng"));

    const result = core.feed({ project: "team-project", user_id: "nonexistent-user", limit: 10 });
    expect(result.ok).toBe(true);
    expect(result.items.length).toBe(0);
  });
});
