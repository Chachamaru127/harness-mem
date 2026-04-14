/**
 * LLM Registry — プロバイダーの生成と自動検出
 *
 * V5-009: Ollama ファーストクラス対応
 *
 * 優先度:
 * 1. 環境変数 HARNESS_MEM_LLM_PROVIDER が明示されている場合はそれを使用
 * 2. OPENAI_API_KEY / HARNESS_MEM_OPENAI_API_KEY が設定されていれば OpenAI
 * 3. それ以外は Ollama (API キー不要)
 */

import type { LLMConfig, LLMProvider } from "./types";
import { OllamaProvider } from "./ollama-provider";
import { OpenAIProvider } from "./openai-provider";
import { tryCreateClaudeAgentSDKProvider } from "./claude-agent-sdk-provider";

/** 環境変数からデフォルト LLM プロバイダー名を解決する */
function resolveDefaultProvider(): LLMConfig["provider"] {
  const explicit = (process.env.HARNESS_MEM_LLM_PROVIDER || "").trim().toLowerCase();
  if (explicit === "openai") return "openai";
  if (explicit === "anthropic") return "anthropic";
  if (explicit === "ollama") return "ollama";

  // API キーがあれば OpenAI を優先
  const openaiKey = (
    process.env.HARNESS_MEM_OPENAI_API_KEY ||
    process.env.OPENAI_API_KEY ||
    ""
  ).trim();
  if (openaiKey) return "openai";

  // API キーなし → Ollama フォールバック
  return "ollama";
}

/**
 * LLMProvider インスタンスを生成する。
 * config.provider が未指定の場合は自動検出する。
 */
export function createLLMProvider(config: Partial<LLMConfig> = {}): LLMProvider {
  const provider = config.provider || resolveDefaultProvider();
  const fullConfig: LLMConfig = { provider, ...config };

  switch (provider) {
    case "ollama":
      return new OllamaProvider(fullConfig);
    case "openai":
      return new OpenAIProvider(fullConfig);
    case "anthropic":
      // S81-C02: Anthropic はまず Claude Agent SDK 経路を試み、
      // SDK 未インストール or 失敗時は Ollama にフォールバックする。
      // SDK は dynamic import なので async な検証は別 API
      // (tryCreateClaudeAgentSDKProvider) を通す必要があり、ここでは
      // 同期インターフェース維持のため Ollama を返す。SDK 経路を使う
      // caller は createClaudeProviderAsync() を呼ぶこと。
      return new OllamaProvider({ ...fullConfig, provider: "ollama" });
    default:
      // 不明なプロバイダーは Ollama にフォールバック
      return new OllamaProvider({ ...fullConfig, provider: "ollama" });
  }
}

/**
 * S81-C02: `claude-agent-sdk` が利用可能なら SDK ベースの provider を、
 * 不可用なら従来 registry の fallback chain を返す async 版。
 * consolidation / rerank から呼ばれる想定で、同期経路を壊さないよう
 * 別関数に分離している。
 */
export async function createClaudeProviderAsync(
  config: Partial<LLMConfig> = {}
): Promise<LLMProvider> {
  const fullConfig: LLMConfig = { provider: "anthropic", ...config };
  const sdkProvider = await tryCreateClaudeAgentSDKProvider(fullConfig);
  if (sdkProvider) return sdkProvider;
  // Codex round 14 P1: when the Agent SDK is not installed but
  // ANTHROPIC_API_KEY is present (common on CI / headless servers),
  // prefer the OpenAI-compatible Anthropic route via a thin wrapper
  // before dropping to the generic openai/ollama chain. Without this,
  // an Anthropic-only environment silently had no LLM available for
  // contradiction detection.
  if (typeof process !== "undefined" && typeof process.env?.ANTHROPIC_API_KEY === "string"
      && process.env.ANTHROPIC_API_KEY.trim() !== "") {
    // Route via openai-provider with Anthropic's OpenAI-compatible
    // endpoint. The provider treats OPENAI_API_KEY/endpoint identically;
    // we synthesise the equivalent config here so the caller does not
    // have to set both envs.
    const anthropicBase = process.env.ANTHROPIC_BASE_URL?.trim() || "https://api.anthropic.com/v1/";
    return createLLMProvider({
      ...config,
      provider: "openai",
      apiKey: process.env.ANTHROPIC_API_KEY,
      endpoint: anthropicBase,
      model: config.model || "claude-3-5-sonnet-20241022",
    });
  }
  // Fallback: registry の既存 chain (openai → ollama)
  return createLLMProvider({ ...config, provider: undefined });
}

/**
 * Ollama が localhost で起動しているか非同期チェックする。
 * タイムアウト: 2 秒。
 */
export async function detectOllamaAvailable(endpoint = "http://localhost:11434"): Promise<boolean> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2_000);
  try {
    const response = await fetch(`${endpoint}/api/tags`, {
      method: "GET",
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeoutId);
  }
}
