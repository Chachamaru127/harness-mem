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
});
