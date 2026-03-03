/**
 * NEXT-009: LangChain Memory 互換レイヤー
 *
 * HarnessMemLangChainMemory は LangChain の BaseMemory と同等のインターフェースを実装し、
 * harness-mem をバックエンドに使った長期記憶を提供する。
 *
 * LangChain BaseMemory 相当インターフェース:
 * - memoryVariables: string[]      — どの変数名を返すか
 * - saveContext(inputs, outputs)   — 入力・出力をメモリに保存
 * - loadMemoryVariables(inputs)    — クエリに関連するメモリを取得
 * - clear()                        — メモリをクリア（harness-mem はサーバー管理のため no-op）
 */

import { HarnessMemClient } from "./client.js";
import type { HarnessMemClientOptions, SearchResultItem } from "./types.js";

export interface HarnessMemLangChainMemoryOptions extends HarnessMemClientOptions {
  /** ハーネスメムのプロジェクト名 */
  project: string;
  /** ハーネスメムのセッションID */
  session_id: string;
  /** 返却するメモリ変数名 (デフォルト: "history") */
  memoryKey?: string;
  /** 検索時に取得する最大件数 (デフォルト: 5) */
  searchLimit?: number;
  /** 検索結果をフォーマットする関数 */
  formatHistory?: (items: SearchResultItem[]) => string;
}

/**
 * LangChain の BaseMemory と互換性のある harness-mem メモリ実装。
 *
 * @example
 * ```typescript
 * const memory = new HarnessMemLangChainMemory({
 *   project: "my-project",
 *   session_id: "session-123",
 * });
 *
 * // LangChain チェーンに渡す
 * const chain = new LLMChain({ llm, prompt, memory });
 * ```
 */
export class HarnessMemLangChainMemory {
  private readonly client: HarnessMemClient;
  private readonly project: string;
  private readonly session_id: string;
  private readonly memoryKey: string;
  private readonly searchLimit: number;
  private readonly formatHistoryFn: (items: SearchResultItem[]) => string;

  constructor(options: HarnessMemLangChainMemoryOptions) {
    const { project, session_id, memoryKey, searchLimit, formatHistory, ...clientOptions } = options;
    this.client = new HarnessMemClient(clientOptions);
    this.project = project;
    this.session_id = session_id;
    this.memoryKey = memoryKey ?? "history";
    this.searchLimit = searchLimit ?? 5;
    this.formatHistoryFn = formatHistory ?? defaultFormatHistory;
  }

  /** LangChain BaseMemory.memoryVariables: 返す変数名のリスト */
  get memoryVariables(): string[] {
    return [this.memoryKey];
  }

  /**
   * LangChain BaseMemory.saveContext: 入出力ペアをメモリに保存する。
   * input の内容と output の内容を結合してハーネスメムに記録する。
   */
  async saveContext(
    inputs: Record<string, string>,
    outputs: Record<string, string>
  ): Promise<void> {
    const inputText = Object.values(inputs).filter(Boolean).join("\n");
    const outputText = Object.values(outputs).filter(Boolean).join("\n");

    if (!inputText && !outputText) {
      return;
    }

    const content = [
      inputText ? `Human: ${inputText}` : "",
      outputText ? `AI: ${outputText}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    await this.client.record({
      project: this.project,
      session_id: this.session_id,
      event_type: "conversation_turn",
      payload: {
        title: inputText.slice(0, 120) || "conversation turn",
        content,
        observation_type: "context",
      },
    });
  }

  /**
   * LangChain BaseMemory.loadMemoryVariables: クエリに関連するメモリを返す。
   * inputs に含まれるテキストで harness-mem を検索し、関連する記憶を history 変数として返す。
   */
  async loadMemoryVariables(
    inputs: Record<string, string>
  ): Promise<Record<string, string>> {
    const query = Object.values(inputs).filter(Boolean).join(" ");

    if (!query.trim()) {
      return { [this.memoryKey]: "" };
    }

    const result = await this.client.search({
      query,
      project: this.project,
      session_id: this.session_id,
      limit: this.searchLimit,
    });

    if (!result.ok || result.items.length === 0) {
      return { [this.memoryKey]: "" };
    }

    const history = this.formatHistoryFn(result.items as SearchResultItem[]);
    return { [this.memoryKey]: history };
  }

  /**
   * LangChain BaseMemory.clear: メモリをクリアする。
   * harness-mem はサーバー側で永続管理するため、クライアント側では no-op とする。
   * 必要な場合は harness-mem の管理 API を直接使用してください。
   */
  async clear(): Promise<void> {
    // no-op: harness-mem はサーバー側で管理される
  }
}

/**
 * デフォルトの履歴フォーマット関数。
 * 検索結果を時系列順に連結したテキストとして返す。
 */
function defaultFormatHistory(items: SearchResultItem[]): string {
  return items
    .map((item) => item.content)
    .filter(Boolean)
    .join("\n---\n");
}
