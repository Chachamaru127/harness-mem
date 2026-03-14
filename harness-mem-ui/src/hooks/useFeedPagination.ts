import { useCallback, useEffect, useRef, useState } from "react";
import { fetchFeed } from "../lib/api";
import { mergeFeedItems } from "../lib/merge";
import type { FeedItem } from "../lib/types";

import type { UiPlatformFilter } from "../lib/types";

interface FeedOptions {
  enabled?: boolean;
  project: string;
  platformFilter: UiPlatformFilter;
  includePrivate: boolean;
  limit: number;
}

interface FeedCacheEntry {
  rawItems: FeedItem[];
  cursor?: string;
  hasMore: boolean;
}

const feedCache = new Map<string, FeedCacheEntry>();

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

function resolvedProjectKey(item: FeedItem): string | undefined {
  if (typeof item.canonical_project === "string" && item.canonical_project.trim()) {
    return item.canonical_project;
  }
  return item.project;
}

function normalizePlatform(value: string | undefined): string {
  return (value || "").trim().toLowerCase();
}

function buildFeedCacheKey(project: string, includePrivate: boolean, limit: number): string {
  const projectKey = project === "__all__" ? "__all__" : normalizeProjectKey(project);
  return `${includePrivate ? "private" : "public"}:${limit}:${projectKey}`;
}

function buildSeedCacheEntry(project: string, includePrivate: boolean, limit: number): FeedCacheEntry | null {
  if (project === "__all__") {
    return null;
  }
  const source = feedCache.get(buildFeedCacheKey("__all__", includePrivate, limit));
  if (!source) {
    return null;
  }
  const rawItems = source.rawItems.filter((item) => projectMatchesSelection(project, resolvedProjectKey(item)));
  if (rawItems.length === 0) {
    return null;
  }
  return {
    rawItems,
    cursor: undefined,
    hasMore: false,
  };
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
  const { enabled = true, project, platformFilter, includePrivate, limit } = options;
  const [rawItems, setRawItems] = useState<FeedItem[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [error, setError] = useState<string>("");
  const [refreshToken, setRefreshToken] = useState(0);
  const cacheKey = buildFeedCacheKey(project, includePrivate, limit);
  const rawItemsRef = useRef<FeedItem[]>([]);
  const cursorRef = useRef<string | undefined>(undefined);
  const hasMoreRef = useRef(true);
  const controllerRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);

  const shouldIncludeByPlatform = useCallback(
    (item: FeedItem): boolean => {
      return platformMatchesFilter(item.platform, platformFilter);
    },
    [platformFilter]
  );

  useEffect(() => {
    rawItemsRef.current = rawItems;
  }, [rawItems]);

  useEffect(() => {
    cursorRef.current = cursor;
  }, [cursor]);

  useEffect(() => {
    hasMoreRef.current = hasMore;
  }, [hasMore]);

  const applyCacheEntry = useCallback((entry: FeedCacheEntry) => {
    rawItemsRef.current = entry.rawItems;
    cursorRef.current = entry.cursor;
    hasMoreRef.current = entry.hasMore;
    setRawItems(entry.rawItems);
    setCursor(entry.cursor);
    setHasMore(entry.hasMore);
  }, []);

  const fetchPage = useCallback(
    async (nextCursor?: string, append = true, background = false) => {
      if (nextCursor) {
        if (controllerRef.current) {
          return;
        }
      } else if (controllerRef.current) {
        controllerRef.current.abort();
      }

      const controller = new AbortController();
      controllerRef.current = controller;
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;

      if (!background) {
        setLoading(true);
      }
      setError("");

      try {
        const response = await fetchFeed({
          cursor: nextCursor,
          project: project === "__all__" ? undefined : project,
          includePrivate,
          limit,
          signal: controller.signal,
        });
        if (controller.signal.aborted || requestId !== requestIdRef.current) {
          return;
        }

        const fetched = response.items || [];
        const nextRawItems = append ? mergeFeedItems(rawItemsRef.current, fetched) : mergeFeedItems([], fetched);
        const nextCursorValue = typeof response.meta.next_cursor === "string" ? response.meta.next_cursor : undefined;
        const nextHasMore = Boolean(nextCursorValue);

        rawItemsRef.current = nextRawItems;
        cursorRef.current = nextCursorValue;
        hasMoreRef.current = nextHasMore;
        setRawItems(nextRawItems);
        setCursor(nextCursorValue);
        setHasMore(nextHasMore);
        setInitialized(true);
        feedCache.set(cacheKey, {
          rawItems: nextRawItems,
          cursor: nextCursorValue,
          hasMore: nextHasMore,
        });
      } catch (err) {
        if (controller.signal.aborted || requestId !== requestIdRef.current) {
          return;
        }
        setError(err instanceof Error ? err.message : String(err));
        setInitialized(true);
      } finally {
        if (controllerRef.current === controller) {
          controllerRef.current = null;
        }
        if (!background && requestId === requestIdRef.current) {
          setLoading(false);
        }
      }
    },
    [cacheKey, includePrivate, limit, project]
  );

  useEffect(() => {
    if (!enabled) {
      if (controllerRef.current) {
        controllerRef.current.abort();
        controllerRef.current = null;
      }
      rawItemsRef.current = [];
      cursorRef.current = undefined;
      hasMoreRef.current = true;
      setRawItems([]);
      setCursor(undefined);
      setHasMore(true);
      setLoading(false);
      setInitialized(false);
      setError("");
      return;
    }

    const cached = feedCache.get(cacheKey);
    if (cached) {
      applyCacheEntry(cached);
      setError("");
      setLoading(false);
      setInitialized(true);
      void fetchPage(undefined, false, true);
    } else {
      const seeded = buildSeedCacheEntry(project, includePrivate, limit);
      if (seeded) {
        applyCacheEntry(seeded);
        setError("");
        setLoading(false);
        setInitialized(true);
        void fetchPage(undefined, false, true);
      } else {
        rawItemsRef.current = [];
        cursorRef.current = undefined;
        hasMoreRef.current = true;
        setRawItems([]);
        setCursor(undefined);
        setHasMore(true);
        setInitialized(false);
        void fetchPage(undefined, false);
      }
    }

    return () => {
      if (controllerRef.current) {
        controllerRef.current.abort();
        controllerRef.current = null;
      }
    };
  }, [applyCacheEntry, cacheKey, enabled, fetchPage, includePrivate, limit, project, refreshToken]);

  const loadMore = useCallback(async () => {
    if (!hasMoreRef.current || !cursorRef.current || controllerRef.current) {
      return;
    }
    await fetchPage(cursorRef.current, true);
  }, [fetchPage]);

  const prependLiveItem = useCallback(
    (item: FeedItem) => {
      if (!item.id) {
        return;
      }
      if (!projectMatchesSelection(project, resolvedProjectKey(item))) {
        return;
      }
      if (!includePrivate && (item.privacy_tags || []).some((tag) => tag === "private" || tag === "sensitive")) {
        return;
      }
      const nextRawItems = mergeFeedItems(rawItemsRef.current, [item], true);
      rawItemsRef.current = nextRawItems;
      setRawItems(nextRawItems);
      feedCache.set(cacheKey, {
        rawItems: nextRawItems,
        cursor: cursorRef.current,
        hasMore: hasMoreRef.current,
      });
    },
    [cacheKey, includePrivate, project]
  );

  const items = rawItems.filter((item) => shouldIncludeByPlatform(item));

  const refresh = useCallback(() => setRefreshToken((prev) => prev + 1), []);

  return {
    items,
    hasMore,
    loading,
    initialized,
    error,
    loadMore,
    refresh,
    prependLiveItem,
  };
}
