/**
 * COMP-013: 自動リフレクション
 *
 * 矛盾ファクトを検出・解消するリフレクションモジュール。
 *
 * 矛盾ファクトの定義:
 *   同じ fact_key を持ちながら異なる fact_value を持つファクト群。
 *   新しい created_at を持つファクトが「正しい」情報として残り、
 *   古いファクトは superseded_by でマークされる。
 */

import type { ConsolidationFact } from "./deduper";

export interface FactConflict {
  /** 古い（上書きされる）ファクトのID */
  older_fact_id: string;
  /** 新しい（優先される）ファクトのID */
  newer_fact_id: string;
  /** 矛盾しているファクトキー */
  fact_key: string;
}

export interface FactSupersededDecision {
  fact_id: string;
  superseded_by: string;
}

/**
 * ファクト一覧から矛盾するペアを検出する。
 * - 同じ fact_key かつ異なる fact_value を持つファクトを対象
 * - 時系列順（created_at 昇順）でソートして ancient → newer の関係を特定
 * @param facts - 検査対象のファクト一覧
 * @returns 矛盾するペアのリスト
 */
export function detectConflictingFacts(facts: ConsolidationFact[]): FactConflict[] {
  // fact_key ごとにファクトをグループ化
  const byKey = new Map<string, ConsolidationFact[]>();
  for (const fact of facts) {
    const key = `${fact.fact_type}::${fact.fact_key}`;
    const group = byKey.get(key) ?? [];
    group.push(fact);
    byKey.set(key, group);
  }

  const conflicts: FactConflict[] = [];

  for (const group of byKey.values()) {
    if (group.length < 2) continue;

    // created_at で昇順ソート（古い順）
    const sorted = [...group].sort((a, b) =>
      String(a.created_at || "").localeCompare(String(b.created_at || "")) ||
      a.fact_id.localeCompare(b.fact_id)
    );

    // 全ユニーク値の集合を確認
    const uniqueValues = new Set(sorted.map(f => f.fact_value));
    if (uniqueValues.size <= 1) {
      // 全て同じ値なら矛盾なし
      continue;
    }

    // 矛盾あり: 連続するペアごとに矛盾を記録
    for (let i = 0; i < sorted.length - 1; i++) {
      const older = sorted[i];
      const newer = sorted[i + 1];
      if (older.fact_value !== newer.fact_value) {
        conflicts.push({
          older_fact_id: older.fact_id,
          newer_fact_id: newer.fact_id,
          fact_key: older.fact_key,
        });
      }
    }
  }

  return conflicts;
}

/**
 * 矛盾ファクトを解消するための superseded_by 更新決定リストを生成する。
 * 古いファクト（older_fact_id）を新しいファクト（newer_fact_id）で上書き扱いにする。
 * @param conflicts - detectConflictingFacts で検出した矛盾リスト
 * @returns superseded_by 更新決定リスト
 */
export function resolveConflicts(conflicts: FactConflict[]): FactSupersededDecision[] {
  return conflicts.map(conflict => ({
    fact_id: conflict.older_fact_id,
    superseded_by: conflict.newer_fact_id,
  }));
}
