import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CJK_BASELINE_FREEZE_MIN_TOP1,
  isDeepFreshnessBenchEnabled,
  reconcileDeveloperDomainManifest,
  resolveCjkBaseline,
} from "../../scripts/s108-developer-domain-manifest";

describe("S108-005b developer-domain manifest reconciliation", () => {
  test("writes S108 dev-workflow and temporal planner metrics into the CI manifest", async () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-mem-s108-manifest-test-"));
    const manifestPath = join(dir, "ci-run-manifest-latest.json");
    try {
      writeFileSync(
        manifestPath,
        `${JSON.stringify({
          generated_at: "2026-04-10T08:10:51.561Z",
          git_sha: "test",
          results: {
            all_passed: true,
            bilingual_recall: 0.88,
            freshness: 1,
            temporal: 0.6458,
          },
        }, null, 2)}\n`,
        "utf8",
      );

      const report = await reconcileDeveloperDomainManifest({
        manifestPath,
        codeTokenRuns: 1,
        temporalMaxCases: 12,
        writeArtifacts: false,
        now: new Date("2026-05-27T00:00:00.000Z"),
      });
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, any>;

      expect(report.schema_version).toBe("s108-developer-domain-manifest.v1");
      expect(report.overall_passed).toBe(true);
      // S154-305: flagship KPI leads the report and is enforced as a gate.
      expect(Object.keys(report)[0]).toBe("flagship_kpi");
      expect(report.flagship_kpi.name).toBe("bilingual_coding_memory_freshness_at_k");
      expect(report.flagship_kpi.value).toBe(1);
      expect(report.flagship_kpi.green).toBe(true);
      expect(report.flagship_kpi.freshness_source).toBe("ci-run-manifest results.freshness");
      expect(report.flagship_kpi.evidence.current_stale_answer_regressions).toBe(0);
      expect(report.gates.flagship_freshness).toBe(true);
      expect(manifest.results.dev_workflow_recall).toBeGreaterThanOrEqual(0.70);
      expect(manifest.results.temporal).toBeGreaterThanOrEqual(0.70);
      expect(manifest.results.cjk_discrimination_min_top1).toBe(1);
      expect(manifest.developer_domain_reconciliation.task_id).toBe("S108-005b");
      expect(manifest.developer_domain_reconciliation.metrics.temporal_order_score).toBe(manifest.results.temporal);
      expect(manifest.developer_domain_reconciliation.gates.cjk_discrimination).toBe(true);
      expect(manifest.developer_domain_reconciliation.metrics.cjk_discrimination_regressions).toBe(0);
      expect(manifest.developer_domain_reconciliation.cjk_discrimination_baseline).toEqual({
        schema_version: "s154-103-cjk-baseline.v1",
        per_slice_top1: {
          nfkc_fixable: 1,
          non_nfkc_orthographic: 1,
          mixed_en_ja: 1,
        },
        recorded_at: "2026-05-27T00:00:00.000Z",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("flagship freshness below the green threshold fails the gate", async () => {
    const dir = mkdtempSync(join(tmpdir(), "harness-mem-s108-manifest-red-"));
    const manifestPath = join(dir, "ci-run-manifest-latest.json");
    try {
      writeFileSync(
        manifestPath,
        `${JSON.stringify({
          generated_at: "2026-04-10T08:10:51.561Z",
          git_sha: "test",
          results: {
            all_passed: true,
            bilingual_recall: 0.88,
            freshness: 0.5,
            temporal: 0.6458,
          },
        }, null, 2)}\n`,
        "utf8",
      );

      const report = await reconcileDeveloperDomainManifest({
        manifestPath,
        codeTokenRuns: 1,
        temporalMaxCases: 12,
        writeArtifacts: false,
        now: new Date("2026-06-11T00:00:00.000Z"),
      });

      expect(report.flagship_kpi.value).toBe(0.5);
      expect(report.flagship_kpi.green).toBe(false);
      expect(report.gates.flagship_freshness).toBe(false);
      expect(report.overall_passed).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  /**
   * §159 follow-up: この 2 件は 2026-07-26 まで既定 5s で timeout していた。原因は
   * deep freshness bench が実 LLM (loopback Ollama) を呼ぶことで、Ollama を動かしている
   * 開発機では reconcile 1 回が 200 秒級になる (実測 203206ms)。CI は Ollama 不在で即
   * 接続拒否となり skipped 扱いで速いため露見していなかった。
   *
   * `npm test` の合否が開発機の LLM 有無に依存しないことを pin する。
   */
  describe("deep freshness bench toggle", () => {
    const ORIGINAL = process.env.HARNESS_MEM_DEEP_FRESHNESS_BENCH;
    const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

    afterEach(() => {
      if (ORIGINAL === undefined) delete process.env.HARNESS_MEM_DEEP_FRESHNESS_BENCH;
      else process.env.HARNESS_MEM_DEEP_FRESHNESS_BENCH = ORIGINAL;
      if (ORIGINAL_NODE_ENV === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = ORIGINAL_NODE_ENV;
    });

    test("テスト実行時は既定でスキップする", () => {
      delete process.env.HARNESS_MEM_DEEP_FRESHNESS_BENCH;
      process.env.NODE_ENV = "test";
      expect(isDeepFreshnessBenchEnabled()).toBe(false);
    });

    test("テスト以外では既定で実行する (release gate 用)", () => {
      delete process.env.HARNESS_MEM_DEEP_FRESHNESS_BENCH;
      process.env.NODE_ENV = "production";
      expect(isDeepFreshnessBenchEnabled()).toBe(true);
    });

    test("env で明示的に上書きできる", () => {
      process.env.NODE_ENV = "test";
      for (const raw of ["1", "true", "TRUE"]) {
        process.env.HARNESS_MEM_DEEP_FRESHNESS_BENCH = raw;
        expect(isDeepFreshnessBenchEnabled()).toBe(true);
      }
      process.env.NODE_ENV = "production";
      for (const raw of ["0", "false", "FALSE"]) {
        process.env.HARNESS_MEM_DEEP_FRESHNESS_BENCH = raw;
        expect(isDeepFreshnessBenchEnabled()).toBe(false);
      }
    });

    test("スキップ時も deep freshness の 3 metric は skipped として報告される", async () => {
      const dir = mkdtempSync(join(tmpdir(), "harness-mem-s108-dfb-skip-"));
      const manifestPath = join(dir, "ci-run-manifest-latest.json");
      try {
        writeFileSync(
          manifestPath,
          `${JSON.stringify({
            generated_at: "2026-04-10T08:10:51.561Z",
            git_sha: "test",
            results: { all_passed: true, bilingual_recall: 0.88, freshness: 1, temporal: 0.6458 },
          }, null, 2)}\n`,
          "utf8",
        );
        const report = await reconcileDeveloperDomainManifest({
          manifestPath,
          codeTokenRuns: 1,
          temporalMaxCases: 12,
          writeArtifacts: false,
          now: new Date("2026-05-27T00:00:00.000Z"),
        });
        const deep = (report.flagship_kpi as unknown as {
          evidence?: { deep_freshness?: Record<string, { status?: string; skip_reason?: string }> };
        }).evidence?.deep_freshness;
        expect(deep).toBeDefined();
        for (const key of ["freshness_lag", "supersession", "tense_rewrite"]) {
          expect(deep?.[key]?.status).toBe("skipped");
          expect(deep?.[key]?.skip_reason).toContain("HARNESS_MEM_DEEP_FRESHNESS_BENCH");
        }
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }, 60_000);
  });

  describe("resolveCjkBaseline freeze quality bar", () => {
    const healthyTop1 = { nfkc_fixable: 1, non_nfkc_orthographic: 1, mixed_en_ja: 1 };

    test("freezes a new baseline from a healthy run", () => {
      const baseline = resolveCjkBaseline(null, healthyTop1, "2026-06-11T00:00:00.000Z");
      expect(baseline).toEqual({
        schema_version: "s154-103-cjk-baseline.v1",
        per_slice_top1: healthyTop1,
        recorded_at: "2026-06-11T00:00:00.000Z",
      });
    });

    test("refuses to freeze when any slice top1 is below the floor", () => {
      const degradedTop1 = {
        nfkc_fixable: 1,
        non_nfkc_orthographic: CJK_BASELINE_FREEZE_MIN_TOP1 - 0.1,
        mixed_en_ja: 1,
      };
      expect(resolveCjkBaseline(null, degradedTop1, "2026-06-11T00:00:00.000Z")).toBeNull();
    });

    test("keeps an existing frozen baseline regardless of the current run", () => {
      const frozen = {
        schema_version: "s154-103-cjk-baseline.v1" as const,
        per_slice_top1: healthyTop1,
        recorded_at: "2026-05-27T00:00:00.000Z",
      };
      const degradedTop1 = { nfkc_fixable: 0, non_nfkc_orthographic: 0, mixed_en_ja: 0 };
      expect(resolveCjkBaseline(frozen, degradedTop1, "2026-06-11T00:00:00.000Z")).toBe(frozen);
    });
  });
});
