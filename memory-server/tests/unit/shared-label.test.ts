/**
 * S58-006: チーム共有ラベル表示 — search レスポンスの shared_by / shared_at フィールドテスト
 *
 * テストケース:
 * 1. team_id 付き observation の検索結果に shared_by / shared_at が含まれる
 * 2. team_id なし observation の検索結果に shared_by / shared_at が含まれない
 * 3. shared_by は observation の user_id を返す
 * 4. shared_at は observation の updated_at を返す
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
  const dir = mkdtempSync(join(tmpdir(), `harness-shared-label-${name}-`));
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
    event_id: `shared-label-test-${evtCounter}-${Date.now()}`,
    event_type: "checkpoint",
    session_id: "test-session",
    platform: "claude",
    project: "test-project",
    ts: new Date().toISOString(),
    payload: { title: "Shared Label Test", content: "shared label content for search" },
    tags: [],
    privacy_tags: [],
    ...overrides,
  };
}

function getObsId(res: ReturnType<HarnessMemCore["recordEvent"]>): string {
  if (!res.ok || res.items.length === 0) {
    throw new Error(`recordEvent failed: ${res.error ?? JSON.stringify(res.meta)}`);
  }
  return (res.items[0] as { id: string }).id;
}

function insertTeam(core: HarnessMemCore, teamId: string): void {
  const db = core.getRawDb();
  const now = new Date().toISOString();
  db.query(
    `INSERT OR IGNORE INTO mem_teams (team_id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`
  ).run(teamId, `Team ${teamId}`, null, now, now);
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe("S58-006: チーム共有ラベル表示", () => {
  test("1. team_id 付き observation → shared_by / shared_at がレスポンスに含まれる", () => {
    const core = new HarnessMemCore(createConfig("with-team"));
    insertTeam(core, "team-alpha");

    const obsId = getObsId(core.recordEvent(makeEvent({ user_id: "alice" })));
    const shareRes = core.shareObservationToTeam({ observation_id: obsId, team_id: "team-alpha" });
    expect(shareRes.ok).toBe(true);

    const searchRes = core.search({
      query: "shared label content",
      project: "test-project",
      limit: 10,
    });

    expect(searchRes.ok).toBe(true);
    const items = searchRes.items as Array<Record<string, unknown>>;
    const found = items.find((item) => item.id === obsId);
    expect(found).toBeDefined();
    expect(found?.shared_by).toBeDefined();
    expect(found?.shared_at).toBeDefined();
    expect(typeof found?.shared_by).toBe("string");
    expect(typeof found?.shared_at).toBe("string");
  });

  test("2. team_id なし observation → shared_by / shared_at がレスポンスに含まれない", () => {
    const core = new HarnessMemCore(createConfig("without-team"));

    const obsId = getObsId(core.recordEvent(makeEvent({ user_id: "bob" })));

    const searchRes = core.search({
      query: "shared label content",
      project: "test-project",
      limit: 10,
    });

    expect(searchRes.ok).toBe(true);
    const items = searchRes.items as Array<Record<string, unknown>>;
    const found = items.find((item) => item.id === obsId);
    expect(found).toBeDefined();
    expect(found?.shared_by).toBeUndefined();
    expect(found?.shared_at).toBeUndefined();
  });

  test("3. shared_by は observation の user_id を返す", () => {
    const core = new HarnessMemCore(createConfig("user-id-check"));
    insertTeam(core, "team-beta");

    const obsId = getObsId(core.recordEvent(makeEvent({ user_id: "carol" })));
    core.shareObservationToTeam({ observation_id: obsId, team_id: "team-beta" });

    const searchRes = core.search({
      query: "shared label content",
      project: "test-project",
      limit: 10,
    });

    expect(searchRes.ok).toBe(true);
    const items = searchRes.items as Array<Record<string, unknown>>;
    const found = items.find((item) => item.id === obsId);
    expect(found).toBeDefined();
    expect(found?.shared_by).toBe("carol");
  });

  test("4. shared_at は文字列（ISO日時）として返される", () => {
    const core = new HarnessMemCore(createConfig("shared-at-check"));
    insertTeam(core, "team-gamma");

    const obsId = getObsId(core.recordEvent(makeEvent({ user_id: "dave" })));
    core.shareObservationToTeam({ observation_id: obsId, team_id: "team-gamma" });

    const searchRes = core.search({
      query: "shared label content",
      project: "test-project",
      limit: 10,
    });

    expect(searchRes.ok).toBe(true);
    const items = searchRes.items as Array<Record<string, unknown>>;
    const found = items.find((item) => item.id === obsId);
    expect(found).toBeDefined();
    const sharedAt = found?.shared_at as string;
    expect(typeof sharedAt).toBe("string");
    // ISO 8601形式であることを確認
    expect(new Date(sharedAt).toISOString()).toBe(sharedAt);
  });
});
