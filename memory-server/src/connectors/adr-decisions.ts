/**
 * ADR / decisions.md コネクタ
 *
 * 以下の形式のドキュメントを harness-mem の観測形式に変換する:
 *   - decisions.md (見出しで区切られた決定事項リスト)
 *   - ADR ファイル (docs/adr/NNN-*.md, NNNNN-*.md 形式)
 *
 * 重複排除は file パス + 見出し/タイトルのハッシュで行う。
 */

import { createHash } from "node:crypto";

export interface AdrObservation {
  dedupeHash: string;
  title: string;
  content: string;
  tags: string[];
  source: string;
  created_at: string;
  metadata: Record<string, unknown>;
}

/**
 * decisions.md を解析する。
 *
 * フォーマット例:
 * ```
 * # Decisions
 *
 * ## 2026-01-10: Use SQLite for storage
 * SQLite is lightweight and sufficient for single-machine use...
 *
 * ## 2026-01-15: Adopt TypeScript strict mode
 * All new code must pass TypeScript strict mode...
 * ```
 */
export function parseDecisionsMd(params: {
  filePath: string;
  content: string;
  project?: string;
  fallbackNowIso?: () => string;
}): {
  observations: AdrObservation[];
  errors: Array<{ section: string; error: string }>;
} {
  const observations: AdrObservation[] = [];
  const errors: Array<{ section: string; error: string }> = [];
  const nowIso = params.fallbackNowIso ?? (() => new Date().toISOString());

  // ## で始まる見出しをセクション区切りとして分割
  const sections = params.content.split(/^(?=## )/m).filter((s) => s.trim());

  for (const section of sections) {
    const firstLine = section.split("\n")[0].trim();

    // # (h1) は全体タイトルとして無視
    if (firstLine.startsWith("# ")) continue;
    if (!firstLine.startsWith("## ")) continue;

    const heading = firstLine.replace(/^##\s+/, "").trim();
    if (!heading) continue;

    try {
      const body = section.replace(/^##\s+[^\n]+\n/, "").trim();

      // 日付プレフィックスの抽出: "YYYY-MM-DD: title" or "YYYY-MM-DD title"
      const dateMatch = heading.match(/^(\d{4}-\d{2}-\d{2})[:\s]+(.+)$/);
      const date = dateMatch ? dateMatch[1] : null;
      const title = dateMatch ? dateMatch[2].trim() : heading;

      const dedupeHash = createHash("sha256")
        .update(`decisions-md:${params.filePath}:${heading}`)
        .digest("hex")
        .slice(0, 16);

      observations.push({
        dedupeHash,
        title: `[Decision] ${title}`,
        content: [`File: ${params.filePath}`, `Decision: ${heading}`, "", body].join("\n"),
        tags: ["decision", "adr"],
        source: `file:${params.filePath}`,
        created_at: date ? `${date}T00:00:00.000Z` : nowIso(),
        metadata: {
          filePath: params.filePath,
          heading,
          type: "decision",
          project: params.project ?? null,
        },
      });
    } catch (err) {
      errors.push({ section: firstLine, error: String(err) });
    }
  }

  return { observations, errors };
}

/**
 * 単一の ADR ファイル (Markdown) を解析する。
 *
 * フォーマット例 (MADR / RFC など):
 * ```
 * # ADR-0001: Use ONNX for embedding inference
 *
 * ## Status
 * Accepted
 *
 * ## Context
 * We need an embedding model...
 *
 * ## Decision
 * Use ONNX Runtime...
 *
 * ## Consequences
 * ...
 * ```
 */
export function parseAdrFile(params: {
  filePath: string;
  content: string;
  project?: string;
  fallbackNowIso?: () => string;
}): {
  observation: AdrObservation | null;
  error?: string;
} {
  const nowIso = params.fallbackNowIso ?? (() => new Date().toISOString());
  const lines = params.content.split("\n");

  // 最初の # 見出しをタイトルとして取得
  const titleLine = lines.find((l) => l.startsWith("# "));
  if (!titleLine) {
    return { observation: null, error: "No H1 title found in ADR file" };
  }

  const rawTitle = titleLine.replace(/^#\s+/, "").trim();

  // ADR番号の抽出: "ADR-0001:" or "0001-" or "0001:"
  const adrNumMatch =
    rawTitle.match(/^ADR[-\s]?(\d+)[:\s]+(.+)$/i) ??
    rawTitle.match(/^(\d+)[-:\s]+(.+)$/);

  const adrNumber = adrNumMatch ? adrNumMatch[1] : null;
  const title = adrNumMatch ? adrNumMatch[2].trim() : rawTitle;

  // Status セクション抽出
  const statusMatch = params.content.match(/^##\s+Status\s*\n+([^\n#]+)/im);
  const status = statusMatch ? statusMatch[1].trim().toLowerCase() : "unknown";

  const dedupeHash = createHash("sha256")
    .update(`adr-file:${params.filePath}`)
    .digest("hex")
    .slice(0, 16);

  // ファイル名から日付の推定 (例: 2026-01-15-use-sqlite.md)
  const filenameDateMatch = params.filePath.match(/(\d{4}-\d{2}-\d{2})/);
  const createdAt = filenameDateMatch
    ? `${filenameDateMatch[1]}T00:00:00.000Z`
    : nowIso();

  const tags = [
    "adr",
    `adr-status:${status}`,
    ...(adrNumber ? [`adr-number:${adrNumber}`] : []),
  ];

  return {
    observation: {
      dedupeHash,
      title: adrNumber ? `[ADR-${adrNumber.padStart(4, "0")}] ${title}` : `[ADR] ${rawTitle}`,
      content: params.content,
      tags,
      source: `file:${params.filePath}`,
      created_at: createdAt,
      metadata: {
        filePath: params.filePath,
        adrNumber: adrNumber ? parseInt(adrNumber, 10) : null,
        status,
        type: "adr",
        project: params.project ?? null,
      },
    },
  };
}
