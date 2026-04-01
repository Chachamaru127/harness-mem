import type { AdaptiveRoute, QueryAnalysis, QueryType } from "./types";

export const DEFAULT_ADAPTIVE_JA_THRESHOLD = 0.85;
export const DEFAULT_ADAPTIVE_CODE_THRESHOLD = 0.5;
const DEFAULT_ANALYSIS_CHAR_LIMIT = 512;

interface RouteThresholdOptions {
  jaThreshold?: number;
  codeThreshold?: number;
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function countMatches(text: string, pattern: RegExp): number {
  const matches = text.match(pattern);
  return matches ? matches.length : 0;
}

function detectQueryType(analysis: QueryAnalysis): QueryType {
  if (analysis.codeRatio >= DEFAULT_ADAPTIVE_CODE_THRESHOLD) {
    return "code";
  }
  if (analysis.jaRatio > 0.05 && analysis.enRatio > 0.05) {
    return "mixed";
  }
  if (analysis.codeRatio >= 0.2) {
    return "mixed";
  }
  return "natural";
}

export function analyzeText(text: string): QueryAnalysis {
  const sample = (text || "").slice(0, DEFAULT_ANALYSIS_CHAR_LIMIT);
  const meaningfulChars = sample.replace(/\s+/g, "");
  const length = sample.length;

  if (meaningfulChars.length === 0) {
    return {
      jaRatio: 0,
      enRatio: 0,
      codeRatio: 0,
      length,
      queryType: "natural",
    };
  }

  const kanaCount = countMatches(meaningfulChars, /[\u3040-\u309F\u30A0-\u30FF]/g);
  const cjkCount = countMatches(meaningfulChars, /[\u3400-\u4DBF\u4E00-\u9FFF]/g);
  const latinCount = countMatches(meaningfulChars, /[A-Za-z]/g);
  const codeFenceCount = countMatches(sample, /```/g);
  const camelCaseCount = countMatches(sample, /\b[a-z]+[A-Z][A-Za-z0-9]*\b/g);
  const snakeCaseCount = countMatches(sample, /\b[a-z0-9]+_[a-z0-9_]+\b/gi);
  const pathLikeCount = countMatches(sample, /\b[\w./-]+\.(ts|tsx|js|jsx|json|py|rb|go|java|rs|md)\b/g);
  const keywordCount = countMatches(
    sample,
    /\b(function|const|let|var|class|return|import|export|SELECT|INSERT|UPDATE|DELETE|async|await|def|interface|type)\b/g
  );
  const codeSymbolCount = countMatches(sample, /[{}[\]();=<>`]|=>|::|\/\//g);

  const japaneseChars = kanaCount > 0 ? kanaCount + cjkCount : kanaCount;
  const jaRatio = clampRatio(japaneseChars / meaningfulChars.length);
  const enRatio = clampRatio(latinCount / meaningfulChars.length);

  const structuralSignals =
    codeFenceCount * 0.45 +
    camelCaseCount * 0.06 +
    snakeCaseCount * 0.12 +
    pathLikeCount * 0.08 +
    keywordCount * 0.08;
  const symbolDensity = clampRatio(codeSymbolCount / meaningfulChars.length);
  const codeRatio = clampRatio(structuralSignals + symbolDensity * 1.9);

  const analysis: QueryAnalysis = {
    jaRatio,
    enRatio,
    codeRatio,
    length,
    queryType: "natural",
  };
  analysis.queryType = detectQueryType(analysis);
  return analysis;
}

/**
 * COMP-005: テキストの言語を検出する。
 * - 日本語比率が一定以上なら "ja"
 * - ハングルや CJK 文字のみ中心なら "multilingual"
 * - それ以外は "en"
 */
export function detectLanguage(text: string): "ja" | "en" | "multilingual" {
  const sample = (text || "").slice(0, DEFAULT_ANALYSIS_CHAR_LIMIT);
  const meaningfulChars = sample.replace(/\s+/g, "");
  if (meaningfulChars.length === 0) {
    return "en";
  }

  const kanaCount = countMatches(meaningfulChars, /[\u3040-\u309F\u30A0-\u30FF]/g);
  if (kanaCount / meaningfulChars.length >= 0.05) {
    return "ja";
  }

  if (/[\uAC00-\uD7AF\u1100-\u11FF]/.test(sample)) {
    return "multilingual";
  }

  const cjkCount = countMatches(meaningfulChars, /[\u3400-\u4DBF\u4E00-\u9FFF]/g);
  if (cjkCount / meaningfulChars.length >= 0.1) {
    return "multilingual";
  }
  return "en";
}

/**
 * COMP-005: 言語に応じてデフォルトモデルIDを選択する。
 */
export function selectModelByLanguage(language: "ja" | "en" | "multilingual"): string {
  if (language === "ja") return "ruri-v3-30m";
  if (language === "multilingual") return "multilingual-e5";
  return "gte-small";
}

export function decideRoute(
  analysis: QueryAnalysis,
  options: RouteThresholdOptions = {}
): AdaptiveRoute {
  const jaThreshold = options.jaThreshold ?? DEFAULT_ADAPTIVE_JA_THRESHOLD;
  const codeThreshold = options.codeThreshold ?? DEFAULT_ADAPTIVE_CODE_THRESHOLD;

  if (analysis.jaRatio >= jaThreshold && analysis.codeRatio < 0.1) {
    return "ruri";
  }
  if (analysis.jaRatio < 0.05 || analysis.codeRatio >= codeThreshold) {
    return "openai";
  }
  return "ensemble";
}
