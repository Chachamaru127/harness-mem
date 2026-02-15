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

type PlatformBadgeId = "codex" | "claude" | "opencode" | "other";

const CATEGORY_ORDER: FeedCategoryId[] = ["prompt", "discovery", "change", "bugfix", "session_summary", "checkpoint", "tool_use", "other"];

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
  const tags = (item.tags || []).map((tag) => normalizeText(tag)).join(" ");
  const text = `${title} ${content} ${tags}`;

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

  const categorizedItems = useMemo(() => {
    return items.map((item) => ({
      item,
      category: inferCategory(item),
    }));
  }, [items]);

  return (
    <section className="feed-panel">
      <div className="feed-summary">
        <strong>{copy.feed}</strong>
        <span>{items.length} {copy.itemsLoadedSuffix}</span>
      </div>

      {items.length === 0 && !loading ? (
        <div className="empty">
          {copy.noFeedItems} {copy.noFeedItemsHint}
        </div>
      ) : null}
      {error ? <div className="error" role="alert">{error}</div> : null}
      {loading ? <div className="loading" aria-live="polite">{copy.loading}</div> : null}

      <div className="feed-list">
        {categorizedItems.map(({ item, category }) => {
          const content = item.content || "";
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
      {!hasMore && items.length > 0 ? <div className="done">{copy.noMoreItems}</div> : null}
      <div ref={sentinelRef} style={{ height: 1 }} aria-hidden="true" />
    </section>
  );
}
