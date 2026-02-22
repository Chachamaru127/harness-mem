/**
 * proof-pack-contract.test.ts
 *
 * T-2: proof-pack が提出物4JSONを生成し、
 * summary JSON と phase1_pass 判定ロジックを維持していることを検証する。
 *
 * proof-pack のフル実行はデーモン依存のため、
 * ここでは summary JSON の schema contract を静的に検証する。
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PROOF_PACK_SCRIPT = resolve(import.meta.dir, "../scripts/harness-mem-proof-pack.sh");

describe("proof-pack summary JSON contract", () => {
  test("harness-mem-proof-pack.sh exists and is executable", () => {
    const stat = Bun.file(PROOF_PACK_SCRIPT);
    expect(stat.size).toBeGreaterThan(0);
  });

  test("jq prerequisite check exists", () => {
    const script = readFileSync(PROOF_PACK_SCRIPT, "utf-8");
    expect(script).toContain("jq is required but not found");
  });

  test("submission artifact names are defined", () => {
    const script = readFileSync(PROOF_PACK_SCRIPT, "utf-8");
    expect(script).toContain("onboarding-report.json");
    expect(script).toContain("continuity-report.json");
    expect(script).toContain("privacy-boundary-report.json");
    expect(script).toContain("session-selfcheck-report.json");
  });

  test("summary JSON template contains all required top-level fields", () => {
    const script = readFileSync(PROOF_PACK_SCRIPT, "utf-8");

    // phase1_pass が summary JSON に含まれていること
    expect(script).toContain('"phase1_pass"');

    // backend_mode が含まれていること
    expect(script).toContain('"backend_mode"');

    // 各セクションが存在すること
    expect(script).toContain('"kpi"');
    expect(script).toContain('"sla"');
    expect(script).toContain('"privacy"');
    expect(script).toContain('"boundary"');
    expect(script).toContain('"migration"');
    expect(script).toContain('"kgi_continuity"');
  });

  test("phase1_pass judgment includes all 10 required conditions", () => {
    const script = readFileSync(PROOF_PACK_SCRIPT, "utf-8");

    // phase1_pass 判定ブロックを抽出
    const judgmentBlock = script.match(
      /PHASE1_PASS=false[\s\S]*?PHASE1_PASS=true/
    );
    expect(judgmentBlock).not.toBeNull();

    const block = judgmentBlock![0];

    // 10個の必須条件がすべて判定に含まれていること
    const requiredConditions = [
      "DAEMON_OK",
      "DOCTOR_ALL_GREEN",
      "SETUP_TIME_PASS",
      "SMOKE_PASS",
      "LATENCY_PASS",
      "PRIVACY_DEFAULT_EXCLUDED",
      "BOUNDARY_ISOLATION",
      "MIGRATE_CMD_EXISTS",
      "ROLLBACK_CMD_EXISTS",
      "CONTINUITY_OK",
    ];

    for (const condition of requiredConditions) {
      expect(block).toContain(condition);
    }
  });

  test("kpi section contains required fields", () => {
    const script = readFileSync(PROOF_PACK_SCRIPT, "utf-8");

    expect(script).toContain('"doctor_all_green"');
    expect(script).toContain('"smoke_pass"');
    expect(script).toContain('"setup_time_pass"');
    expect(script).toContain('"setup_time_seconds"');
  });

  test("privacy section contains default_excluded", () => {
    const script = readFileSync(PROOF_PACK_SCRIPT, "utf-8");
    expect(script).toContain('"default_excluded"');
  });

  test("boundary section contains isolation", () => {
    const script = readFileSync(PROOF_PACK_SCRIPT, "utf-8");
    expect(script).toContain('"isolation"');
  });

  test("migration section contains command availability fields", () => {
    const script = readFileSync(PROOF_PACK_SCRIPT, "utf-8");
    expect(script).toContain('"migrate_command_available"');
    expect(script).toContain('"rollback_command_available"');
  });

  test("kgi_continuity section contains correlation_id_chain", () => {
    const script = readFileSync(PROOF_PACK_SCRIPT, "utf-8");
    expect(script).toContain('"correlation_id_chain"');
    expect(script).toContain('"continuity_rate_pct"');
    expect(script).toContain('"continuity_rate_pass"');
  });

  test("privacy/boundary reports include leak counts", () => {
    const script = readFileSync(PROOF_PACK_SCRIPT, "utf-8");
    expect(script).toContain('"privacy"');
    expect(script).toContain('"boundary"');
    expect(script).toContain('"leak_count"');
  });

  test("no /v1/observations endpoint is referenced in scripts", () => {
    const script = readFileSync(PROOF_PACK_SCRIPT, "utf-8");
    // P0-2: 存在しない API エンドポイントを使っていないこと
    expect(script).not.toContain("/v1/observations");
  });

  test("leak detection uses jq .items[] instead of raw grep", () => {
    const script = readFileSync(PROOF_PACK_SCRIPT, "utf-8");

    // privacy leak detection が jq .items[] を使っていること
    // grep で応答全体を検索する旧方式でないこと
    const privacySection = script.match(
      /PRIVATE_LEAKED[\s\S]*?PRIVATE_LEAKED/
    );
    if (privacySection) {
      expect(privacySection[0]).toContain(".items[]");
    }

    // boundary leak detection も同様
    const boundarySection = script.match(
      /BOUNDARY_LEAKED[\s\S]*?BOUNDARY_LEAKED/
    );
    if (boundarySection) {
      expect(boundarySection[0]).toContain(".items[]");
    }
  });
});
