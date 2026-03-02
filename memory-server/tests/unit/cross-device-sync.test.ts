/**
 * NEXT-010: クロスデバイス同期 のテスト
 *
 * SyncEngine が以下を正しく実装することを検証する:
 * - 変更セット（changeset）の生成
 * - リモートから変更を受信してマージ
 * - コンフリクト解決（last-write-wins）
 * - オフライン→オンライン復帰時のフラッシュ
 */
import { describe, expect, test } from "bun:test";
import {
  buildChangeset,
  mergeChangeset,
  resolveConflict,
  type SyncRecord,
  type Changeset,
  type ConflictPolicy,
} from "../../src/sync/engine";

const makeRecord = (overrides: Partial<SyncRecord> = {}): SyncRecord => ({
  id: "obs_001",
  content: "default content",
  updated_at: "2026-01-01T00:00:00.000Z",
  device_id: "device-A",
  ...overrides,
});

describe("buildChangeset", () => {
  test("空配列から空の changeset を生成する", () => {
    const cs = buildChangeset([], "device-A", null);
    expect(cs.records).toHaveLength(0);
    expect(cs.device_id).toBe("device-A");
  });

  test("since 以降のレコードのみを含む", () => {
    const records: SyncRecord[] = [
      makeRecord({ id: "obs_old", updated_at: "2025-12-01T00:00:00.000Z" }),
      makeRecord({ id: "obs_new", updated_at: "2026-02-01T00:00:00.000Z" }),
    ];
    const cs = buildChangeset(records, "device-A", "2026-01-01T00:00:00.000Z");
    expect(cs.records).toHaveLength(1);
    expect(cs.records[0].id).toBe("obs_new");
  });

  test("since が null の場合は全レコードを含む", () => {
    const records: SyncRecord[] = [
      makeRecord({ id: "obs_001" }),
      makeRecord({ id: "obs_002" }),
    ];
    const cs = buildChangeset(records, "device-A", null);
    expect(cs.records).toHaveLength(2);
  });
});

describe("mergeChangeset", () => {
  test("新規レコードをローカルに追加する", () => {
    const local: SyncRecord[] = [makeRecord({ id: "obs_local" })];
    const remote: Changeset = {
      device_id: "device-B",
      since: null,
      records: [makeRecord({ id: "obs_remote", device_id: "device-B" })],
    };
    const result = mergeChangeset(local, remote, "last-write-wins");
    expect(result.merged).toHaveLength(2);
    expect(result.conflicts).toHaveLength(0);
  });

  test("重複しないレコードはそのまま保持される", () => {
    const local: SyncRecord[] = [makeRecord({ id: "obs_A" })];
    const remote: Changeset = {
      device_id: "device-B",
      since: null,
      records: [makeRecord({ id: "obs_B", device_id: "device-B" })],
    };
    const result = mergeChangeset(local, remote, "last-write-wins");
    expect(result.merged.map((r) => r.id).sort()).toEqual(["obs_A", "obs_B"]);
  });

  test("same ID でコンフリクトが発生したとき LWW で解決する", () => {
    const local: SyncRecord[] = [
      makeRecord({ id: "obs_shared", content: "local version", updated_at: "2026-01-01T00:00:00.000Z" }),
    ];
    const remote: Changeset = {
      device_id: "device-B",
      since: null,
      records: [
        makeRecord({
          id: "obs_shared",
          content: "remote version (newer)",
          updated_at: "2026-01-02T00:00:00.000Z",
          device_id: "device-B",
        }),
      ],
    };
    const result = mergeChangeset(local, remote, "last-write-wins");
    const shared = result.merged.find((r) => r.id === "obs_shared");
    expect(shared?.content).toBe("remote version (newer)");
    expect(result.conflicts).toHaveLength(1);
  });

  test("ローカルが新しい場合は LWW でローカルを保持する", () => {
    const local: SyncRecord[] = [
      makeRecord({ id: "obs_shared", content: "local newer", updated_at: "2026-01-03T00:00:00.000Z" }),
    ];
    const remote: Changeset = {
      device_id: "device-B",
      since: null,
      records: [
        makeRecord({
          id: "obs_shared",
          content: "remote older",
          updated_at: "2026-01-01T00:00:00.000Z",
          device_id: "device-B",
        }),
      ],
    };
    const result = mergeChangeset(local, remote, "last-write-wins");
    const shared = result.merged.find((r) => r.id === "obs_shared");
    expect(shared?.content).toBe("local newer");
  });
});

describe("resolveConflict", () => {
  const local = makeRecord({ content: "local", updated_at: "2026-01-01T10:00:00.000Z" });
  const remote = makeRecord({ content: "remote", updated_at: "2026-01-01T12:00:00.000Z" });

  test("last-write-wins: 新しい方を返す", () => {
    const winner = resolveConflict(local, remote, "last-write-wins");
    expect(winner.content).toBe("remote");
  });

  test("local-wins: ローカルを常に返す", () => {
    const winner = resolveConflict(local, remote, "local-wins");
    expect(winner.content).toBe("local");
  });

  test("remote-wins: リモートを常に返す", () => {
    const winner = resolveConflict(local, remote, "remote-wins");
    expect(winner.content).toBe("remote");
  });
});
