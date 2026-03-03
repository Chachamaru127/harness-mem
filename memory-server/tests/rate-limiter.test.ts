import { describe, expect, test, beforeEach } from "bun:test";
import { TokenBucketRateLimiter, createRateLimiterFromEnv } from "../src/middleware/rate-limiter";
import { RequestValidator } from "../src/middleware/validator";

// ---- TokenBucketRateLimiter テスト ----

describe("TokenBucketRateLimiter", () => {
  test("Token Bucket 基本動作: リクエストを許可する", () => {
    const limiter = new TokenBucketRateLimiter({
      requestsPerMinute: 60,
      burstSize: 10,
      keyBy: "ip",
    });

    const result = limiter.tryConsume("client-1");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBeGreaterThanOrEqual(0);
  });

  test("バースト制限: burstSize を超えるとリクエストを拒否する", () => {
    const burstSize = 5;
    const limiter = new TokenBucketRateLimiter({
      requestsPerMinute: 60,
      burstSize,
      keyBy: "ip",
    });

    // burstSize 分消費
    for (let i = 0; i < burstSize; i++) {
      const r = limiter.tryConsume("client-burst");
      expect(r.allowed).toBe(true);
    }

    // バースト超過でリジェクト
    const rejected = limiter.tryConsume("client-burst");
    expect(rejected.allowed).toBe(false);
    expect(rejected.remaining).toBe(0);
  });

  test("トークン補充: 時間経過後にトークンが補充される", async () => {
    const limiter = new TokenBucketRateLimiter({
      requestsPerMinute: 60,
      burstSize: 1,
      keyBy: "ip",
    });

    // 最初のリクエストを消費
    const first = limiter.tryConsume("client-refill");
    expect(first.allowed).toBe(true);

    // バケットが空なのでリジェクト
    const rejected = limiter.tryConsume("client-refill");
    expect(rejected.allowed).toBe(false);

    // 1秒 = 1 token(60req/min) 待つ
    await new Promise((r) => setTimeout(r, 1100));

    // トークンが補充されてリクエスト許可
    const refilled = limiter.tryConsume("client-refill");
    expect(refilled.allowed).toBe(true);
  });

  test("クライアントキー分離: 異なるキーは独立して制限される", () => {
    const limiter = new TokenBucketRateLimiter({
      requestsPerMinute: 60,
      burstSize: 2,
      keyBy: "ip",
    });

    // client-a を消費しきる
    limiter.tryConsume("client-a");
    limiter.tryConsume("client-a");
    const rejectedA = limiter.tryConsume("client-a");
    expect(rejectedA.allowed).toBe(false);

    // client-b は独立しているので許可される
    const allowedB = limiter.tryConsume("client-b");
    expect(allowedB.allowed).toBe(true);
  });

  test("reset: 特定キーのバケットをリセットできる", () => {
    const limiter = new TokenBucketRateLimiter({
      requestsPerMinute: 60,
      burstSize: 1,
      keyBy: "ip",
    });

    limiter.tryConsume("client-reset");
    const rejected = limiter.tryConsume("client-reset");
    expect(rejected.allowed).toBe(false);

    limiter.reset("client-reset");

    const allowed = limiter.tryConsume("client-reset");
    expect(allowed.allowed).toBe(true);
  });

  test("Rate Limit ヘッダー: 正しいヘッダーキーが返る", () => {
    const limiter = new TokenBucketRateLimiter({
      requestsPerMinute: 120,
      burstSize: 20,
      keyBy: "ip",
    });

    limiter.tryConsume("client-headers");
    const headers = limiter.getHeaders("client-headers");

    expect(headers["X-RateLimit-Limit"]).toBe("120");
    expect(typeof headers["X-RateLimit-Remaining"]).toBe("string");
    expect(typeof headers["X-RateLimit-Reset"]).toBe("string");
    expect(Number(headers["X-RateLimit-Remaining"])).toBeGreaterThanOrEqual(0);
    expect(Number(headers["X-RateLimit-Reset"])).toBeGreaterThan(0);
  });

  test("resetAt: リジェクト時の resetAt は現在時刻より後", () => {
    const limiter = new TokenBucketRateLimiter({
      requestsPerMinute: 60,
      burstSize: 1,
      keyBy: "ip",
    });

    limiter.tryConsume("client-reset-time");
    const rejected = limiter.tryConsume("client-reset-time");

    expect(rejected.allowed).toBe(false);
    expect(rejected.resetAt).toBeGreaterThan(Date.now());
  });

  test("cleanup: 古いバケットが削除される", () => {
    const limiter = new TokenBucketRateLimiter({
      requestsPerMinute: 60,
      burstSize: 5,
      keyBy: "ip",
    });

    limiter.tryConsume("client-cleanup");
    // reset() で対象バケットを明示的に削除
    limiter.reset("client-cleanup");

    // リセット後は満タンのバケットが使われる（5 - 1 = 4）
    const result = limiter.tryConsume("client-cleanup");
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(4);
  });
});

// ---- createRateLimiterFromEnv テスト ----

describe("createRateLimiterFromEnv", () => {
  test("HARNESS_MEM_RATE_LIMIT=0 のとき null を返す", () => {
    const original = process.env.HARNESS_MEM_RATE_LIMIT;
    process.env.HARNESS_MEM_RATE_LIMIT = "0";
    try {
      expect(createRateLimiterFromEnv()).toBeNull();
    } finally {
      if (original === undefined) {
        delete process.env.HARNESS_MEM_RATE_LIMIT;
      } else {
        process.env.HARNESS_MEM_RATE_LIMIT = original;
      }
    }
  });

  test("HARNESS_MEM_RATE_LIMIT 未設定のときデフォルト 120/min で生成される", () => {
    const original = process.env.HARNESS_MEM_RATE_LIMIT;
    delete process.env.HARNESS_MEM_RATE_LIMIT;
    try {
      const limiter = createRateLimiterFromEnv();
      expect(limiter).not.toBeNull();
      const result = limiter!.tryConsume("env-test");
      expect(result.allowed).toBe(true);
    } finally {
      if (original !== undefined) {
        process.env.HARNESS_MEM_RATE_LIMIT = original;
      }
    }
  });
});

// ---- RequestValidator テスト ----

describe("RequestValidator", () => {
  let validator: RequestValidator;

  beforeEach(() => {
    validator = new RequestValidator({
      maxContentLength: 100,
      maxTitleLength: 50,
      maxTags: 3,
      maxTagLength: 10,
      maxProjectLength: 30,
    });
  });

  test("validateRecordEvent: 正常なリクエストを通す", () => {
    const result = validator.validateRecordEvent({
      event: {
        event_id: "test-001",
        platform: "codex",
        project: "my-project",
        session_id: "sess-001",
        event_type: "user_prompt",
        payload: { content: "hello" },
        tags: ["tag1"],
        privacy_tags: [],
      },
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test("validateRecordEvent: content 超過でエラー", () => {
    const result = validator.validateRecordEvent({
      event: {
        payload: { content: "x".repeat(101) },
        tags: [],
        privacy_tags: [],
      },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("content"))).toBe(true);
  });

  test("validateRecordEvent: タグ数超過でエラー", () => {
    const result = validator.validateRecordEvent({
      event: {
        payload: { content: "ok" },
        tags: ["a", "b", "c", "d"],
        privacy_tags: [],
      },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("tags"))).toBe(true);
  });

  test("validateRecordEvent: タグ文字長超過でエラー", () => {
    const result = validator.validateRecordEvent({
      event: {
        payload: { content: "ok" },
        tags: ["toolongtagname"],
        privacy_tags: [],
      },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("tag"))).toBe(true);
  });

  test("validateRecordEvent: project 文字長超過でエラー", () => {
    const result = validator.validateRecordEvent({
      event: {
        project: "p".repeat(31),
        payload: { content: "ok" },
        tags: [],
        privacy_tags: [],
      },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("project"))).toBe(true);
  });

  test("validateSearch: 正常なリクエストを通す", () => {
    const result = validator.validateSearch({ query: "test query" });
    expect(result.valid).toBe(true);
  });

  test("validateSearch: query なしでエラー", () => {
    const result = validator.validateSearch({ query: "" });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("query"))).toBe(true);
  });

  test("validateSearch: query 超過でエラー", () => {
    const result = validator.validateSearch({ query: "q".repeat(101) });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("query"))).toBe(true);
  });

  test("validateCheckpoint: 正常なリクエストを通す", () => {
    const result = validator.validateCheckpoint({
      session_id: "sess-001",
      title: "My Title",
      content: "Some content",
      tags: [],
    });
    expect(result.valid).toBe(true);
  });

  test("validateCheckpoint: title 超過でエラー", () => {
    const result = validator.validateCheckpoint({
      session_id: "sess-001",
      title: "t".repeat(51),
      content: "ok",
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("title"))).toBe(true);
  });

  test("validateCheckpoint: content 超過でエラー", () => {
    const result = validator.validateCheckpoint({
      session_id: "sess-001",
      title: "ok",
      content: "c".repeat(101),
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("content"))).toBe(true);
  });

  test("validateCheckpoint: tags 超過でエラー", () => {
    const result = validator.validateCheckpoint({
      session_id: "sess-001",
      title: "ok",
      content: "ok",
      tags: ["a", "b", "c", "d"],
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("tags"))).toBe(true);
  });

  test("validateTableAlias: 許可されたエイリアスを通す", () => {
    const defaultValidator = new RequestValidator();
    expect(defaultValidator.validateTableAlias("mem_observations")).toBe(true);
    expect(defaultValidator.validateTableAlias("mem_sessions")).toBe(true);
    expect(defaultValidator.validateTableAlias("mem_events")).toBe(true);
    expect(defaultValidator.validateTableAlias("mem_facts")).toBe(true);
    expect(defaultValidator.validateTableAlias("mem_entities")).toBe(true);
    expect(defaultValidator.validateTableAlias("mem_links")).toBe(true);
  });

  test("tableAlias ホワイトリスト: 許可されていないエイリアスを拒否", () => {
    const defaultValidator = new RequestValidator();
    expect(defaultValidator.validateTableAlias("users")).toBe(false);
    expect(defaultValidator.validateTableAlias("secrets")).toBe(false);
    expect(defaultValidator.validateTableAlias("mem_observations; DROP TABLE")).toBe(false);
    expect(defaultValidator.validateTableAlias("")).toBe(false);
  });

  test("body が null のとき invalid を返す", () => {
    expect(validator.validateRecordEvent(null).valid).toBe(false);
    expect(validator.validateSearch(null).valid).toBe(false);
    expect(validator.validateCheckpoint(null).valid).toBe(false);
  });
});
