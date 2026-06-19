/**
 * privacy-tags.ts — Ingest-time sanitizer for <private>...</private> blocks.
 *
 * Strip <private>...</private> blocks from observation content BEFORE embedding
 * and BEFORE persisted content write. This is a default-on, no-opt-out sanitizer.
 *
 * Design notes:
 *   - Applied at the ingest choke point (recordEvent) before buildObservationFromEvent.
 *   - tags / privacy_tags arrays on an observation are NOT affected.
 *   - Strips the block entirely (not replaced with [REDACTED]).
 *   - If the entire content is private blocks, result is "". No error is thrown.
 *   - Malformed tags (no matching close tag) are left as-is to avoid data loss.
 */

const PRIVATE_TAG_RE = /<private\b[^>]*>[\s\S]*?<\/private>/gi;

/**
 * Strip all well-formed `<private>...</private>` blocks (case-insensitive, multi-line).
 *
 * - Returns input unchanged when it is null, undefined, or empty string.
 * - Handles attributes: `<private reason="credentials">...</private>` is stripped.
 * - Multiple blocks are all stripped independently (non-greedy).
 * - Unbalanced / malformed tags (no closing `</private>`) are left untouched.
 * - Whitespace between stripped blocks is preserved as-is (two spaces is acceptable).
 */
export function stripPrivateBlocks(text: string | null | undefined): string | null | undefined {
  if (!text) return text;
  return text.replace(PRIVATE_TAG_RE, "");
}

/**
 * S154-204: deterministic secret redaction, applied UNCONDITIONALLY before a
 * current-state prose summary is produced (`summarizeCurrentState`). Unlike the
 * tag-gated ingest redactor in event-recorder, this always runs and additionally
 * covers PEM private-key blocks, Bearer tokens, and phone numbers. Order matters
 * (multi-line PEM first). Over-redaction is acceptable; leakage is not.
 *
 * Phone patterns are intentionally narrow (JP 0-prefixed or intl +-prefixed with
 * separators) so ISO dates like 2026-06-08 are NOT redacted as phone numbers.
 */
const SECRET_RULES: Array<[RegExp, string]> = [
  [/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g, "[REDACTED_PEM]"],
  [/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "[REDACTED_BEARER]"],
  [/\b(?:sk|rk|pk)[-_][A-Za-z0-9]{16,}\b/g, "[REDACTED_KEY]"],
  [/\bgh[posru]_[A-Za-z0-9]{20,}\b/g, "[REDACTED_KEY]"],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, "[REDACTED_KEY]"],
  [
    /\b(?:api[-_ ]?key|access[-_ ]?token|secret|password|passwd|pwd|client[-_ ]?secret|private[-_ ]?key)\s*[:=]\s*['"]?[^\s'"]{6,}/gi,
    "[REDACTED_SECRET]",
  ],
  [/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[REDACTED_EMAIL]"],
  [/\b[0-9a-f]{32,}\b/gi, "[REDACTED_HEX]"],
  [/\b0\d{1,4}[-.\s]\d{1,4}[-.\s]\d{3,4}\b/g, "[REDACTED_PHONE]"],
  [/\+\d{1,3}[-.\s]?\d{1,4}[-.\s]\d{1,4}[-.\s]\d{2,4}\b/g, "[REDACTED_PHONE]"],
];

/** S154-204: redact secrets from free text. Always returns a string (never null). */
export function redactSecrets(text: string | null | undefined): string {
  if (!text) return "";
  let out = text;
  for (const [pattern, replacement] of SECRET_RULES) {
    out = out.replace(pattern, replacement);
  }
  return out;
}
