export const IGNORED_VISIBLE_PROMPT_PATTERNS = [
  /^# AGENTS\.md instructions\b/i,
  /^<skill>/i,
  /^<turn_aborted>/i,
  /^Base directory for this skill:/i,
  /^<command-message>/i,
  /^<command-name>/i,
  /^<command-args>/i,
  /^<local-command-caveat>/i,
  /^<local-command-(?:stdout|stderr)>/i,
  /^This session is being continued from a previous conversation that ran out of context\./i,
];

export const IGNORED_VISIBLE_RESPONSE_PATTERNS = [
  /^No response requested\.?$/i,
];

export const IGNORED_VISIBLE_TAGS = new Set(["visibility_suppressed"]);

export function buildVisibleInteractionText(title: string | null | undefined, content: string | null | undefined): string {
  return `${title || ""}\n${content || ""}`.trim();
}

export function isIgnoredVisiblePromptText(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) return true;
  return IGNORED_VISIBLE_PROMPT_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function isIgnoredVisibleResponseText(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) return true;
  return IGNORED_VISIBLE_RESPONSE_PATTERNS.some((pattern) => pattern.test(normalized));
}

export function hasIgnoredVisibleTag(tags: string[] | null | undefined): boolean {
  return (tags || []).some((tag) => IGNORED_VISIBLE_TAGS.has(String(tag || "").trim()));
}
