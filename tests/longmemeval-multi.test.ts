/**
 * NEXT-012: LongMemEval マルチセッション評価テスト
 *
 * 単一セッション→マルチセッション評価、セッション間記憶持続性測定。
 *
 * テスト内容:
 * 1. MultiSessionMemoryScore がマルチセッション評価スコアを計算する
 * 2. scoreMemoryPersistence がセッション間記憶持続性を0-1でスコアリングする
 * 3. createLongMemEvalMultiRunner がサンプルデータでテスト実行できる
 */
import { describe, expect, test } from "bun:test";
import {
  scoreMemoryPersistence,
  createLongMemEvalMultiRunner,
  type MultiSessionMemorySample,
  type MultiSessionMemoryScore,
} from "../benchmarks/longmemeval-multisession";

describe("NEXT-012: LongMemEval マルチセッション評価", () => {
  // テスト1: scoreMemoryPersistence が正しくスコアを返す
  test("scoreMemoryPersistence がセッション間記憶持続性スコアを返す", () => {
    const sample: MultiSessionMemorySample = {
      sample_id: "test-001",
      sessions: [
        {
          session_id: "sess-1",
          turns: [
            { role: "user", content: "私の名前は田中です" },
            { role: "assistant", content: "田中さん、よろしくお願いします" },
          ],
        },
        {
          session_id: "sess-2",
          turns: [
            { role: "user", content: "私の名前を覚えていますか？" },
            { role: "assistant", content: "田中さんですね" },
          ],
        },
      ],
      cross_session_qa: [
        {
          question: "ユーザーの名前は何ですか？",
          expected_answer: "田中",
          session_reference: "sess-1",
        },
      ],
    };

    const score = scoreMemoryPersistence(sample, (question: string) => {
      // 模擬的に "田中" を含む答えを返す
      return "田中という名前です";
    });

    expect(score).toBeDefined();
    expect(typeof score.persistence_score).toBe("number");
    expect(score.persistence_score).toBeGreaterThanOrEqual(0);
    expect(score.persistence_score).toBeLessThanOrEqual(1);
    expect(score.total_questions).toBe(1);
    expect(score.correct_answers).toBeGreaterThanOrEqual(0);
  });

  // テスト2: 答えが合わない場合はスコアが低い
  test("答えが合わない場合は persistence_score が 0 になる", () => {
    const sample: MultiSessionMemorySample = {
      sample_id: "test-002",
      sessions: [
        {
          session_id: "sess-1",
          turns: [
            { role: "user", content: "私の趣味はサイクリングです" },
            { role: "assistant", content: "サイクリングが好きなんですね" },
          ],
        },
      ],
      cross_session_qa: [
        {
          question: "ユーザーの趣味は何ですか？",
          expected_answer: "サイクリング",
          session_reference: "sess-1",
        },
      ],
    };

    const score = scoreMemoryPersistence(sample, (_question: string) => {
      // 全く関係ない答えを返す
      return "不明です";
    });

    expect(score.persistence_score).toBeLessThan(0.5);
    expect(score.total_questions).toBe(1);
  });

  // テスト3: createLongMemEvalMultiRunner がサンプルデータでランナーを作成できる
  test("createLongMemEvalMultiRunner がサンプルデータで評価ランナーを返す", () => {
    const samples: MultiSessionMemorySample[] = [
      {
        sample_id: "sample-001",
        sessions: [
          {
            session_id: "s1",
            turns: [
              { role: "user", content: "好きな食べ物はラーメンです" },
              { role: "assistant", content: "ラーメンが好きなんですね" },
            ],
          },
        ],
        cross_session_qa: [
          {
            question: "好きな食べ物は？",
            expected_answer: "ラーメン",
            session_reference: "s1",
          },
        ],
      },
    ];

    const runner = createLongMemEvalMultiRunner(samples);
    expect(runner).toBeDefined();
    expect(typeof runner.evaluate).toBe("function");

    // evaluate を実行してスコアを取得
    const result = runner.evaluate((q: string) => {
      return q.includes("食べ物") ? "ラーメンです" : "不明です";
    });

    expect(result).toBeDefined();
    expect(typeof result.overall_score).toBe("number");
    expect(result.overall_score).toBeGreaterThanOrEqual(0);
    expect(result.overall_score).toBeLessThanOrEqual(1);
    expect(result.sample_scores).toHaveLength(1);
    expect(result.total_sessions).toBe(1);
  });
});
