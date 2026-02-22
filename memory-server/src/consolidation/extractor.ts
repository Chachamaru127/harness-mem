import { spawnSync } from "node:child_process";

export interface FactCandidate {
  fact_type: string;
  fact_key: string;
  fact_value: string;
  confidence: number;
}

export interface ExtractFactInput {
  title: string;
  content: string;
  observation_type: string;
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
    });
  }

  if (facts.length === 0 && input.observation_type !== "context") {
    const seed = (combined.trim() || input.title || "").slice(0, 500);
    if (seed) {
      facts.push({
        fact_type: input.observation_type,
        fact_key: `${input.observation_type}:${normalizeFactKey(seed)}`,
        fact_value: seed,
        confidence: 0.6,
      });
    }
  }

  return facts.slice(0, 8);
}

function llmExtract(input: ExtractFactInput): FactCandidate[] {
  const apiKey = (process.env.HARNESS_MEM_OPENAI_API_KEY || "").trim();
  if (!apiKey) {
    return [];
  }

  const model = (process.env.HARNESS_MEM_FACT_LLM_MODEL || "gpt-4o-mini").trim();
  const prompt = [
    "Extract up to 5 stable memory facts as compact JSON array.",
    "Each item must include fact_type, fact_key, fact_value, confidence.",
    "Allowed fact_type: decision, preference, lesson, pattern, action.",
    `title: ${input.title}`,
    `content: ${input.content.slice(0, 2000)}`,
  ].join("\n");

  const body = JSON.stringify({
    model,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: "Return JSON object only." },
      { role: "user", content: prompt },
    ],
  });

  const result = spawnSync(
    "curl",
    [
      "-sS",
      "--max-time",
      "8",
      "https://api.openai.com/v1/chat/completions",
      "-H",
      "content-type: application/json",
      "-H",
      `authorization: Bearer ${apiKey}`,
      "-d",
      body,
    ],
    { encoding: "utf8" }
  );

  if (result.status !== 0) {
    return [];
  }

  try {
    const parsed = JSON.parse(result.stdout || "{}");
    const content = parsed?.choices?.[0]?.message?.content;
    if (typeof content !== "string") {
      return [];
    }
    const json = JSON.parse(content);
    const facts = Array.isArray(json?.facts) ? json.facts : Array.isArray(json) ? json : [];
    return facts
      .map((fact: Record<string, unknown>) => ({
        fact_type: typeof fact.fact_type === "string" ? fact.fact_type : "context",
        fact_key: typeof fact.fact_key === "string" ? fact.fact_key : "",
        fact_value: typeof fact.fact_value === "string" ? fact.fact_value : "",
        confidence: typeof fact.confidence === "number" ? fact.confidence : 0.5,
      }))
      .filter((fact: FactCandidate) =>
        fact.fact_key.length > 0 &&
        fact.fact_value.length > 0 &&
        ["decision", "preference", "lesson", "pattern", "action"].includes(fact.fact_type)
      )
      .slice(0, 5);
  } catch {
    return [];
  }
}

export function extractFacts(input: ExtractFactInput): FactCandidate[] {
  const mode = (process.env.HARNESS_MEM_FACT_EXTRACTOR_MODE || "heuristic").trim().toLowerCase();
  if (mode === "llm") {
    const llmFacts = llmExtract(input);
    if (llmFacts.length > 0) {
      return llmFacts;
    }
  }
  return heuristicExtract(input);
}
