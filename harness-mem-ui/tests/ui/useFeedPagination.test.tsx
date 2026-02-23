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

describe("useFeedPagination", () => {
  beforeEach(() => {
    fetchFeedMock.mockReset();
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
});
