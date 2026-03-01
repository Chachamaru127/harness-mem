/**
 * COMP-007: ドキュメント取り込みモジュール
 * Markdown/HTML/プレーンテキストのパースと観察への変換を担当する。
 * 外部ライブラリ不使用（正規表現ベース）。
 */

import { createHash } from "node:crypto";
import type { HarnessMemCore } from "../core/harness-mem-core";

export interface DocumentChunk {
  title: string;
  content: string;
}

const MAX_CHUNK_CONTENT = 5000;

/** Markdown テキストを H1/H2 見出しでチャンク分割する */
export function parseMarkdownChunks(text: string): DocumentChunk[] {
  if (!text || !text.trim()) {
    return [];
  }

  const lines = text.split("\n");
  const chunks: DocumentChunk[] = [];
  let currentTitle = "";
  let currentLines: string[] = [];

  function flushChunk() {
    const content = currentLines
      .join("\n")
      .trim()
      .replace(/\r/g, "")
      .slice(0, MAX_CHUNK_CONTENT);
    if (content) {
      chunks.push({
        title: currentTitle || "（無題）",
        content,
      });
    }
  }

  for (const line of lines) {
    const h1 = line.match(/^#\s+(.+)/);
    const h2 = line.match(/^##\s+(.+)/);

    if (h1 || h2) {
      // 現在のチャンクを確定
      flushChunk();
      currentTitle = (h1 ? h1[1] : h2![1]).trim();
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  // 最後のチャンクを確定
  flushChunk();

  // 見出しがなかった場合（プレーンテキスト）
  if (chunks.length === 0 && text.trim()) {
    return [
      {
        title: "（無題）",
        content: text.trim().slice(0, MAX_CHUNK_CONTENT),
      },
    ];
  }

  return chunks;
}

/** HTML文字列からテキストを抽出する（タグ除去 + エンティティデコード） */
export function parseHtmlText(html: string): string {
  if (!html || !html.trim()) {
    return "";
  }

  // script/style タグとその中身を除去
  let text = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ");

  // ブロック要素の前後に改行を挿入（可読性向上）
  text = text
    .replace(/<\/(p|div|h[1-6]|li|tr|td|th|blockquote|pre)>/gi, "\n")
    .replace(/<(br|hr)\s*\/?>/gi, "\n");

  // 残りのHTMLタグを除去
  text = text.replace(/<[^>]+>/g, " ");

  // HTMLエンティティをデコード
  text = decodeHtmlEntities(text);

  // 連続する空白・改行を整理
  text = text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text;
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

export type DocumentFormat = "markdown" | "html" | "text";

export interface IngestDocumentOptions {
  core: HarnessMemCore;
  content: string;
  format: DocumentFormat;
  project: string;
  session_id: string;
  source_title?: string;
}

export interface IngestDocumentResult {
  ok: boolean;
  chunks_processed: number;
  observations_created: number;
  error?: string;
}

/** ドキュメントを観察として取り込む */
export async function ingestDocument(options: IngestDocumentOptions): Promise<IngestDocumentResult> {
  const { core, content, format, project, session_id, source_title } = options;

  if (!content || !content.trim()) {
    return { ok: true, chunks_processed: 0, observations_created: 0 };
  }

  let chunks: DocumentChunk[];

  if (format === "html") {
    const plainText = parseHtmlText(content);
    if (!plainText) {
      return { ok: true, chunks_processed: 0, observations_created: 0 };
    }
    chunks = parseMarkdownChunks(plainText);
    if (chunks.length === 0) {
      chunks = [{ title: source_title || "HTML Document", content: plainText.slice(0, MAX_CHUNK_CONTENT) }];
    }
  } else if (format === "markdown") {
    chunks = parseMarkdownChunks(content);
    if (chunks.length === 0 && content.trim()) {
      chunks = [{ title: source_title || "Document", content: content.trim().slice(0, MAX_CHUNK_CONTENT) }];
    }
  } else {
    // text
    chunks = [{ title: source_title || "Document", content: content.trim().slice(0, MAX_CHUNK_CONTENT) }];
  }

  let observationsCreated = 0;

  for (const chunk of chunks) {
    const contentHash = createHash("sha256").update(chunk.content).digest("hex");
    try {
      await core.recordEvent({
        event_type: "observation",
        project,
        session_id,
        payload: {
          title: chunk.title,
          content: chunk.content,
          observation_type: "document",
          content_hash: contentHash,
        },
        metadata: {
          source: "document_ingest",
          format,
          source_title: source_title || "",
        },
      });
      observationsCreated++;
    } catch {
      // 個別チャンクのエラーは無視して続行
    }
  }

  return {
    ok: true,
    chunks_processed: chunks.length,
    observations_created: observationsCreated,
  };
}
