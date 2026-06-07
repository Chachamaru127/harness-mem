import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// S108-012: claim ceiling guard.
// Public README copy must not exceed what the evidence snapshot supports.
// This test enforces:
//   1) banned superlative phrases never appear in user-facing READMEs
//   2) the lead tagline of README.md / README_ja.md matches the claim map SSOT
//      (docs/readme-claims.md / docs/readme-claims-ja.md)
//
// Fail = README is making a claim that the SSOT does not back. Update the SSOT
// first, then change public copy (per docs/readme-claims.md "Update rule").

const root = process.cwd();

function read(...parts: string[]): string {
  return readFileSync(join(root, ...parts), "utf8");
}

const BANNED_PHRASES = [
  // English superlatives that imply unverifiable category dominance.
  /\bunique\b/i,
  /\bbest-in-class\b/i,
  /\bstate-of-the-art\b/i,
  /\bfastest\b/i,
  /\bfirst-ever\b/i,
  /\bnative Japanese (quality|support)\b/i,
  /\bonly (memory|runtime|tool) (that|which)\b/i,
  // Generic "every AI coding agent" overclaim — narrowed by S108-011.
  /\bEvery AI (coding )?agent\b/i,
];

const CURRENT_LEAD_TAGLINE =
  "Local project memory for AI coding sessions — a continuity runtime, not a generic memory API.";

describe("S108-012 README claim ceiling", () => {
  const readmeEn = read("README.md");
  const readmeJa = read("README_ja.md");
  const claimsEn = read("docs/readme-claims.md");
  const claimsJa = read("docs/readme-claims-ja.md");
  const spec = read("Spec.md");
  const adr004 = read("docs/adr/ADR-004-local-streamable-http-mcp-default.md");
  const changelog = read("CHANGELOG.md");
  const codexAppDogfood = read("docs/codex-app-dogfood-2026-05-26.md");

  test("README.md is free of banned superlatives", () => {
    for (const pattern of BANNED_PHRASES) {
      // README has one benign "best option for Claude Code users on Windows" line.
      // We exempt that exact phrase by stripping it before checking.
      const sanitized = readmeEn.replace(/best option for Claude Code users on Windows/g, "");
      const match = sanitized.match(pattern);
      if (match) {
        throw new Error(`README.md contains banned phrase ${pattern}: ${match[0]}`);
      }
      expect(match).toBeNull();
    }
  });

  test("README_ja.md is free of banned superlatives", () => {
    for (const pattern of BANNED_PHRASES) {
      const match = readmeJa.match(pattern);
      expect(match).toBeNull();
    }
  });

  test("English lead tagline matches the claim map SSOT", () => {
    expect(readmeEn).toContain(CURRENT_LEAD_TAGLINE);
    expect(claimsEn).toContain(CURRENT_LEAD_TAGLINE);
  });

  test("Japanese lead tagline matches the claim map SSOT", () => {
    // The JA README leads with a Japanese gloss, then echoes the canonical EN tagline
    // on its claim map for cross-language traceability.
    expect(readmeJa).toContain(
      "AI コーディングセッション向けのローカルなプロジェクトメモリ"
    );
    expect(claimsJa).toContain(CURRENT_LEAD_TAGLINE);
  });

  test("each claim map row references a repo evidence surface", () => {
    // Every claim map row must cite a source-of-truth column that points at a
    // repo evidence surface (README, docs/, Spec.md, CHANGELOG, memory-server).
    // This guards against silent claim drift where someone adds a row without
    // tying it to evidence.
    for (const [label, claims] of [["EN", claimsEn], ["JA", claimsJa]] as const) {
      const rows = claims
        .split("\n")
        .filter((line) => line.startsWith("| ") && !line.startsWith("| README") && !line.startsWith("| ---"));
      expect(rows.length).toBeGreaterThan(0);
      for (const row of rows) {
        const cells = row.split("|").map((c) => c.trim());
        // | <claim> | <source> | <status> | <notes> |  → cells[1..4]
        const source = cells[2] ?? "";
        const hasFileRef =
          /README/i.test(source) ||
          /docs\//i.test(source) ||
          /CHANGELOG/i.test(source) ||
          /Spec\.md/i.test(source) ||
          /architecture/i.test(source) ||
          /memory-server/i.test(source) ||
          /setup guide/i.test(source) ||
          /SSOT/i.test(source) ||
          /benchmark/i.test(source) ||
          /local SQLite/i.test(source);
        if (!hasFileRef) {
          throw new Error(`${label} claim map row missing file/source reference: ${row}`);
        }
        expect(hasFileRef).toBe(true);
      }
    }
  });

  test("HTTP MCP default claim is backed by accepted ADR and release evidence", () => {
    expect(readmeEn).toContain("Since v0.25.0, new");
    expect(readmeJa).toContain("v0.25.0 以降の新規");
    expect(adr004).toContain("Status: Accepted");
    expect(spec).toContain("This gate was promoted");
    expect(changelog).toContain("## [0.25.0]");
    expect(changelog).toContain("Local Streamable HTTP MCP is now the default");
    expect(claimsEn).toContain("New Claude Code and Codex setup defaults to the local Streamable HTTP MCP gateway.");
    expect(claimsJa).toContain("新規 Claude Code / Codex setup は local Streamable HTTP MCP gateway を default にする。");
  });

  test("Codex App wording stays scoped to dogfood instead of Tier 1 parity", () => {
    expect(readmeEn).toContain("Codex App dogfood");
    expect(readmeJa).toContain("Codex App dogfood");
    expect(readmeEn).toContain("| **Dogfood** | Codex App |");
    expect(readmeJa).toContain("| **Dogfood** | Codex App |");
    expect(readmeEn).not.toContain("| **Tier 1** | Codex App |");
    expect(readmeJa).not.toContain("| **Tier 1** | Codex App |");
    expect(codexAppDogfood).toContain("not a general Tier 1 support claim");
    expect(claimsEn).toContain("Codex App is local-dogfood green in this maintainer setup.");
    expect(claimsJa).toContain("Codex App はこのメンテナ環境で local dogfood green。");
  });

  test("README_ja dev-domain benchmark claims stay in sync with the manifest SSOT", () => {
    // S154-001: the developer-domain numbers in README_ja must equal the latest
    // CI manifest (ci-run-manifest-latest.json). The manifest git ref is the SSOT;
    // this guard fails the build if the public copy drifts from measured values.
    // (The manifest itself is verified by `npm run benchmark:developer-domain`;
    // this test only enforces README↔manifest agreement, not the numbers' truth.)
    const manifest = JSON.parse(
      read("memory-server/src/benchmark/results/ci-run-manifest-latest.json"),
    ) as {
      developer_domain_reconciliation: {
        metrics: {
          dev_workflow_recall_at_10: number;
          temporal_order_score: number;
          bilingual_recall_at_10: number;
        };
      };
    };
    const m = manifest.developer_domain_reconciliation.metrics;
    const fmt = (n: number): string => n.toFixed(2);
    // Strip bold markers so the row assertion tolerates **0.90** vs 0.90.
    const jaPlain = readmeJa.replace(/\*\*/g, "");
    expect(jaPlain).toContain(`\`dev-workflow\` recall@10 | ${fmt(m.dev_workflow_recall_at_10)} `);
    expect(jaPlain).toContain(`\`bilingual\` recall@10 | ${fmt(m.bilingual_recall_at_10)} `);
    expect(jaPlain).toContain(`\`temporal\` ordering score | ${fmt(m.temporal_order_score)} `);
  });
});
