/**
 * S81-C02: Claude Agent SDK provider.
 *
 * When `@anthropic-ai/claude-agent-sdk` is installed and a Claude Code
 * subscription is reachable (i.e. the user is logged into `claude`), the
 * subscription-backed path is preferred over raw `ANTHROPIC_API_KEY`.
 * This lets consolidation + rerank run without any API-key friction on
 * developer machines where Claude Code is already signed in.
 *
 * Design:
 *   - The SDK is a **soft** dependency. We dynamic-import it lazily so the
 *     memory-server package never has to bundle it.
 *   - If the import fails, or the SDK query call fails, we return
 *     `{available: false, reason}` so the caller falls back to
 *     OpenAI / Ollama via the existing registry.
 *   - All environment sniffing lives in this module so tests can stub
 *     the detector instead of poking `process.env`.
 */

import type { GenerateOptions, LLMConfig, LLMProvider } from "./types";

export interface AgentSDKAvailability {
  available: boolean;
  reason?: string;
  source?: "claude-agent-sdk" | "subscription" | "api-key";
}

/** The minimal surface we rely on from `@anthropic-ai/claude-agent-sdk`. */
type AgentSDKQueryOptions = {
  prompt: string;
  options?: {
    model?: string;
    systemPrompt?: string;
    maxTurns?: number;
  };
};

type AgentSDKMessage = {
  type: string;
  // The SDK streams several message types; we concatenate `text` chunks
  // from `assistant` content blocks to assemble the final response.
  message?: {
    content?: Array<{ type: string; text?: string }>;
  };
};

type AgentSDKQuery = (args: AgentSDKQueryOptions) => AsyncIterable<AgentSDKMessage>;

export interface AgentSDKLoader {
  /**
   * Returns the SDK's `query` function if the module can be imported, or
   * `null` if it cannot (package missing, ESM error, etc.). Tests override
   * this to simulate availability without installing the real package.
   */
  load(): Promise<AgentSDKQuery | null>;
}

export interface AgentSDKProviderOptions {
  loader?: AgentSDKLoader;
  /** Allows tests to force availability detection without env sniffing. */
  availability?: AgentSDKAvailability;
  logger?: (event: string, payload?: Record<string, unknown>) => void;
}

const defaultLoader: AgentSDKLoader = {
  async load(): Promise<AgentSDKQuery | null> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod = (await import(/* @vite-ignore */ "@anthropic-ai/claude-agent-sdk" as string)) as {
        query?: AgentSDKQuery;
      };
      return typeof mod.query === "function" ? mod.query : null;
    } catch {
      return null;
    }
  },
};

/**
 * Returns `true` if ANTHROPIC_API_KEY looks set. The raw key value is
 * never captured into a local so it cannot leak into logs or stack
 * traces — only a boolean crosses the boundary.
 */
function hasAnthropicApiKey(): boolean {
  const raw = process.env.ANTHROPIC_API_KEY;
  return typeof raw === "string" && raw.trim().length > 0;
}

/**
 * Inspect the environment to decide whether the Agent SDK path is worth
 * attempting. The returned `source` drives the "provider switch log" the
 * DoD asks for.
 *
 * `apiKeyPresentFn` is injectable so tests can exercise both branches
 * without touching `process.env`.
 */
export async function detectAgentSDKAvailability(
  loader: AgentSDKLoader = defaultLoader,
  apiKeyPresentFn: () => boolean = hasAnthropicApiKey
): Promise<AgentSDKAvailability> {
  const q = await loader.load();
  if (!q) {
    return { available: false, reason: "claude-agent-sdk module not installed" };
  }
  // The SDK transparently uses a subscription login if present; otherwise it
  // falls back to ANTHROPIC_API_KEY. Both count as "available" from our POV —
  // the DoD specifically notes "ANTHROPIC_API_KEY 未設定かつ Claude
  // subscription あり" as the primary win, but having just the API key is
  // still useful (no regression vs. openai-provider).
  const source: AgentSDKAvailability["source"] = apiKeyPresentFn() ? "api-key" : "subscription";
  return { available: true, source };
}

async function collectText(stream: AsyncIterable<AgentSDKMessage>): Promise<string> {
  const parts: string[] = [];
  for await (const msg of stream) {
    if (msg.type === "assistant" && msg.message?.content) {
      for (const block of msg.message.content) {
        if (block.type === "text" && typeof block.text === "string") {
          parts.push(block.text);
        }
      }
    }
  }
  return parts.join("");
}

/**
 * Wraps the SDK in the LLMProvider surface expected by consolidation +
 * rerank. `embed()` is not supported by the Agent SDK (it's a reasoning
 * surface, not an embedding endpoint) so we reject with a typed error and
 * the caller is expected to route embeddings through the embedding
 * registry instead.
 */
export class ClaudeAgentSDKProvider implements LLMProvider {
  readonly name = "claude-agent-sdk";
  private readonly config: LLMConfig;
  private readonly loader: AgentSDKLoader;
  private readonly logger: NonNullable<AgentSDKProviderOptions["logger"]>;
  private cachedQuery: AgentSDKQuery | null | undefined;

  constructor(config: LLMConfig, options: AgentSDKProviderOptions = {}) {
    this.config = config;
    this.loader = options.loader ?? defaultLoader;
    this.logger = options.logger ?? (() => {});
  }

  private async resolveQuery(): Promise<AgentSDKQuery | null> {
    if (this.cachedQuery !== undefined) return this.cachedQuery;
    const q = await this.loader.load();
    this.cachedQuery = q;
    if (!q) {
      this.logger("llm.provider.switch", {
        from: "claude-agent-sdk",
        to: "fallback",
        reason: "sdk-missing",
      });
    } else {
      this.logger("llm.provider.switch", {
        to: "claude-agent-sdk",
        source: hasAnthropicApiKey() ? "api-key" : "subscription",
      });
    }
    return q;
  }

  async generate(prompt: string, options: GenerateOptions = {}): Promise<string> {
    const query = await this.resolveQuery();
    if (!query) {
      throw new Error(
        "@anthropic-ai/claude-agent-sdk not available; fall back to another provider"
      );
    }
    const stream = query({
      prompt,
      options: {
        model: options.model ?? this.config.model ?? "claude-sonnet-4-5",
        systemPrompt: options.systemPrompt,
        maxTurns: 1,
      },
    });
    return await collectText(stream);
  }

  async embed(_text: string): Promise<number[]> {
    throw new Error(
      "claude-agent-sdk does not provide an embedding endpoint; route embeddings through the embedding registry"
    );
  }

  async testConnection(): Promise<{ ok: boolean; message: string }> {
    const availability = await detectAgentSDKAvailability(this.loader);
    if (!availability.available) {
      return { ok: false, message: availability.reason ?? "agent-sdk unavailable" };
    }
    return {
      ok: true,
      message: `claude-agent-sdk ready (source=${availability.source ?? "unknown"})`,
    };
  }
}

/**
 * Factory used by the LLM registry. Returns the SDK provider when the
 * module loads; otherwise returns `null` so the caller can keep the
 * existing fallback chain intact.
 */
export async function tryCreateClaudeAgentSDKProvider(
  config: LLMConfig,
  options: AgentSDKProviderOptions = {}
): Promise<ClaudeAgentSDKProvider | null> {
  const availability = options.availability ?? (await detectAgentSDKAvailability(options.loader));
  if (!availability.available) return null;
  return new ClaudeAgentSDKProvider(config, options);
}
