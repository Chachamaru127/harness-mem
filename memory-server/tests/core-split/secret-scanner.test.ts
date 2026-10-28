/**
 * T2: ローカル秘密検査（Stage 0 の egress scanner）
 *
 * 契約: docs/specs/2026-10-living-memory/spec.md §4.5
 *   - privacy tag filter（private / secret / sensitive / legal_hold）
 *   - <private>...</private> ブロック
 *   - PEM 秘密鍵、Bearer、キープレフィックス、代入、長い hex、base64 風文字列
 *   - メール、電話、日付、UUID、URL、日本語、パス、短い hex はブロックしない
 *
 * 30 件の秘密サンプルで 0 件の取りこぼし、30 件の安全サンプルで 0 件の誤ブロックを確認する。
 * ネットワーク呼び出しは無し。
 */

import { describe, expect, test } from "bun:test";
import {
  scanForEgress,
  type EgressScanResult,
} from "../../src/core/secret-scanner";

type Sample = {
  name: string;
  content: string;
  privacyTags?: string[];
};

const PEM_RSA = `-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEA1a2b3c4d5e6f7g8h9i0jK LmNoPqRsTuVwXyZ0123456789abcdef
GhIjKlMnOpQrStUvWxYzAbCdEfGhIjKlMnOpQrStUvWxYz0123456789
-----END RSA PRIVATE KEY-----`;

const PEM_EC = `-----BEGIN EC PRIVATE KEY-----
MHcCAQEEIJ7f3k9d2a4b6c8e0f1a3b5c7d9e2f4a6b8c0d2e4f6a8b0c2d4e6f8
-----END EC PRIVATE KEY-----`;

const PEM_GENERIC = `-----BEGIN PRIVATE KEY-----
MIGkAgEBBDCr7Xk2mQ9pLz4tVb1yNc8sDf6hJk3lPq0wEr5uIo2aSd7fGh1jKl4zXc
-----END PRIVATE KEY-----`;

// ---------------------------------------------------------------------------
// 秘密サンプル 30 件: すべて blocked でなければならない
// ---------------------------------------------------------------------------

const SECRET_SAMPLES: Sample[] = [
  {
    name: "privacy tag: private",
    content: "来週のリリース計画と担当者をまとめた。",
    privacyTags: ["private"],
  },
  {
    name: "privacy tag: secret",
    content: "顧客の契約条件についてのメモ。",
    privacyTags: ["secret", "work"],
  },
  {
    name: "privacy tag: sensitive",
    content: "人事評価の下書き。",
    privacyTags: ["work", "sensitive"],
  },
  {
    name: "privacy tag: legal_hold",
    content: "訴訟関連の記録。",
    privacyTags: ["legal_hold"],
  },
  {
    name: "private block inline",
    content: "接続情報はこちら <private>db_password=hunter2hunter2</private> です。",
  },
  {
    name: "private block with attribute",
    content: '設定 <private reason="credentials">token: abcd1234efgh5678</private> を控えた。',
  },
  {
    name: "PEM RSA private key",
    content: `鍵は次の通り。\n${PEM_RSA}\n以上。`,
  },
  {
    name: "PEM EC private key",
    content: PEM_EC,
  },
  {
    name: "PEM generic private key",
    content: PEM_GENERIC,
  },
  {
    name: "Bearer token",
    content:
      "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdef",
  },
  {
    name: "bearer token lowercase",
    content: 'curl -H "authorization: bearer abcdef1234567890abcdef" https://api.example.com',
  },
  {
    name: "sk- key",
    content: "OPENAI_API_KEY=sk-proj-abcdef0123456789abcdef",
  },
  {
    name: "rk_ key",
    content: "stripe key rk_live_51HabcdefghijklmnopQRST",
  },
  {
    name: "pk_ key",
    content: "publishable pk_test_51HabcdefghijklmnopQRST",
  },
  {
    name: "ghp_ token",
    content: "token ghp" + "_16CharactersLongToken0123456789 を使う",
  },
  {
    name: "gho_ token",
    content: "oauth gho" + "_16CharactersLongToken0123456789",
  },
  {
    name: "ghs_ token",
    content: "server ghs" + "_16CharactersLongToken0123456789",
  },
  {
    name: "ghr_ token",
    content: "refresh ghr" + "_16CharactersLongToken0123456789",
  },
  {
    name: "xoxb token",
    content: "slack xox" + "b-123456789012-123456789012-abcdefghijklmnop",
  },
  {
    name: "xoxp token",
    content: "slack xox" + "p-123456789012-123456789012-abcdefghijklmnop",
  },
  {
    name: "api_key assignment",
    content: 'api_key = "a1b2c3d4e5f6"',
  },
  {
    name: "JSON quoted password key",
    content: '{"password":"ExampleCredential123"}',
  },
  {
    name: "JSON quoted api_key key",
    content: '{"api_key": "ExampleCredential123"}',
  },
  {
    name: "access_token assignment",
    content: "access_token: ya29.a0AfH6SMBxxxxxxxxxxxx",
  },
  {
    name: "secret assignment",
    content: "secret = s3cr3tV4lue",
  },
  {
    name: "password assignment",
    content: "password=hunter2hunter2",
  },
  {
    name: "client_secret assignment",
    content: 'client_secret = "cs_live_abcdef123456"',
  },
  {
    name: "32 hex chars",
    content: "checksum d41d8cd98f00b204e9800998ecf8427e を記録",
  },
  {
    name: "64 hex chars",
    content:
      "digest 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
  },
  {
    name: "base64-like 40 chars",
    content: "payload aB3dE5fG7hI9jK1lM3nO5pQ7rS9tU1vW3xY5zA7bC9d",
  },
  {
    name: "base64-like with padding",
    content: "blob aB3dE5fG7hI9jK1lM3nO5pQ7rS9tU1vW3xY5zA7bC9dE1f2==",
  },
  {
    name: "base64-like inside JSON",
    content:
      '{"client_token":"aB3dE5fG7hI9jK1lM3nO5pQ7rS9tU1vW3xY5zA7bC9d"}',
  },
  {
    name: "email + credential pair",
    content: "ログイン: operator@example.com / hokujob-demo-pass",
  },
  {
    name: "demo-pass token",
    content: "アカウント demo-pass で確認する",
  },
  {
    name: "pass- token",
    content: "初期値 pass-123456 を変更する",
  },
];

// ---------------------------------------------------------------------------
// 安全サンプル 30 件: すべて blocked=false でなければならない
// ---------------------------------------------------------------------------

const SAFE_SAMPLES: Sample[] = [
  { name: "email", content: "連絡先は taro.yamada@example.co.jp です。" },
  {
    name: "two emails",
    content: "宛先: ops-team+alerts@example.com, noreply@example.org",
  },
  { name: "JP phone", content: "電話は 03-1234-5678 です。" },
  { name: "Intl phone", content: "+81 90-1234-5678 までご連絡ください。" },
  { name: "ISO date", content: "2026-10-20 にリリース予定。" },
  { name: "ISO datetime", content: "2026-10-20T09:30:00Z に開始しました。" },
  { name: "UUID", content: "id: 550e8400-e29b-41d4-a716-446655440000" },
  {
    name: "two UUIDs",
    content:
      "from 550e8400-e29b-41d4-a716-446655440000 to 6ba7b810-9dad-11d1-80b4-00c04fd430c8",
  },
  { name: "URL", content: "https://github.com/Chachamaru127/harness-mem" },
  {
    name: "URL with query",
    content: "https://example.com/search?q=memory+retention&page=2",
  },
  {
    name: "URL with long mixed-case path",
    content:
      "https://api.example.com/v2/Organizations/AbCd1234/Repositories/Example/Contents/README.md",
  },
  { name: "short git hash 7", content: "commit 3f2a9c1 を確認した" },
  { name: "short git hash 12", content: "SHA 9b1c4d7e8f0a を cherry-pick" },
  {
    name: "Japanese sentence",
    content: "記憶の圧縮は、保持する情報を減らすことではなく、現在の状態を保つことだ。",
  },
  {
    name: "Japanese paragraph",
    content:
      "一次層は現在の状態だけを持ち、詳細は二次層へ移す。移す前に要約とアーカイブを作り、sha256 を照合する。削除は別の判断であり、ここでは行わない。",
  },
  {
    name: "absolute path",
    content:
      "/Users/example/work/harness-mem/memory-server/src/core/secret-scanner.ts",
  },
  {
    name: "relative path",
    content: "memory-server/tests/core-split/secret-scanner.test.ts",
  },
  {
    name: "windows path",
    content: "C:\\Users\\taro\\Documents\\harness-mem\\README.md",
  },
  { name: "short hex 8", content: "deadbeef" },
  { name: "short hex 16", content: "0123456789abcdef" },
  { name: "short base64", content: "QWxhZGRpbjpvcGVuIHNlc2Ft" },
  {
    name: "prose with the word secret",
    content: "The secret to a small primary layer is aggressive summarization.",
  },
  {
    name: "small JSON",
    content: '{"id": 12345, "name": "living-memory", "enabled": true}',
  },
  {
    name: "code constants",
    content: "const maxRetries = 5; const timeoutMs = 10000;",
  },
  {
    name: "semver with build metadata",
    content: "version 1.0.0-beta.3+build.20261020",
  },
  {
    name: "markdown link",
    content: "[設計メモ](https://example.com/docs/design-notes?v=2)",
  },
  {
    name: "date range",
    content: "期間: 2026-10-01 から 2026-10-20 まで",
  },
  {
    name: "build id in URL",
    content: "https://example.com/builds/1f2e3d4c5b/logs",
  },
  {
    name: "Japanese with numbers",
    content: "2026年10月20日に30件のテストを実行し、すべて成功した。",
  },
  {
    name: "commit line",
    content: "fix: handle overflow (commit 7c1d9ab)",
  },
  {
    name: "password word",
    content: "パスワードは定期的に変更する方針です。",
  },
  {
    name: "passwordless",
    content: "passwordless 認証を検討する。",
  },
  {
    name: "compass",
    content: "compass という名前のツールを使う。",
  },
];

// ---------------------------------------------------------------------------
// ヘルパー
// ---------------------------------------------------------------------------

function scan(sample: Sample): EgressScanResult {
  return scanForEgress(sample.content, sample.privacyTags ?? []);
}

// ---------------------------------------------------------------------------
// テスト
// ---------------------------------------------------------------------------

describe("scanForEgress: 契約", () => {
  test("戻り値は blocked: boolean と reasons: string[] を持つ", () => {
    const result = scanForEgress("普通のメモ", []);
    expect(typeof result.blocked).toBe("boolean");
    expect(Array.isArray(result.reasons)).toBe(true);
    expect(result.blocked).toBe(false);
    expect(result.reasons).toEqual([]);
  });

  test("ブロック時は reason が 1 件以上入り、重複しない", () => {
    const result = scanForEgress(
      "api_key = abcdef123456 と password=zzzzzzzzzzzz と sk-abcdefghijklmnop",
      [],
    );
    expect(result.blocked).toBe(true);
    expect(result.reasons.length).toBeGreaterThanOrEqual(1);
    expect(new Set(result.reasons).size).toBe(result.reasons.length);
  });

  test("privacy tag は大文字小文字を問わずブロックする", () => {
    expect(scanForEgress("本文", ["Private"]).blocked).toBe(true);
    expect(scanForEgress("本文", [" legal_hold "]).blocked).toBe(true);
  });

  test("無関係な privacy tag ではブロックしない", () => {
    expect(scanForEgress("本文", ["work", "project-x"]).blocked).toBe(false);
  });

  test("空文字と空タグはブロックしない", () => {
    expect(scanForEgress("", [])).toEqual({ blocked: false, reasons: [] });
  });
});

describe("scanForEgress: 秘密 35 件を取りこぼさない", () => {
  for (const sample of SECRET_SAMPLES) {
    test(sample.name, () => {
      const result = scan(sample);
      expect(result.blocked).toBe(true);
      expect(result.reasons.length).toBeGreaterThanOrEqual(1);
    });
  }

  test("秘密サンプルは 35 件ある", () => {
    expect(SECRET_SAMPLES.length).toBe(35);
  });
});

describe("scanForEgress: 安全 33 件を誤ブロックしない", () => {
  for (const sample of SAFE_SAMPLES) {
    test(sample.name, () => {
      const result = scan(sample);
      expect({ name: sample.name, result }).toEqual({
        name: sample.name,
        result: { blocked: false, reasons: [] },
      });
    });
  }

  test("安全サンプルは 33 件ある", () => {
    expect(SAFE_SAMPLES.length).toBe(33);
  });
});

describe("scanForEgress: 集計", () => {
  test("取りこぼし 0 件 / 誤ブロック 0 件", () => {
    const missed = SECRET_SAMPLES.filter((sample) => !scan(sample).blocked).map(
      (sample) => sample.name,
    );
    const falseBlocks = SAFE_SAMPLES.filter((sample) => scan(sample).blocked).map(
      (sample) => sample.name,
    );
    expect({ missed, falseBlocks }).toEqual({ missed: [], falseBlocks: [] });
  });
});
