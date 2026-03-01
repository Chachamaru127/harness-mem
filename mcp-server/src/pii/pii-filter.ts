/**
 * TEAM-006: PII フィルタリング
 *
 * MCP Server から VPS への送信前に PII（個人識別情報）を除去/置換するモジュール。
 * VPS には PII が到達しない設計を保証する。
 *
 * フィルタ対象:
 *   - 電話番号 → [PHONE]
 *   - メールアドレス → [EMAIL]
 *   - LINE ID → [LINE_ID]
 *   - カスタムルール（pii-rules.json から読み込み）
 */
import { readFileSync } from "node:fs";

export interface PiiRule {
  name: string;
  /** 正規表現文字列（フラグなし、グローバル置換は自動適用）*/
  pattern: string;
  replacement: string;
}

export interface PiiRulesFile {
  rules?: PiiRule[];
}

/**
 * テキストに PII フィルタを適用し、マスク済みテキストを返す純粋関数。
 *
 * @param text - フィルタ対象テキスト
 * @param rules - 適用する PiiRule の配列
 * @returns マスク済みテキスト
 */
export function applyPiiFilter(text: string, rules: PiiRule[]): string {
  let result = text;
  for (const rule of rules) {
    try {
      const regex = new RegExp(rule.pattern, "g");
      result = result.replace(regex, rule.replacement);
    } catch {
      // 正規表現が不正な場合はスキップ
    }
  }
  return result;
}

/**
 * pii-rules.json ファイルからルールを読み込む。
 * ファイルが存在しないか不正な場合は空配列を返す。
 */
export function loadPiiRules(rulesPath: string): PiiRule[] {
  try {
    const raw = readFileSync(rulesPath, "utf8");
    const parsed = JSON.parse(raw) as PiiRulesFile;
    if (Array.isArray(parsed?.rules)) {
      return parsed.rules.filter(
        (r): r is PiiRule =>
          typeof r.name === "string" &&
          typeof r.pattern === "string" &&
          typeof r.replacement === "string"
      );
    }
  } catch {
    // ファイルなし / パースエラー
  }
  return [];
}

/** デフォルトの PII ルール（組み込み） */
export const DEFAULT_PII_RULES: PiiRule[] = [
  {
    name: "phone",
    pattern: "0\\d{1,4}[-‐−]?\\d{1,4}[-‐−]?\\d{3,4}",
    replacement: "[PHONE]",
  },
  {
    name: "email",
    pattern: "[\\w.+\\-]+@[\\w.\\-]+\\.\\w+",
    replacement: "[EMAIL]",
  },
  {
    name: "line_id",
    pattern: "@[a-zA-Z0-9_.]{3,20}",
    replacement: "[LINE_ID]",
  },
];

/**
 * 環境変数と設定ファイルを参照して有効な PII ルールセットを返す。
 * HARNESS_MEM_PII_FILTER=true の場合のみ有効化。
 * HARNESS_MEM_PII_RULES_PATH が設定されていればそのパスからルールを読み込む。
 */
export function getActivePiiRules(): PiiRule[] | null {
  const enabled = (process.env.HARNESS_MEM_PII_FILTER || "").toLowerCase();
  if (enabled !== "true" && enabled !== "1") {
    return null; // フィルタ無効
  }

  const rulesPath = process.env.HARNESS_MEM_PII_RULES_PATH;
  if (rulesPath) {
    const custom = loadPiiRules(rulesPath);
    return custom.length > 0 ? custom : DEFAULT_PII_RULES;
  }

  return DEFAULT_PII_RULES;
}
