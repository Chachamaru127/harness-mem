import { useCallback, useEffect, useRef, useState } from "react";
import { fetchFeed } from "../lib/api";
import { mergeFeedItems } from "../lib/merge";
import type { FeedItem } from "../lib/types";

import type { UiPlatformFilter } from "../lib/types";

interface FeedOptions {
  project: string;
  platformFilter: UiPlatformFilter;
  includePrivate: boolean;
  limit: number;
}

function normalizeProjectKey(value: string | undefined): string {
  if (typeof value !== "string") {
    return "";
  }
  return value.trim().replace(/\\/g, "/").replace(/\/+$/, "");
}

function projectMatchesSelection(selectedProject: string, itemProject: string | undefined): boolean {
  if (selectedProject === "__all__") {
    return true;
  }
  if (!itemProject) {
    return false;
  }
  const selected = normalizeProjectKey(selectedProject);
  const item = normalizeProjectKey(itemProject);
  if (!selected || !item) {
    return false;
  }
  return item === selected || item.startsWith(`${selected}/`) || selected.startsWith(`${item}/`);
}

function normalizePlatform(value: string | undefined): string {
  return (value || "").trim().toLowerCase();
}

function platformMatchesFilter(platform: string | undefined, filter: FeedOptions["platformFilter"]): boolean {
  const normalized = normalizePlatform(platform);
  if (normalized.includes("antigravity")) {
    return false;
  }
  if (filter === "__all__") {
    return true;
  }
  if (!normalized) {
    return false;
  }
  return normalized === filter || normalized.startsWith(`${filter}-`) || normalized.includes(filter);
}

export function useFeedPagination(options: FeedOptions) {
  const { project, platformFilter, includePrivate, limit } = options;
  const [items, setItems] = useState<FeedItem[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>("");
  const [refreshToken, setRefreshToken] = useState(0);
  const inflightRef = useRef(false);

  const shouldIncludeByPlatform = useCallback(
    (item: FeedItem): boolean => {
      return platformMatchesFilter(item.platform, platformFilter);
    },
    [platformFilter]
  );

  const fetchPage = useCallback(
    async (nextCursor?: string, append = true) => {
      if (inflightRef.current) {
        return;
      }
      inflightRef.current = true;
      setLoading(true);
      setError("");
      try {
        const response = await fetchFeed({
          cursor: nextCursor,
          project: project === "__all__" ? undefined : project,
          includePrivate,
          limit,
        });
        const fetched = (response.items || []).filter((item) => shouldIncludeByPlatform(item));
        setItems((prev) => (append ? mergeFeedItems(prev, fetched) : mergeFeedItems([], fetched)));
        const next = typeof response.meta.next_cursor === "string" ? response.meta.next_cursor : undefined;
        setCursor(next);
        setHasMore(Boolean(next));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        inflightRef.current = false;
        setLoading(false);
      }
    },
    [includePrivate, limit, project, shouldIncludeByPlatform]
  );

  useEffect(() => {
    setItems([]);
    setCursor(undefined);
    setHasMore(true);
    void fetchPage(undefined, false);
  }, [fetchPage, refreshToken]);

  const loadMore = useCallback(async () => {
    if (!hasMore || !cursor || loading) {
      return;
    }
    await fetchPage(cursor, true);
  }, [cursor, fetchPage, hasMore, loading]);

  const prependLiveItem = useCallback(
    (item: FeedItem) => {
      if (!item.id) {
        return;
      }
      if (!projectMatchesSelection(project, item.project)) {
        return;
      }
      if (!shouldIncludeByPlatform(item)) {
        return;
      }
      if (!includePrivate && (item.privacy_tags || []).some((tag) => tag === "private" || tag === "sensitive")) {
        return;
      }
      setItems((prev) => mergeFeedItems(prev, [item], true));
    },
    [includePrivate, project, shouldIncludeByPlatform]
  );

  const refresh = useCallback(() => setRefreshToken((prev) => prev + 1), []);

  return {
    items,
    hasMore,
    loading,
    error,
    loadMore,
    refresh,
    prependLiveItem,
  };
}
