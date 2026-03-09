/**
 * IngesterRegistry — PlatformIngester の集中管理クラス
 *
 * 新しい ingester の追加は createDefaultRegistry() への1行追加で完了する。
 */

import type { PlatformIngester } from "./types.js";

import { AntigravityFilesIngester } from "./antigravity-files.js";
import { AntigravityLogsIngester } from "./antigravity-logs.js";
import { AudioIngester, type AudioIngesterConfig } from "./audio-ingester.js";
import { ClaudeCodeSessionsIngester } from "./claude-code-sessions.js";
import { ClaudeMemImportIngester } from "./claude-mem-import.js";
import { CodexHistoryIngester } from "./codex-history.js";
import { CodexSessionsIngester } from "./codex-sessions.js";
import { CursorHooksIngester } from "./cursor-hooks.js";
import { DocumentParserIngester } from "./document-parser.js";
import { GeminiEventsIngester } from "./gemini-events.js";
import { NotionGdriveIngester } from "./notion-gdrive-connector.js";
import { OpencodeDbIngester } from "./opencode-db.js";
import { OpencodeStorageIngester } from "./opencode-storage.js";
import { UrlConnectorIngester } from "./url-connector.js";

export class IngesterRegistry {
  private readonly ingesters = new Map<string, PlatformIngester>();

  register(ingester: PlatformIngester): void {
    this.ingesters.set(ingester.name, ingester);
  }

  get(name: string): PlatformIngester | undefined {
    return this.ingesters.get(name);
  }

  getAll(): PlatformIngester[] {
    return Array.from(this.ingesters.values());
  }

  has(name: string): boolean {
    return this.ingesters.has(name);
  }
}

/**
 * デフォルトの全 ingester を登録した IngesterRegistry を返すファクトリ関数。
 * 新しい ingester を追加する場合は、ここに1行 registry.register() を追加するだけでよい。
 */
export function createDefaultRegistry(): IngesterRegistry {
  const registry = new IngesterRegistry();

  registry.register(new AntigravityFilesIngester());
  registry.register(new AntigravityLogsIngester());
  const audioConfig: AudioIngesterConfig = { provider: "whisper-local" };
  registry.register(new AudioIngester(audioConfig));
  registry.register(new ClaudeCodeSessionsIngester());
  registry.register(new ClaudeMemImportIngester());
  registry.register(new CodexHistoryIngester());
  registry.register(new CodexSessionsIngester());
  registry.register(new CursorHooksIngester());
  registry.register(new DocumentParserIngester());
  registry.register(new GeminiEventsIngester());
  registry.register(new NotionGdriveIngester());
  registry.register(new OpencodeDbIngester());
  registry.register(new OpencodeStorageIngester());
  registry.register(new UrlConnectorIngester());

  return registry;
}
