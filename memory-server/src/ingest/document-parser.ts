/**
 * COMP-007: ドキュメント取り込みモジュール
 * Markdown/HTML/プレーンテキストのパースと観察への変換を担当する。
 * NEXT-007: 画像 OCR 取り込み（Tesseract.js）も含む。
 */

import { createHash } from "node:crypto";
import { basename } from "node:path";
import type { HarnessMemCore } from "../core/harness-mem-core";

export interface DocumentChunk {
  title: string;
  content: string;
}

const MAX_CHUNK_CONTENT = 5000;

/**
 * Markdown テキストを H1/H2 見出し + コードフェンスブロックでチャンク分割する。
 *
 * NEXT-002: コードフェンスブロック（```lang ... ```）を独立チャンクとして抽出する。
 */
export function parseMarkdownChunks(text: string): DocumentChunk[] {
  if (!text || !text.trim()) {
    return [];
  }

  const lines = text.split("\n");
  const chunks: DocumentChunk[] = [];
  let currentTitle = "";
  let currentLines: string[] = [];
  let inCodeFence = false;
  let codeFenceLang = "";
  let codeLines: string[] = [];

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

  function flushCodeChunk() {
    const content = codeLines.join("\n").trim().slice(0, MAX_CHUNK_CONTENT);
    if (content) {
      const title = codeFenceLang
        ? `${codeFenceLang} コードブロック`
        : "コードブロック";
      chunks.push({ title, content });
    }
    codeLines = [];
    codeFenceLang = "";
  }

  for (const line of lines) {
    // コードフェンス開始/終了の検出
    const fenceStart = line.match(/^```(\w*)/);
    const fenceEnd = /^```\s*$/.test(line);

    if (inCodeFence) {
      if (fenceEnd) {
        // コードフェンス終了
        inCodeFence = false;
        flushCodeChunk();
      } else {
        codeLines.push(line);
      }
      continue;
    }

    if (fenceStart && !fenceEnd) {
      // コードフェンス開始: 現在のテキストチャンクを確定してからコードモードへ
      flushChunk();
      currentLines = [];
      inCodeFence = true;
      codeFenceLang = fenceStart[1] || "";
      continue;
    }

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

  // 未閉じのコードフェンスがあれば確定
  if (inCodeFence && codeLines.length > 0) {
    flushCodeChunk();
  }

  // 最後のテキストチャンクを確定
  flushChunk();

  // 見出しもコードフェンスもなかった場合（プレーンテキスト）
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

/**
 * NEXT-002: AST チャンク分割
 * コードテキストを関数・クラス・const 宣言単位で分割する。
 * 外部 AST パーサー不使用（正規表現ベースで近似）。
 */
const CODE_CHUNK_PATTERNS = [
  // TypeScript / JavaScript: function declaration / arrow function
  /^(?:export\s+)?(?:async\s+)?function\s+\w+/m,
  // TypeScript / JavaScript: class declaration
  /^(?:export\s+)?class\s+\w+/m,
  // TypeScript / JavaScript: const/let arrow function
  /^(?:export\s+)?(?:const|let)\s+\w+\s*=\s*(?:async\s+)?\(/m,
  // Python: def / class
  /^(?:async\s+)?def\s+\w+|^class\s+\w+/m,
  // Go / Rust: func / fn
  /^(?:pub\s+)?fn\s+\w+|^func\s+\w+/m,
];

const CODE_SPLIT_RE = new RegExp(
  [
    // TypeScript / JavaScript
    /(?=^(?:export\s+)?(?:async\s+)?function\s+\w)/,
    /(?=^(?:export\s+)?class\s+\w)/,
    /(?=^(?:export\s+)?(?:const|let)\s+\w+\s*=\s*(?:async\s+)?\()/,
    // Python
    /(?=^(?:async\s+)?def\s+\w)/,
    /(?=^class\s+\w)/,
    // Go / Rust
    /(?=^(?:pub\s+)?fn\s+\w)/,
    /(?=^func\s+\w)/,
  ]
    .map((r) => r.source)
    .join("|"),
  "gm"
);

const MAX_CODE_CHUNK = 3000;

/**
 * コードテキストを AST ライクに関数・クラス単位でチャンク分割する。
 * 外部ライブラリ不使用（正規表現ベース）。
 *
 * @param code  ソースコードテキスト
 * @param lang  言語ヒント（typescript / python / go / rust / text 等）
 * @returns     DocumentChunk 配列
 */
export function parseCodeChunks(code: string, lang: string): DocumentChunk[] {
  if (!code || !code.trim()) {
    return [];
  }

  // 分割パターンが1つもマッチしない場合は単一チャンクとして返す
  const hasStructure = CODE_CHUNK_PATTERNS.some((p) => p.test(code));
  if (!hasStructure) {
    return [{ title: `${lang} code`, content: code.trim().slice(0, MAX_CODE_CHUNK) }];
  }

  // 分割して各チャンクを生成
  const parts = code.split(CODE_SPLIT_RE).filter((p) => p && p.trim());

  if (parts.length <= 1) {
    return [{ title: `${lang} code`, content: code.trim().slice(0, MAX_CODE_CHUNK) }];
  }

  return parts
    .map((part) => {
      const trimmed = part.trim();
      if (!trimmed) return null;

      // チャンクのタイトルを最初の行から抽出
      const firstLine = trimmed.split("\n")[0].trim();
      const title = firstLine.slice(0, 80) || `${lang} chunk`;

      return {
        title,
        content: trimmed.slice(0, MAX_CODE_CHUNK),
      };
    })
    .filter((c): c is DocumentChunk => c !== null && c.content.length > 0);
}

export type DocumentFormat = "markdown" | "html" | "text" | "pdf";

export interface PdfParseResult {
  ok: boolean;
  text: string;
  pages: number;
  error?: string;
}

/**
 * PDF バイナリを解析してテキストを抽出する。
 * 外部ライブラリ不要のネイティブ実装。
 * PDF テキストストリーム（BT ... Tj/TJ ... ET）から文字列を抽出する。
 */
export async function parsePdfBuffer(data: Uint8Array): Promise<PdfParseResult> {
  if (!data || data.length === 0) {
    return { ok: false, text: "", pages: 0, error: "empty PDF data" };
  }

  try {
    const raw = new TextDecoder("latin1").decode(data);

    // PDF かどうか確認
    if (!raw.startsWith("%PDF-")) {
      return { ok: false, text: "", pages: 0, error: "not a valid PDF" };
    }

    // ページ数カウント（/Type /Page の出現数）
    const pageMatches = raw.match(/\/Type\s*\/Page[^s]/g);
    const pages = pageMatches ? pageMatches.length : 1;

    // テキストストリームから文字列を抽出する
    // BT ... ET ブロック内の (text) Tj / [(text)] TJ パターンを対象とする
    const textParts: string[] = [];

    // BT...ET ブロックを抽出
    const btBlocks = raw.match(/BT[\s\S]*?ET/g) || [];
    for (const block of btBlocks) {
      // (text) Tj パターン
      const tjMatches = block.match(/\(([^)]*)\)\s*Tj/g) || [];
      for (const m of tjMatches) {
        const captured = m.match(/\(([^)]*)\)/);
        if (captured && captured[1]) {
          textParts.push(captured[1]);
        }
      }
      // [(text1)(text2)] TJ パターン
      const tjArrayMatches = block.match(/\[([^\]]*)\]\s*TJ/g) || [];
      for (const m of tjArrayMatches) {
        const inner = m.match(/\[([^\]]*)\]/);
        if (inner && inner[1]) {
          const parts = inner[1].match(/\(([^)]*)\)/g) || [];
          for (const p of parts) {
            const txt = p.match(/\(([^)]*)\)/);
            if (txt && txt[1]) {
              textParts.push(txt[1]);
            }
          }
        }
      }
    }

    const text = textParts.join(" ").replace(/\s+/g, " ").trim();

    return {
      ok: true,
      text,
      pages,
    };
  } catch (err) {
    return {
      ok: false,
      text: "",
      pages: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * PDF から抽出したテキストをチャンク分割する。
 * ページ区切りや段落をもとに分割する。
 */
export function parsePdfChunks(text: string, sourceTitle: string): DocumentChunk[] {
  if (!text || !text.trim()) {
    return [];
  }

  // 連続する空行（2行以上）を段落区切りとして扱う
  const paragraphs = text
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (paragraphs.length === 0) {
    return [];
  }

  // 段落が少ない場合は単一チャンクとして返す
  if (paragraphs.length <= 2) {
    return [{ title: sourceTitle || "PDF Document", content: text.trim().slice(0, MAX_CHUNK_CONTENT) }];
  }

  // 長いドキュメントは段落をグループ化してチャンク分割
  const chunks: DocumentChunk[] = [];
  const PARAGRAPHS_PER_CHUNK = 5;
  for (let i = 0; i < paragraphs.length; i += PARAGRAPHS_PER_CHUNK) {
    const group = paragraphs.slice(i, i + PARAGRAPHS_PER_CHUNK).join("\n\n");
    const chunkIndex = Math.floor(i / PARAGRAPHS_PER_CHUNK) + 1;
    chunks.push({
      title: `${sourceTitle || "PDF"} (part ${chunkIndex})`,
      content: group.slice(0, MAX_CHUNK_CONTENT),
    });
  }

  return chunks;
}

export interface IngestDocumentOptions {
  core: HarnessMemCore;
  content: string;
  format: DocumentFormat;
  project: string;
  session_id: string;
  source_title?: string;
  /** PDF バイナリデータ（format === "pdf" の場合に使用） */
  pdf_data?: Uint8Array;
}

export interface IngestDocumentResult {
  ok: boolean;
  chunks_processed: number;
  observations_created: number;
  error?: string;
}

/** ドキュメントを観察として取り込む */
export async function ingestDocument(options: IngestDocumentOptions): Promise<IngestDocumentResult> {
  const { core, content, format, project, session_id, source_title, pdf_data } = options;

  if (format !== "pdf" && (!content || !content.trim())) {
    return { ok: true, chunks_processed: 0, observations_created: 0 };
  }

  let chunks: DocumentChunk[];

  if (format === "pdf") {
    const pdfBytes = pdf_data ?? (content ? new TextEncoder().encode(content) : new Uint8Array(0));
    const parsed = await parsePdfBuffer(pdfBytes);
    if (!parsed.ok) {
      return { ok: false, chunks_processed: 0, observations_created: 0, error: parsed.error };
    }
    chunks = parsePdfChunks(parsed.text, source_title || "PDF Document");
    if (chunks.length === 0 && parsed.text.trim()) {
      chunks = [{ title: source_title || "PDF Document", content: parsed.text.trim().slice(0, MAX_CHUNK_CONTENT) }];
    }
  } else if (format === "html") {
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

// ---- NEXT-007: 画像 OCR 取り込み ----

export interface OcrResult {
  ok: boolean;
  text: string;
  error?: string;
}

/**
 * Tesseract.js を使って画像ファイルからテキストを抽出する。
 * ワーカーは呼び出しごとに生成・終了する（ステートレス）。
 *
 * @param imagePath  画像ファイルのパス（png/jpg/webp 等）
 * @returns          抽出テキストと成否フラグ
 */
export async function extractTextFromImage(imagePath: string): Promise<OcrResult> {
  if (!imagePath || !imagePath.trim()) {
    return { ok: false, text: "", error: "imagePath is required" };
  }

  let worker: { recognize: (path: string) => Promise<{ data: { text: string } }>; terminate: () => Promise<void> } | null = null;
  try {
    const { createWorker } = await import("tesseract.js");
    worker = await createWorker();
    const { data } = await worker.recognize(imagePath);
    const text = (data.text || "").trim();
    return { ok: true, text };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, text: "", error: message };
  } finally {
    if (worker) {
      await worker.terminate().catch(() => {});
    }
  }
}

export interface IngestImageOptions {
  core: HarnessMemCore;
  imagePath: string;
  project: string;
  session_id: string;
  source_title?: string;
}

export interface IngestImageResult {
  ok: boolean;
  observations_created: number;
  error?: string;
}

/**
 * 画像ファイルを OCR でテキスト抽出し、観察として登録する。
 *
 * @param options  画像パス・プロジェクト・セッション情報
 * @returns        登録結果
 */
export async function ingestImageFile(options: IngestImageOptions): Promise<IngestImageResult> {
  const { core, imagePath, project, session_id, source_title } = options;

  const ocrResult = await extractTextFromImage(imagePath);
  if (!ocrResult.ok) {
    return { ok: false, observations_created: 0, error: ocrResult.error };
  }

  if (!ocrResult.text) {
    return { ok: true, observations_created: 0 };
  }

  const title = source_title || basename(imagePath);
  const contentHash = createHash("sha256").update(ocrResult.text).digest("hex");

  try {
    await core.recordEvent({
      event_type: "observation",
      project,
      session_id,
      payload: {
        title,
        content: ocrResult.text.slice(0, MAX_CHUNK_CONTENT),
        observation_type: "document",
        content_hash: contentHash,
        source_format: "image_ocr",
      },
    });
    return { ok: true, observations_created: 1 };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, observations_created: 0, error: message };
  }
}
