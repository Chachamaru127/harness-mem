/**
 * TEAM-003: ユーザー識別スキーマ拡張 のテスト
 *
 * mem_sessions/mem_events/mem_observations に user_id/team_id が記録されることを検証する。
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HarnessMemCore, getConfig, type Config } from "../../src/core/harness-mem-core";

type EnvSnapshot = {
  HARNESS_MEM_USER_ID?: string;
  HARNESS_MEM_TEAM_ID?: string;
};

function snapshotEnv(): EnvSnapshot {
  return {
    HARNESS_MEM_USER_ID: process.env.HARNESS_MEM_USER_ID,
    HARNESS_MEM_TEAM_ID: process.env.HARNESS_MEM_TEAM_ID,
  };
}

function restoreEnv(snapshot: EnvSnapshot): void {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete process.env[key as keyof EnvSnapshot];
    } else {
      process.env[key as keyof EnvSnapshot] = value;
    }
  }
}

function makeConfig(dir: string, overrides: Partial<Config> = {}): Config {
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
    ...overrides,
  };
}

describe("TEAM-003: ユーザー識別スキーマ拡張", () => {
  let envSnapshot: EnvSnapshot;

  beforeEach(() => {
    envSnapshot = snapshotEnv();
  });

  afterEach(() => {
    restoreEnv(envSnapshot);
  });

  test("イベント記録時に user_id と team_id が mem_observations に保存される", () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-mem-user-id-obs-"));
    const core = new HarnessMemCore(makeConfig(dir, {
      userId: "ohashi",
      teamId: "it-team",
    }));

    try {
      core.recordEvent({
        platform: "claude",
        project: "user-id-test",
        session_id: "session-uid-1",
        event_type: "user_prompt",
        ts: new Date().toISOString(),
        payload: { content: "ユーザー識別テストデータ" },
        tags: [],
        privacy_tags: [],
      });

      const db = (core as any).db;
      const obs = db.query(
        `SELECT user_id, team_id FROM mem_observations WHERE project = 'user-id-test' LIMIT 1`
      ).get() as { user_id: string; team_id: string | null } | null;

      expect(obs).not.toBeNull();
      expect(obs?.user_id).toBe("ohashi");
      expect(obs?.team_id).toBe("it-team");
    } finally {
      core.shutdown("test");
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("イベント記録時に user_id が mem_events に保存される", () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-mem-user-id-events-"));
    const core = new HarnessMemCore(makeConfig(dir, {
      userId: "fujisaki",
      teamId: "it-team",
    }));

    try {
      core.recordEvent({
        event_id: "uid-event-1",
        platform: "claude",
        project: "user-id-events",
        session_id: "session-uid-2",
        event_type: "user_prompt",
        ts: new Date().toISOString(),
        payload: { content: "イベントユーザー識別テスト" },
        tags: [],
        privacy_tags: [],
      });

      const db = (core as any).db;
      const event = db.query(
        `SELECT user_id, team_id FROM mem_events WHERE event_id = 'uid-event-1' LIMIT 1`
      ).get() as { user_id: string; team_id: string | null } | null;

      expect(event).not.toBeNull();
      expect(event?.user_id).toBe("fujisaki");
      expect(event?.team_id).toBe("it-team");
    } finally {
      core.shutdown("test");
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("セッション作成時に user_id/team_id が mem_sessions に保存される", () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-mem-user-id-sessions-"));
    const core = new HarnessMemCore(makeConfig(dir, {
      userId: "tanaka",
      teamId: "marketing",
    }));

    try {
      core.recordEvent({
        platform: "claude",
        project: "user-id-sessions",
        session_id: "session-uid-3",
        event_type: "user_prompt",
        ts: new Date().toISOString(),
        payload: { content: "セッションユーザー識別テスト" },
        tags: [],
        privacy_tags: [],
      });

      const db = (core as any).db;
      const session = db.query(
        `SELECT user_id, team_id FROM mem_sessions WHERE session_id = 'session-uid-3' LIMIT 1`
      ).get() as { user_id: string; team_id: string | null } | null;

      expect(session).not.toBeNull();
      expect(session?.user_id).toBe("tanaka");
      expect(session?.team_id).toBe("marketing");
    } finally {
      core.shutdown("test");
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("userId 未設定時は 'default' が使われる", () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-mem-user-id-default-"));
    const core = new HarnessMemCore(makeConfig(dir));

    try {
      core.recordEvent({
        platform: "claude",
        project: "user-id-default",
        session_id: "session-uid-default",
        event_type: "user_prompt",
        ts: new Date().toISOString(),
        payload: { content: "デフォルトユーザー識別テスト" },
        tags: [],
        privacy_tags: [],
      });

      const db = (core as any).db;
      const obs = db.query(
        `SELECT user_id, team_id FROM mem_observations WHERE project = 'user-id-default' LIMIT 1`
      ).get() as { user_id: string; team_id: string | null } | null;

      expect(obs).not.toBeNull();
      expect(obs?.user_id).toBe("default");
      expect(obs?.team_id).toBeNull();
    } finally {
      core.shutdown("test");
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("getConfig() が HARNESS_MEM_USER_ID / HARNESS_MEM_TEAM_ID を読み取る", () => {
    process.env.HARNESS_MEM_USER_ID = "test-user";
    process.env.HARNESS_MEM_TEAM_ID = "test-team";

    const config = getConfig();
    expect(config.userId).toBe("test-user");
    expect(config.teamId).toBe("test-team");
  });
});
