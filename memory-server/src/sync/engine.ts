/**
 * NEXT-010: クロスデバイス同期エンジン
 *
 * HTTP ベースの変更セット交換によるデバイス間双方向同期を実装する。
 * コンフリクト解決ポリシー:
 * - last-write-wins: タイムスタンプが新しい方を採用（デフォルト）
 * - local-wins:      常にローカルを採用
 * - remote-wins:     常にリモートを採用
 */

/** 同期対象の観察レコード */
export interface SyncRecord {
  id: string;
  content: string;
  updated_at: string;
  device_id: string;
  [key: string]: unknown;
}

/** デバイス間で交換する変更セット */
export interface Changeset {
  /** 送信元デバイスID */
  device_id: string;
  /** この changeset に含まれる最古の updated_at (null = 全件) */
  since: string | null;
  /** 変更されたレコード群 */
  records: SyncRecord[];
}

/** コンフリクト情報 */
export interface ConflictInfo {
  id: string;
  local: SyncRecord;
  remote: SyncRecord;
  winner: SyncRecord;
}

/** mergeChangeset の結果 */
export interface MergeResult {
  /** マージ後のレコード群 */
  merged: SyncRecord[];
  /** 解決されたコンフリクト群 */
  conflicts: ConflictInfo[];
}

/** コンフリクト解決ポリシー */
export type ConflictPolicy = "last-write-wins" | "local-wins" | "remote-wins";

/**
 * ローカルレコード群から変更セットを生成する。
 *
 * @param records   ローカルの全レコード
 * @param deviceId  このデバイスのID
 * @param since     この日時以降に更新されたレコードのみ含める (null = 全件)
 */
export function buildChangeset(
  records: SyncRecord[],
  deviceId: string,
  since: string | null
): Changeset {
  const filtered = since
    ? records.filter((r) => r.updated_at > since)
    : records.slice();

  return {
    device_id: deviceId,
    since,
    records: filtered,
  };
}

/**
 * コンフリクト解決: 2つのレコードのうち、ポリシーに従った勝者を返す。
 *
 * @param local   ローカルのレコード
 * @param remote  リモートのレコード
 * @param policy  解決ポリシー
 */
export function resolveConflict(
  local: SyncRecord,
  remote: SyncRecord,
  policy: ConflictPolicy
): SyncRecord {
  switch (policy) {
    case "local-wins":
      return local;
    case "remote-wins":
      return remote;
    case "last-write-wins":
    default:
      // ISO 8601 の文字列比較で新しい方を選ぶ
      return remote.updated_at > local.updated_at ? remote : local;
  }
}

/**
 * ローカルレコードとリモート changeset をマージする。
 *
 * アルゴリズム:
 * 1. ローカルレコードを Map に積む
 * 2. リモートの各レコードを処理:
 *    - 新規 ID → そのまま追加
 *    - 既存 ID → ポリシーに従いコンフリクト解決
 * 3. マージ結果と解決済みコンフリクトリストを返す
 *
 * @param localRecords  ローカルのレコード群
 * @param remote        リモートから受信した changeset
 * @param policy        コンフリクト解決ポリシー
 */
export function mergeChangeset(
  localRecords: SyncRecord[],
  remote: Changeset,
  policy: ConflictPolicy
): MergeResult {
  const localMap = new Map<string, SyncRecord>();
  for (const rec of localRecords) {
    localMap.set(rec.id, rec);
  }

  const conflicts: ConflictInfo[] = [];

  for (const remoteRec of remote.records) {
    const localRec = localMap.get(remoteRec.id);

    if (!localRec) {
      // 新規レコード: ローカルに存在しないので追加
      localMap.set(remoteRec.id, remoteRec);
    } else if (localRec.updated_at !== remoteRec.updated_at) {
      // コンフリクト: 同一 ID で異なるタイムスタンプ
      const winner = resolveConflict(localRec, remoteRec, policy);
      localMap.set(remoteRec.id, winner);
      conflicts.push({
        id: remoteRec.id,
        local: localRec,
        remote: remoteRec,
        winner,
      });
    }
    // タイムスタンプが同一の場合はスキップ（冪等性保証）
  }

  return {
    merged: Array.from(localMap.values()),
    conflicts,
  };
}
