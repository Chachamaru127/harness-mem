/**
 * llm-reranker.ts — S58-008
 *
 * 検索結果 top-k を LLM で再スコアリングするオプション機能。
 * HARNESS_MEM_LLM_ENHANCE=true の場合のみ有効。無効時は従来パイプラインのまま。
 *
 * 外部 API は fetch を直接使用（SDK 依存なし）。
 * タイムアウト 5 秒。エラー時は graceful degradation（元スコアをそのまま返す）。
 */

const LLM_RERANK_TIMEOUT_MS = 5_000;

export interface LlmRerankerConfig {
  enabled: boolean;
  provider: "openai" | "anthropic";
  model?: string;
  apiKey?: string;
  topK?: number; // リランク対象の上位件数（デフォルト: 20）
}

export interface LlmRerankCandidate {
  id: string;
  title: string;
  content: string;
  score: number;
}

export interface LlmRerankResult {
  id: string;
  score: number;
}

// ---------------------------------------------------------------------------
// 設定解析ヘルパー
// ---------------------------------------------------------------------------

function parseEnabled(raw: string | undefined): boolean {
  if (!raw) return false;
  const v = raw.trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(v);
}

/**
 * 環境変数から LlmRerankerConfig を組み立てる。
 */
export function buildLlmRerankerConfigFromEnv(): LlmRerankerConfig {
  const enabled = parseEnabled(process.env.HARNESS_MEM_LLM_ENHANCE);
  const provider = (process.env.HARNESS_MEM_LLM_PROVIDER as "openai" | "anthropic") || "openai";
  const model = process.env.HARNESS_MEM_LLM_MODEL;
  const apiKey =
    process.env.HARNESS_MEM_LLM_API_KEY ??
    (provider === "anthropic" ? process.env.ANTHROPIC_API_KEY : process.env.OPENAI_API_KEY);
  const topK = process.env.HARNESS_MEM_LLM_TOP_K ? parseInt(process.env.HARNESS_MEM_LLM_TOP_K, 10) : undefined;
  return { enabled, provider, model, apiKey, topK };
}

// ---------------------------------------------------------------------------
// スコア結合
// ---------------------------------------------------------------------------

/**
 * LLM スコアと元スコアを重み付き結合する。
 * final = 0.6 * llm_score + 0.4 * original_score
 */
export function combineScores(llmScore: number, originalScore: number): number {
  return 0.6 * llmScore + 0.4 * originalScore;
}

// ---------------------------------------------------------------------------
// OpenAI 実装
// ---------------------------------------------------------------------------

async function rerankWithOpenAI(
  query: string,
  candidates: LlmRerankCandidate[],
  config: LlmRerankerConfig
): Promise<LlmRerankResult[]> {
  const model = config.model ?? "gpt-4o-mini";
  const apiKey = config.apiKey;
  if (!apiKey) {
    throw new Error("LLM reranker: OpenAI API key is not set");
  }

  const docs = candidates
    .map((c, i) => `[${i}] Title: ${c.title}\nContent: ${c.content.slice(0, 400)}`)
    .join("\n\n");

  const prompt = `以下の記憶リストについて、クエリ「${query}」との関連度を 0.0〜1.0 で評価してください。
各記憶の番号と関連スコアのみを JSON 配列で返してください。

形式: [{"index": 0, "score": 0.9}, {"index": 1, "score": 0.3}, ...]

記憶リスト:
${docs}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_RERANK_TIMEOUT_MS);

  let raw: string;
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
        max_tokens: 512,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`OpenAI API error: ${res.status} ${text}`);
    }
    const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
    raw = data.choices[0]?.message?.content ?? "[]";
  } finally {
    clearTimeout(timer);
  }

  return parseLlmResponse(raw, candidates);
}

// ---------------------------------------------------------------------------
// Anthropic 実装
// ---------------------------------------------------------------------------

async function rerankWithAnthropic(
  query: string,
  candidates: LlmRerankCandidate[],
  config: LlmRerankerConfig
): Promise<LlmRerankResult[]> {
  const model = config.model ?? "claude-haiku-4-5";
  const apiKey = config.apiKey;
  if (!apiKey) {
    throw new Error("LLM reranker: Anthropic API key is not set");
  }

  const docs = candidates
    .map((c, i) => `[${i}] Title: ${c.title}\nContent: ${c.content.slice(0, 400)}`)
    .join("\n\n");

  const prompt = `以下の記憶リストについて、クエリ「${query}」との関連度を 0.0〜1.0 で評価してください。
各記憶の番号と関連スコアのみを JSON 配列で返してください。

形式: [{"index": 0, "score": 0.9}, {"index": 1, "score": 0.3}, ...]

記憶リスト:
${docs}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_RERANK_TIMEOUT_MS);

  let raw: string;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        max_tokens: 512,
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Anthropic API error: ${res.status} ${text}`);
    }
    const data = (await res.json()) as { content: Array<{ type: string; text: string }> };
    raw = data.content.find((b) => b.type === "text")?.text ?? "[]";
  } finally {
    clearTimeout(timer);
  }

  return parseLlmResponse(raw, candidates);
}

// ---------------------------------------------------------------------------
// レスポンスパース
// ---------------------------------------------------------------------------

function parseLlmResponse(raw: string, candidates: LlmRerankCandidate[]): LlmRerankResult[] {
  // JSON 配列を抽出（```json ... ``` 等のコードブロックにも対応）
  const match = raw.match(/\[[\s\S]*?\]/);
  if (!match) {
    throw new Error(`LLM reranker: failed to parse JSON from response: ${raw.slice(0, 200)}`);
  }

  const parsed = JSON.parse(match[0]) as Array<{ index: number; score: number }>;

  return parsed
    .filter((entry) => typeof entry.index === "number" && typeof entry.score === "number")
    .map((entry) => {
      const candidate = candidates[entry.index];
      if (!candidate) return null;
      const llmScore = Math.max(0, Math.min(1, entry.score));
      return {
        id: candidate.id,
        score: combineScores(llmScore, candidate.score),
      };
    })
    .filter((r): r is LlmRerankResult => r !== null);
}

// ---------------------------------------------------------------------------
// LLM 不在判定（S58-009）
// ---------------------------------------------------------------------------

/**
 * LLM に「クエリに対して top 候補の記憶が関連しているか」を Yes/No で問い合わせる。
 *
 * - タイムアウト・エラー時は `{ has_memory: false }` を返す（元の判定を維持）
 * - 応答が Yes 系の文字列を含む場合 `has_memory: true`、それ以外は `false`
 */
export async function llmNoMemoryCheck(
  query: string,
  topCandidate: { title: string; content: string; score: number },
  config: { provider: string; model?: string; apiKey: string }
): Promise<{ has_memory: boolean }> {
  const prompt = `クエリ: 「${query}」

以下の記憶はこのクエリと関連していますか？ "Yes" か "No" の一語のみで回答してください。

タイトル: ${topCandidate.title}
内容: ${topCandidate.content.slice(0, 400)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_RERANK_TIMEOUT_MS);

  try {
    let raw: string;

    if (config.provider === "anthropic") {
      const model = config.model ?? "claude-haiku-4-5";
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": config.apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          max_tokens: 16,
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`Anthropic API error: ${res.status} ${text}`);
      }
      const data = (await res.json()) as { content: Array<{ type: string; text: string }> };
      raw = data.content.find((b) => b.type === "text")?.text ?? "";
    } else {
      // openai (default)
      const model = config.model ?? "gpt-4o-mini";
      const res = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [{ role: "user", content: prompt }],
          temperature: 0,
          max_tokens: 16,
        }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`OpenAI API error: ${res.status} ${text}`);
      }
      const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
      raw = data.choices[0]?.message?.content ?? "";
    }

    const normalized = raw.trim().toLowerCase();
    const has_memory = normalized.startsWith("yes") || normalized.includes("yes");
    return { has_memory };
  } catch {
    // タイムアウト・エラー時は元の判定を維持（has_memory: false）
    return { has_memory: false };
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// メインエントリポイント
// ---------------------------------------------------------------------------

/**
 * LLM リランクを実行する。
 *
 * config.enabled が false の場合は元の candidates をそのまま返す（スキップ）。
 * LLM 呼び出しが失敗した場合は graceful degradation（元スコアをそのまま使用）。
 *
 * @returns 結合スコアでソート済みの結果配列。スキップ時は元順序のまま。
 */
export async function llmRerank(
  query: string,
  candidates: LlmRerankCandidate[],
  config: LlmRerankerConfig
): Promise<LlmRerankResult[]> {
  if (!config.enabled || candidates.length === 0) {
    return candidates.map((c) => ({ id: c.id, score: c.score }));
  }

  const topK = config.topK ?? 20;
  const toRerank = candidates.slice(0, topK);
  const rest = candidates.slice(topK).map((c) => ({ id: c.id, score: c.score }));

  let results: LlmRerankResult[];
  try {
    if (config.provider === "anthropic") {
      results = await rerankWithAnthropic(query, toRerank, config);
    } else {
      results = await rerankWithOpenAI(query, toRerank, config);
    }
  } catch {
    // graceful degradation: 元スコアをそのまま返す
    return candidates.map((c) => ({ id: c.id, score: c.score }));
  }

  // reranked 結果に含まれなかった候補を末尾に追加（元スコアで）
  const rerankedIds = new Set(results.map((r) => r.id));
  const missing = toRerank
    .filter((c) => !rerankedIds.has(c.id))
    .map((c) => ({ id: c.id, score: c.score }));

  // 結合スコア降順でソート
  const rerankedSorted = [...results, ...missing].sort((a, b) => b.score - a.score);

  return [...rerankedSorted, ...rest];
}
