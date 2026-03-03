/**
 * LLM プロバイダー共通インターフェース
 *
 * V5-009: Ollama ファーストクラス対応
 * - API キーなしで全 LLM 機能が動作するようにする
 * - Ollama をデフォルトプロバイダーとして扱う
 */

export interface GenerateOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  systemPrompt?: string;
}

export interface LLMProvider {
  name: string;

  /** テキスト生成 */
  generate(prompt: string, options?: GenerateOptions): Promise<string>;

  /** 埋め込み生成 */
  embed(text: string): Promise<number[]>;

  /** 接続テスト */
  testConnection(): Promise<{ ok: boolean; message: string }>;
}

export interface LLMConfig {
  provider: "openai" | "ollama" | "anthropic";
  model?: string;
  apiKey?: string;
  endpoint?: string;
}
