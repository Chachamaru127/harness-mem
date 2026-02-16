import { render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { FeedPanel } from "../../src/components/FeedPanel";
import type { FeedItem } from "../../src/lib/types";

class MockIntersectionObserver {
  observe() {}
  disconnect() {}
  unobserve() {}
}

vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);

function claudeToolUse(index: number): FeedItem {
  return {
    id: `tool-${index}`,
    platform: "claude",
    project: "Context-Harness",
    session_id: "session-1",
    event_type: "tool_use",
    title: `Tool ${index}`,
    content: `tool content ${index}`,
    created_at: `2026-02-16T03:10:${String(59 - index).padStart(2, "0")}.000Z`,
    tags: [],
    privacy_tags: [],
  };
}

describe("FeedPanel", () => {
  test("collapses consecutive claude tool_use records into one summary card", () => {
    const items: FeedItem[] = [
      claudeToolUse(1),
      claudeToolUse(2),
      claudeToolUse(3),
      claudeToolUse(4),
      claudeToolUse(5),
      {
        id: "prompt-1",
        platform: "claude",
        project: "Context-Harness",
        session_id: "session-1",
        event_type: "user_prompt",
        title: "User prompt",
        content: "Hello",
        created_at: "2026-02-16T03:09:00.000Z",
        tags: [],
        privacy_tags: [],
      },
    ];

    const { container } = render(
      <FeedPanel
        items={items}
        compact={false}
        language="en"
        loading={false}
        error=""
        hasMore={false}
        onLoadMore={() => undefined}
      />
    );

    expect(screen.getByText("Claude Code Tool Use (5)")).toBeDefined();
    expect(container.querySelectorAll(".feed-card").length).toBe(2);
  });
});
