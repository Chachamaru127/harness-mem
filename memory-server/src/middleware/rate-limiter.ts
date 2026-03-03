export interface RateLimitConfig {
  /** 1分あたりのリクエスト上限 */
  requestsPerMinute: number;
  /** バースト許容量（瞬間的な超過リクエスト数） */
  burstSize: number;
  /** クライアント識別方法 */
  keyBy: "ip" | "token" | "user_id";
}

interface Bucket {
  tokens: number;
  lastRefill: number;
}

export interface ConsumeResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export class TokenBucketRateLimiter {
  private buckets = new Map<string, Bucket>();

  constructor(private config: RateLimitConfig) {}

  /** リクエストを許可するか判定（Token Bucket アルゴリズム） */
  tryConsume(key: string): ConsumeResult {
    const now = Date.now();
    const refillRateMs = 60000 / this.config.requestsPerMinute;
    const maxTokens = this.config.burstSize;

    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { tokens: maxTokens, lastRefill: now };
      this.buckets.set(key, bucket);
    }

    // 経過時間に応じてトークンを補充
    const elapsed = now - bucket.lastRefill;
    const refilled = Math.floor(elapsed / refillRateMs);
    if (refilled > 0) {
      bucket.tokens = Math.min(maxTokens, bucket.tokens + refilled);
      bucket.lastRefill = now;
    }

    const resetAt = now + Math.ceil((1 - bucket.tokens) * refillRateMs);

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return { allowed: true, remaining: bucket.tokens, resetAt };
    }

    return { allowed: false, remaining: 0, resetAt };
  }

  /** Rate Limit レスポンスヘッダーを返す */
  getHeaders(key: string): Record<string, string> {
    const result = this.peek(key);
    return {
      "X-RateLimit-Limit": String(this.config.requestsPerMinute),
      "X-RateLimit-Remaining": String(result.remaining),
      "X-RateLimit-Reset": String(Math.ceil(result.resetAt / 1000)),
    };
  }

  /** トークン消費なしで現在の状態を確認 */
  private peek(key: string): ConsumeResult {
    const now = Date.now();
    const refillRateMs = 60000 / this.config.requestsPerMinute;
    const maxTokens = this.config.burstSize;

    const bucket = this.buckets.get(key);
    if (!bucket) {
      return { allowed: true, remaining: maxTokens, resetAt: now };
    }

    const elapsed = now - bucket.lastRefill;
    const refilled = Math.floor(elapsed / refillRateMs);
    const currentTokens = Math.min(maxTokens, bucket.tokens + refilled);
    const resetAt = now + Math.ceil((1 - currentTokens) * refillRateMs);

    return { allowed: currentTokens >= 1, remaining: currentTokens, resetAt };
  }

  /** バケットのクリア（テスト用） */
  reset(key?: string): void {
    if (key !== undefined) {
      this.buckets.delete(key);
    } else {
      this.buckets.clear();
    }
  }

  /** 古いバケットのクリーンアップ（メモリリーク防止） */
  cleanup(maxAgeMs = 300000): void {
    const now = Date.now();
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.lastRefill > maxAgeMs) {
        this.buckets.delete(key);
      }
    }
  }
}

/**
 * 環境変数 HARNESS_MEM_RATE_LIMIT から設定を読み込む。
 * 値が 0 の場合は Rate Limiting を無効化する（テスト時等に利用）。
 */
export function createRateLimiterFromEnv(): TokenBucketRateLimiter | null {
  const envValue = process.env.HARNESS_MEM_RATE_LIMIT;
  if (envValue === "0") {
    return null;
  }

  const requestsPerMinute = envValue ? parseInt(envValue, 10) : 120;
  if (!Number.isFinite(requestsPerMinute) || requestsPerMinute <= 0) {
    return null;
  }

  return new TokenBucketRateLimiter({
    requestsPerMinute,
    burstSize: Math.max(requestsPerMinute, 20),
    keyBy: "ip",
  });
}
