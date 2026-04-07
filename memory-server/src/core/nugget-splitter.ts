/**
 * nugget-splitter.ts
 *
 * S74-001: Nugget Extraction
 *
 * Observation コンテンツを 1〜3 文の "nugget" に分割する。
 * 各 nugget は独立した embedding を持ち、長い observation の
 * 「平均的な意味」問題を解消して検索精度を向上させる。
 *
 * 対応言語: 英語・日本語・混合テキスト
 */

import { createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// 定数
// ---------------------------------------------------------------------------

const MIN_NUGGET_CHARS = 20;
const MAX_NUGGET_CHARS = 500;
const SENTENCES_PER_NUGGET = 3;

// ---------------------------------------------------------------------------
// 型定義
// ---------------------------------------------------------------------------

export interface Nugget {
  seq: number;
  content: string;
  content_hash: string;
}

// ---------------------------------------------------------------------------
// 文境界分割（英語・日本語対応）
// ---------------------------------------------------------------------------

/**
 * テキストを文単位に分割する。
 *
 * - 日本語: 。や！？で区切る（読点「、」は文内区切りとして扱わない）
 * - 英語: . ! ? の後に空白または行末が続く場合で区切る
 * - 段落区切り（\n\n）は常に文境界として扱う
 */
function splitIntoSentences(text: string): string[] {
  const sentences: string[] = [];

  // まず段落（\n\n）で大きく分割する
  const paragraphs = text.split(/\n{2,}/);

  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim();
    if (!trimmed) continue;

    // 日本語文末記号: 。！？ / 英語文末: . ! ? の後に空白か行末
    // アルファベット略語（e.g., "e.g. ", "Dr. "）の誤分割を防ぐため
    // 大文字始まりの次語が来る場合のみ英語の文末とみなす
    const parts = trimmed.split(
      /(?<=[。！？])\s*|(?<=[.!?])\s+(?=[A-Z\u3040-\u30ff\u3400-\u9fff])/
    );

    for (const part of parts) {
      const s = part.trim();
      if (s) sentences.push(s);
    }
  }

  return sentences;
}

/**
 * 文のリストを最大 SENTENCES_PER_NUGGET 文ずつグループ化し、
 * MIN / MAX 制約を適用してナゲットを生成する。
 */
function groupSentencesIntoNuggets(sentences: string[]): string[] {
  const nuggets: string[] = [];
  let buffer: string[] = [];
  let bufferLength = 0;

  const flush = (): void => {
    if (buffer.length === 0) return;
    const joined = buffer.join(" ").trim();
    if (joined.length >= MIN_NUGGET_CHARS) {
      nuggets.push(joined);
    }
    buffer = [];
    bufferLength = 0;
  };

  for (const sentence of sentences) {
    // 単一文が MAX を超える場合は強制分割
    if (sentence.length > MAX_NUGGET_CHARS) {
      flush();
      // 文字数で強制分割
      let start = 0;
      while (start < sentence.length) {
        const chunk = sentence.slice(start, start + MAX_NUGGET_CHARS).trim();
        if (chunk.length >= MIN_NUGGET_CHARS) {
          nuggets.push(chunk);
        }
        start += MAX_NUGGET_CHARS;
      }
      continue;
    }

    // バッファに追加するとMAXを超える場合はフラッシュ
    if (bufferLength + sentence.length + 1 > MAX_NUGGET_CHARS && buffer.length > 0) {
      flush();
    }

    buffer.push(sentence);
    bufferLength += sentence.length + 1;

    // SENTENCES_PER_NUGGET に達したらフラッシュ
    if (buffer.length >= SENTENCES_PER_NUGGET) {
      flush();
    }
  }

  flush();
  return nuggets;
}

// ---------------------------------------------------------------------------
// パブリック API
// ---------------------------------------------------------------------------

/**
 * observation の content を nugget 配列に分割して返す。
 *
 * @param content - observation テキスト
 * @returns Nugget 配列（seq は 0-indexed）
 */
export function splitIntoNuggets(content: string): Nugget[] {
  if (!content || content.trim().length < MIN_NUGGET_CHARS) {
    return [];
  }

  const sentences = splitIntoSentences(content);
  const nuggetTexts = groupSentencesIntoNuggets(sentences);

  // 重複排除しつつ seq を付与
  const seen = new Set<string>();
  const result: Nugget[] = [];

  for (const text of nuggetTexts) {
    const hash = createHash("sha256").update(text).digest("hex");
    if (seen.has(hash)) continue;
    seen.add(hash);

    result.push({
      seq: result.length,
      content: text,
      content_hash: hash,
    });
  }

  return result;
}
