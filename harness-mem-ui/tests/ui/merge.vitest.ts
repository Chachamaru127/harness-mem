import { describe, expect, test } from "vitest";
import { mergeFeedItems } from "../../src/lib/merge";

describe("mergeFeedItems", () => {
  test("dedupes by id while preserving incoming priority", () => {
    const current = [
      { id: "a", title: "old-a" },
      { id: "b", title: "old-b" },
    ];
    const incoming = [
      { id: "b", title: "new-b" },
      { id: "c", title: "new-c" },
    ];

    const merged = mergeFeedItems(current, incoming, true);
    expect(merged.map((item) => item.id)).toEqual(["b", "c", "a"]);
    expect(merged[0]?.title).toBe("new-b");
  });

  test("backfills missing content/timestamp from duplicate item", () => {
    const current = [
      {
        id: "cursor-1",
        title: "Cursor prompt",
        content: "",
        created_at: undefined,
        tags: [],
        privacy_tags: [],
      },
    ];
    const incoming = [
      {
        id: "cursor-1",
        title: "Cursor prompt",
        content: "actual prompt text",
        created_at: "2026-02-16T09:20:47Z",
        tags: ["cursor_hooks_ingest"],
        privacy_tags: [],
      },
    ];

    const merged = mergeFeedItems(current, incoming, false);
    expect(merged).toHaveLength(1);
    expect(merged[0]?.content).toBe("actual prompt text");
    expect(merged[0]?.created_at).toBe("2026-02-16T09:20:47Z");
    expect(merged[0]?.tags).toEqual(["cursor_hooks_ingest"]);
  });
});
