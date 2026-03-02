/**
 * NEXT-014: MCP 認証自動注入
 *
 * MCP 接続時に user_id / team_id を自動解決する。
 * 優先順位:
 * 1. 環境変数（HARNESS_MEM_USER_ID / HARNESS_MEM_TEAM_ID）
 * 2. config の tokenMap からの解決
 * 3. システムユーザー名（USER / LOGNAME 環境変数）
 * 4. hostname フォールバック
 */

import * as os from "os";

export interface AuthInjectionConfig {
  /** user_id → team_id マッピング */
  tokenMap?: Record<string, string>;
}

export interface AuthIdentity {
  user_id: string;
  team_id: string;
}

export interface ResolveUserIdOptions {
  hostname?: string;
  config?: AuthInjectionConfig;
}

export interface ResolveTeamIdOptions {
  user_id: string;
  config?: AuthInjectionConfig;
}

/**
 * user_id を解決する。
 * 優先順位: HARNESS_MEM_USER_ID > USER/LOGNAME > hostname
 */
export function resolveUserId(options: ResolveUserIdOptions): string {
  const fromEnv = (process.env.HARNESS_MEM_USER_ID || "").trim();
  if (fromEnv) return fromEnv;

  const fromUser = (process.env.USER || process.env.LOGNAME || "").trim();
  if (fromUser) return fromUser;

  if (options.hostname) return options.hostname;

  try {
    const hostname = os.hostname();
    return hostname || "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * team_id を解決する。
 * 優先順位: HARNESS_MEM_TEAM_ID > tokenMap[user_id] > user_id
 */
export function resolveTeamId(options: ResolveTeamIdOptions): string {
  const fromEnv = (process.env.HARNESS_MEM_TEAM_ID || "").trim();
  if (fromEnv) return fromEnv;

  if (options.config?.tokenMap) {
    const mapped = options.config.tokenMap[options.user_id];
    if (mapped) return mapped;
  }

  return options.user_id;
}

/**
 * 現在の環境から AuthIdentity（user_id + team_id）を解決する。
 */
export function resolveAuthIdentity(options: { hostname?: string; config?: AuthInjectionConfig }): AuthIdentity {
  const user_id = resolveUserId(options);
  const team_id = resolveTeamId({ user_id, config: options.config });
  return { user_id, team_id };
}

/**
 * MCP サーバー起動時に認証情報を環境変数として自動注入する。
 * すでに設定済みの場合はスキップする。
 */
export function injectAuthFromEnvironment(config?: AuthInjectionConfig): AuthIdentity {
  const identity = resolveAuthIdentity({ config });

  if (!process.env.HARNESS_MEM_USER_ID) {
    process.env.HARNESS_MEM_USER_ID = identity.user_id;
  }
  if (!process.env.HARNESS_MEM_TEAM_ID) {
    process.env.HARNESS_MEM_TEAM_ID = identity.team_id;
  }

  return identity;
}
