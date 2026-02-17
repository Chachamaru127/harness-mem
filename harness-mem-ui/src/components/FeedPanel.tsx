import { useEffect, useMemo, useRef } from "react";
import { getUiCopy } from "../lib/i18n";
import type { FeedItem } from "../lib/types";
import type { UiLanguage } from "../lib/types";

interface FeedPanelProps {
  items: FeedItem[];
  compact: boolean;
  language: UiLanguage;
  loading: boolean;
  error: string;
  hasMore: boolean;
  onLoadMore: () => void;
}

type FeedCategoryId =
  | "prompt"
  | "discovery"
  | "change"
  | "bugfix"
  | "session_summary"
  | "checkpoint"
  | "tool_use"
  | "other";

type PlatformBadgeId = "codex" | "claude" | "opencode" | "cursor" | "other";

const CATEGORY_ORDER: FeedCategoryId[] = ["prompt", "discovery", "change", "bugfix", "session_summary", "checkpoint", "tool_use", "other"];
const CLAUDE_TOOL_USE_COLLAPSE_THRESHOLD = 4;
const CLAUDE_TOOL_USE_COLLAPSE_GAP_MS = 3 * 60 * 1000;
const CONSECUTIVE_SAME_CARD_COLLAPSE_THRESHOLD = 2;
const CONSECUTIVE_SAME_CARD_COLLAPSE_GAP_MS = 3 * 60 * 1000;

const KEYWORDS = {
  discovery: ["discovery", "investigate", "analysis", "root cause", "調査", "特定", "原因", "確認", "検証", "learned"],
  bugfix: ["bugfix", "bug", "fix", "repair", "error", "exception", "invalid", "修正", "不具合", "エラー", "復旧"],
  change: ["change", "update", "implement", "refactor", "migrate", "追加", "変更", "改善", "実装", "対応"],
  sessionSummary: ["session summary", "summary", "finalize", "完了要約", "セッション要約", "サマリー"],
};

function formatTimestamp(value: string | undefined, language: UiLanguage): string {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString(language === "ja" ? "ja-JP" : undefined);
}

function normalizeText(value: unknown): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().toLowerCase();
}

function includesAnyKeyword(text: string, keywords: string[]): boolean {
  for (const keyword of keywords) {
    if (text.includes(keyword)) {
      return true;
    }
  }
  return false;
}

function inferCategory(item: FeedItem): FeedCategoryId {
  const eventType = normalizeText(item.event_type || item.card_type);
  const title = normalizeText(item.title);
  const content = normalizeText(item.content);
  const summary = normalizeText(item.summary);
  const tags = (item.tags || []).map((tag) => normalizeText(tag)).join(" ");
  const text = `${title} ${content} ${summary} ${tags}`;

  if (eventType.includes("session_end") || includesAnyKeyword(text, KEYWORDS.sessionSummary)) {
    return "session_summary";
  }
  if (eventType.includes("tool")) {
    return "tool_use";
  }
  if (eventType.includes("user_prompt")) {
    return "prompt";
  }
  if (includesAnyKeyword(text, KEYWORDS.bugfix)) {
    return "bugfix";
  }
  if (includesAnyKeyword(text, KEYWORDS.discovery)) {
    return "discovery";
  }
  if (includesAnyKeyword(text, KEYWORDS.change)) {
    return "change";
  }
  if (eventType.includes("checkpoint")) {
    return "checkpoint";
  }
  return "other";
}

function toEpochMs(value: string | undefined): number {
  if (!value) {
    return 0;
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return 0;
  }
  return parsed;
}

function isClaudeToolUse(item: FeedItem): boolean {
  const platform = normalizeText(item.platform);
  const eventType = normalizeText(item.event_type || item.card_type);
  return platform.includes("claude") && eventType === "tool_use";
}

function parseSummaryFromContent(content: string | undefined): string {
  if (typeof content !== "string") {
    return "";
  }
  const trimmed = content.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return "";
  }
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    return typeof parsed.summary === "string" ? parsed.summary.trim() : "";
  } catch {
    return "";
  }
}

function resolveCardContent(item: FeedItem, category: FeedCategoryId): string {
  if (category !== "session_summary") {
    return item.content || "";
  }

  const explicitSummary = typeof item.summary === "string" ? item.summary.trim() : "";
  if (explicitSummary) {
    return explicitSummary;
  }

  const parsedSummary = parseSummaryFromContent(item.content);
  if (parsedSummary) {
    return parsedSummary;
  }

  return item.content || "";
}

function summarizeClaudeToolUseRun(items: FeedItem[], language: UiLanguage): FeedItem {
  const latest = items[0] || {};
  const oldest = items[items.length - 1] || {};

  const uniqueHints = Array.from(
    new Set(
      items
        .map((item) => (typeof item.title === "string" ? item.title.trim() : ""))
        .filter((title) => title.length > 0 && title.toLowerCase() !== "tool_use")
    )
  ).slice(0, 3);

  const latestAt = formatTimestamp(latest.created_at, language);
  const oldestAt = formatTimestamp(oldest.created_at, language);
  const title =
    language === "ja"
      ? `Claude Code ツール実行 ${items.length}件`
      : `Claude Code Tool Use (${items.length})`;
  const timeRange =
    language === "ja"
      ? `期間: ${oldestAt} 〜 ${latestAt}`
      : `Range: ${oldestAt} - ${latestAt}`;
  const hintPrefix = language === "ja" ? "代表ツール:" : "Sample tools:";
  const hintText = uniqueHints.length > 0 ? `${hintPrefix} ${uniqueHints.join(" / ")}` : "";

  return {
    id: `${latest.id || "claude-tool-use"}__grouped_${items.length}`,
    event_id: latest.event_id,
    platform: latest.platform || "claude",
    project: latest.project,
    session_id: latest.session_id,
    event_type: "tool_use",
    card_type: "tool_use",
    title,
    content: hintText ? `${timeRange}\n${hintText}` : timeRange,
    created_at: latest.created_at,
    tags: latest.tags || [],
    privacy_tags: latest.privacy_tags || [],
  };
}

function shouldCollapseConsecutiveItems(base: FeedItem, next: FeedItem): boolean {
  const baseType = normalizeText(base.event_type || base.card_type);
  const nextType = normalizeText(next.event_type || next.card_type);
  const baseTitle = normalizeText(base.title);
  const nextTitle = normalizeText(next.title);
  if (!baseType || !baseTitle) {
    return false;
  }

  const baseCreatedAt = toEpochMs(base.created_at);
  const nextCreatedAt = toEpochMs(next.created_at);
  if (baseCreatedAt <= 0 || nextCreatedAt <= 0) {
    return false;
  }
  const gapMs = Math.abs(baseCreatedAt - nextCreatedAt);

  return (
    baseType === nextType &&
    baseTitle === nextTitle &&
    normalizeText(base.platform) === normalizeText(next.platform) &&
    normalizeText(base.project) === normalizeText(next.project) &&
    normalizeText(base.session_id) === normalizeText(next.session_id) &&
    gapMs <= CONSECUTIVE_SAME_CARD_COLLAPSE_GAP_MS
  );
}

function summarizeConsecutiveItems(items: FeedItem[], language: UiLanguage): FeedItem {
  const latest = items[0] || {};
  const oldest = items[items.length - 1] || {};
  const latestAt = formatTimestamp(latest.created_at, language);
  const oldestAt = formatTimestamp(oldest.created_at, language);
  const baseTitle = (typeof latest.title === "string" && latest.title.trim()) || latest.event_type || latest.card_type || "event";
  const title = language === "ja" ? `${baseTitle} (${items.length}件)` : `${baseTitle} (${items.length})`;
  const timeRange = language === "ja" ? `期間: ${oldestAt} 〜 ${latestAt}` : `Range: ${oldestAt} - ${latestAt}`;
  const latestCategory = inferCategory(latest);
  const latestContent = resolveCardContent(latest, latestCategory).replace(/\s+/g, " ").trim().slice(0, 260);
  const latestPrefix = language === "ja" ? "最新:" : "Latest:";

  const tags = Array.from(new Set(items.flatMap((item) => item.tags || []))).slice(0, 8);
  const privacyTags = Array.from(new Set(items.flatMap((item) => item.privacy_tags || []))).slice(0, 8);

  return {
    id: `${latest.id || "grouped"}__same_card_${items.length}`,
    event_id: latest.event_id,
    platform: latest.platform,
    project: latest.project,
    session_id: latest.session_id,
    event_type: latest.event_type,
    card_type: latest.card_type,
    title,
    content: latestContent ? `${timeRange}\n${latestPrefix} ${latestContent}` : timeRange,
    created_at: latest.created_at,
    tags,
    privacy_tags: privacyTags,
  };
}

function collapseClaudeToolUseItems(items: FeedItem[], language: UiLanguage): FeedItem[] {
  const collapsed: FeedItem[] = [];
  let index = 0;

  while (index < items.length) {
    const current = items[index];
    if (!current) {
      index += 1;
      continue;
    }

    if (!isClaudeToolUse(current)) {
      collapsed.push(current);
      index += 1;
      continue;
    }

    const run: FeedItem[] = [current];
    let cursor = index + 1;
    while (cursor < items.length) {
      const next = items[cursor];
      if (!next || !isClaudeToolUse(next)) {
        break;
      }

      const sameProject = (next.project || "") === (current.project || "");
      const sameSession = (next.session_id || "") === (current.session_id || "");
      const prev = run[run.length - 1];
      const gapMs = Math.abs(toEpochMs(prev?.created_at) - toEpochMs(next.created_at));
      if (!sameProject || !sameSession || (gapMs > 0 && gapMs > CLAUDE_TOOL_USE_COLLAPSE_GAP_MS)) {
        break;
      }

      run.push(next);
      cursor += 1;
    }

    if (run.length >= CLAUDE_TOOL_USE_COLLAPSE_THRESHOLD) {
      collapsed.push(summarizeClaudeToolUseRun(run, language));
    } else {
      collapsed.push(...run);
    }
    index = cursor;
  }

  return collapsed;
}

function collapseConsecutiveSameCards(items: FeedItem[], language: UiLanguage): FeedItem[] {
  const collapsed: FeedItem[] = [];
  let index = 0;

  while (index < items.length) {
    const current = items[index];
    if (!current) {
      index += 1;
      continue;
    }

    const run: FeedItem[] = [current];
    let cursor = index + 1;
    while (cursor < items.length) {
      const next = items[cursor];
      if (!next || !shouldCollapseConsecutiveItems(current, next)) {
        break;
      }
      run.push(next);
      cursor += 1;
    }

    if (run.length >= CONSECUTIVE_SAME_CARD_COLLAPSE_THRESHOLD) {
      collapsed.push(summarizeConsecutiveItems(run, language));
    } else {
      collapsed.push(...run);
    }
    index = cursor;
  }

  return collapsed;
}

function categoryLabel(category: FeedCategoryId, language: UiLanguage): string {
  const copy = getUiCopy(language);
  return copy.category[category] || copy.category.other;
}

function normalizePlatformBadge(platform: string | undefined): { id: PlatformBadgeId; label: string } {
  const raw = normalizeText(platform);
  if (raw.includes("codex")) {
    return { id: "codex", label: "Codex" };
  }
  if (raw.includes("claude")) {
    return { id: "claude", label: "Claude Code" };
  }
  if (raw.includes("opencode")) {
    return { id: "opencode", label: "OpenCode" };
  }
  if (raw.includes("cursor")) {
    return { id: "cursor", label: "Cursor" };
  }
  if (platform && platform.trim().length > 0) {
    return { id: "other", label: platform.trim() };
  }
  return { id: "other", label: "Unknown" };
}

export function FeedPanel(props: FeedPanelProps) {
  const { items, compact, language, loading, error, hasMore, onLoadMore } = props;
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const copy = getUiCopy(language);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[0];
      if (entry?.isIntersecting) {
        onLoadMore();
      }
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [onLoadMore]);

  const displayItems = useMemo(() => {
    const toolCollapsed = collapseClaudeToolUseItems(items, language);
    return collapseConsecutiveSameCards(toolCollapsed, language);
  }, [items, language]);

  const categorizedItems = useMemo(() => {
    return displayItems.map((item) => ({
      item,
      category: inferCategory(item),
    }));
  }, [displayItems]);

  return (
    <section className="feed-panel">
      <div className="feed-summary">
        <strong>{copy.feed}</strong>
        <span>{displayItems.length} {copy.itemsLoadedSuffix}</span>
      </div>

      {displayItems.length === 0 && !loading ? (
        <div className="empty">
          {copy.noFeedItems} {copy.noFeedItemsHint}
        </div>
      ) : null}
      {error ? <div className="error" role="alert">{error}</div> : null}
      {loading ? <div className="loading" aria-live="polite">{copy.loading}</div> : null}

      <div className="feed-list">
        {categorizedItems.map(({ item, category }) => {
          const content = resolveCardContent(item, category);
          const platform = normalizePlatformBadge(item.platform);
          return (
            <article
              key={item.id}
              className={`feed-card feed-kind-${category} platform-${platform.id}${compact ? " compact" : ""}`}
            >
              <div className="card-top">
                <div className="card-top-left">
                  <span className={`platform-chip ${platform.id}`}>{platform.label}</span>
                  <span className={`category-chip ${category}`}>{categoryLabel(category, language)}</span>
                </div>
                <span className="card-time">{formatTimestamp(item.created_at, language)}</span>
              </div>

              <h3>{item.title || item.id}</h3>
              {content ? <p>{content}</p> : null}

              <div className="card-meta">
                <span>{item.project || "-"}</span>
                <span>{item.session_id || "-"}</span>
              </div>

              <div className="card-tags">
                {(item.tags || []).map((tag) => (
                  <span key={`${item.id}-tag-${tag}`} className="pill">
                    {tag}
                  </span>
                ))}
                {(item.privacy_tags || []).map((tag) => (
                  <span key={`${item.id}-privacy-${tag}`} className="pill privacy">
                    {copy.privacyPrefix}:{tag}
                  </span>
                ))}
              </div>
            </article>
          );
        })}
      </div>

      {hasMore ? (
        <button type="button" className="load-more" onClick={onLoadMore}>
          {copy.loadMore}
        </button>
      ) : null}
      {!hasMore && displayItems.length > 0 ? <div className="done">{copy.noMoreItems}</div> : null}
      <div ref={sentinelRef} style={{ height: 1 }} aria-hidden="true" />
    </section>
  );
}
