/**
 * ONNX Cross-Encoder Reranker
 *
 * ms-marco-MiniLM-L6-v2 (または互換モデル) を @huggingface/transformers 経由で
 * ローカル ONNX 推論する Reranker。
 *
 * - モデルファイルは memory-server/models/ に配置 (初回実行時に自動ダウンロード)
 * - ONNX / モデルロード失敗時は simple-v1 にフォールバック
 * - 同期 Reranker インターフェースを実装 (observation-store との互換性維持)
 * - バックグラウンドで非同期ロードし、スコアはキャッシュを介して提供
 */

import path from "node:path";
import fs from "node:fs";
import type { RerankInput, RerankOutputItem, Reranker } from "./types";
import { createSimpleReranker } from "./simple-reranker";

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------

const DEFAULT_MODEL_ID = "cross-encoder/ms-marco-MiniLM-L6-v2";
const MODELS_DIR = path.join(import.meta.dirname, "..", "..", "models");
const MAX_SEQ_LEN = 512;
const SCORE_CACHE_MAX = 512;

// ---------------------------------------------------------------------------
// 型
// ---------------------------------------------------------------------------

type TransformersModule = typeof import("@huggingface/transformers");
type AutoTokenizerInstance = Awaited<ReturnType<TransformersModule["AutoTokenizer"]["from_pretrained"]>>;
type AutoModelForSequenceClassificationInstance = Awaited<
  ReturnType<TransformersModule["AutoModelForSequenceClassification"]["from_pretrained"]>
>;

export interface OnnxCrossEncoderOptions {
  /** HuggingFace モデル ID。デフォルト: cross-encoder/ms-marco-MiniLM-L6-v2 */
  modelId?: string;
  /** モデルを保存するディレクトリ。デフォルト: memory-server/models/<modelId> */
  modelPath?: string;
  /** モデルが存在しない場合に HuggingFace からダウンロードするか。デフォルト: true */
  autoDownload?: boolean;
}

// ---------------------------------------------------------------------------
// モデルディレクトリ確保
// ---------------------------------------------------------------------------

function ensureModelDirectory(modelPath: string): void {
  if (!fs.existsSync(modelPath)) {
    fs.mkdirSync(modelPath, { recursive: true });
  }
}

// ---------------------------------------------------------------------------
// スコアリングユーティリティ
// ---------------------------------------------------------------------------

/**
 * Cross-encoder の生スコア (logit) をシグモイド変換して [0, 1] に正規化する。
 */
function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/**
 * Transformers.js logits テンソルから単一アイテムのスコアを抽出する。
 * shape は [1, 1], [1, 2], または [1] のいずれかを想定。
 */
function extractLogit(logits: unknown): number | null {
  const tensor = logits as { data?: Float32Array | number[]; dims?: number[] } | null;
  if (!tensor?.data || !tensor.dims) return null;

  const dims = tensor.dims;
  if (dims.length === 2) {
    // [batch=1, num_labels]
    const numLabels = dims[1] ?? 1;
    // binary cross-encoder では label 1 (relevant) のスコアを使用
    const offset = numLabels > 1 ? numLabels - 1 : 0;
    const val = tensor.data[offset];
    return val !== undefined ? Number(val) : null;
  }
  if (dims.length === 1) {
    const val = tensor.data[0];
    return val !== undefined ? Number(val) : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// ONNX Cross-Encoder Reranker ファクトリ
// ---------------------------------------------------------------------------

export interface OnnxCrossEncoderReranker extends Reranker {
  /** モデルのロード完了を待機する (テスト・ウォームアップ用) */
  readonly initPromise: Promise<void>;
}

/**
 * ONNX Cross-Encoder Reranker を生成する。
 *
 * モデルのロードは非同期で行われ、ロード完了前のリクエストは
 * キャッシュされたスコアがあればそれを使い、なければ simple-v1 にフォールバックする。
 * ロード完了後は ONNX スコアがキャッシュに蓄積され、次回から使われる。
 */
export function createOnnxCrossEncoderReranker(options: OnnxCrossEncoderOptions = {}): OnnxCrossEncoderReranker {
  const modelId = options.modelId ?? DEFAULT_MODEL_ID;
  const modelPath = options.modelPath ?? path.join(MODELS_DIR, modelId.replace(/\//g, "--"));
  const autoDownload = options.autoDownload ?? true;

  const fallback = createSimpleReranker();

  // モデル状態
  let tokenizer: AutoTokenizerInstance | null = null;
  let model: AutoModelForSequenceClassificationInstance | null = null;
  let isReady = false;

  // スコアキャッシュ (LRU 近似: Map の挿入順を利用)
  const scoreCache = new Map<string, number>();

  function buildCacheKey(query: string, item: Pick<RerankOutputItem, "id">): string {
    return `${query.slice(0, 128)}|||${item.id}`;
  }

  function setCachedScore(key: string, score: number): void {
    if (scoreCache.has(key)) {
      scoreCache.delete(key);
    }
    scoreCache.set(key, score);
    if (scoreCache.size > SCORE_CACHE_MAX) {
      const oldest = scoreCache.keys().next().value;
      if (typeof oldest === "string") {
        scoreCache.delete(oldest);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // バッチスコア計算 (非同期)
  // ---------------------------------------------------------------------------

  async function scoreSingle(query: string, doc: string): Promise<number> {
    if (!tokenizer || !model || !isReady) {
      throw new Error("ONNX model not ready");
    }

    const encoded = (tokenizer as unknown as {
      (
        text: string,
        text_pair: string,
        opts: {
          padding: boolean;
          truncation: boolean;
          max_length: number;
          return_tensors: string;
        }
      ): Record<string, { data: number[] | BigInt64Array; dims: number[] }>;
    })(query, doc, {
      padding: true,
      truncation: true,
      max_length: MAX_SEQ_LEN,
      return_tensors: "pt",
    });

    const output = await (model as unknown as {
      (inputs: typeof encoded): Promise<{ logits: unknown }>;
    })(encoded);

    const logit = extractLogit(output.logits);
    return logit !== null ? sigmoid(logit) : 0.5;
  }

  async function primeScores(query: string, items: RerankOutputItem[]): Promise<void> {
    for (const item of items) {
      const key = buildCacheKey(query, item);
      if (scoreCache.has(key)) continue;
      try {
        const doc = `${item.title}\n${item.content}`.trim();
        const score = await scoreSingle(query, doc);
        setCachedScore(key, score);
      } catch {
        // 推論失敗は個別に無視
      }
    }
  }

  // ---------------------------------------------------------------------------
  // 非同期初期化
  // ---------------------------------------------------------------------------

  const initPromise: Promise<void> = (async () => {
    try {
      ensureModelDirectory(modelPath);

      const transformers: TransformersModule = await import("@huggingface/transformers");
      const { AutoTokenizer, AutoModelForSequenceClassification, env } = transformers;

      if (autoDownload) {
        env.allowRemoteModels = true;
        env.localModelPath = MODELS_DIR;
        env.useBrowserCache = false;

        const hasLocalModel =
          fs.existsSync(path.join(modelPath, "config.json")) ||
          fs.existsSync(path.join(modelPath, "onnx", "model.onnx")) ||
          fs.existsSync(path.join(modelPath, "model.onnx"));

        if (!hasLocalModel) {
          process.stderr.write(
            `[harness-mem][onnx-reranker] downloading ${modelId} to ${modelPath}...\n`
          );
        }

        tokenizer = await AutoTokenizer.from_pretrained(modelId, {
          cache_dir: MODELS_DIR,
        } as Parameters<typeof AutoTokenizer.from_pretrained>[1]);

        model = await AutoModelForSequenceClassification.from_pretrained(modelId, {
          cache_dir: MODELS_DIR,
        } as Parameters<typeof AutoModelForSequenceClassification.from_pretrained>[1]);
      } else {
        env.allowRemoteModels = false;
        env.localModelPath = MODELS_DIR;
        env.useBrowserCache = false;

        tokenizer = await AutoTokenizer.from_pretrained(modelPath, {
          local_files_only: true,
        } as Parameters<typeof AutoTokenizer.from_pretrained>[1]);

        model = await AutoModelForSequenceClassification.from_pretrained(modelPath, {
          local_files_only: true,
        } as Parameters<typeof AutoModelForSequenceClassification.from_pretrained>[1]);
      }

      isReady = true;
      process.stderr.write(`[harness-mem][onnx-reranker] ${modelId} ready\n`);
    } catch (err) {
      const msg = String(err);
      process.stderr.write(
        `[harness-mem][onnx-reranker] failed to load ${modelId}: ${msg}; falling back to simple-v1\n`
      );
    }
  })();

  // ---------------------------------------------------------------------------
  // 同期 Reranker インターフェース
  // ---------------------------------------------------------------------------

  return {
    name: "onnx-cross-encoder-v1",
    initPromise,

    rerank(input: RerankInput): RerankOutputItem[] {
      if (input.items.length === 0) return [];

      const enriched: RerankOutputItem[] = input.items.map((item) => ({
        ...item,
        rerank_score: 0,
      }));

      // キャッシュからスコアを取得
      const uncached: RerankOutputItem[] = [];
      for (const item of enriched) {
        const key = buildCacheKey(input.query, item);
        const cached = scoreCache.get(key);
        if (cached !== undefined) {
          item.rerank_score = cached;
        } else {
          uncached.push(item);
        }
      }

      // モデルが準備できていれば未キャッシュアイテムをバックグラウンドでプライム
      if (isReady && uncached.length > 0) {
        void primeScores(input.query, uncached);
      }

      // 未キャッシュアイテムには fallback スコアを適用
      if (uncached.length > 0) {
        const fallbackResult = fallback.rerank({
          query: input.query,
          items: uncached,
        });
        for (const fb of fallbackResult) {
          const item = enriched.find((e) => e.id === fb.id);
          if (item) {
            item.rerank_score = fb.rerank_score;
          }
        }
      }

      enriched.sort((lhs, rhs) => {
        if (rhs.rerank_score !== lhs.rerank_score) {
          return rhs.rerank_score - lhs.rerank_score;
        }
        return lhs.source_index - rhs.source_index;
      });

      return enriched;
    },
  };
}
