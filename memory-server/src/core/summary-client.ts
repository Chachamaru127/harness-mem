export interface SummaryFacts {
  decision: string | null;
  reason: string | null;
  date: string | null;
  version: string | null;
  files: string[];
}

export interface SummaryInput {
  project: string;
  sessionId: string;
  text: string;
  facts: SummaryFacts;
}

export type SummaryResult =
  | { ok: true; summary: string }
  | { ok: false; reason: string };

export interface SummaryClientOptions {
  backend?: "ollama" | "codex-app-server" | "claude-code";
  endpoint?: string;
  model?: string;
  timeoutMs?: number;
  maxTokens?: number;
  /** Test seam. Defaults to globalThis.fetch. */
  fetchImpl?: typeof fetch;
}

const DEFAULT_ENDPOINT = "http://127.0.0.1:11434";
const DEFAULT_MODEL = "glm-5.3-flash:cloud";
const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_TOKENS = 2000;
const MAX_LOG_CHARS = 6000;
const SYSTEM_PROMPT = "あなたは開発記憶の圧縮担当です。日本語で要約します。";
const INSTRUCTIONS =
  "決定、理由、手順、数値、未解決点を必ず残す。進捗報告、挨拶、ツールの生出力は落とす。800字以内。推測を足さない。" +
  "メールアドレス、パスワード、API キー、トークン、顧客名は要約に含めない。";
const MISSING = "(なし)";

/**
 * Stage 2 summary client (spec §4.4). Ollama /api/chat, non-streaming.
 * Every failure is reported as `{ ok: false, reason }`; this never throws.
 */
export class SummaryClient {
  constructor(private readonly options: SummaryClientOptions = {}) {}

  async summarize(input: SummaryInput): Promise<SummaryResult> {
    if (this.options.backend === "claude-code") {
      const { summarizeWithClaude } = await import("./claude-summary-client");
      return summarizeWithClaude(userPrompt(input), this.options.model ?? "claude-haiku-5-5", this.options.timeoutMs);
    }
    if (this.options.backend === "codex-app-server") {
      const { summarizeWithCodex } = await import("./codex-summary-client");
      return summarizeWithCodex(userPrompt(input), this.options.model ?? "gpt-6-luna", this.options.timeoutMs);
    }
    const controller = new AbortController();
    const timeoutMs = this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const timer = Number.isFinite(timeoutMs) && timeoutMs > 0
      ? setTimeout(() => controller.abort(), timeoutMs)
      : null;

    try {
      const response = await (this.options.fetchImpl ?? globalThis.fetch)(this.endpointUrl(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(this.body(input)),
        signal: controller.signal,
        // A loopback endpoint must not be redirected to a remote host behind the cloud gate.
        redirect: "error",
      });

      if (response.status < 200 || response.status >= 300) {
        return { ok: false, reason: `http ${response.status}` };
      }

      let text: string;
      try {
        text = await response.text();
      } catch {
        return { ok: false, reason: controller.signal.aborted ? "timeout" : "network" };
      }

      let payload: unknown;
      try {
        payload = JSON.parse(text);
      } catch {
        return { ok: false, reason: "invalid-json" };
      }

      const content = messageContent(payload);
      if (typeof content !== "string") return { ok: false, reason: "empty" };
      const summary = content.trim();
      if (summary.length === 0) return { ok: false, reason: "empty" };
      return { ok: true, summary };
    } catch {
      return { ok: false, reason: controller.signal.aborted ? "timeout" : "network" };
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private endpointUrl(): string {
    return `${(this.options.endpoint ?? DEFAULT_ENDPOINT).replace(/\/+$/, "")}/api/chat`;
  }

  private body(input: SummaryInput): unknown {
    return {
      model: this.options.model ?? DEFAULT_MODEL,
      stream: false,
      options: { num_predict: this.options.maxTokens ?? DEFAULT_MAX_TOKENS },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userPrompt(input) },
      ],
    };
  }
}

function userPrompt(input: SummaryInput): string {
  const facts = input.facts;
  return [
    `プロジェクト: ${input.project}`,
    `セッション: ${input.sessionId}`,
    "",
    "## 抽出済みの事実",
    `- 決定: ${facts.decision ?? MISSING}`,
    `- 理由: ${facts.reason ?? MISSING}`,
    `- 日付: ${facts.date ?? MISSING}`,
    `- バージョン: ${facts.version ?? MISSING}`,
    `- ファイル: ${facts.files.length > 0 ? facts.files.join(", ") : MISSING}`,
    "",
    "## セッションのログ",
    input.text.slice(0, MAX_LOG_CHARS),
    "",
    "## 指示",
    INSTRUCTIONS,
  ].join("\n");
}

function messageContent(payload: unknown): unknown {
  if (!payload || typeof payload !== "object") return undefined;
  const message = (payload as { message?: unknown }).message;
  if (!message || typeof message !== "object") return undefined;
  return (message as { content?: unknown }).content;
}
