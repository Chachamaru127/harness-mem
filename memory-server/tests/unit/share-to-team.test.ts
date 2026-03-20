/**
 * S58-005: チーム記憶共有 — shareObservationToTeam のユニットテスト
 *
 * テストケース:
 * 1. 正常共有 → team_id が更新される
 * 2. 存在しない observation → エラー
 * 3. 存在しない team → エラー
 * 4. 冪等性 → 2回呼んでもエラーにならない（already_shared=true）
 * 5. 削除済み observation → エラー
 * 6. member ロール: 他ユーザーの observation を共有しようとする → エラー
 * 7. 監査ログに write.share_to_team が記録される
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
  const dir = mkdtempSync(join(tmpdir(), `harness-share-${name}-`));
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
    event_id: `share-test-${evtCounter}-${Date.now()}`,
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

function getObsId(res: ReturnType<HarnessMemCore["recordEvent"]>): string {
  if (!res.ok || res.items.length === 0) {
    throw new Error(`recordEvent failed: ${res.error ?? JSON.stringify(res.meta)}`);
  }
  return (res.items[0] as { id: string }).id;
}

/** チームを直接 DB に INSERT するヘルパー */
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

describe("S58-005: shareObservationToTeam", () => {
  test("1. 正常共有 — team_id が更新される", () => {
    const core = new HarnessMemCore(createConfig("normal"));
    insertTeam(core, "team-alpha");

    const obsId = getObsId(core.recordEvent(makeEvent()));
    const res = core.shareObservationToTeam({ observation_id: obsId, team_id: "team-alpha" });

    expect(res.ok).toBe(true);
    const item = res.items[0] as { observation_id: string; team_id: string; already_shared: boolean };
    expect(item.observation_id).toBe(obsId);
    expect(item.team_id).toBe("team-alpha");
    expect(item.already_shared).toBe(false);

    // DB で直接確認
    const db = core.getRawDb();
    const row = db.query<{ team_id: string }, string>(`SELECT team_id FROM mem_observations WHERE id = ?`).get(obsId);
    expect(row?.team_id).toBe("team-alpha");
  });

  test("2. 存在しない observation → エラー", () => {
    const core = new HarnessMemCore(createConfig("not-found-obs"));
    insertTeam(core, "team-beta");

    const res = core.shareObservationToTeam({ observation_id: "nonexistent-obs-id", team_id: "team-beta" });

    expect(res.ok).toBe(false);
    expect(res.error).toContain("not found");
  });

  test("3. 存在しない team → エラー", () => {
    const core = new HarnessMemCore(createConfig("not-found-team"));

    const obsId = getObsId(core.recordEvent(makeEvent()));
    const res = core.shareObservationToTeam({ observation_id: obsId, team_id: "nonexistent-team" });

    expect(res.ok).toBe(false);
    expect(res.error).toContain("not found");
  });

  test("4. 冪等性 — 2回呼んでもエラーにならない (already_shared=true)", () => {
    const core = new HarnessMemCore(createConfig("idempotent"));
    insertTeam(core, "team-gamma");

    const obsId = getObsId(core.recordEvent(makeEvent()));

    // 1回目
    const res1 = core.shareObservationToTeam({ observation_id: obsId, team_id: "team-gamma" });
    expect(res1.ok).toBe(true);
    expect((res1.items[0] as { already_shared: boolean }).already_shared).toBe(false);

    // 2回目（同一 team_id）
    const res2 = core.shareObservationToTeam({ observation_id: obsId, team_id: "team-gamma" });
    expect(res2.ok).toBe(true);
    expect((res2.items[0] as { already_shared: boolean }).already_shared).toBe(true);
  });

  test("5. 削除済み observation → エラー", () => {
    const core = new HarnessMemCore(createConfig("deleted-obs"));
    insertTeam(core, "team-delta");

    const obsId = getObsId(core.recordEvent(makeEvent()));

    // ソフトデリート (privacy_tags_json に "deleted" を追加)
    const db = core.getRawDb();
    db.query(`UPDATE mem_observations SET privacy_tags_json = '["deleted"]' WHERE id = ?`).run(obsId);

    const res = core.shareObservationToTeam({ observation_id: obsId, team_id: "team-delta" });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("deleted");
  });

  test("6. member ロール: 他ユーザーの observation は共有不可", () => {
    const core = new HarnessMemCore(createConfig("permission-check"));
    insertTeam(core, "team-epsilon");

    // user_id = "alice" の observation を作成
    const obsId = getObsId(core.recordEvent(makeEvent({ user_id: "alice" })));

    // bob として共有しようとする
    const res = core.shareObservationToTeam({ observation_id: obsId, team_id: "team-epsilon", user_id: "bob" });
    expect(res.ok).toBe(false);
    expect(res.error).toContain("Permission denied");
  });

  test("7. 監査ログに write.share_to_team が記録される", () => {
    const core = new HarnessMemCore(createConfig("audit-log"));
    insertTeam(core, "team-zeta");

    const obsId = getObsId(core.recordEvent(makeEvent()));
    const shareRes = core.shareObservationToTeam({ observation_id: obsId, team_id: "team-zeta" });
    expect(shareRes.ok).toBe(true);

    const auditRes = core.getAuditLog({ limit: 10, action: "write.share_to_team" });
    expect(auditRes.ok).toBe(true);
    const entries = auditRes.items as Array<{ action: string; target_id: string }>;
    const entry = entries.find((e) => e.action === "write.share_to_team" && e.target_id === obsId);
    expect(entry).toBeDefined();
  });
});
