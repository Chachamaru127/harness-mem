/**
 * @harness-mem/sdk - Vercel AI SDK Integration
 *
 * Vercel AI SDK 用の Memory Provider。
 * generateText / streamText の context に harness-mem の記憶を注入する。
 */

import type { HarnessMemClient } from "./client.js";
import type { SearchResultItem } from "./types.js";

/** Vercel AI SDK の Message 型 (外部依存なし) */
export interface VercelAIMessage {
  role: "user" | "assistant" | "system" | string;
  content: string | Array<{ type: string; text?: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

/** HarnessMemVercelProvider のオプション */
export interface VercelProviderOptions {
  /** 検索結果の最大件数。デフォルト: 5 */
  maxResults?: number;
  /** 対象プロジェクト */
  project?: string;
}

/**
 * Vercel AI SDK 用の Memory Provider。
 *
 * @example
 * ```typescript
 * const provider = new HarnessMemVercelProvider(client, { maxResults: 5 });
 *
 * // tool として登録
 * const result = await generateText({
 *   model: ...,
 *   tools: { memory: provider.asTool() },
 *   messages,
 * });
 *
 * // middleware として利用
 * const enrichedMessages = await provider.asMiddleware().transformMessages(messages);
 * ```
 */
export class HarnessMemVercelProvider {
  constructor(
    private readonly client: HarnessMemClient,
    private readonly options: VercelProviderOptions = {}
  ) {}

  /**
   * Vercel AI SDK の tool として登録可能な形式で返す。
   * `generateText` / `streamText` の `tools` オプションに渡せる。
   */
  asTool(): object {
    const self = this;
    return {
      name: "harness_mem_search",
      description: "Search long-term memory for relevant context",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
        },
        required: ["query"],
      },
      execute: async ({ query }: { query: string }) => {
        const response = await self.client.search({
          query,
          limit: self.options.maxResults ?? 5,
          project: self.options.project,
        });
        return response.items;
      },
    };
  }

  /**
   * messages 配列に記憶コンテキストを注入する middleware を返す。
   * 最後のユーザーメッセージをクエリとして使い、system メッセージに記憶を付加する。
   */
  asMiddleware(): {
    transformMessages(messages: VercelAIMessage[]): Promise<VercelAIMessage[]>;
  } {
    const self = this;
    return {
      async transformMessages(messages: VercelAIMessage[]): Promise<VercelAIMessage[]> {
        // 最後のユーザーメッセージからクエリを抽出
        const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
        if (!lastUserMsg) return messages;

        const query =
          typeof lastUserMsg.content === "string"
            ? lastUserMsg.content
            : Array.isArray(lastUserMsg.content)
            ? (lastUserMsg.content.find((c) => c.type === "text")?.text ?? "")
            : "";

        if (!query) return messages;

        const response = await self.client.search({
          query,
          limit: self.options.maxResults ?? 5,
          project: self.options.project,
        });

        if (response.items.length === 0) return messages;

        const memoryContext = response.items
          .map((m: SearchResultItem) => {
            const typeLabel = m.observation_type ?? "context";
            const title = m.title ?? "";
            return `[${typeLabel}] ${title}: ${m.content}`;
          })
          .join("\n");

        // コピーを作って変更
        const enriched: VercelAIMessage[] = messages.map((m) => ({ ...m }));
        const systemMsg = enriched.find((m) => m.role === "system");

        if (systemMsg) {
          systemMsg.content =
            (typeof systemMsg.content === "string" ? systemMsg.content : "") +
            `\n\n## Long-term Memory\n${memoryContext}`;
        } else {
          enriched.unshift({
            role: "system",
            content: `## Long-term Memory\n${memoryContext}`,
          });
        }

        return enriched;
      },
    };
  }
}
