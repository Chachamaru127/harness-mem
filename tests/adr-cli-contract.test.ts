import { describe, expect, test, afterEach } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { parseAdrFile } from "../memory-server/src/connectors/adr-decisions";

const ROOT = resolve(import.meta.dir, "..");
const ADR_CLI = join(ROOT, "memory-server/src/adr/adr-cli.ts");
const HARNESS_MEM_SCRIPT = join(ROOT, "scripts/harness-mem");
const HARNESS_MEM_SOURCE = readFileSync(HARNESS_MEM_SCRIPT, "utf8");
const TEMPLATE = readFileSync(join(ROOT, "docs/adr/TEMPLATE.md"), "utf8");
const INDEX = readFileSync(join(ROOT, "docs/adr/README.md"), "utf8");

function writeAdrSkeleton(projectDir: string): void {
  mkdirSync(join(projectDir, "docs/adr"), { recursive: true });
  writeFileSync(join(projectDir, "docs/adr-001-auto-memory-coexistence.md"), "# ADR-001: Legacy\n", "utf8");
  writeFileSync(join(projectDir, "docs/adr/ADR-002-commercial-packaging.md"), "# ADR-002: Packaging\n", "utf8");
  writeFileSync(join(projectDir, "docs/adr/ADR-003-recall-runtime-architecture.md"), "# ADR-003: Recall\n", "utf8");
}

function baseArgs(projectDir: string): string[] {
  return [
    "new",
    "--project",
    projectDir,
    "--title",
    "ADR CLI Entry Point",
    "--status",
    "Proposed",
    "--options",
    "A: Generate from harness-mem CLI; B: Manual copy from docs template",
    "--consequences",
    "ADR authors get an explicit dry-run before any file write",
    "--supersedes",
    "None",
    "--source-plans",
    "Plans.md §128 / S128-010",
    "--context",
    "S128-010 requires ADR template generation with validation.",
    "--decision",
    "Use a dry-run-first CLI to render ADR-NNN files under docs/adr.",
    "--json",
  ];
}

function runAdrCli(args: string[]) {
  return spawnSync("bun", [ADR_CLI, ...args], {
    cwd: ROOT,
    encoding: "utf8",
  });
}

function runHarnessMem(args: string[], home: string) {
  return spawnSync("bash", [HARNESS_MEM_SCRIPT, ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: home,
      HARNESS_MEM_HOME: join(home, ".harness-mem"),
      HARNESS_MEM_SKIP_AUTO_UPDATE: "1",
      HARNESS_MEM_NON_INTERACTIVE: "1",
    },
  });
}

describe("ADR CLI contract", () => {
  let tmpRoot = "";

  afterEach(() => {
    if (tmpRoot) {
      rmSync(tmpRoot, { recursive: true, force: true });
      tmpRoot = "";
    }
  });

  test("scripts/harness-mem exposes adr new and docs carry the required template/index", () => {
    expect(HARNESS_MEM_SOURCE).toContain("adr new");
    expect(HARNESS_MEM_SOURCE).toContain("adr_impl()");
    expect(HARNESS_MEM_SOURCE).toContain("memory-server/src/adr/adr-cli.ts");
    expect(TEMPLATE).toContain("## Options");
    expect(TEMPLATE).toContain("## Consequences");
    expect(TEMPLATE).toContain("## Supersedes");
    expect(TEMPLATE).toContain("Source Plans Section: Plans.md §NNN");
    expect(INDEX).toContain("docs/adr-001-auto-memory-coexistence.md");
    expect(INDEX).toContain("migration candidate");
  });

  test("adr new is dry-run by default and plans ADR-004 without writing", () => {
    tmpRoot = mkdtempSync(join(tmpdir(), "hmem-adr-dry-run-"));
    writeAdrSkeleton(tmpRoot);

    const result = runAdrCli(baseArgs(tmpRoot));
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");
    const payload = JSON.parse(result.stdout) as {
      ok: boolean;
      mode: string;
      writes: number;
      relative_path: string;
      content: string;
      legacy: { migration_candidates: string[] };
    };

    expect(payload.ok).toBe(true);
    expect(payload.mode).toBe("dry-run");
    expect(payload.writes).toBe(0);
    expect(payload.relative_path).toBe("docs/adr/ADR-004-adr-cli-entry-point.md");
    expect(existsSync(join(tmpRoot, payload.relative_path))).toBe(false);
    expect(payload.content).toContain("Status: Proposed");
    expect(payload.content).toContain("## Options");
    expect(payload.content).toContain("## Consequences");
    expect(payload.content).toContain("## Supersedes");
    expect(payload.content).toContain("Source Plans Section: Plans.md §128 / S128-010");
    expect(payload.legacy.migration_candidates).toContain("docs/adr-001-auto-memory-coexistence.md");
  });

  test("adr new --write creates docs/adr/ADR-NNN file through the main harness-mem entrypoint", () => {
    tmpRoot = mkdtempSync(join(tmpdir(), "hmem-adr-write-"));
    const home = join(tmpRoot, "home");
    const project = join(tmpRoot, "project");
    mkdirSync(home, { recursive: true });
    writeAdrSkeleton(project);

    const result = runHarnessMem(["adr", ...baseArgs(project), "--write"], home);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe("");

    const payload = JSON.parse(result.stdout) as {
      relative_path: string;
      writes: number;
      content: string;
    };
    const writtenPath = join(project, payload.relative_path);
    expect(payload.writes).toBe(1);
    expect(existsSync(writtenPath)).toBe(true);
    expect(readFileSync(writtenPath, "utf8")).toBe(payload.content);

    const parsed = parseAdrFile({
      filePath: payload.relative_path,
      content: payload.content,
      fallbackNowIso: () => "2026-05-22T00:00:00.000Z",
    });
    expect(parsed.error).toBeUndefined();
    expect(parsed.observation?.title).toContain("ADR-0004");
    expect(parsed.observation?.tags).toContain("adr-status:proposed");
    expect(parsed.observation?.tags).toContain("adr-number:004");
  });

  test("adr new validation rejects missing required fields before rendering", () => {
    tmpRoot = mkdtempSync(join(tmpdir(), "hmem-adr-validation-"));
    writeAdrSkeleton(tmpRoot);

    const result = runAdrCli([
      "new",
      "--project",
      tmpRoot,
      "--title",
      "Incomplete ADR",
      "--status",
      "Draft",
      "--options",
      "Only option",
      "--consequences",
      "Only consequence",
      "--json",
    ]);

    expect(result.status).toBe(2);
    expect(result.stdout).toBe("");
    expect(result.stderr).toContain("status");
    expect(result.stderr).toContain("supersedes");
    expect(result.stderr).toContain("source_plans_section");
    expect(existsSync(join(tmpRoot, "docs/adr/ADR-004-incomplete-adr.md"))).toBe(false);
  });
});
