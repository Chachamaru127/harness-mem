/**
 * @harness-mem/sdk - Framework Integrations
 *
 * LangChain / LlamaIndex 互換インターフェース。
 * 既存の HarnessMemClient をラップして、フレームワーク固有の
 * Memory インターフェースに適合させる。
 *
 * LangChain Memory API (save_context / load_memory_variables):
 * - https://python.langchain.com/docs/modules/memory/
 *
 * LlamaIndex Memory API (put / get / getAll):
 * - https://docs.llamaindex.ai/en/stable/module_guides/storing/chat_stores/
 */

import type { HarnessMemClient } from "./client.js";
import type { RecordEventInput, SearchInput, SearchResultItem, ApiResponse } from "./types.js";

/**
 * HarnessMemClient の最小インターフェース。
 * テストでモックを構成する際や、部分的な実装に使用する。
 */
export interface HarnessMemClientLike {
  record(input: RecordEventInput): Promise<ApiResponse<unknown>>;
  search(input: SearchInput): Promise<ApiResponse<SearchResultItem>>;
}

// ---- LangChain 互換 ----

export interface LangChainMemoryOptions {
  /** harness-mem クライアント */
  client: HarnessMemClientLike;
  /** プロジェクト名 */
  project: string;
  /** セッション ID */
  session_id: string;
  /** load_memory_variables が返すキー名。デフォルト: "chat_history" */
  memory_key?: string;
  /** 検索時の最大取得件数。デフォルト: 5 */
  search_limit?: number;
}

/**
 * LangChain Memory 互換クラス。
 *
 * 旧 `BaseMemory` API（save_context / load_memory_variables）を実装し、
 * harness-mem に会話コンテキストを永続化する。
 */
export class HarnessMemLangChainMemory {
  readonly memory_key: string;
  private readonly client: HarnessMemClientLike;
  private readonly project: string;
  private readonly session_id: string;
  private readonly searchLimit: number;

  constructor(options: LangChainMemoryOptions) {
    this.client = options.client;
    this.project = options.project;
    this.session_id = options.session_id;
    this.memory_key = options.memory_key ?? "chat_history";
    this.searchLimit = options.search_limit ?? 5;
  }

  /**
   * 入力と出力のペアを記録する（LangChain BaseMemory.save_context 互換）。
   *
   * @param inputs  ユーザー入力 Map（例: { input: "質問" }）
   * @param outputs LLM 出力 Map（例: { output: "回答" }）
   */
  async save_context(
    inputs: Record<string, unknown>,
    outputs: Record<string, unknown>
  ): Promise<void> {
    const inputText = Object.values(inputs).filter(Boolean).join(" ");
    const outputText = Object.values(outputs).filter(Boolean).join(" ");
    const content = `User: ${inputText}\nAssistant: ${outputText}`;

    await this.client.record({
      project: this.project,
      session_id: this.session_id,
      event_type: "observation",
      payload: {
        title: `会話ログ: ${inputText.slice(0, 60)}`,
        content,
        observation_type: "context",
      },
    });
  }

  /**
   * 関連する会話履歴を検索して返す（LangChain BaseMemory.load_memory_variables 互換）。
   *
   * @param inputs 現在の入力 Map（クエリとして使用）
   * @returns { [memory_key]: string } 形式の記憶変数
   */
  async load_memory_variables(
    inputs: Record<string, unknown>
  ): Promise<Record<string, string>> {
    const query = Object.values(inputs).filter(Boolean).join(" ");

    const response = await this.client.search({
      query: query || "*",
      project: this.project,
      session_id: this.session_id,
      limit: this.searchLimit,
    });

    const history = response.items
      .map((item: SearchResultItem) => {
        const title = item.title ? `[${item.title}] ` : "";
        return `${title}${item.content}`;
      })
      .join("\n---\n");

    return { [this.memory_key]: history };
  }

  /**
   * 記憶をクリアする（LangChain BaseMemory.clear 互換）。
   * harness-mem では観察は保持され続けるため、このメソッドは no-op。
   */
  async clear(): Promise<void> {
    // harness-mem は append-only なのでクリアは行わない
  }
}

// ---- LlamaIndex 互換 ----

export interface LlamaIndexMemoryOptions {
  /** harness-mem クライアント */
  client: HarnessMemClientLike;
  /** プロジェクト名 */
  project: string;
  /** セッション ID */
  session_id: string;
  /** 検索時の最大取得件数。デフォルト: 10 */
  search_limit?: number;
}

/** LlamaIndex ChatMessage に対応する型 */
export interface ChatMessage {
  role: "user" | "assistant" | "system" | string;
  content: string;
  [key: string]: unknown;
}

/**
 * LlamaIndex Memory 互換クラス。
 *
 * LlamaIndex の `BaseChatStoreMemory` / `SimpleMemory` に近い API
 * （put / get / getAll）を実装し、harness-mem にメッセージを永続化する。
 */
export class HarnessMemLlamaIndexMemory {
  private readonly client: HarnessMemClientLike;
  private readonly project: string;
  private readonly session_id: string;
  private readonly searchLimit: number;

  constructor(options: LlamaIndexMemoryOptions) {
    this.client = options.client;
    this.project = options.project;
    this.session_id = options.session_id;
    this.searchLimit = options.search_limit ?? 10;
  }

  /**
   * メッセージを記録する（LlamaIndex Memory.put 互換）。
   *
   * @param message ChatMessage オブジェクト
   */
  async put(message: ChatMessage): Promise<void> {
    const roleLabel = message.role === "user" ? "User" : "Assistant";
    await this.client.record({
      project: this.project,
      session_id: this.session_id,
      event_type: "observation",
      payload: {
        title: `${roleLabel}: ${String(message.content).slice(0, 60)}`,
        content: `${roleLabel}: ${message.content}`,
        observation_type: "context",
      },
    });
  }

  /**
   * クエリに関連するメッセージを取得する（LlamaIndex Memory.get 互換）。
   *
   * @param query  検索クエリ文字列
   * @returns      関連する ChatMessage の配列
   */
  async get(query: string): Promise<ChatMessage[]> {
    const response = await this.client.search({
      query: query || "*",
      project: this.project,
      session_id: this.session_id,
      limit: this.searchLimit,
    });

    return response.items.map((item: SearchResultItem) => ({
      role: "assistant",
      content: item.content,
      id: item.id,
      created_at: item.created_at,
    }));
  }

  /**
   * すべての記録を取得する（LlamaIndex Memory.getAll 互換）。
   * harness-mem では時系列で最新のものを返す。
   *
   * @returns ChatMessage の配列
   */
  async getAll(): Promise<ChatMessage[]> {
    return this.get("*");
  }
}
