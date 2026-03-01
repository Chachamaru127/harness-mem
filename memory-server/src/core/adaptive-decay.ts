/**
 * COMP-002: 適応的メモリ減衰（Adaptive Decay）
 *
 * 3-tier decay モデル:
 *   hot  - 直近 24 時間以内にアクセスされた観察（乗数 1.0）
 *   warm - 直近 7 日以内にアクセスされた観察（乗数 0.7）
 *   cold - 7 日以上アクセスなし、または未アクセス（乗数 0.4）
 */

export type DecayTier = "hot" | "warm" | "cold";

/** hot の閾値: 24 時間（ミリ秒） */
const HOT_THRESHOLD_MS = 1000 * 60 * 60 * 24;

/** warm の閾値: 7 日（ミリ秒） */
const WARM_THRESHOLD_MS = 1000 * 60 * 60 * 24 * 7;

/** tier 別の乗数 */
const DECAY_MULTIPLIERS: Record<DecayTier, number> = {
  hot: 1.0,
  warm: 0.7,
  cold: 0.4,
};

/**
 * 最終アクセス時刻から decay tier を算出する。
 *
 * @param lastAccessedAt - ISO 8601 文字列、または null（未アクセス）
 * @param nowMs - 現在時刻（ミリ秒）。省略時は Date.now()
 */
export function getDecayTier(lastAccessedAt: string | null, nowMs: number = Date.now()): DecayTier {
  if (!lastAccessedAt) {
    return "cold";
  }
  const ageMs = nowMs - new Date(lastAccessedAt).getTime();
  if (ageMs < HOT_THRESHOLD_MS) {
    return "hot";
  }
  if (ageMs < WARM_THRESHOLD_MS) {
    return "warm";
  }
  return "cold";
}

/**
 * decay tier から乗数を返す。
 */
export function getDecayMultiplier(tier: DecayTier): number {
  return DECAY_MULTIPLIERS[tier];
}

/**
 * score に decay 乗数を適用したスコアを返す。
 */
export function applyDecayToScore(score: number, tier: DecayTier): number {
  return score * getDecayMultiplier(tier);
}
