/**
 * secret-scanner.ts — Stage 0 のローカル秘密検査（cloud egress 前段）
 *
 * 契約: docs/specs/2026-10-living-memory/spec.md §4.5
 *   - クラウドへの送信前に、privacy tag フィルタと秘密検査をローカルで必ず実行する。
 *   - 判定は決定論的。クラウドモデルに「これは秘密か」を聞かない。
 *   - 一致した行は送信しない。理由は文字列で返し、監査には理由だけを残す。
 *
 * 方針:
 *   - 誤検知よりも取りこぼしを避けるが、URL・パス・日付・UUID・日本語のような
 *     日常的な文書断片は通す（誤ブロックは運用を止めるため）。
 *   - ネットワーク呼び出しはしない。依存は privacy-tags.ts の stripPrivateBlocks のみ。
 */

import { stripPrivateBlocks } from "./privacy-tags";

export interface EgressScanResult {
  blocked: boolean;
  reasons: string[];
}

/** privacy_tags のうち、無条件で egress を止めるタグ。 */
const BLOCKING_PRIVACY_TAGS = new Set([
  "private",
  "secret",
  "sensitive",
  "legal_hold",
]);

/** PEM 秘密鍵（RSA / EC / OPENSSH / PKCS#8 のいずれも "PRIVATE KEY" を含む）。 */
const PEM_PRIVATE_KEY_RE = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/;

/** Bearer トークン。ヘッダ名の大文字小文字は問わない。 */
const BEARER_TOKEN_RE = /(?<![A-Za-z0-9_])Bearer\s+[A-Za-z0-9._~+/-]{6,}=*/i;

/** 既知のキープレフィックス。前方が単語文字の場合は対象外（task-based 等を避ける）。 */
const KEY_PREFIX_RE =
  /(?<![A-Za-z0-9_])(?:sk-|rk_|pk_|gh[pousr]_|xox[baprs]-)[A-Za-z0-9_-]{6,}/;

/** key/secret/password への代入。値は 6 文字以上。JSON / YAML の引用符付きキーも含む。 */
const ASSIGNMENT_RE =
  /(?<![A-Za-z0-9_])["']?(?:api[-_]?key|access[-_]?token|secret|password|client[-_]?secret)["']?\s*[:=]\s*["']?[^\s"',;]{6,}/i;

/** メールアドレスの直後に区切りと資格情報らしき文字列（例: user@example.com / demo-pass）。 */
const EMAIL_WITH_SECRET_RE =
  /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\s*[/|:]\s*[^\s,;]{6,}/;

/** demo-pass / hokujob-demo-pass / pass-123 のようなパスワード風トークン。 */
const PASSWORD_TOKEN_RE =
  /(?<![A-Za-z0-9_])(?:[A-Za-z0-9._-]+[-_](?:pass|passwd|pwd)|(?:pass|passwd|pwd)[-_][A-Za-z0-9._-]+)(?![A-Za-z0-9_])/i;

/** ハイフンなしの連続 hex 32 文字以上。UUID や短い commit hash は該当しない。 */
const HEX_RE = /(?<![0-9A-Za-z])[0-9a-fA-F]{32,}(?![0-9A-Za-z])/;

/**
 * base64 風の長い連続文字列。
 * URL とパスは base64 の文字集合（`/` を含む）と衝突するため、判定前に伏せる。
 */
const URL_OR_PATH_RE =
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>`]+|[A-Za-z]:\\[^\s"'<>`]*|(?:~\/|\/)[^\s"'<>`]*/gi;
const BASE64_RE =
  /(?<![A-Za-z0-9+/])[A-Za-z0-9+/]{40,}={0,2}(?![A-Za-z0-9+/=])/g;

/**
 * base64 風文字列が「秘密らしい」か。
 * 大文字・小文字・数字が混在し、英字が全体の 60% 以上を占めるものだけを拾う。
 * ランダムな base64 は英字が約 81% になるため、この条件で通常の英単語列は落ちる。
 */
function looksLikeSecretBase64(token: string): boolean {
  const body = token.replace(/=+$/, "");
  if (body.length < 40) return false;
  if (!/[A-Z]/.test(body) || !/[a-z]/.test(body) || !/[0-9]/.test(body)) {
    return false;
  }
  const letters = body.replace(/[^A-Za-z]/g, "").length;
  return letters / body.length >= 0.6;
}

function maskUrlsAndPaths(content: string): string {
  return content.replace(URL_OR_PATH_RE, " ");
}

function hasPrivateBlock(content: string): boolean {
  const stripped = stripPrivateBlocks(content);
  return typeof stripped === "string" && stripped !== content;
}

function hasBase64Secret(content: string): boolean {
  const masked = maskUrlsAndPaths(content);
  for (const match of masked.matchAll(BASE64_RE)) {
    if (looksLikeSecretBase64(match[0])) return true;
  }
  return false;
}

/**
 * content と privacyTags をローカルで検査し、egress 可否を返す。
 *
 * - blocked=true の行はクラウドへ送らない。
 * - reasons は一致した規則の識別子。重複しない。監査ログにはこの理由だけを残す。
 */
export function scanForEgress(
  content: string,
  privacyTags: string[],
): EgressScanResult {
  const reasons: string[] = [];
  const add = (reason: string): void => {
    if (!reasons.includes(reason)) reasons.push(reason);
  };

  for (const rawTag of privacyTags) {
    const tag = rawTag.trim().toLowerCase();
    if (BLOCKING_PRIVACY_TAGS.has(tag)) add(`privacy_tag:${tag}`);
  }

  const text = typeof content === "string" ? content : "";

  if (hasPrivateBlock(text)) add("private_block");
  if (PEM_PRIVATE_KEY_RE.test(text)) add("pem_private_key");
  if (BEARER_TOKEN_RE.test(text)) add("bearer_token");
  if (KEY_PREFIX_RE.test(text)) add("api_key_prefix");
  if (ASSIGNMENT_RE.test(text)) add("credential_assignment");
  if (EMAIL_WITH_SECRET_RE.test(text)) add("email_credential_pair");
  if (PASSWORD_TOKEN_RE.test(text)) add("password_token");
  if (HEX_RE.test(text)) add("hex_secret");
  if (hasBase64Secret(text)) add("base64_secret");

  return { blocked: reasons.length > 0, reasons };
}
