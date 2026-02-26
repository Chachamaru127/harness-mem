
export interface FactCandidate {
  fact_type: string;
  fact_key: string;
  fact_value: string;
  confidence: number;
  /** heuristic 抽出時に自動生成されるタグ（任意） */
  auto_tags?: string[];
}

export interface ExtractFactInput {
  title: string;
  content: string;
  observation_type: string;
}

/** 既存ファクトの最小情報（差分比較用） */
export interface ExistingFact {
  fact_id: string;
  fact_type: string;
  fact_key: string;
  fact_value: string;
}

/** LLM 差分抽出の結果 */
export interface FactDiffResult {
  new_facts: FactCandidate[];
  /** supersedes[i] = 新ファクト i が上書きする旧 fact_id（なければ undefined） */
  supersedes: (string | undefined)[];
  /** 削除すべきファクトの fact_id 一覧（矛盾で無効化） */
  deleted_fact_ids: string[];
}

function normalizeFactKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1)
    .slice(0, 12)
    .join("_")
    .slice(0, 120);
}

function splitSentences(text: string): string[] {
  return text
    .split(/[\n。.!?]+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 10)
    .slice(0, 20);
}

function inferType(sentence: string, fallbackType: string): string {
  const normalized = sentence.toLowerCase();
  if (/(decide|decision|採用|方針|決定|choose)/.test(normalized)) {
    return "decision";
  }
  if (/(prefer|preference|好み|避け|avoid)/.test(normalized)) {
    return "preference";
  }
  if (/(learned|lesson|教訓|学び|反省|気づき)/.test(normalized)) {
    return "lesson";
  }
  if (/(pattern|傾向|パターン|いつも)/.test(normalized)) {
    return "pattern";
  }
  if (/(todo|next|次|action|対応)/.test(normalized)) {
    return "action";
  }
  return fallbackType || "context";
}

/**
 * ファクトの fact_type と fact_key からタグを自動生成する。
 * - fact_type はそのままタグとして付与する
 * - fact_key 内の既知の技術キーワードを小文字タグとして付与する
 */
function inferAutoTags(fact_type: string, fact_key: string): string[] {
  const tags = new Set<string>();

  // fact_type をタグとして付与
  if (fact_type && fact_type !== "context") {
    tags.add(fact_type);
  }

  // fact_key に含まれる既知の技術キーワードをタグとして付与
  const text = fact_key.toLowerCase();
  const TECH_KEYWORDS: string[] = [
    "typescript", "javascript", "python", "rust", "go", "java", "ruby",
    "react", "nextjs", "vue", "angular", "svelte",
    "node", "bun", "deno",
    "sqlite", "postgres", "mysql", "redis", "mongodb",
    "docker", "kubernetes", "aws", "gcp", "azure",
    "git", "github", "ci", "cd",
    "api", "rest", "graphql", "grpc",
    "auth", "security", "performance", "testing",
  ];
  for (const keyword of TECH_KEYWORDS) {
    if (text.includes(keyword)) {
      tags.add(keyword);
    }
  }

  return Array.from(tags);
}

function heuristicExtract(input: ExtractFactInput): FactCandidate[] {
  const combined = [input.title, input.content].filter(Boolean).join("\n");
  const lines = splitSentences(combined);
  const facts: FactCandidate[] = [];
  const seen = new Set<string>();

  for (const line of lines) {
    const factType = inferType(line, input.observation_type);
    if (!["decision", "preference", "lesson", "pattern", "action"].includes(factType)) {
      continue;
    }

    const key = `${factType}:${normalizeFactKey(line)}`;
    if (!key || seen.has(key)) {
      continue;
    }
    seen.add(key);

    facts.push({
      fact_type: factType,
      fact_key: key,
      fact_value: line.slice(0, 500),
      confidence: factType === input.observation_type ? 0.9 : 0.7,
      auto_tags: inferAutoTags(factType, key),
    });
  }

  if (facts.length === 0 && input.observation_type !== "context") {
    const seed = (combined.trim() || input.title || "").slice(0, 500);
    if (seed) {
      const fallbackType = input.observation_type;
      const fallbackKey = `${fallbackType}:${normalizeFactKey(seed)}`;
      facts.push({
        fact_type: fallbackType,
        fact_key: fallbackKey,
        fact_value: seed,
        confidence: 0.6,
        auto_tags: inferAutoTags(fallbackType, fallbackKey),
      });
    }
  }

  return facts.slice(0, 8);
}

/** LLM レスポンスから FactCandidate[] をパースする共通ロジック */
function parseFactsFromContent(content: string): FactCandidate[] {
  const json = JSON.parse(content);
  const facts = Array.isArray(json?.facts) ? json.facts : Array.isArray(json) ? json : [];
  return facts
    .map((fact: Record<string, unknown>) => {
      const fact_type = typeof fact.fact_type === "string" ? fact.fact_type : "context";
      const fact_key = typeof fact.fact_key === "string" ? fact.fact_key : "";
      return {
        fact_type,
        fact_key,
        fact_value: typeof fact.fact_value === "string" ? fact.fact_value.slice(0, 500) : "",
        confidence: typeof fact.confidence === "number" ? fact.confidence : 0.5,
        auto_tags: inferAutoTags(fact_type, fact_key),
      };
    })
    .filter(
      (fact: FactCandidate) =>
        fact.fact_key.length > 0 &&
        fact.fact_value.length > 0 &&
        ["decision", "preference", "lesson", "pattern", "action"].includes(fact.fact_type)
    )
    .slice(0, 5);
}

/** LLM レスポンスから差分情報（supersedes / deleted_fact_ids）をパースする */
function parseDiffFromContent(
  content: string,
  newFacts: FactCandidate[],
  existingFacts: ExistingFact[]
): { supersedes: (string | undefined)[]; deleted_fact_ids: string[] } {
  const supersedes: (string | undefined)[] = newFacts.map(() => undefined);
  const deleted_fact_ids: string[] = [];

  try {
    const json = JSON.parse(content);

    // supersedes: { new_fact_key: old_fact_id } マップ
    const supersededMap = json?.supersedes as Record<string, string> | undefined;
    if (supersededMap && typeof supersededMap === "object") {
      for (let i = 0; i < newFacts.length; i++) {
        const oldId = supersededMap[newFacts[i].fact_key];
        if (oldId && existingFacts.some((ef) => ef.fact_id === oldId)) {
          supersedes[i] = oldId;
        }
      }
    }

    // deleted: fact_id 配列
    const deleted = json?.deleted;
    if (Array.isArray(deleted)) {
      for (const id of deleted) {
        if (typeof id === "string" && existingFacts.some((ef) => ef.fact_id === id)) {
          deleted_fact_ids.push(id);
        }
      }
    }
  } catch {
    // 差分情報がなくても新規ファクト追加として扱う
  }

  return { supersedes, deleted_fact_ids };
}

/** OpenAI API を呼び出してファクトを抽出する */
async function callOpenAI(
  prompt: string,
  systemPrompt: string,
  apiKey: string,
  model: string
): Promise<string | null> {
  const body = JSON.stringify({
    model,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt },
    ],
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8_000);

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${apiKey}`,
      },
      body,
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    const parsed = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
    const content = parsed?.choices?.[0]?.message?.content;
    return typeof content === "string" ? content : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/** Ollama API を呼び出してファクトを抽出する */
async function callOllama(
  prompt: string,
  systemPrompt: string,
  model: string
): Promise<string | null> {
  const host = (process.env.HARNESS_MEM_OLLAMA_HOST || "http://127.0.0.1:11434").trim();
  if (!/^https?:\/\//i.test(host)) {
    process.stderr.write(`[harness-mem][warn] HARNESS_MEM_OLLAMA_HOST must use http or https scheme, got: ${host}\n`);
    return null;
  }
  const body = JSON.stringify({
    model,
    stream: false,
    format: "json",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt },
    ],
  });

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(`${host}/api/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body,
      signal: controller.signal,
    });

    if (!response.ok) {
      return null;
    }

    const parsed = await response.json() as { message?: { content?: unknown } };
    const content = parsed?.message?.content;
    return typeof content === "string" ? content : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function llmExtract(input: ExtractFactInput): Promise<FactCandidate[]> {
  const apiKey = (process.env.HARNESS_MEM_OPENAI_API_KEY || "").trim();
  if (!apiKey) {
    return [];
  }

  const model = (process.env.HARNESS_MEM_FACT_LLM_MODEL || "gpt-4o-mini").trim();
  const systemPrompt = "Return JSON object only.";
  const prompt = [
    "Extract up to 5 stable memory facts as compact JSON array.",
    "Each item must include fact_type, fact_key, fact_value, confidence.",
    "Allowed fact_type: decision, preference, lesson, pattern, action.",
    `title: ${input.title}`,
    `content: ${input.content.slice(0, 2000)}`,
  ].join("\n");

  const content = await callOpenAI(prompt, systemPrompt, apiKey, model);
  if (!content) {
    return [];
  }

  try {
    return parseFactsFromContent(content);
  } catch {
    return [];
  }
}

/**
 * LLM モードで既存ファクトとの差分を含むファクト抽出を行う。
 * プロバイダは HARNESS_MEM_FACT_LLM_PROVIDER 環境変数で切り替える（openai | ollama、デフォルト: openai）。
 * 接続失敗時は graceful に空配列を返す。
 */
export async function llmExtractWithDiff(
  input: ExtractFactInput,
  existingFacts: ExistingFact[]
): Promise<FactDiffResult> {
  const provider = (process.env.HARNESS_MEM_FACT_LLM_PROVIDER || "openai").trim().toLowerCase();

  const existingFactsJson =
    existingFacts.length > 0
      ? JSON.stringify(
          existingFacts.map((f) => ({
            fact_id: f.fact_id,
            fact_type: f.fact_type,
            fact_key: f.fact_key,
            fact_value: f.fact_value.slice(0, 200),
          }))
        )
      : "[]";

  const systemPrompt = [
    "You are a memory fact extractor. Return JSON object only.",
    "Your response must be a JSON object with keys: facts, supersedes, deleted.",
    "  facts: array of {fact_type, fact_key, fact_value, confidence}",
    "  supersedes: object mapping new fact_key to the old fact_id it replaces (if any)",
    "  deleted: array of fact_ids that are now invalid/contradicted by new information",
    "Allowed fact_type values: decision, preference, lesson, pattern, action",
  ].join("\n");

  const prompt = [
    "Extract up to 5 stable memory facts from the input.",
    "Compare with the existing facts below. If a new fact contradicts or updates an existing one, record it in 'supersedes'.",
    "If an existing fact is now completely invalid, add its fact_id to 'deleted'.",
    "",
    `title: ${input.title}`,
    `content: ${input.content.slice(0, 2000)}`,
    "",
    `existing_facts: ${existingFactsJson}`,
  ].join("\n");

  let content: string | null = null;

  if (provider === "ollama") {
    const model = (process.env.HARNESS_MEM_FACT_LLM_MODEL || "llama3.2").trim();
    content = await callOllama(prompt, systemPrompt, model);
  } else {
    // openai がデフォルト
    const apiKey = (process.env.HARNESS_MEM_OPENAI_API_KEY || "").trim();
    if (!apiKey) {
      return { new_facts: [], supersedes: [], deleted_fact_ids: [] };
    }
    const model = (process.env.HARNESS_MEM_FACT_LLM_MODEL || "gpt-4o-mini").trim();
    content = await callOpenAI(prompt, systemPrompt, apiKey, model);
  }

  if (!content) {
    return { new_facts: [], supersedes: [], deleted_fact_ids: [] };
  }

  try {
    const newFacts = parseFactsFromContent(content);
    const { supersedes, deleted_fact_ids } = parseDiffFromContent(content, newFacts, existingFacts);
    return { new_facts: newFacts, supersedes, deleted_fact_ids };
  } catch {
    return { new_facts: [], supersedes: [], deleted_fact_ids: [] };
  }
}

export async function extractFacts(input: ExtractFactInput): Promise<FactCandidate[]> {
  const mode = (process.env.HARNESS_MEM_FACT_EXTRACTOR_MODE || "heuristic").trim().toLowerCase();
  if (mode === "llm") {
    const llmFacts = await llmExtract(input);
    if (llmFacts.length > 0) {
      return llmFacts;
    }
  }
  return heuristicExtract(input);
}
