/**
 * COMP-008: URL コネクター
 * 公開URLからHTMLコンテンツを取得して観察として取り込む。
 * SSRF防止: プライベート/予約済みIPアドレスへのリクエストをブロック。
 * robots.txt 尊重: Disallow ルールに従いフェッチをスキップ。
 */

import { parseHtmlText, ingestDocument, type IngestDocumentResult } from "./document-parser";
import type { HarnessMemCore } from "../core/harness-mem-core";

export interface UrlValidationResult {
  ok: boolean;
  error?: string;
}

/**
 * IPアドレスがプライベート/予約済みレンジかどうかを判定する。
 * 対象: 127.0.0.0/8, 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16,
 *       169.254.0.0/16 (link-local), ::1 (IPv6 loopback)
 */
export function isPrivateOrReservedHost(host: string): boolean {
  // IPv6 ループバック
  if (host === "::1" || host === "0:0:0:0:0:0:0:1") {
    return true;
  }

  // IPv4 の場合のみチェック
  const ipv4Pattern = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
  const match = host.match(ipv4Pattern);
  if (!match) {
    // ドメイン名は公開扱い（DNS解決後のチェックは別途必要）
    // localhost は明示的にチェック
    return host.toLowerCase() === "localhost" || host.toLowerCase() === "ip6-localhost";
  }

  const [, a, b, c] = match.map(Number);

  // 127.0.0.0/8 (loopback)
  if (a === 127) return true;
  // 10.0.0.0/8
  if (a === 10) return true;
  // 172.16.0.0/12 (172.16.x.x - 172.31.x.x)
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16
  if (a === 192 && b === 168) return true;
  // 169.254.0.0/16 (link-local / AWS metadata)
  if (a === 169 && b === 254) return true;
  // 0.0.0.0
  if (a === 0 && b === 0 && c === 0) return true;

  return false;
}

/** URLをフェッチ前に検証する。SSRF防止チェックを含む。 */
export function validateUrlForFetch(urlString: string): UrlValidationResult {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    return { ok: false, error: "Invalid URL format" };
  }

  // http/https のみ許可
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: `Unsupported protocol: ${url.protocol}. Only http/https allowed.` };
  }

  const hostname = url.hostname;

  // SSRF 防止: プライベート/予約済みホストをブロック
  if (isPrivateOrReservedHost(hostname)) {
    return {
      ok: false,
      error: `SSRF blocked: host "${hostname}" is a private or reserved address`,
    };
  }

  return { ok: true };
}

/** robots.txt を解析してパスが Disallow かどうかを確認する */
async function isAllowedByRobots(baseUrl: string, path: string, userAgent = "*"): Promise<boolean> {
  const robotsUrl = `${baseUrl}/robots.txt`;
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5_000);
    const response = await fetch(robotsUrl, {
      signal: controller.signal,
      headers: { "User-Agent": "harness-mem-bot/1.0" },
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      // robots.txt がない場合はアクセス許可
      return true;
    }

    const text = await response.text();
    return !isPathDisallowed(text, path, userAgent);
  } catch {
    // エラー時はアクセス許可（保守的アプローチ）
    return true;
  }
}

/** robots.txt テキストからパスが Disallow かどうかを判定 */
function isPathDisallowed(robotsTxt: string, path: string, userAgent: string): boolean {
  const lines = robotsTxt.split("\n").map((l) => l.trim());
  let currentAgentMatches = false;

  for (const line of lines) {
    if (line.startsWith("#") || !line) {
      continue;
    }

    const colonIdx = line.indexOf(":");
    if (colonIdx < 0) continue;

    const field = line.slice(0, colonIdx).trim().toLowerCase();
    const value = line.slice(colonIdx + 1).trim();

    if (field === "user-agent") {
      currentAgentMatches = value === "*" || value.toLowerCase() === userAgent.toLowerCase();
    } else if (field === "disallow" && currentAgentMatches && value) {
      if (path.startsWith(value)) {
        return true;
      }
    }
  }

  return false;
}

export interface FetchUrlOptions {
  core: HarnessMemCore;
  url: string;
  project: string;
  session_id: string;
  respect_robots?: boolean;
  timeout_ms?: number;
}

export interface FetchUrlResult extends IngestDocumentResult {
  url: string;
  status_code?: number;
  robots_blocked?: boolean;
}

/** URLからコンテンツを取得して観察として取り込む */
export async function fetchAndIngestUrl(options: FetchUrlOptions): Promise<FetchUrlResult> {
  const { core, url: urlString, project, session_id, respect_robots = true, timeout_ms = 10_000 } = options;

  // SSRF 検証
  const validation = validateUrlForFetch(urlString);
  if (!validation.ok) {
    return {
      ok: false,
      url: urlString,
      chunks_processed: 0,
      observations_created: 0,
      error: validation.error,
    };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(urlString);
  } catch {
    return { ok: false, url: urlString, chunks_processed: 0, observations_created: 0, error: "Invalid URL" };
  }

  // robots.txt チェック
  if (respect_robots) {
    const baseUrl = `${parsedUrl.protocol}//${parsedUrl.host}`;
    const allowed = await isAllowedByRobots(baseUrl, parsedUrl.pathname);
    if (!allowed) {
      return {
        ok: false,
        url: urlString,
        chunks_processed: 0,
        observations_created: 0,
        robots_blocked: true,
        error: "Blocked by robots.txt",
      };
    }
  }

  // フェッチ
  let htmlContent: string;
  let statusCode: number;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout_ms);
    const response = await fetch(urlString, {
      signal: controller.signal,
      headers: {
        "User-Agent": "harness-mem-bot/1.0 (+https://github.com/tachiban/harness-mem)",
        "Accept": "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.8",
      },
    });
    clearTimeout(timeoutId);

    statusCode = response.status;

    if (!response.ok) {
      return {
        ok: false,
        url: urlString,
        chunks_processed: 0,
        observations_created: 0,
        status_code: statusCode,
        error: `HTTP ${statusCode}: fetch failed`,
      };
    }

    const contentType = response.headers.get("content-type") || "";
    const isHtml = contentType.includes("text/html") || contentType.includes("application/xhtml");
    htmlContent = await response.text();

    const format = isHtml ? "html" : "text";
    const ingestResult = await ingestDocument({
      core,
      content: htmlContent,
      format,
      project,
      session_id,
      source_title: parsedUrl.hostname + parsedUrl.pathname,
    });

    return {
      ...ingestResult,
      url: urlString,
      status_code: statusCode,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      url: urlString,
      chunks_processed: 0,
      observations_created: 0,
      error: `Fetch error: ${errorMsg}`,
    };
  }
}
