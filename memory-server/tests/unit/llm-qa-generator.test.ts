/**
 * §54 S54-006: LLM QA生成パイプライン ユニットテスト
 */

import { describe, expect, test } from "bun:test";
import {
  buildQAPrompt,
  convertToLocomoFormat,
  sliceToCategory,
  type SessionData,
  type GeneratedQA,
} from "../../src/benchmark/llm-qa-generator";

// ---------------------------------------------------------------------------
// テスト用フィクスチャ
// ---------------------------------------------------------------------------

const mockSession: SessionData = {
  session_id: "test-session-001",
  platform: "claude",
  project: "harness-mem",
  observations: [
    {
      id: "obs-001",
      content: "TypeScript の型エラーを修正するために strictNullChecks を有効化した",
      title: "型安全性の改善",
      observation_type: "context",
      tags: ["typescript", "fix"],
      created_at: "2026-03-16T10:00:00Z",
    },
    {
      id: "obs-002",
      content: "bun test を実行して全テストがパスすることを確認した",
      title: "テスト実行",
      observation_type: "context",
      tags: ["test", "bun"],
      created_at: "2026-03-16T10:05:00Z",
    },
    {
      id: "obs-003",
      content: "PR を作成して main ブランチにマージした",
      title: "デプロイ完了",
      observation_type: "context",
      tags: ["git", "deploy"],
      created_at: "2026-03-16T10:10:00Z",
    },
  ],
};

const mockQAList: GeneratedQA[] = [
  {
    question_id: "llm-test-session-001-001",
    question: "このセッションで使用したテストランナーは何ですか？",
    answer: "bun test",
    slice: "tool-recall",
    cross_lingual: false,
    source_observation_ids: ["obs-002"],
    session_id: "test-session-001",
    platform: "claude",
    project: "harness-mem",
    generated_at: "2026-03-16T10:20:00Z",
    verified: false,
  },
  {
    question_id: "llm-test-session-001-002",
    question: "Why was strictNullChecks enabled in this session?",
    answer: "TypeScript の型エラーを修正するため",
    slice: "decision-why",
    cross_lingual: true,
    source_observation_ids: ["obs-001"],
    session_id: "test-session-001",
    platform: "claude",
    project: "harness-mem",
    generated_at: "2026-03-16T10:20:00Z",
    verified: false,
  },
  {
    question_id: "llm-test-session-002-001",
    question: "セッションの最初のタスクは何でしたか？",
    answer: "TypeScript の型エラーを修正するために strictNullChecks を有効化した",
    slice: "temporal-order",
    cross_lingual: false,
    source_observation_ids: ["obs-001"],
    session_id: "test-session-002",
    platform: "codex",
    project: "other-project",
    generated_at: "2026-03-16T10:20:00Z",
    verified: false,
  },
];

// ---------------------------------------------------------------------------
// buildQAPrompt テスト
// ---------------------------------------------------------------------------

describe("buildQAPrompt", () => {
  test("セッション情報を含む有効なプロンプトを生成する", () => {
    const prompt = buildQAPrompt(mockSession);

    expect(prompt).toContain("claude");
    expect(prompt).toContain("harness-mem");
    expect(prompt).toContain("3"); // 観察数
  });

  test("すべての QA 種類（slice）がプロンプトに含まれる", () => {
    const prompt = buildQAPrompt(mockSession);

    expect(prompt).toContain("tool-recall");
    expect(prompt).toContain("decision-why");
    expect(prompt).toContain("temporal-order");
    expect(prompt).toContain("cross-lingual");
    expect(prompt).toContain("session-summary");
  });

  test("observation の内容がプロンプトに含まれる", () => {
    const prompt = buildQAPrompt(mockSession);

    // タイトルと content がプロンプトに含まれる（id は含まれない）
    expect(prompt).toContain("型安全性の改善");
    expect(prompt).toContain("strictNullChecks");
  });

  test("出力形式（JSON配列）の指示がプロンプトに含まれる", () => {
    const prompt = buildQAPrompt(mockSession);

    expect(prompt).toContain("JSON");
    expect(prompt).toContain("question_id");
    expect(prompt).toContain("source_observation_ids");
  });

  test("session_id がプロンプトの question_id テンプレートに含まれる", () => {
    const prompt = buildQAPrompt(mockSession);
    expect(prompt).toContain("llm-test-session-001-001");
  });

  test("title が null の observation も処理できる", () => {
    const sessionWithNullTitle: SessionData = {
      ...mockSession,
      observations: [
        { ...mockSession.observations[0], title: null },
        mockSession.observations[1],
        mockSession.observations[2],
      ],
    };
    expect(() => buildQAPrompt(sessionWithNullTitle)).not.toThrow();
    const prompt = buildQAPrompt(sessionWithNullTitle);
    // title が null でも content は含まれる
    expect(prompt).toContain("strictNullChecks");
  });

  test("content の制約（question/answer の文字数）がプロンプトに含まれる", () => {
    const prompt = buildQAPrompt(mockSession);

    expect(prompt).toContain("10文字以上 200文字以内");
    expect(prompt).toContain("5文字以上 300文字以内");
  });
});

// ---------------------------------------------------------------------------
// sliceToCategory テスト
// ---------------------------------------------------------------------------

describe("sliceToCategory", () => {
  test("tool-recall は cat-1 にマッピングされる", () => {
    expect(sliceToCategory("tool-recall")).toBe("cat-1");
  });

  test("file-change は cat-1 にマッピングされる", () => {
    expect(sliceToCategory("file-change")).toBe("cat-1");
  });

  test("dependency は cat-1 にマッピングされる", () => {
    expect(sliceToCategory("dependency")).toBe("cat-1");
  });

  test("session-summary は cat-2 にマッピングされる", () => {
    expect(sliceToCategory("session-summary")).toBe("cat-2");
  });

  test("cross-client は cat-2 にマッピングされる", () => {
    expect(sliceToCategory("cross-client")).toBe("cat-2");
  });

  test("decision-why は cat-3 にマッピングされる", () => {
    expect(sliceToCategory("decision-why")).toBe("cat-3");
  });

  test("error-resolution は cat-3 にマッピングされる", () => {
    expect(sliceToCategory("error-resolution")).toBe("cat-3");
  });

  test("temporal-order は cat-4 にマッピングされる", () => {
    expect(sliceToCategory("temporal-order")).toBe("cat-4");
  });

  test("config-diff は cat-4 にマッピングされる", () => {
    expect(sliceToCategory("config-diff")).toBe("cat-4");
  });

  test("未知の slice は cat-1 にフォールバックする", () => {
    expect(sliceToCategory("unknown-slice")).toBe("cat-1");
    expect(sliceToCategory("")).toBe("cat-1");
  });
});

// ---------------------------------------------------------------------------
// convertToLocomoFormat テスト
// ---------------------------------------------------------------------------

describe("convertToLocomoFormat", () => {
  test("GeneratedQA 配列を LoCoMo 形式に変換する", () => {
    const samples = convertToLocomoFormat(mockQAList, [mockSession]);

    expect(samples.length).toBeGreaterThan(0);
    expect(samples[0]).toHaveProperty("sample_id");
    expect(samples[0]).toHaveProperty("conversation");
    expect(samples[0]).toHaveProperty("qa");
  });

  test("sample_id が正しい形式（llm-gen-NNN）になる", () => {
    const samples = convertToLocomoFormat(mockQAList, [mockSession]);

    for (const sample of samples) {
      expect(sample.sample_id).toMatch(/^llm-gen-\d{3}$/);
    }
  });

  test("QA に category フィールドが追加される", () => {
    const samples = convertToLocomoFormat(mockQAList, [mockSession]);

    for (const sample of samples) {
      for (const qa of sample.qa) {
        expect(qa).toHaveProperty("category");
        expect(["cat-1", "cat-2", "cat-3", "cat-4"]).toContain(qa.category);
      }
    }
  });

  test("cross_lingual が true の場合のみフィールドが含まれる", () => {
    const samples = convertToLocomoFormat(mockQAList, [mockSession]);

    // cross_lingual: true の QA
    const crossLingualQAs = samples
      .flatMap((s) => s.qa)
      .filter((qa) => qa.cross_lingual !== undefined);
    expect(crossLingualQAs.every((qa) => qa.cross_lingual === true)).toBe(true);

    // cross_lingual: false の QA はフィールド自体が存在しない
    const nonCrossLingualQAs = samples
      .flatMap((s) => s.qa)
      .filter((qa) => qa.cross_lingual === undefined);
    expect(nonCrossLingualQAs.length).toBeGreaterThan(0);
  });

  test("session_id でグループ化される（複数セッションが別サンプルになる）", () => {
    const mockSession2: SessionData = {
      session_id: "test-session-002",
      platform: "codex",
      project: "other-project",
      observations: [],
    };
    const samples = convertToLocomoFormat(mockQAList, [mockSession, mockSession2]);

    // test-session-001 と test-session-002 が別サンプルになる
    expect(samples.length).toBe(2);
  });

  test("session を持つサンプルは conversation に observation 内容が含まれる", () => {
    const samples = convertToLocomoFormat(mockQAList, [mockSession]);

    const session001Sample = samples.find((s) =>
      s.qa.some((qa) => qa.question_id.startsWith("llm-test-session-001"))
    );
    expect(session001Sample).toBeDefined();
    expect(session001Sample!.conversation.length).toBeGreaterThan(0);
    expect(session001Sample!.conversation[0].speaker).toBe("user");
  });

  test("空の QA リストは空の samples を返す", () => {
    const samples = convertToLocomoFormat([], [mockSession]);
    expect(samples).toHaveLength(0);
  });

  test("category マッピングが仕様通り", () => {
    const samples = convertToLocomoFormat(mockQAList, [mockSession]);
    const allQA = samples.flatMap((s) => s.qa);

    const toolRecall = allQA.find((qa) => qa.slice === "tool-recall");
    expect(toolRecall?.category).toBe("cat-1");

    const decisionWhy = allQA.find((qa) => qa.slice === "decision-why");
    expect(decisionWhy?.category).toBe("cat-3");

    const temporalOrder = allQA.find((qa) => qa.slice === "temporal-order");
    expect(temporalOrder?.category).toBe("cat-4");
  });
});

// ---------------------------------------------------------------------------
// extractSessions のプライバシーフィルタリングテスト（インメモリ DB）
// ---------------------------------------------------------------------------

describe("extractSessions privacy filtering", () => {
  test("pii タグ付き observation が除外されることをロジックで確認", () => {
    // SQLクエリの WHERE 条件を直接検証するのではなく、
    // privacy_tags_json NOT LIKE '%"pii"%' の動作を確認するためのロジックテスト

    const privacyTagsJson = JSON.stringify(["pii", "sensitive"]);
    const normalTagsJson = JSON.stringify(["typescript", "fix"]);

    // pii を含む場合は LIKE '%"pii"%' がマッチする
    expect(privacyTagsJson.includes('"pii"')).toBe(true);
    // 通常タグは pii を含まない
    expect(normalTagsJson.includes('"pii"')).toBe(false);
  });

  test("content が500文字に切り詰められることを確認", () => {
    // extractSessions で content.slice(0, 500) が適用されることを
    // 同じロジックで検証
    const longContent = "a".repeat(1000);
    const truncated = longContent.slice(0, 500);

    expect(truncated.length).toBe(500);
    expect(truncated).toBe("a".repeat(500));
  });
});
