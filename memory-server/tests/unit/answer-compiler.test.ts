import { describe, expect, test } from "bun:test";
import { compileAnswer, type CompilerInput } from "../../src/answer/compiler";

describe("compileAnswer", () => {
  test("compiles empty observations", () => {
    const input: CompilerInput = {
      question_kind: "hybrid",
      observations: [],
      privacy_excluded_count: 0,
    };
    const result = compileAnswer(input);
    expect(result.evidence_count).toBe(0);
    expect(result.evidence).toHaveLength(0);
    expect(result.question_kind).toBe("hybrid");
    expect(result.meta.time_span).toBeNull();
    expect(result.meta.cross_session).toBe(false);
  });

  test("compiles observations into evidence", () => {
    const input: CompilerInput = {
      question_kind: "profile",
      observations: [
        {
          id: "obs-1",
          platform: "claude",
          project: "/test/project",
          title: "Test Title",
          content_redacted: "Test content",
          created_at: "2026-02-20T10:00:00Z",
          tags_json: '["tag1","tag2"]',
          session_id: "sess-1",
          final_score: 0.95,
        },
        {
          id: "obs-2",
          platform: "codex",
          project: "/test/project",
          title: null,
          content_redacted: "Another content",
          created_at: "2026-02-19T10:00:00Z",
          tags_json: "[]",
          session_id: "sess-2",
          final_score: 0.8,
        },
      ],
      privacy_excluded_count: 1,
    };

    const result = compileAnswer(input);
    expect(result.evidence_count).toBe(2);
    expect(result.evidence).toHaveLength(2);
    expect(result.evidence[0]?.observation_id).toBe("obs-1");
    expect(result.evidence[0]?.relevance_score).toBe(0.95);
    expect(result.evidence[0]?.tags).toEqual(["tag1", "tag2"]);
    expect(result.evidence[1]?.title).toBe("");

    expect(result.meta.platforms).toContain("claude");
    expect(result.meta.platforms).toContain("codex");
    expect(result.meta.projects).toEqual(["/test/project"]);
    expect(result.meta.cross_session).toBe(true);
    expect(result.meta.privacy_excluded).toBe(1);
    expect(result.meta.time_span).not.toBeNull();
    expect(result.meta.time_span?.oldest).toBe("2026-02-19T10:00:00Z");
    expect(result.meta.time_span?.newest).toBe("2026-02-20T10:00:00Z");
  });

  test("handles invalid tags_json gracefully", () => {
    const input: CompilerInput = {
      question_kind: "hybrid",
      observations: [
        {
          id: "obs-1",
          platform: "claude",
          project: "/p",
          title: "T",
          content_redacted: "C",
          created_at: "2026-02-20T10:00:00Z",
          tags_json: "invalid json",
          session_id: "s1",
          final_score: 0.5,
        },
      ],
      privacy_excluded_count: 0,
    };

    const result = compileAnswer(input);
    expect(result.evidence[0]?.tags).toEqual([]);
  });

  test("single session is not cross_session", () => {
    const input: CompilerInput = {
      question_kind: "timeline",
      observations: [
        {
          id: "obs-1", platform: "claude", project: "/p", title: "T",
          content_redacted: "C", created_at: "2026-02-20T10:00:00Z",
          tags_json: "[]", session_id: "same-session", final_score: 0.5,
        },
        {
          id: "obs-2", platform: "claude", project: "/p", title: "T2",
          content_redacted: "C2", created_at: "2026-02-20T11:00:00Z",
          tags_json: "[]", session_id: "same-session", final_score: 0.4,
        },
      ],
      privacy_excluded_count: 0,
    };

    const result = compileAnswer(input);
    expect(result.meta.cross_session).toBe(false);
  });
});
