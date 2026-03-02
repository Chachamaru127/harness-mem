/**
 * NEXT-012: LongMemEval マルチセッション評価モジュール
 *
 * 単一セッション→マルチセッション評価に拡張し、
 * セッション間の記憶持続性（Memory Persistence）を定量化する。
 *
 * LongMemEval 参考:
 * - Wu et al. (2024) "LongMemEval: Benchmarking Chat Assistants on Long-Term Interactive Memory"
 * - セッション間でユーザー情報を保持できるかを QA 形式で評価する
 */

// ---- データ型定義 ----

export interface ConversationTurn {
  role: "user" | "assistant" | string;
  content: string;
}

export interface SessionData {
  session_id: string;
  turns: ConversationTurn[];
}

export interface CrossSessionQA {
  question: string;
  expected_answer: string;
  /** どのセッションで情報が登場したか */
  session_reference: string;
}

export interface MultiSessionMemorySample {
  sample_id: string;
  sessions: SessionData[];
  cross_session_qa: CrossSessionQA[];
}

export interface MultiSessionMemoryScore {
  sample_id: string;
  persistence_score: number;
  total_questions: number;
  correct_answers: number;
  details: Array<{
    question: string;
    expected: string;
    actual: string;
    correct: boolean;
  }>;
}

export interface LongMemEvalMultiResult {
  overall_score: number;
  sample_scores: MultiSessionMemoryScore[];
  total_sessions: number;
  total_questions: number;
  total_correct: number;
}

// ---- 答え合わせロジック ----

/**
 * 正規化して部分一致で答えの正誤を判定する。
 * 大文字小文字・スペース・句読点を除去して比較する。
 */
function normalizeAnswer(text: string): string {
  return text
    .toLowerCase()
    .replace(/[、。！？,.!?「」『』【】\s]/g, "")
    .trim();
}

/**
 * 期待する答えが実際の回答に含まれるか判定する（部分一致）。
 */
function isCorrect(expected: string, actual: string): boolean {
  const normExpected = normalizeAnswer(expected);
  const normActual = normalizeAnswer(actual);
  if (!normExpected || !normActual) return false;
  return normActual.includes(normExpected) || normExpected.includes(normActual);
}

// ---- 評価関数 ----

/**
 * マルチセッションサンプルのセッション間記憶持続性スコアを計算する。
 *
 * @param sample     評価サンプル（複数セッション + クロスセッション QA）
 * @param answerFn   質問を受け取り答えを返す関数（メモリシステムのクエリ）
 * @returns          持続性スコア（0-1）+ 詳細
 */
export function scoreMemoryPersistence(
  sample: MultiSessionMemorySample,
  answerFn: (question: string, sampleId: string) => string
): MultiSessionMemoryScore {
  const details: MultiSessionMemoryScore["details"] = [];
  let correct = 0;

  for (const qa of sample.cross_session_qa) {
    const actual = answerFn(qa.question, sample.sample_id);
    const matched = isCorrect(qa.expected_answer, actual);
    if (matched) correct++;
    details.push({
      question: qa.question,
      expected: qa.expected_answer,
      actual,
      correct: matched,
    });
  }

  const total = sample.cross_session_qa.length;
  const persistence_score = total === 0 ? 0 : correct / total;

  return {
    sample_id: sample.sample_id,
    persistence_score,
    total_questions: total,
    correct_answers: correct,
    details,
  };
}

// ---- ランナー ----

export interface LongMemEvalMultiRunner {
  evaluate(
    answerFn: (question: string, sampleId?: string) => string
  ): LongMemEvalMultiResult;
}

/**
 * LongMemEval マルチセッション評価ランナーを作成する。
 *
 * @param samples  評価サンプルの配列
 * @returns        evaluate メソッドを持つランナー
 */
export function createLongMemEvalMultiRunner(
  samples: MultiSessionMemorySample[]
): LongMemEvalMultiRunner {
  return {
    evaluate(answerFn: (question: string, sampleId?: string) => string): LongMemEvalMultiResult {
      const sample_scores: MultiSessionMemoryScore[] = [];
      let totalQuestions = 0;
      let totalCorrect = 0;
      let totalSessions = 0;

      for (const sample of samples) {
        const score = scoreMemoryPersistence(sample, (q, sid) => answerFn(q, sid));
        sample_scores.push(score);
        totalQuestions += score.total_questions;
        totalCorrect += score.correct_answers;
        totalSessions += sample.sessions.length;
      }

      const overall_score = totalQuestions === 0 ? 0 : totalCorrect / totalQuestions;

      return {
        overall_score,
        sample_scores,
        total_sessions: totalSessions,
        total_questions: totalQuestions,
        total_correct: totalCorrect,
      };
    },
  };
}
