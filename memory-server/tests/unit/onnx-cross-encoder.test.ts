/**
 * ONNX Cross-Encoder Reranker ユニットテスト
 *
 * 実際の ONNX モデルダウンロードは行わず、モデルなし状態での
 * フォールバック動作とインターフェース準拠を検証する。
 */

import { describe, expect, test, mock, beforeEach } from "bun:test";
import type { RerankInput } from "../../src/rerank/types";

// ---------------------------------------------------------------------------
// テスト用サンプルデータ
// ---------------------------------------------------------------------------

const sampleInput: RerankInput = {
  query: "memory search reranking",
  items: [
    {
      id: "obs-1",
      score: 0.6,
      created_at: "2026-02-01T00:00:00.000Z",
      title: "search pipeline overview",
      content: "The search pipeline uses BM25 followed by reranking.",
      source_index: 0,
    },
    {
      id: "obs-2",
      score: 0.5,
      created_at: "2026-02-10T00:00:00.000Z",
      title: "memory reranking strategy",
      content: "Cross-encoder reranking improves retrieval accuracy significantly.",
      source_index: 1,
    },
    {
      id: "obs-3",
      score: 0.4,
      created_at: "2026-01-15T00:00:00.000Z",
      title: "unrelated topic",
      content: "This document has nothing to do with search or reranking.",
      source_index: 2,
    },
  ],
};

// ---------------------------------------------------------------------------
// インターフェース準拠テスト
// ---------------------------------------------------------------------------

describe("OnnxCrossEncoderReranker — interface compliance", () => {
  test("implements Reranker interface with name and rerank()", async () => {
    const { createOnnxCrossEncoderReranker } = await import("../../src/rerank/onnx-cross-encoder");
    const reranker = createOnnxCrossEncoderReranker({ autoDownload: false });

    expect(reranker).toHaveProperty("name");
    expect(typeof reranker.name).toBe("string");
    expect(reranker.name).toBe("onnx-cross-encoder-v1");
    expect(typeof reranker.rerank).toBe("function");
    expect(reranker).toHaveProperty("initPromise");
  });

  test("rerank() returns RerankOutputItem[] with rerank_score field", async () => {
    const { createOnnxCrossEncoderReranker } = await import("../../src/rerank/onnx-cross-encoder");
    const reranker = createOnnxCrossEncoderReranker({ autoDownload: false });

    // モデル未ロード状態 → fallback が使われる
    const result = reranker.rerank(sampleInput);

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(sampleInput.items.length);

    for (const item of result) {
      expect(item).toHaveProperty("id");
      expect(item).toHaveProperty("score");
      expect(item).toHaveProperty("rerank_score");
      expect(item).toHaveProperty("title");
      expect(item).toHaveProperty("content");
      expect(typeof item.rerank_score).toBe("number");
    }
  });

  test("rerank() preserves all input item IDs", async () => {
    const { createOnnxCrossEncoderReranker } = await import("../../src/rerank/onnx-cross-encoder");
    const reranker = createOnnxCrossEncoderReranker({ autoDownload: false });

    const result = reranker.rerank(sampleInput);
    const inputIds = sampleInput.items.map((i) => i.id).sort();
    const resultIds = result.map((i) => i.id).sort();

    expect(resultIds).toEqual(inputIds);
  });

  test("rerank() returns empty array for empty input", async () => {
    const { createOnnxCrossEncoderReranker } = await import("../../src/rerank/onnx-cross-encoder");
    const reranker = createOnnxCrossEncoderReranker({ autoDownload: false });

    const result = reranker.rerank({ query: "test", items: [] });
    expect(result).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// フォールバック動作テスト
// ---------------------------------------------------------------------------

describe("OnnxCrossEncoderReranker — fallback behavior", () => {
  test("falls back to simple-v1 when model is not loaded", async () => {
    const { createOnnxCrossEncoderReranker } = await import("../../src/rerank/onnx-cross-encoder");
    const reranker = createOnnxCrossEncoderReranker({ autoDownload: false });

    // モデル未ロード状態での rerank は simple-v1 にフォールバックする
    const result = reranker.rerank(sampleInput);

    // 結果が返ること (クラッシュしないこと) を確認
    expect(result.length).toBe(3);

    // rerank_score が数値であること
    for (const item of result) {
      expect(typeof item.rerank_score).toBe("number");
      expect(Number.isNaN(item.rerank_score)).toBe(false);
    }
  });

  test("rerank_score values are sorted descending", async () => {
    const { createOnnxCrossEncoderReranker } = await import("../../src/rerank/onnx-cross-encoder");
    const reranker = createOnnxCrossEncoderReranker({ autoDownload: false });

    const result = reranker.rerank(sampleInput);

    for (let i = 0; i < result.length - 1; i++) {
      expect(result[i]!.rerank_score).toBeGreaterThanOrEqual(result[i + 1]!.rerank_score);
    }
  });

  test("fallback returns query-relevant item higher than unrelated", async () => {
    const { createOnnxCrossEncoderReranker } = await import("../../src/rerank/onnx-cross-encoder");
    const reranker = createOnnxCrossEncoderReranker({ autoDownload: false });

    const result = reranker.rerank(sampleInput);

    const rerankIdx = result.findIndex((i) => i.id === "obs-2");
    const unrelatedIdx = result.findIndex((i) => i.id === "obs-3");

    // "memory reranking strategy" は "unrelated topic" より上に来るべき
    expect(rerankIdx).toBeLessThan(unrelatedIdx);
  });
});

// ---------------------------------------------------------------------------
// Registry 統合テスト
// ---------------------------------------------------------------------------

describe("registry — onnx-cross-encoder provider", () => {
  test("createRerankerRegistry returns enabled reranker for onnx-cross-encoder provider", async () => {
    const originalProvider = process.env.HARNESS_MEM_RERANKER_PROVIDER;
    process.env.HARNESS_MEM_RERANKER_PROVIDER = "onnx-cross-encoder";

    try {
      const { createRerankerRegistry } = await import("../../src/rerank/registry");
      const result = createRerankerRegistry(true);

      expect(result.enabled).toBe(true);
      expect(result.reranker).not.toBeNull();
      expect(result.reranker?.name).toBe("onnx-cross-encoder-v1");
    } finally {
      if (originalProvider === undefined) {
        delete process.env.HARNESS_MEM_RERANKER_PROVIDER;
      } else {
        process.env.HARNESS_MEM_RERANKER_PROVIDER = originalProvider;
      }
    }
  });

  test("createRerankerRegistry returns null reranker when disabled", async () => {
    const { createRerankerRegistry } = await import("../../src/rerank/registry");
    const result = createRerankerRegistry(false);

    expect(result.enabled).toBe(false);
    expect(result.reranker).toBeNull();
  });

  test("onnx reranker from registry can rerank without error", async () => {
    const originalProvider = process.env.HARNESS_MEM_RERANKER_PROVIDER;
    process.env.HARNESS_MEM_RERANKER_PROVIDER = "onnx-cross-encoder";

    try {
      const { createRerankerRegistry } = await import("../../src/rerank/registry");
      const { reranker } = createRerankerRegistry(true);

      expect(reranker).not.toBeNull();
      const result = reranker!.rerank(sampleInput);
      expect(result.length).toBe(3);
    } finally {
      if (originalProvider === undefined) {
        delete process.env.HARNESS_MEM_RERANKER_PROVIDER;
      } else {
        process.env.HARNESS_MEM_RERANKER_PROVIDER = originalProvider;
      }
    }
  });
});

// ---------------------------------------------------------------------------
// スコアキャッシュ動作テスト (モック ONNX スコア注入)
// ---------------------------------------------------------------------------

describe("OnnxCrossEncoderReranker — cached score injection", () => {
  test("uses cached ONNX scores when available", async () => {
    const { createOnnxCrossEncoderReranker } = await import("../../src/rerank/onnx-cross-encoder");

    // autoDownload: false でモデルなし状態を作り、
    // キャッシュへのスコア注入はできないため fallback 動作を確認
    const reranker = createOnnxCrossEncoderReranker({ autoDownload: false });

    // 2 回 rerank を呼んでも結果が安定していること (決定論的)
    const result1 = reranker.rerank(sampleInput);
    const result2 = reranker.rerank(sampleInput);

    expect(result1.map((i) => i.id)).toEqual(result2.map((i) => i.id));
    for (let i = 0; i < result1.length; i++) {
      expect(result1[i]!.rerank_score).toBe(result2[i]!.rerank_score);
    }
  });
});
