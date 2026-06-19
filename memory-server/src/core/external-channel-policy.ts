/**
 * external-channel-policy.ts — S154-900: egress policy for external channels.
 *
 * "External channel" = any surface where memory content leaves the local
 * tool boundary toward third-party messaging (Hermes business responses
 * relayed to Telegram / Slack / Discord / WhatsApp etc.).
 *
 * Contract (Plans.md 154-900, D2-consistent):
 *  1) Memory content handed to an external channel MUST pass the
 *     deterministic redactor (stripPrivateBlocks + redactSecrets).
 *  2) Observations carrying privacy_tags "private" / "internal" / "secret"
 *     are EXCLUDED from external-channel egress entirely (not redacted —
 *     dropped).
 *  3) Fail-closed: a malformed privacy_tags value (non-array, or any
 *     non-string entry) excludes the item, mirroring the D38 malformed
 *     privacy_tags_json fail-close precedent.
 *
 * resume_pack is NOT an external-channel surface: its pack shape cannot be
 * filtered per-item post-hoc. External consumers (Hermes bridge) must read
 * through `HarnessMemCore.searchForExternalChannel()`.
 */

import { redactSecrets, stripPrivateBlocks } from "./privacy-tags";

/** Privacy tags whose observations never leave toward an external channel. */
export const EXTERNAL_CHANNEL_BLOCKED_PRIVACY_TAGS = ["private", "internal", "secret"] as const;

const BLOCKED: ReadonlySet<string> = new Set(EXTERNAL_CHANNEL_BLOCKED_PRIVACY_TAGS);

/**
 * Whether an observation's privacy_tags forbid external-channel egress.
 *
 * - `null` / `undefined` / `[]` → not blocked (no privacy restriction).
 * - non-array or non-string entry → blocked (fail-closed).
 * - any entry (trimmed, case-insensitive) in the blocklist → blocked.
 */
export function isBlockedForExternalChannel(privacyTags: unknown): boolean {
  if (privacyTags == null) return false;
  if (!Array.isArray(privacyTags)) return true;
  for (const tag of privacyTags) {
    if (typeof tag !== "string") return true;
    if (BLOCKED.has(tag.trim().toLowerCase())) return true;
  }
  return false;
}

/** Deterministic redactor pass required for any external-channel text. */
export function sanitizeTextForExternalChannel(text: string | null | undefined): string {
  return redactSecrets(stripPrivateBlocks(text) ?? "");
}

export interface ExternalChannelItem {
  [key: string]: unknown;
  title?: unknown;
  content?: unknown;
  privacy_tags?: unknown;
}

export interface ExternalChannelSanitizeResult<T> {
  items: T[];
  excluded_count: number;
}

/**
 * Apply the full external-channel policy to a list of observation-shaped
 * items: drop blocked items, redact surviving title/content.
 */
export function sanitizeItemsForExternalChannel<T extends ExternalChannelItem>(
  items: readonly T[],
): ExternalChannelSanitizeResult<T> {
  const out: T[] = [];
  let excluded = 0;
  for (const item of items) {
    if (isBlockedForExternalChannel(item.privacy_tags)) {
      excluded += 1;
      continue;
    }
    out.push({
      ...item,
      title: typeof item.title === "string" ? sanitizeTextForExternalChannel(item.title) : item.title,
      content: typeof item.content === "string" ? sanitizeTextForExternalChannel(item.content) : item.content,
    });
  }
  return { items: out, excluded_count: excluded };
}
