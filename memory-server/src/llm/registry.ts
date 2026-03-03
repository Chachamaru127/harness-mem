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
      // Anthropic は将来的に AnthropicProvider を追加予定
      // 暫定: API キーがあれば OpenAI 互換エンドポイント経由で扱う
      // （anthropic SDK 非依存で維持するため）
      return new OllamaProvider({ ...fullConfig, provider: "ollama" });
    default:
      // 不明なプロバイダーは Ollama にフォールバック
      return new OllamaProvider({ ...fullConfig, provider: "ollama" });
  }
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
