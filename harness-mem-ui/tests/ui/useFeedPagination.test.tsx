import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { useFeedPagination } from "../../src/hooks/useFeedPagination";
import type { FeedItem } from "../../src/lib/types";

const fetchFeedMock = vi.fn();

vi.mock("../../src/lib/api", () => ({
  fetchFeed: (...args: unknown[]) => fetchFeedMock(...args),
}));

function makeApiResponse(items: FeedItem[]) {
  return {
    ok: true,
    source: "core" as const,
    items,
    meta: {
      count: items.length,
      latency_ms: 1,
      filters: {},
      ranking: "feed_v1",
      next_cursor: null,
    },
  };
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useFeedPagination", () => {
  beforeEach(() => {
    fetchFeedMock.mockReset();
  });

  test("does not fetch until enabled", () => {
    const { result } = renderHook(() =>
      useFeedPagination({
        enabled: false,
        project: "/Users/example/Context-Harness",
        platformFilter: "__all__",
        includePrivate: false,
        limit: 20,
      })
    );

    expect(fetchFeedMock).not.toHaveBeenCalled();
    expect(result.current.loading).toBe(false);
    expect(result.current.initialized).toBe(false);
    expect(result.current.items).toEqual([]);
  });

  test("platformFilter=claude includes claude-* platform values", async () => {
    fetchFeedMock.mockResolvedValueOnce(
      makeApiResponse([
        { id: "obs-claude", platform: "claude-code", project: "/Users/example/Context-Harness" },
        { id: "obs-codex", platform: "codex", project: "/Users/example/Context-Harness" },
      ])
    );

    const { result } = renderHook(() =>
      useFeedPagination({
        project: "/Users/example/Context-Harness",
        platformFilter: "claude",
        includePrivate: false,
        limit: 20,
      })
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.items.map((item) => item.id)).toEqual(["obs-claude"]);
    });
  });

  test("prependLiveItem keeps claude item when selected project and item project are alias-related", async () => {
    fetchFeedMock.mockResolvedValueOnce(makeApiResponse([]));

    const { result } = renderHook(() =>
      useFeedPagination({
        project: "/Users/example/Context-Harness",
        platformFilter: "__all__",
        includePrivate: false,
        limit: 20,
      })
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
    });

    act(() => {
      result.current.prependLiveItem({
        id: "live-claude",
        platform: "claude",
        project: "/Users/example",
        event_type: "tool_use",
        title: "tool use",
        content: "content",
        privacy_tags: [],
      });
    });

    expect(result.current.items.map((item) => item.id)).toEqual(["live-claude"]);
  });

  test("project switch seeds from all-project cache and avoids transient loading", async () => {
    fetchFeedMock.mockResolvedValueOnce(
      makeApiResponse([
        { id: "all-context", platform: "claude-code", project: "/Users/example/Context-Harness" },
        { id: "all-other", platform: "codex", project: "/Users/example/Other-Repo" },
      ])
    );

    const projectRefresh = createDeferred<ReturnType<typeof makeApiResponse>>();
    fetchFeedMock.mockImplementationOnce(() => projectRefresh.promise);

    const { result, rerender } = renderHook(
      ({ project }) =>
        useFeedPagination({
          project,
          platformFilter: "__all__",
          includePrivate: false,
          limit: 40,
        }),
      {
        initialProps: { project: "__all__" },
      }
    );

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.items.map((item) => item.id)).toEqual(["all-context", "all-other"]);
    });

    rerender({ project: "/Users/example/Context-Harness" });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.items.map((item) => item.id)).toEqual(["all-context"]);
    });

    await act(async () => {
      projectRefresh.resolve(
        makeApiResponse([
          { id: "project-context-1", platform: "claude-code", project: "/Users/example/Context-Harness" },
          { id: "project-context-2", platform: "codex", project: "/Users/example/Context-Harness" },
        ])
      );
      await projectRefresh.promise;
    });

    await waitFor(() => {
      expect(result.current.loading).toBe(false);
      expect(result.current.items.map((item) => item.id)).toEqual(["project-context-1", "project-context-2"]);
    });
  });
});
