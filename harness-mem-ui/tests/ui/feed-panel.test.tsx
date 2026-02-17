import { fireEvent, render, screen } from "@testing-library/react";
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

  test("shows real summary text for session summary cards", () => {
    const summary = "Session summary line 1\nSession summary line 2";
    render(
      <FeedPanel
        items={[
          {
            id: "summary-1",
            platform: "claude",
            project: "Context-Harness",
            session_id: "session-2",
            event_type: "session_end",
            card_type: "session_summary",
            title: "session_end",
            content: JSON.stringify({
              summary,
              summary_mode: "standard",
            }),
            created_at: "2026-02-16T03:20:00.000Z",
            tags: ["finalized"],
            privacy_tags: [],
          },
        ]}
        compact={false}
        language="en"
        loading={false}
        error=""
        hasMore={false}
        onLoadMore={() => undefined}
      />
    );

    expect(screen.getByText(/Session summary line 1[\s\S]*Session summary line 2/)).toBeDefined();
    expect(screen.queryByText(/summary_mode/)).toBeNull();
  });

  test("collapses consecutive cards with same type and title", () => {
    const items: FeedItem[] = [
      {
        id: "dup-1",
        platform: "codex",
        project: "Context-Harness",
        session_id: "session-3",
        event_type: "tool_use",
        title: "Read file",
        content: "read package.json",
        created_at: "2026-02-16T03:40:00.000Z",
        tags: [],
        privacy_tags: [],
      },
      {
        id: "dup-2",
        platform: "codex",
        project: "Context-Harness",
        session_id: "session-3",
        event_type: "tool_use",
        title: "Read file",
        content: "read tsconfig.json",
        created_at: "2026-02-16T03:39:00.000Z",
        tags: [],
        privacy_tags: [],
      },
      {
        id: "dup-3",
        platform: "codex",
        project: "Context-Harness",
        session_id: "session-3",
        event_type: "tool_use",
        title: "Read file",
        content: "read README.md",
        created_at: "2026-02-16T03:38:00.000Z",
        tags: [],
        privacy_tags: [],
      },
      {
        id: "other-1",
        platform: "codex",
        project: "Context-Harness",
        session_id: "session-3",
        event_type: "user_prompt",
        title: "User prompt",
        content: "Summarize findings",
        created_at: "2026-02-16T03:37:00.000Z",
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

    expect(screen.getByText("Read file (3)")).toBeDefined();
    expect(container.querySelectorAll(".feed-card").length).toBe(2);
  });

  test("does not re-collapse separated claude tool_use summary runs", () => {
    const items: FeedItem[] = [
      {
        id: "run1-1",
        platform: "claude",
        project: "Context-Harness",
        session_id: "session-gap",
        event_type: "tool_use",
        title: "Read file",
        content: "a",
        created_at: "2026-02-16T03:20:59.000Z",
        tags: [],
        privacy_tags: [],
      },
      {
        id: "run1-2",
        platform: "claude",
        project: "Context-Harness",
        session_id: "session-gap",
        event_type: "tool_use",
        title: "Read file",
        content: "b",
        created_at: "2026-02-16T03:20:58.000Z",
        tags: [],
        privacy_tags: [],
      },
      {
        id: "run1-3",
        platform: "claude",
        project: "Context-Harness",
        session_id: "session-gap",
        event_type: "tool_use",
        title: "Read file",
        content: "c",
        created_at: "2026-02-16T03:20:57.000Z",
        tags: [],
        privacy_tags: [],
      },
      {
        id: "run1-4",
        platform: "claude",
        project: "Context-Harness",
        session_id: "session-gap",
        event_type: "tool_use",
        title: "Read file",
        content: "d",
        created_at: "2026-02-16T03:20:56.000Z",
        tags: [],
        privacy_tags: [],
      },
      {
        id: "run2-1",
        platform: "claude",
        project: "Context-Harness",
        session_id: "session-gap",
        event_type: "tool_use",
        title: "Read file",
        content: "e",
        created_at: "2026-02-16T03:10:59.000Z",
        tags: [],
        privacy_tags: [],
      },
      {
        id: "run2-2",
        platform: "claude",
        project: "Context-Harness",
        session_id: "session-gap",
        event_type: "tool_use",
        title: "Read file",
        content: "f",
        created_at: "2026-02-16T03:10:58.000Z",
        tags: [],
        privacy_tags: [],
      },
      {
        id: "run2-3",
        platform: "claude",
        project: "Context-Harness",
        session_id: "session-gap",
        event_type: "tool_use",
        title: "Read file",
        content: "g",
        created_at: "2026-02-16T03:10:57.000Z",
        tags: [],
        privacy_tags: [],
      },
      {
        id: "run2-4",
        platform: "claude",
        project: "Context-Harness",
        session_id: "session-gap",
        event_type: "tool_use",
        title: "Read file",
        content: "h",
        created_at: "2026-02-16T03:10:56.000Z",
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

    expect(screen.getAllByText("Claude Code Tool Use (4)").length).toBe(2);
    expect(container.querySelectorAll(".feed-card").length).toBe(2);
  });

  test("renders cursor/antigravity platform badges with dedicated classes", () => {
    const items: FeedItem[] = [
      {
        id: "cursor-1",
        platform: "cursor",
        project: "harness-mem",
        session_id: "cursor-session",
        event_type: "user_prompt",
        title: "Cursor prompt",
        content: "cursor test",
        created_at: "2026-02-16T03:50:00.000Z",
        tags: [],
        privacy_tags: [],
      },
      {
        id: "antigravity-1",
        platform: "antigravity",
        project: "antigravity-project",
        session_id: "antigravity-session",
        event_type: "checkpoint",
        title: "Checkpoint",
        content: "antigravity test",
        created_at: "2026-02-16T03:49:00.000Z",
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

    expect(screen.getByText("Cursor")).toBeDefined();
    expect(screen.getByText("Antigravity")).toBeDefined();
    expect(container.querySelectorAll(".platform-chip.cursor").length).toBe(1);
    expect(container.querySelectorAll(".platform-chip.antigravity").length).toBe(1);
  });

  test("expands inline detail with full content on card click", () => {
    const fullText = "line-1\nline-2\nline-3 full detail";
    const { container } = render(
      <FeedPanel
        items={[
          {
            id: "detail-1",
            platform: "codex",
            project: "harness-mem",
            session_id: "detail-session",
            event_type: "user_prompt",
            title: "Open detail",
            content: fullText,
            created_at: "2026-02-16T04:10:00.000Z",
            tags: [],
            privacy_tags: [],
          },
        ]}
        compact={true}
        language="en"
        loading={false}
        error=""
        hasMore={false}
        onLoadMore={() => undefined}
      />
    );

    fireEvent.click(screen.getByText("Open detail"));
    expect(container.querySelectorAll(".feed-card.expanded").length).toBe(1);
    const detail = container.querySelector(".feed-inline-detail");
    expect(detail).toBeTruthy();
    expect(detail?.textContent).toContain("line-3 full detail");

    fireEvent.click(screen.getByText("Open detail"));
    expect(container.querySelectorAll(".feed-card.expanded").length).toBe(0);
    expect(container.querySelectorAll(".feed-inline-detail").length).toBe(0);
  });
});
