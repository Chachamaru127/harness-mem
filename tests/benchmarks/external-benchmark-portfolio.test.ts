import { describe, expect, test } from "bun:test";
import { execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const PACKAGE_JSON_PATH = join(ROOT, "package.json");
const TAU3_SCRIPT_PATH = join(ROOT, "scripts", "bench-tau3.sh");
const TAU3_RUNNER_PATH = join(ROOT, "scripts", "bench-tau3-runner.py");
const SWEBENCH_PRO_SCRIPT_PATH = join(ROOT, "scripts", "bench-swebench-pro.sh");
const BENCHMARK_DOCS_DIR = join(ROOT, "docs", "benchmarks");

function listMarkdownFiles(dir: string): string[] {
  if (!existsSync(dir)) {
    return [];
  }

  return readdirSync(dir).flatMap((entry) => {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);

    if (stats.isDirectory()) {
      return listMarkdownFiles(fullPath);
    }

    if (stats.isFile() && entry.endsWith(".md")) {
      return [fullPath];
    }

    return [];
  });
}

describe("external benchmark portfolio contract", () => {
  test("ships tau3 and swebench-pro execution entry points", () => {
    expect(existsSync(TAU3_SCRIPT_PATH)).toBe(true);
    expect(existsSync(TAU3_RUNNER_PATH)).toBe(true);
    expect(existsSync(SWEBENCH_PRO_SCRIPT_PATH)).toBe(true);

    const tau3Script = readFileSync(TAU3_SCRIPT_PATH, "utf8");
    const tau3Runner = readFileSync(TAU3_RUNNER_PATH, "utf8");
    const swebenchScript = readFileSync(SWEBENCH_PRO_SCRIPT_PATH, "utf8");

    expect(tau3Script).toContain("--help");
    expect(tau3Script).toContain("--dry-run");
    expect(tau3Script).toContain("--repo-path");
    expect(tau3Script).toContain("--domain");
    expect(tau3Script).toContain("--task-split-name");
    expect(tau3Script).toContain("--num-tasks");
    expect(tau3Script).toContain("--num-trials");
    expect(tau3Script).toContain("--agent-llm");
    expect(tau3Script).toContain("--user-llm");
    expect(tau3Script).toContain("--mode");
    expect(tau3Script).toContain("HARNESS_MEM_BENCH_MODE");
    expect(tau3Script).toContain("bench-tau3-runner.py");
    expect(tau3Runner).toContain("harness_mem_llm_agent");
    expect(tau3Runner).toContain("record-checkpoint");
    expect(tau3Runner).toContain("Contextual Recall");
    expect(tau3Runner).toContain("Reference only. Use these notes only if they clearly help the current request.");
    expect(tau3Runner).toContain("harness_mem_max_recall_items\", 1");
    expect(tau3Runner).toContain("Agent note:");

    expect(swebenchScript).toContain("--help");
    expect(swebenchScript).toContain("--dry-run");
    expect(swebenchScript).toContain("--repo-path");
    expect(swebenchScript).toContain("--subset-manifest");
    expect(swebenchScript).toContain("--runner");
    expect(swebenchScript).toContain("local-docker");
    expect(swebenchScript).toContain("modal");
    expect(swebenchScript).toContain("--model");
    expect(swebenchScript).toContain("--mode");
  });

  test("package.json exposes smoke and dry-run scripts for both wrappers", () => {
    const pkg = JSON.parse(readFileSync(PACKAGE_JSON_PATH, "utf8")) as {
      scripts?: Record<string, string>;
    };
    const scripts = pkg.scripts ?? {};

    expect(scripts["benchmark:tau3"]).toBe("bash scripts/bench-tau3.sh");
    expect(scripts["benchmark:tau3:dry-run"]).toBe("bash scripts/bench-tau3.sh --dry-run");
    expect(scripts["benchmark:tau3:smoke"]).toContain("bash scripts/bench-tau3.sh");
    expect(scripts["benchmark:tau3:smoke"]).toContain("--dry-run");

    expect(scripts["benchmark:swebench-pro"]).toBe("bash scripts/bench-swebench-pro.sh");
    expect(scripts["benchmark:swebench-pro:dry-run"]).toBe("bash scripts/bench-swebench-pro.sh --dry-run");
    expect(scripts["benchmark:swebench-pro:smoke"]).toContain("bash scripts/bench-swebench-pro.sh");
    expect(scripts["benchmark:swebench-pro:smoke"]).toContain("--dry-run");
  });

  test("tau3 dry-run recommends explicit runner modes for off/on comparisons", () => {
    const output = execSync(
      "bash scripts/bench-tau3.sh --dry-run --repo-path ../tau2-bench --domain retail --task-split-name base --num-tasks 2 --num-trials 2 --mode on-off",
      {
        cwd: ROOT,
        encoding: "utf8",
      },
    );

    expect(output).toContain("HARNESS_MEM_BENCH_MODE=off");
    expect(output).toContain("HARNESS_MEM_BENCH_MODE=on");
    expect(output).toContain("--mode off");
    expect(output).toContain("--mode on");
  });

  test("benchmark docs encode the commercial-safe portfolio rules", () => {
    const markdownFiles = listMarkdownFiles(BENCHMARK_DOCS_DIR);
    const portfolioDocs = markdownFiles
      .filter((path) => /portfolio/i.test(path))
      .map((path) => ({ path, source: readFileSync(path, "utf8") }));

    expect(portfolioDocs.length).toBeGreaterThan(0);
    expect(portfolioDocs.some(({ source }) => source.includes("NoLiMa") && /research[- ]only/i.test(source))).toBe(true);
    expect(portfolioDocs.some(({ source }) => /τ³-bench|tau3/i.test(source))).toBe(true);
    expect(portfolioDocs.some(({ source }) => /SWE-bench Pro|swebench pro/i.test(source))).toBe(true);
  });
});
