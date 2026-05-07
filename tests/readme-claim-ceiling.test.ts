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

  test("each claim map row references either README or a docs/architecture surface", () => {
    // Every row in the EN claim map must cite a source-of-truth column that
    // points at a file in the repo (README, docs/, or memory-server). This
    // guards against silent claim drift where someone adds a row without
    // tying it to evidence.
    const rows = claimsEn
      .split("\n")
      .filter((line) => line.startsWith("| ") && !line.startsWith("| README claim") && !line.startsWith("| ---"));
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      const cells = row.split("|").map((c) => c.trim());
      // | <claim> | <source> | <status> | <notes> |  → cells[1..4]
      const source = cells[2] ?? "";
      const hasFileRef =
        /README/i.test(source) ||
        /docs\//i.test(source) ||
        /architecture/i.test(source) ||
        /memory-server/i.test(source) ||
        /setup guide/i.test(source) ||
        /SSOT/i.test(source) ||
        /benchmark/i.test(source) ||
        /local SQLite/i.test(source);
      if (!hasFileRef) {
        throw new Error(`claim map row missing file/source reference: ${row}`);
      }
      expect(hasFileRef).toBe(true);
    }
  });
});
