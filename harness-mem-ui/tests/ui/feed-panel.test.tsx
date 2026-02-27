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

/** セッショングループヘッダーを展開してカードを表示する */
function expandAllGroups(container: HTMLElement): void {
  const headers = container.querySelectorAll<HTMLButtonElement>(".session-group-header");
  for (const header of headers) {
    fireEvent.click(header);
  }
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

    expandAllGroups(container);
    expect(screen.getByText("Claude Code Tool Use (5)")).toBeDefined();
    expect(container.querySelectorAll(".feed-card").length).toBe(2);
  });

  test("shows real summary text for session summary cards", () => {
    const summary = "Session summary line 1\nSession summary line 2";
    const { container } = render(
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

    expandAllGroups(container);
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

    expandAllGroups(container);
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

    expandAllGroups(container);
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

    expandAllGroups(container);
    expect(screen.getByText("Cursor")).toBeDefined();
    expect(screen.getByText("Antigravity")).toBeDefined();
    expect(container.querySelectorAll(".platform-chip.cursor").length).toBe(1);
    expect(container.querySelectorAll(".platform-chip.antigravity").length).toBe(1);
  });

  test("W3-001: renders gemini platform badge with dedicated class and aria-label", () => {
    const items: FeedItem[] = [
      {
        id: "gemini-1",
        platform: "gemini",
        project: "gemini-project",
        session_id: "gemini-session",
        event_type: "user_prompt",
        title: "Gemini prompt",
        content: "gemini test content",
        created_at: "2026-02-16T03:48:00.000Z",
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

    expandAllGroups(container);
    expect(screen.getByText("Gemini")).toBeDefined();
    expect(container.querySelectorAll(".platform-chip.gemini").length).toBe(1);
    // a11y: aria-label が付いていることを確認
    const badge = container.querySelector(".platform-chip.gemini");
    expect(badge?.getAttribute("aria-label")).toBe("Platform: Gemini");
  });

  test("W3-001: platform badges have aria-label for all platforms", () => {
    const platforms = [
      { platform: "claude", label: "Claude Code" },
      { platform: "codex", label: "Codex" },
      { platform: "cursor", label: "Cursor" },
      { platform: "opencode", label: "OpenCode" },
      { platform: "gemini", label: "Gemini" },
    ];

    for (const { platform, label } of platforms) {
      const { container, unmount } = render(
        <FeedPanel
          items={[{
            id: `badge-${platform}`,
            platform,
            project: "test-project",
            session_id: "test-session",
            event_type: "user_prompt",
            title: `${platform} item`,
            content: "content",
            created_at: "2026-02-16T03:47:00.000Z",
            tags: [],
            privacy_tags: [],
          }]}
          compact={false}
          language="en"
          loading={false}
          error=""
          hasMore={false}
          onLoadMore={() => undefined}
        />
      );

      expandAllGroups(container);
      const badge = container.querySelector(`.platform-chip.${platform}`);
      expect(badge).toBeTruthy();
      expect(badge?.getAttribute("aria-label")).toBe(`Platform: ${label}`);
      unmount();
    }
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

    expandAllGroups(container);
    fireEvent.click(screen.getByText("Open detail"));
    expect(container.querySelectorAll(".feed-card.expanded").length).toBe(1);
    const detail = container.querySelector(".feed-inline-detail");
    expect(detail).toBeTruthy();
    expect(detail?.textContent).toContain("line-3 full detail");

    fireEvent.click(screen.getByText("Open detail"));
    expect(container.querySelectorAll(".feed-card.expanded").length).toBe(0);
    expect(container.querySelectorAll(".feed-inline-detail").length).toBe(0);
  });

  test("W3-002: system envelope cards are collapsed by default (content hidden)", () => {
    const { container } = render(
      <FeedPanel
        items={[
          {
            id: "env-ctx-1",
            platform: "codex",
            project: "harness-mem",
            session_id: "env-session",
            event_type: "user_prompt",
            title: "<environment_context>",
            content: "<environment_context>\n  <cwd>/tmp</cwd>\n  SECRET=value\n</environment_context>",
            created_at: "2026-02-16T04:30:00.000Z",
            tags: [],
            privacy_tags: [],
          },
          {
            id: "agents-1",
            platform: "codex",
            project: "harness-mem",
            session_id: "env-session",
            event_type: "user_prompt",
            title: "# agents.md instructions for /tmp/project",
            content: "# agents.md instructions for /tmp/project\n\nsome instructions",
            created_at: "2026-02-16T04:29:00.000Z",
            tags: [],
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

    expandAllGroups(container);

    // system-envelope クラスが付いていることを確認
    const envelopeCards = container.querySelectorAll(".feed-card.system-envelope");
    expect(envelopeCards.length).toBe(2);

    // コンテンツが非表示（デフォルト折りたたみ）
    expect(container.querySelector("p")?.textContent).toBeUndefined();

    // 展開ヒントが表示されている
    const hints = container.querySelectorAll(".system-envelope-hint");
    expect(hints.length).toBeGreaterThan(0);
  });

  test("W3-002: system envelope card expands on click (keyboard accessible)", () => {
    const { container } = render(
      <FeedPanel
        items={[
          {
            id: "env-expand-1",
            platform: "codex",
            project: "harness-mem",
            session_id: "env-session",
            event_type: "user_prompt",
            title: "<environment_context>",
            content: "<environment_context>SECRET_CONTENT</environment_context>",
            created_at: "2026-02-16T04:31:00.000Z",
            tags: [],
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

    expandAllGroups(container);

    const card = container.querySelector(".feed-card.system-envelope");
    expect(card).toBeTruthy();

    // クリックで展開
    fireEvent.click(card!);
    expect(card?.classList.contains("expanded")).toBe(true);
    expect(card?.getAttribute("aria-expanded")).toBe("true");

    // 再クリックで折りたたみ
    fireEvent.click(card!);
    expect(card?.classList.contains("expanded")).toBe(false);
  });

  test("classifies system envelope user_prompt cards as other", () => {
    const { container } = render(
      <FeedPanel
        items={[
          {
            id: "sys-1",
            platform: "codex",
            project: "harness-mem",
            session_id: "sys-session",
            event_type: "user_prompt",
            title: "# AGENTS.md instructions for /tmp/project",
            content: "# AGENTS.md instructions for /tmp/project\n\n<INSTRUCTIONS>",
            created_at: "2026-02-16T04:20:00.000Z",
            tags: [],
            privacy_tags: [],
          },
          {
            id: "sys-2",
            platform: "codex",
            project: "harness-mem",
            session_id: "sys-session",
            event_type: "user_prompt",
            title: "<environment_context>",
            content: "<environment_context>\n  <cwd>/tmp</cwd>\n</environment_context>",
            created_at: "2026-02-16T04:19:00.000Z",
            tags: [],
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

    expandAllGroups(container);
    expect(container.querySelectorAll(".feed-card.feed-kind-other").length).toBe(2);
    expect(container.querySelectorAll(".feed-card.feed-kind-prompt").length).toBe(0);
  });

  test("W3-003: groups items by session_id under accordion headers", () => {
    const items: FeedItem[] = [
      {
        id: "s1-1",
        platform: "codex",
        project: "proj-a",
        session_id: "session-alpha",
        event_type: "user_prompt",
        title: "Prompt A1",
        content: "hello",
        created_at: "2026-02-16T05:00:00.000Z",
        tags: [],
        privacy_tags: [],
      },
      {
        id: "s1-2",
        platform: "codex",
        project: "proj-a",
        session_id: "session-alpha",
        event_type: "user_prompt",
        title: "Prompt A2",
        content: "world",
        created_at: "2026-02-16T04:59:00.000Z",
        tags: [],
        privacy_tags: [],
      },
      {
        id: "s2-1",
        platform: "claude",
        project: "proj-b",
        session_id: "session-beta",
        event_type: "user_prompt",
        title: "Prompt B1",
        content: "foo",
        created_at: "2026-02-16T04:58:00.000Z",
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

    // 2 セッショングループが表示される
    const headers = container.querySelectorAll(".session-group-header");
    expect(headers.length).toBe(2);

    // カードはデフォルト折りたたみ（未展開）なので初期状態では非表示
    expect(container.querySelectorAll(".feed-card").length).toBe(0);
  });

  test("W3-003: session accordion expands on click and is keyboard accessible", () => {
    const items: FeedItem[] = [
      {
        id: "k1",
        platform: "claude",
        project: "proj-k",
        session_id: "session-kappa",
        event_type: "user_prompt",
        title: "Kappa Prompt",
        content: "kappa content",
        created_at: "2026-02-16T05:10:00.000Z",
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

    const header = container.querySelector(".session-group-header");
    expect(header).toBeTruthy();
    expect(header?.getAttribute("aria-expanded")).toBe("false");

    // クリックで展開
    fireEvent.click(header!);
    expect(header?.getAttribute("aria-expanded")).toBe("true");
    expect(header?.classList.contains("expanded")).toBe(true);
    expect(container.querySelectorAll(".feed-card").length).toBe(1);

    // 再クリックで折りたたみ
    fireEvent.click(header!);
    expect(header?.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelectorAll(".feed-card").length).toBe(0);
  });

  test("W3-003: session group label shows platform and item count", () => {
    const items: FeedItem[] = [
      {
        id: "lb1",
        platform: "codex",
        project: "proj-label",
        session_id: "session-label",
        event_type: "user_prompt",
        title: "Label test",
        content: "content",
        created_at: "2026-02-16T05:20:00.000Z",
        tags: [],
        privacy_tags: [],
      },
      {
        id: "lb2",
        platform: "codex",
        project: "proj-label",
        session_id: "session-label",
        event_type: "user_prompt",
        title: "Label test 2",
        content: "content 2",
        created_at: "2026-02-16T05:19:00.000Z",
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

    const label = container.querySelector(".session-group-label");
    expect(label).toBeTruthy();
    // "2 items" が表示される
    expect(label?.textContent).toContain("2 items");
    // プラットフォーム名が含まれる
    expect(label?.textContent?.toLowerCase()).toContain("codex");
  });
});
