/**
 * §54 S54-006: LLM QA生成パイプライン
 *
 * 実DBのセッションデータを抽出し、Claude API を使って QA ペアを半自動生成する。
 * 目標: 100セッションから500問の候補 QA を生成。
 *
 * 使用方法:
 *   bun run llm-qa-generator.ts <db-path> --dry-run [--output prompts.json]
 *   bun run llm-qa-generator.ts <db-path> --generate [--output generated-qa.json] [--sessions 100]
 *   bun run llm-qa-generator.ts --convert <generated-qa.json> [--output locomo-pack.json]
 */

import { Database } from "bun:sqlite";
import { writeFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// ---------------------------------------------------------------------------
// 型定義
// ---------------------------------------------------------------------------

export interface SessionObservation {
  id: string;
  content: string;
  title: string | null;
  observation_type: string;
  tags: string[];
  created_at: string;
}

export interface SessionData {
  session_id: string;
  platform: string;
  project: string;
  observations: SessionObservation[];
}

export interface GeneratedQA {
  question_id: string;
  question: string;
  answer: string;
  slice: string;
  cross_lingual: boolean;
  source_observation_ids: string[];
  session_id: string;
  platform: string;
  project: string;
  generated_at: string;
  verified: boolean;
}

export interface LocomoQA {
  question_id: string;
  question: string;
  answer: string;
  category: string;
  slice: string;
  cross_lingual?: boolean;
}

export interface LocomoSample {
  sample_id: string;
  conversation: Array<{ speaker: string; text: string }>;
  qa: LocomoQA[];
}

export interface DryRunPrompt {
  session_id: string;
  platform: string;
  project: string;
  observation_count: number;
  prompt: string;
  generated_at: string;
}

// ---------------------------------------------------------------------------
// DB 行型（内部用）
// ---------------------------------------------------------------------------

interface SessionRow {
  session_id: string;
  platform: string;
  project: string;
  entry_count: number;
}

interface ObservationRow {
  id: string;
  content: string;
  title: string | null;
  observation_type: string;
  tags_json: string;
  created_at: string;
}

// ---------------------------------------------------------------------------
// セッション抽出
// ---------------------------------------------------------------------------

/**
 * DB から3件以上の observation を持つセッションを抽出する。
 * プライバシータグ（pii）を含む observation は除外し、content を500文字に切り詰める。
 *
 * @param dbPath SQLite データベースのパス
 * @param maxSessions 取得するセッション数の上限（デフォルト 100）
 */
export function extractSessions(
  dbPath: string,
  maxSessions = 100
): SessionData[] {
  const db = new Database(dbPath, { readonly: true });
  try {
    // 3件以上の非pii observation を持つセッションを取得
    const sessions = db
      .query<SessionRow, []>(`
        SELECT
          session_id,
          platform,
          project,
          COUNT(*) as entry_count
        FROM mem_observations
        WHERE session_id IS NOT NULL AND session_id != ''
          AND content IS NOT NULL AND content != ''
          AND privacy_tags_json NOT LIKE '%"pii"%'
        GROUP BY session_id, platform, project
        HAVING entry_count >= 3
        ORDER BY entry_count DESC
        LIMIT ${maxSessions}
      `)
      .all();

    if (sessions.length === 0) {
      return [];
    }

    const result: SessionData[] = [];

    for (const session of sessions) {
      const rows = db
        .query<ObservationRow, [string]>(`
          SELECT id, content, title, observation_type, tags_json, created_at
          FROM mem_observations
          WHERE session_id = ?
            AND content IS NOT NULL AND content != ''
            AND privacy_tags_json NOT LIKE '%"pii"%'
          ORDER BY created_at ASC
          LIMIT 20
        `)
        .all(session.session_id);

      if (rows.length < 3) continue;

      const observations: SessionObservation[] = rows.map((row) => {
        let tags: string[] = [];
        try {
          tags = JSON.parse(row.tags_json) as string[];
        } catch {
          // tags_json が不正な場合は空配列
        }
        return {
          id: row.id,
          content: row.content.slice(0, 500), // プライバシー保護: 500文字に切り詰め
          title: row.title,
          observation_type: row.observation_type,
          tags,
          created_at: row.created_at,
        };
      });

      result.push({
        session_id: session.session_id,
        platform: session.platform,
        project: session.project,
        observations,
      });
    }

    return result;
  } finally {
    db.close();
  }
}

// ---------------------------------------------------------------------------
// QA 生成プロンプト構築
// ---------------------------------------------------------------------------

/**
 * セッションデータから Claude API に送るプロンプトを構築する。
 */
export function buildQAPrompt(session: SessionData): string {
  const obsText = session.observations
    .map(
      (o, i) =>
        `[${i + 1}] (${o.created_at}) ${o.title ?? ""}: ${o.content}`
    )
    .join("\n");

  return `
あなたは AI コーディングセッションの品質評価用 QA ペアの生成器です。

以下のコーディングセッションのログから、5つの QA ペアを生成してください。
各 QA は、このセッションの内容を「正しく思い出せるか」をテストするものです。

## セッション情報
- プラットフォーム: ${session.platform}
- プロジェクト: ${session.project}
- 観察数: ${session.observations.length}

## セッション内容
${obsText}

## 生成する QA の種類（各1問ずつ）
1. tool-recall: 使用したツールやコマンドに関する質問
2. decision-why: 設計判断や選択の理由に関する質問
3. temporal-order: 作業の時系列に関する質問
4. cross-lingual: 日本語で質問（内容が英語の場合）または英語で質問（内容が日本語の場合）
5. session-summary: セッション全体の成果に関する質問

## 出力形式（JSON配列）
[
  {
    "question_id": "llm-${session.session_id}-001",
    "question": "質問文",
    "answer": "正解（セッション内容から直接導出可能な事実のみ）",
    "slice": "tool-recall",
    "cross_lingual": true,
    "source_observation_ids": ["関連するobservationのID"]
  }
]

## 制約
- answer は セッション内容から客観的に導出できる事実のみ
- 推測や一般知識に基づく回答は不可
- 日本語と英語を混ぜて出力（cross_lingual は言語が異なる場合 true）
- question は 10文字以上 200文字以内
- answer は 5文字以上 300文字以内
`.trim();
}

// ---------------------------------------------------------------------------
// LLM API 呼び出し
// ---------------------------------------------------------------------------

interface AnthropicContent {
  type: string;
  text?: string;
}

interface AnthropicResponse {
  content: AnthropicContent[];
}

/**
 * Claude API を呼び出して QA ペアを生成する。
 * ANTHROPIC_API_KEY 環境変数が必要。
 */
async function callClaudeAPI(prompt: string): Promise<GeneratedQA[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is required for --generate mode");
  }

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2000,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Anthropic API error ${response.status}: ${errText}`);
  }

  const data = (await response.json()) as AnthropicResponse;
  const textContent = data.content.find((c) => c.type === "text");
  if (!textContent?.text) {
    throw new Error("No text content in API response");
  }

  // JSON 配列部分を抽出してパース
  const text = textContent.text;
  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) {
    throw new Error(`Could not extract JSON array from response: ${text.slice(0, 200)}`);
  }

  return JSON.parse(jsonMatch[0]) as GeneratedQA[];
}

// ---------------------------------------------------------------------------
// QA 生成メイン処理
// ---------------------------------------------------------------------------

/**
 * セッションリストから QA ペアを生成する。
 * dryRun = true の場合はプロンプトのみ返す（API 呼び出しなし）。
 */
export async function generateQAPairs(
  sessions: SessionData[],
  dryRun: boolean
): Promise<GeneratedQA[] | DryRunPrompt[]> {
  if (dryRun) {
    const prompts: DryRunPrompt[] = sessions.map((session) => ({
      session_id: session.session_id,
      platform: session.platform,
      project: session.project,
      observation_count: session.observations.length,
      prompt: buildQAPrompt(session),
      generated_at: new Date().toISOString(),
    }));
    return prompts;
  }

  const allQA: GeneratedQA[] = [];
  const generatedAt = new Date().toISOString();

  for (let i = 0; i < sessions.length; i++) {
    const session = sessions[i];
    console.error(
      `[llm-qa] Generating QA for session ${i + 1}/${sessions.length}: ${session.session_id}`
    );

    try {
      const prompt = buildQAPrompt(session);
      const qaList = await callClaudeAPI(prompt);

      for (const qa of qaList) {
        allQA.push({
          ...qa,
          session_id: session.session_id,
          platform: session.platform,
          project: session.project,
          generated_at: generatedAt,
          verified: false,
        });
      }
    } catch (err) {
      console.error(
        `[llm-qa] Error generating QA for session ${session.session_id}: ${err}`
      );
    }

    // rate limiting: 1リクエスト/秒
    if (i < sessions.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  return allQA;
}

// ---------------------------------------------------------------------------
// LoCoMo 形式への変換
// ---------------------------------------------------------------------------

/** slice → LoCoMo category マッピング */
const SLICE_TO_CATEGORY: Record<string, string> = {
  // cat-1: 事実想起
  "tool-recall": "cat-1",
  "file-change": "cat-1",
  "dependency": "cat-1",
  // cat-2: 要約
  "session-summary": "cat-2",
  "cross-client": "cat-2",
  // cat-3: 理由
  "decision-why": "cat-3",
  "error-resolution": "cat-3",
  // cat-4: 時系列/比較
  "temporal-order": "cat-4",
  "config-diff": "cat-4",
};

/**
 * slice 文字列から LoCoMo category を返す。
 * 未知の slice は "cat-1" にフォールバック。
 */
export function sliceToCategory(slice: string): string {
  return SLICE_TO_CATEGORY[slice] ?? "cat-1";
}

/**
 * GeneratedQA 配列を LoCoMo 形式に変換する。
 * セッション単位でグループ化し、observation の内容を conversation に変換する。
 */
export function convertToLocomoFormat(
  qaList: GeneratedQA[],
  sessions: SessionData[]
): LocomoSample[] {
  // session_id でインデックス
  const sessionMap = new Map<string, SessionData>();
  for (const s of sessions) {
    sessionMap.set(s.session_id, s);
  }

  // QA を session_id でグループ化
  const groupedQA = new Map<string, GeneratedQA[]>();
  for (const qa of qaList) {
    const list = groupedQA.get(qa.session_id) ?? [];
    list.push(qa);
    groupedQA.set(qa.session_id, list);
  }

  const samples: LocomoSample[] = [];
  let sampleIdx = 1;

  for (const [sessionId, qas] of groupedQA.entries()) {
    const session = sessionMap.get(sessionId);

    // conversation: セッション observation を user/assistant 交互形式に変換
    const conversation: Array<{ speaker: string; text: string }> = [];
    if (session) {
      for (const obs of session.observations) {
        const text = obs.title
          ? `${obs.title}: ${obs.content}`
          : obs.content;
        conversation.push({ speaker: "user", text });
        conversation.push({
          speaker: "assistant",
          text: `[${obs.observation_type}] recorded`,
        });
      }
    }

    // QA を LoCoMo 形式に変換
    const locomoQA: LocomoQA[] = qas.map((qa) => {
      const item: LocomoQA = {
        question_id: qa.question_id,
        question: qa.question,
        answer: qa.answer,
        category: sliceToCategory(qa.slice),
        slice: qa.slice,
      };
      if (qa.cross_lingual) {
        item.cross_lingual = true;
      }
      return item;
    });

    samples.push({
      sample_id: `llm-gen-${String(sampleIdx).padStart(3, "0")}`,
      conversation,
      qa: locomoQA,
    });
    sampleIdx++;
  }

  return samples;
}

// ---------------------------------------------------------------------------
// 統計サマリー
// ---------------------------------------------------------------------------

/**
 * 生成された QA の基本統計を stderr に出力する。
 */
export function summarizeQA(qaList: GeneratedQA[]): void {
  const bySlice: Record<string, number> = {};
  const byPlatform: Record<string, number> = {};
  let crossLingualCount = 0;

  for (const qa of qaList) {
    bySlice[qa.slice] = (bySlice[qa.slice] ?? 0) + 1;
    byPlatform[qa.platform] = (byPlatform[qa.platform] ?? 0) + 1;
    if (qa.cross_lingual) crossLingualCount++;
  }

  const uniqueSessions = new Set(qaList.map((qa) => qa.session_id)).size;

  console.error(`[llm-qa] Generated ${qaList.length} QA pairs from ${uniqueSessions} sessions`);
  console.error(`[llm-qa] Cross-lingual: ${crossLingualCount}`);
  console.error(`[llm-qa] By slice:`);
  for (const [slice, count] of Object.entries(bySlice)) {
    console.error(`  ${slice}: ${count}`);
  }
  console.error(`[llm-qa] By platform:`);
  for (const [platform, count] of Object.entries(byPlatform)) {
    console.error(`  ${platform}: ${count}`);
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

if (import.meta.main) {
  const args = process.argv.slice(2);

  // --convert モード: 既存の generated-qa.json を LoCoMo 形式に変換
  const convertIdx = args.indexOf("--convert");
  if (convertIdx !== -1) {
    const inputPath = args[convertIdx + 1];
    if (!inputPath) {
      console.error("Usage: bun llm-qa-generator.ts --convert <generated-qa.json> [--output locomo-pack.json]");
      process.exit(1);
    }
    const outputIdx = args.indexOf("--output");
    const outputPath = outputIdx !== -1 ? args[outputIdx + 1] : undefined;

    const raw = readFileSync(resolve(inputPath), "utf-8");
    const qaList = JSON.parse(raw) as GeneratedQA[];

    // セッション情報は QA から再構築（observation 内容なし）
    const sessionIds = [...new Set(qaList.map((qa) => qa.session_id))];
    const sessions: SessionData[] = sessionIds.map((id) => {
      const first = qaList.find((qa) => qa.session_id === id)!;
      return {
        session_id: id,
        platform: first.platform,
        project: first.project,
        observations: [],
      };
    });

    const locomo = convertToLocomoFormat(qaList, sessions);
    const output = JSON.stringify(locomo, null, 2);

    if (outputPath) {
      writeFileSync(resolve(outputPath), output);
      console.error(`[llm-qa] LoCoMo pack written to ${resolve(outputPath)}`);
    } else {
      process.stdout.write(output + "\n");
    }
    process.exit(0);
  }

  // 通常モード: DB からセッションを抽出して QA 生成
  const dbPath = args[0];
  if (!dbPath || dbPath.startsWith("--")) {
    console.error(
      "Usage:\n" +
      "  bun llm-qa-generator.ts <db-path> --dry-run [--output prompts.json]\n" +
      "  bun llm-qa-generator.ts <db-path> --generate [--output generated-qa.json] [--sessions 100]\n" +
      "  bun llm-qa-generator.ts --convert <generated-qa.json> [--output locomo-pack.json]"
    );
    process.exit(1);
  }

  const isDryRun = args.includes("--dry-run");
  const isGenerate = args.includes("--generate");

  if (!isDryRun && !isGenerate) {
    console.error("Error: specify --dry-run or --generate");
    process.exit(1);
  }

  const sessionsIdx = args.indexOf("--sessions");
  const maxSessions = sessionsIdx !== -1 ? parseInt(args[sessionsIdx + 1] ?? "100", 10) : 100;

  const outputIdx = args.indexOf("--output");
  const outputPath = outputIdx !== -1 ? args[outputIdx + 1] : undefined;

  const resolvedDb = resolve(dbPath);
  console.error(`[llm-qa] Extracting sessions from ${resolvedDb} (max ${maxSessions})`);

  const sessions = extractSessions(resolvedDb, maxSessions);
  console.error(`[llm-qa] Found ${sessions.length} sessions with 3+ observations`);

  if (sessions.length === 0) {
    console.error("[llm-qa] No sessions found. Exiting.");
    process.exit(0);
  }

  const result = await generateQAPairs(sessions, isDryRun);

  if (!isDryRun) {
    summarizeQA(result as GeneratedQA[]);
  } else {
    console.error(`[llm-qa] Dry run: generated ${result.length} prompts`);
  }

  const output = JSON.stringify(result, null, 2);

  if (outputPath) {
    writeFileSync(resolve(outputPath), output);
    console.error(`[llm-qa] Written to ${resolve(outputPath)}`);
  } else {
    process.stdout.write(output + "\n");
  }
}
