import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const README_PATH = join(ROOT, "README.md");
const README_JA_PATH = join(ROOT, "README_ja.md");
const CHANGELOG_PATH = join(ROOT, "CHANGELOG.md");
const CHANGELOG_JA_PATH = join(ROOT, "CHANGELOG_ja.md");
const RELEASE_DOC_PATH = join(ROOT, "docs", "release-process.md");

describe("release docs contract", () => {
  test("README files point to the canonical release reproducibility doc", () => {
    const readme = readFileSync(README_PATH, "utf8");
    const readmeJa = readFileSync(README_JA_PATH, "utf8");

    expect(readme).toContain("## Release Reproducibility");
    expect(readme).toContain("docs/release-process.md");
    expect(readme).toContain("CHANGELOG.md");
    expect(readme).toContain("[Unreleased]");
    expect(readmeJa).toContain("## リリースの再現性");
    expect(readmeJa).toContain("docs/release-process.md");
    expect(readmeJa).toContain("CHANGELOG.md");
    expect(readmeJa).toContain("[Unreleased]");
  });

  test("release-process runbook exists and encodes the release contract", () => {
    expect(existsSync(RELEASE_DOC_PATH)).toBe(true);
    const doc = readFileSync(RELEASE_DOC_PATH, "utf8");

    expect(doc).toContain("harness-release");
    expect(doc).toContain("CHANGELOG.md");
    expect(doc).toContain("[Unreleased]");
    expect(doc).toContain("package.json");
    expect(doc).toContain("docs/TESTING.md");
    expect(doc).toContain("docs/bun-test-panic-repro.md");
    expect(doc).toContain("npm pack --dry-run");
    expect(doc).toContain("npm publish");
    expect(doc).toContain("GitHub Release");
    expect(doc).toContain("git tag");
    expect(doc).toContain("release.yml");
  });

  test("changelog files mention the release reproducibility docs update", () => {
    const changelog = readFileSync(CHANGELOG_PATH, "utf8");
    const changelogJa = readFileSync(CHANGELOG_JA_PATH, "utf8");

    expect(changelog).toContain("## [Unreleased]");
    expect(changelog).toContain("release reproducibility");
    expect(changelogJa).toContain("## [Unreleased]");
    expect(changelogJa).toContain("docs/release-process.md");
  });
});
