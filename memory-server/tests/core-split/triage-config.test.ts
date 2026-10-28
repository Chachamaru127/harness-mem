/**
 * T1: triage 設定の契約テスト
 *
 * getConfig() が HARNESS_MEM_TRIAGE_* / HARNESS_MEM_CLOUD_LLM / CLOUDFLARE_* を
 * 環境変数から解決する。既定は triage off、threshold 0.3、concurrency 4、
 * timeout 30000ms。cloud への egress は HARNESS_MEM_CLOUD_LLM が trim 後
 * 完全に "1" のときだけ許可する。
 *
 * 各テストは対象 env を snapshot し、afterEach で必ず元に戻す。
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { __resetUserConfigCache, getConfig } from "../../src/core/core-utils";

const ENV_KEYS = [
  "HARNESS_MEM_TRIAGE_ENABLED",
  "HARNESS_MEM_TRIAGE_MODEL",
  "HARNESS_MEM_TRIAGE_THRESHOLD",
  "HARNESS_MEM_TRIAGE_CONCURRENCY",
  "HARNESS_MEM_TRIAGE_TIMEOUT_MS",
  "HARNESS_MEM_SUMMARY_ENABLED",
  "HARNESS_MEM_SUMMARY_BACKEND",
  "HARNESS_MEM_SUMMARY_MODEL",
  "HARNESS_MEM_SUMMARY_ENDPOINT",
  "HARNESS_MEM_SUMMARY_INTERVAL_MS",
  "HARNESS_MEM_SUMMARY_MAX_SESSIONS",
  "HARNESS_MEM_SUMMARY_MAX_SOURCES",
  "HARNESS_MEM_CLAIRIC_ENABLED",
  "HARNESS_MEM_CLAIRIC_MODEL",
  "HARNESS_MEM_CLOUD_LLM",
  "CLOUDFLARE_ACCOUNT_ID",
  "CLOUDFLARE_API_TOKEN",
  "HARNESS_MEM_CONFIG_PATH",
] as const;

let snapshot: Record<string, string | undefined> = {};

beforeEach(() => {
  snapshot = {};
  for (const key of ENV_KEYS) {
    snapshot[key] = process.env[key];
    delete process.env[key];
  }
  // 実ユーザーの config.json を読ませない（triage 設定は env のみが正本）。
  process.env.HARNESS_MEM_CONFIG_PATH = "/tmp/harness-mem-t1-missing-config.json";
  __resetUserConfigCache();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = snapshot[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  __resetUserConfigCache();
});

describe("triage config: defaults", () => {
  test("Claude opt-in selects Haiku without changing the default backend", () => {
    expect(getConfig().summaryBackend).toBe("ollama");
    process.env.HARNESS_MEM_SUMMARY_BACKEND = "claude-code";
    expect(getConfig().summaryBackend).toBe("claude-code");
    expect(getConfig().summaryModel).toBe("claude-haiku-5-5");
  });
  test("env 未設定なら off / 既定モデル / 0.3 / 4 / 30000 / cloudflare なし", () => {
    const config = getConfig();
    expect(config.triageEnabled).toBe(false);
    expect(config.triageModel).toBe("typesafe/jev-1.14.0");
    expect(config.triageThreshold).toBe(0.3);
    expect(config.triageConcurrency).toBe(4);
    expect(config.triageTimeoutMs).toBe(30000);
    expect(config.cloudLlmEnabled).toBe(false);
    expect(config.cloudflareAccountId).toBeUndefined();
    expect(config.cloudflareApiToken).toBeUndefined();
  });
});

describe("triage config: threshold", () => {
  test("threshold は 0 未満を 0、1 超を 1 に clamp する", () => {
    process.env.HARNESS_MEM_TRIAGE_THRESHOLD = "-0.5";
    expect(getConfig().triageThreshold).toBe(0);

    process.env.HARNESS_MEM_TRIAGE_THRESHOLD = "1.7";
    expect(getConfig().triageThreshold).toBe(1);
  });

  test("threshold は有効な小数をそのまま保持する", () => {
    process.env.HARNESS_MEM_TRIAGE_THRESHOLD = "0.45";
    expect(getConfig().triageThreshold).toBe(0.45);
  });

  test("threshold が NaN なら既定 0.3 に戻す", () => {
    process.env.HARNESS_MEM_TRIAGE_THRESHOLD = "not-a-number";
    expect(getConfig().triageThreshold).toBe(0.3);
  });
});

describe("triage config: concurrency", () => {
  test("concurrency は 1〜8 に clamp し、範囲内はそのまま使う", () => {
    process.env.HARNESS_MEM_TRIAGE_CONCURRENCY = "0";
    expect(getConfig().triageConcurrency).toBe(1);

    process.env.HARNESS_MEM_TRIAGE_CONCURRENCY = "99";
    expect(getConfig().triageConcurrency).toBe(8);

    process.env.HARNESS_MEM_TRIAGE_CONCURRENCY = "3";
    expect(getConfig().triageConcurrency).toBe(3);
  });
});

describe("triage config: timeout", () => {
  test("timeout は 1000〜120000ms に clamp し、範囲内はそのまま使う", () => {
    process.env.HARNESS_MEM_TRIAGE_TIMEOUT_MS = "10";
    expect(getConfig().triageTimeoutMs).toBe(1000);

    process.env.HARNESS_MEM_TRIAGE_TIMEOUT_MS = "999999999";
    expect(getConfig().triageTimeoutMs).toBe(120000);

    process.env.HARNESS_MEM_TRIAGE_TIMEOUT_MS = "45000";
    expect(getConfig().triageTimeoutMs).toBe(45000);
  });
});

describe("triage config: flags", () => {
  test("triageEnabled は envFlag 相当で真偽を読む（既定 false）", () => {
    process.env.HARNESS_MEM_TRIAGE_ENABLED = "1";
    expect(getConfig().triageEnabled).toBe(true);

    process.env.HARNESS_MEM_TRIAGE_ENABLED = "0";
    expect(getConfig().triageEnabled).toBe(false);

    process.env.HARNESS_MEM_TRIAGE_ENABLED = "false";
    expect(getConfig().triageEnabled).toBe(false);

    delete process.env.HARNESS_MEM_TRIAGE_ENABLED;
    expect(getConfig().triageEnabled).toBe(false);
  });

  test("cloudLlmEnabled は trim 後が完全に \"1\" のときだけ true", () => {
    process.env.HARNESS_MEM_CLOUD_LLM = "1";
    expect(getConfig().cloudLlmEnabled).toBe(true);

    process.env.HARNESS_MEM_CLOUD_LLM = " 1 ";
    expect(getConfig().cloudLlmEnabled).toBe(true);

    process.env.HARNESS_MEM_CLOUD_LLM = "true";
    expect(getConfig().cloudLlmEnabled).toBe(false);

    process.env.HARNESS_MEM_CLOUD_LLM = "01";
    expect(getConfig().cloudLlmEnabled).toBe(false);

    process.env.HARNESS_MEM_CLOUD_LLM = "1\n";
    expect(getConfig().cloudLlmEnabled).toBe(true);

    delete process.env.HARNESS_MEM_CLOUD_LLM;
    expect(getConfig().cloudLlmEnabled).toBe(false);
  });
});

describe("triage config: model and cloudflare credentials", () => {
  test("triageModel は trim し、空文字なら既定に戻す", () => {
    process.env.HARNESS_MEM_TRIAGE_MODEL = "  custom/model-1  ";
    expect(getConfig().triageModel).toBe("custom/model-1");

    process.env.HARNESS_MEM_TRIAGE_MODEL = "   ";
    expect(getConfig().triageModel).toBe("typesafe/jev-1.14.0");
  });

  test("Cloudflare の値は trim し、空文字は undefined にする", () => {
    process.env.CLOUDFLARE_ACCOUNT_ID = "  acc-123  ";
    process.env.CLOUDFLARE_API_TOKEN = "  token-abc  ";
    const filled = getConfig();
    expect(filled.cloudflareAccountId).toBe("acc-123");
    expect(filled.cloudflareApiToken).toBe("token-abc");

    process.env.CLOUDFLARE_ACCOUNT_ID = "";
    process.env.CLOUDFLARE_API_TOKEN = "   ";
    const blank = getConfig();
    expect(blank.cloudflareAccountId).toBeUndefined();
    expect(blank.cloudflareApiToken).toBeUndefined();
  });

});

describe("summary config: T12 defaults and clamps", () => {
  test("summary は既定 off、モデルと間隔は既定値", () => {
    const config = getConfig();
    expect(config.summaryEnabled).toBe(false);
    expect(config.summaryModel).toBe("glm-5.3-flash:cloud");
    expect(config.summaryEndpoint).toBe("http://127.0.0.1:11434");
    expect(config.summaryIntervalMs).toBe(600000);
    expect(config.summaryMaxSessions).toBe(5);
    expect(config.summaryMaxSources).toBe(50);
    expect(config.summaryConcurrency).toBe(2);
    expect(config.clairicEnabled).toBe(true);
    expect(config.clairicModel).toBe("@cf/cloudflare/clairic");
  });

  test("summary の間隔と件数は clamp する", () => {
    process.env.HARNESS_MEM_SUMMARY_INTERVAL_MS = "1000";
    process.env.HARNESS_MEM_SUMMARY_MAX_SESSIONS = "999";
    process.env.HARNESS_MEM_SUMMARY_MAX_SOURCES = "999";
    process.env.HARNESS_MEM_SUMMARY_CONCURRENCY = "99";
    const config = getConfig();
    expect(config.summaryIntervalMs).toBe(60000);
    expect(config.summaryMaxSessions).toBe(200);
    expect(config.summaryMaxSources).toBe(200);
    expect(config.summaryConcurrency).toBe(6);
  });

  test("Clairic は 0 / false でだけ無効になる", () => {
    process.env.HARNESS_MEM_CLAIRIC_ENABLED = "0";
    expect(getConfig().clairicEnabled).toBe(false);
    process.env.HARNESS_MEM_CLAIRIC_ENABLED = "off";
    expect(getConfig().clairicEnabled).toBe(true);
  });
});
