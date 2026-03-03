/**
 * @harness-mem/sdk - Setup CLI Helper
 *
 * 各 AI クライアントに harness-mem MCP サーバーの設定を注入するユーティリティ。
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

/** サポートするクライアント */
export type SupportedClient = "claude" | "cursor" | "windsurf" | "cline";

/** setupClient の結果 */
export interface SetupResult {
  client: SupportedClient;
  configPath: string;
  /** 既存設定に追記した場合 true、新規作成の場合 false */
  merged: boolean;
}

/** harness-mem MCP サーバーの設定エントリ */
const HARNESS_MEM_MCP_ENTRY = {
  command: "npx",
  args: ["harness-mem", "mcp"],
  env: {},
};

/**
 * 各クライアントの MCP 設定ファイルパスを返す。
 */
function getConfigPath(client: SupportedClient): string {
  const home = homedir();
  switch (client) {
    case "claude":
      // Claude Desktop: ~/Library/Application Support/Claude/claude_desktop_config.json (macOS)
      // Linux: ~/.config/Claude/claude_desktop_config.json
      if (process.platform === "darwin") {
        return join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
      }
      return join(home, ".config", "Claude", "claude_desktop_config.json");

    case "cursor":
      // Cursor: ~/.cursor/mcp.json
      return join(home, ".cursor", "mcp.json");

    case "windsurf":
      // Windsurf: ~/.codeium/windsurf/mcp_config.json
      return join(home, ".codeium", "windsurf", "mcp_config.json");

    case "cline":
      // Cline (VS Code 拡張): ~/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/settings/cline_mcp_settings.json
      if (process.platform === "darwin") {
        return join(
          home,
          "Library",
          "Application Support",
          "Code",
          "User",
          "globalStorage",
          "saoudrizwan.claude-dev",
          "settings",
          "cline_mcp_settings.json"
        );
      }
      return join(
        home,
        ".config",
        "Code",
        "User",
        "globalStorage",
        "saoudrizwan.claude-dev",
        "settings",
        "cline_mcp_settings.json"
      );

    default: {
      const _exhaustive: never = client;
      throw new Error(`Unsupported client: ${_exhaustive}`);
    }
  }
}

/**
 * 既存の JSON 設定ファイルを読み込む。存在しない場合は空オブジェクトを返す。
 */
function readJson(filePath: string): Record<string, unknown> {
  if (!existsSync(filePath)) return {};
  try {
    return JSON.parse(readFileSync(filePath, "utf-8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

/**
 * 指定クライアントの MCP 設定に harness-mem を追加する。
 *
 * @param client - 設定対象のクライアント
 * @param serverUrl - harness-mem サーバー URL（任意）
 * @returns SetupResult
 *
 * @example
 * ```typescript
 * const result = await setupClient('claude');
 * console.log(`設定を書き込みました: ${result.configPath}`);
 * ```
 */
export function setupClient(
  client: SupportedClient,
  _serverUrl = "http://localhost:37888"
): SetupResult {
  const configPath = getConfigPath(client);
  const configDir = dirname(configPath);

  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true });
  }

  const existing = readJson(configPath);
  const merged = Object.keys(existing).length > 0;

  // mcpServers キーに harness-mem を追加
  const mcpServers = (existing["mcpServers"] as Record<string, unknown> | undefined) ?? {};
  mcpServers["harness-mem"] = HARNESS_MEM_MCP_ENTRY;
  existing["mcpServers"] = mcpServers;

  writeFileSync(configPath, JSON.stringify(existing, null, 2) + "\n", "utf-8");

  return { client, configPath, merged };
}
