/**
 * TEAM-004: マルチトークン認証
 *
 * config.json の auth セクションに定義されたトークンマップで
 * Bearer Token を user_id / team_id / role に解決する。
 */
import { timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";

export type TokenRole = "admin" | "member";

export interface TokenEntry {
  user_id: string;
  team_id?: string;
  role: TokenRole;
}

export interface ResolvedIdentity {
  user_id: string;
  team_id?: string;
  role: TokenRole;
}

export interface AuthConfig {
  admin_token: string;
  tokens: Record<string, TokenEntry>;
}

/**
 * Bearer Token を AuthConfig に照合して ResolvedIdentity を返す。
 * - admin_token と一致 → { user_id: "admin", role: "admin" }
 * - tokens マップに一致 → 対応する TokenEntry
 * - 一致なし or 空 → null
 *
 * タイミング攻撃対策として timingSafeEqual を使用。
 */
export function resolveTokenIdentity(
  token: string,
  config: AuthConfig
): ResolvedIdentity | null {
  if (!token) return null;

  // admin_token チェック
  const adminToken = (config.admin_token || "").trim();
  if (adminToken && token.length === adminToken.length) {
    if (timingSafeEqual(Buffer.from(token), Buffer.from(adminToken))) {
      return { user_id: "admin", role: "admin" };
    }
  }

  // ユーザートークンマップを検索
  for (const [mapToken, entry] of Object.entries(config.tokens || {})) {
    if (!mapToken || token.length !== mapToken.length) continue;
    if (timingSafeEqual(Buffer.from(token), Buffer.from(mapToken))) {
      return {
        user_id: entry.user_id,
        team_id: entry.team_id,
        role: entry.role,
      };
    }
  }

  return null;
}

/**
 * config.json ファイルから auth セクションを読み取る。
 * ファイルが存在しないか auth セクションがない場合は null を返す。
 */
export function loadAuthConfig(configPath: string): AuthConfig | null {
  try {
    const raw = readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw);
    if (typeof parsed === "object" && parsed !== null && parsed.auth) {
      const auth = parsed.auth;
      return {
        admin_token: String(auth.admin_token || ""),
        tokens: typeof auth.tokens === "object" && auth.tokens !== null
          ? auth.tokens as Record<string, TokenEntry>
          : {},
      };
    }
  } catch {
    // ファイルが存在しない、またはパースエラー
  }
  return null;
}

/**
 * リクエストヘッダーから Bearer Token を抽出する。
 * Authorization: Bearer <token> または x-harness-mem-token ヘッダーに対応。
 */
export function extractBearerToken(request: Request): string {
  const rawAuth = request.headers.get("authorization");
  const bearer = rawAuth?.startsWith("Bearer ") ? rawAuth.slice(7).trim() : "";
  return request.headers.get("x-harness-mem-token") || bearer || "";
}
