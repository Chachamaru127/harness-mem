import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { reconcileDeveloperDomainManifest } from "../../scripts/s108-developer-domain-manifest";

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
});
