/**
 * HARDEN-003: Sync HTTP エンドポイント用インメモリストア
 *
 * buildChangeset / mergeChangeset / resolveConflict を HTTP レイヤーに接続する。
 * HarnessMemCore との統合なしに、純粋な同期ロジックをカプセル化する。
 *
 * 注意: このストアはプロセスメモリ上に保持される（インメモリ実装）。
 * サーバー再起動でデータは消失する。永続化が必要な場合は SQLite / DB バックエンドに換装すること。
 */

import {
  buildChangeset,
  mergeChangeset,
  type Changeset,
  type ConflictPolicy,
  type MergeResult,
  type SyncRecord,
} from "./engine";

/** サーバーサイドの同期レコードストア */
export interface SyncStore {
  records: Map<string, SyncRecord>;
}

/** push 操作の結果 */
export interface SyncPushResult {
  ok: boolean;
  merged: SyncRecord[];
  conflicts: MergeResult["conflicts"];
}

/**
 * インメモリの SyncStore を生成する。
 */
export function createSyncStore(): SyncStore {
  return { records: new Map() };
}

/**
 * リモートの changeset をローカルストアにマージする（push）。
 *
 * @param store   ローカルストア
 * @param remote  リモートから受信した changeset
 * @param policy  コンフリクト解決ポリシー
 */
export function handleSyncPush(
  store: SyncStore,
  remote: Changeset,
  policy: ConflictPolicy
): SyncPushResult {
  const localRecords = Array.from(store.records.values());
  const { merged, conflicts } = mergeChangeset(localRecords, remote, policy);

  // ストアを更新
  store.records.clear();
  for (const rec of merged) {
    store.records.set(rec.id, rec);
  }

  return { ok: true, merged, conflicts };
}

/**
 * ローカルストアから差分 changeset を生成する（pull）。
 *
 * @param store     ローカルストア
 * @param deviceId  このサーバーのデバイスID
 * @param since     この日時以降に更新されたレコードのみ含める (null = 全件)
 */
export function handleSyncPull(
  store: SyncStore,
  deviceId: string,
  since: string | null
): Changeset {
  const records = Array.from(store.records.values());
  return buildChangeset(records, deviceId, since);
}
