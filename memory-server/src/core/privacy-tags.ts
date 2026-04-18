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
