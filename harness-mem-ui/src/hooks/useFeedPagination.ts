import { useCallback, useEffect, useRef, useState } from "react";
import { fetchFeed } from "../lib/api";
import { mergeFeedItems } from "../lib/merge";
import type { FeedItem } from "../lib/types";

interface FeedOptions {
  project: string;
  platformFilter: "__all__" | "claude" | "codex" | "opencode";
  includePrivate: boolean;
  limit: number;
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
      if (platformFilter === "__all__") {
        return true;
      }
      return item.platform === platformFilter;
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
      if (project !== "__all__" && item.project && item.project !== project) {
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
