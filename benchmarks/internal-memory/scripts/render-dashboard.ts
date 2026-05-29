import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { getPublishedReference } from "../adapters/import-published";
import { inferCompetency, usesLlmJudge } from "../scorers/competency";
import type { BenchmarkCase, BenchmarkSummary, Competency, ScoredCaseResult } from "../lib/types";

const COMPETENCY_ORDER: Competency[] = ["AR", "CR", "TTL", "LRU"];

function competencyOf(row: ScoredCaseResult): Competency {
  return row.competency ?? inferCompetency(row as unknown as BenchmarkCase);
}

function meanOf(values: number[]): string {
  if (values.length === 0) return "—";
  return (values.reduce((acc, value) => acc + value, 0) / values.length).toFixed(3);
}

/** Mask personal absolute paths: collapse the home directory prefix to `~`. */
function redactPath(filePath: string): string {
  const home = homedir();
  if (home && filePath.startsWith(home)) {
    return `~${filePath.slice(home.length)}`;
  }
  return filePath;
}

const ROOT = join(import.meta.dir, "..");
const REPORT_DIR = join(ROOT, "reports", "latest");

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderScorecard(summary: BenchmarkSummary, results: ScoredCaseResult[]): string {
  const reproduced = summary.competitors.filter((c) => c.measurement === "reproduced");
  const published = summary.competitors.filter((c) => c.measurement === "published");

  const lines: string[] = [
    "# Internal Memory Benchmark Scorecard",
    "",
    `Generated: ${summary.generated_at}`,
    `Run ID: ${summary.run_id}`,
    summary.git_sha ? `Git SHA: ${summary.git_sha}` : "",
    "",
    "## Reproduced (locally measured — same dataset / scorer / manifest)",
    "",
    "| Competitor | Status | JA+Mixed score | Public R@10 | JA R@10 | Mixed R@10 | P95 latency (ms) |",
    "|---|---:|---:|---:|---:|---:|---:|",
  ];

  for (const competitor of reproduced) {
    const publicLayer = competitor.layers.find((layer) => layer.layer === "public_compatible");
    const jaLayer = competitor.layers.find((layer) => layer.layer === "ja_coding");
    const mixedLayer = competitor.layers.find((layer) => layer.layer === "mixed_coding");
    const latencies = competitor.layers.map((layer) => layer.latency_p95_ms);
    const p95 = latencies.length ? Math.max(...latencies) : 0;
    lines.push(
      `| ${competitor.competitor_id} | ${competitor.status} | ${(competitor.japanese_mixed_score ?? 0).toFixed(3)} | ${(publicLayer?.recall_at_10_mean ?? 0).toFixed(3)} | ${(jaLayer?.recall_at_10_mean ?? 0).toFixed(3)} | ${(mixedLayer?.recall_at_10_mean ?? 0).toFixed(3)} | ${p95.toFixed(1)} |`,
    );
  }

  const reproducedIds = new Set(reproduced.map((competitor) => competitor.competitor_id));
  const tierRows = results.filter(
    (row) => reproducedIds.has(row.competitor_id) && row.status === "ok",
  );
  if (tierRows.length > 0) {
    lines.push(
      "",
      "## Competency tiers (§139 two-tier scoring)",
      "",
      "AR/CR use expected-keyword substring grounding; TTL/LRU use the OpenRouter LLM judge (opt-in). The two tiers stay in separate columns and are never collapsed into one grounding number.",
      "",
      "| Competency | Tier | Cases | Substring grounding | LLM grounding |",
      "|---|---|---:|---:|---:|",
    );
    for (const competency of COMPETENCY_ORDER) {
      const rows = tierRows.filter((row) => competencyOf(row) === competency);
      if (rows.length === 0) continue;
      const tier = usesLlmJudge(competency) ? "llm_judge" : "substring";
      const substringScores = rows
        .map((row) => row.substring_grounding_score)
        .filter((value): value is number => typeof value === "number");
      const llmScores = rows
        .map((row) => row.llm_grounding_score)
        .filter((value): value is number => typeof value === "number");
      lines.push(
        `| ${competency} | ${tier} | ${rows.length} | ${meanOf(substringScores)} | ${meanOf(llmScores)} |`,
      );
    }
  }

  lines.push(
    "",
    "## Published (reference-only — NOT comparable, kept separate from the ranking above)",
    "",
    "| Competitor | Domain | Published R@10 | Source / note |",
    "|---|---|---:|---|",
  );
  if (published.length === 0) {
    lines.push("| (none) | - | - | - |");
  }
  for (const competitor of published) {
    const value =
      competitor.published_recall_at_10 === null || competitor.published_recall_at_10 === undefined
        ? "n/a"
        : competitor.published_recall_at_10.toFixed(3);
    const ref = getPublishedReference(competitor.competitor_id);
    const domain = ref?.domain ?? "-";
    const note = `${competitor.published_source ?? ref?.source ?? ""} ${competitor.published_note ?? ref?.note ?? ""}`.trim();
    lines.push(`| ${competitor.competitor_id} | ${domain} | ${value} | ${note} |`);
  }

  if (summary.openrouter_budget?.enabled) {
    lines.push(
      "",
      "## OpenRouter spend",
      "",
      `- cap_usd: ${summary.openrouter_budget.cap_usd}`,
      `- spent_usd: ${summary.openrouter_budget.spent_usd.toFixed(6)}`,
      `- remaining_usd: ${summary.openrouter_budget.remaining_usd.toFixed(6)}`,
      `- request_count: ${summary.openrouter_budget.request_count}`,
    );
  }

  lines.push("", "## Claim safety", "");
  for (const note of summary.claim_safety) {
    lines.push(`- ${note}`);
  }

  const failures = results.filter((row) => row.status === "ok" && row.recall_at_10 < 1);
  if (failures.length > 0) {
    lines.push("", "## Sample misses", "");
    for (const row of failures.slice(0, 10)) {
      lines.push(`- ${row.competitor_id} / ${row.case_id} (${row.category}): recall@10=${row.recall_at_10.toFixed(2)}`);
    }
  }

  return `${lines.filter(Boolean).join("\n")}\n`;
}

export function renderDashboardHtml(summary: BenchmarkSummary): string {
  const reproduced = summary.competitors.filter((c) => c.measurement === "reproduced");
  const published = summary.competitors.filter((c) => c.measurement === "published");

  const reproducedRows = reproduced
    .map((competitor) =>
      competitor.layers
        .map(
          (layer) =>
            `<tr><td>${escapeHtml(competitor.competitor_id)}</td><td>${escapeHtml(layer.layer)}</td><td>${layer.recall_at_10_mean.toFixed(3)}</td><td>${layer.mrr_mean.toFixed(3)}</td><td>${layer.ndcg_at_10_mean.toFixed(3)}</td><td>${layer.latency_p95_ms.toFixed(1)}</td><td>${layer.skipped_count}</td></tr>`,
        )
        .join(""),
    )
    .join("");

  const publishedRows = published
    .map((competitor) => {
      const ref = getPublishedReference(competitor.competitor_id);
      const value =
        competitor.published_recall_at_10 === null || competitor.published_recall_at_10 === undefined
          ? "n/a"
          : competitor.published_recall_at_10.toFixed(3);
      const note = `${competitor.published_source ?? ref?.source ?? ""} ${competitor.published_note ?? ref?.note ?? ""}`.trim();
      return `<tr><td>${escapeHtml(competitor.competitor_id)}</td><td>${escapeHtml(ref?.domain ?? "-")}</td><td>${value}</td><td>${escapeHtml(note)}</td></tr>`;
    })
    .join("");

  const publishedTable = published.length
    ? `<h2>Published (reference-only — NOT comparable)</h2>
  <table>
    <thead>
      <tr><th>Competitor</th><th>Domain</th><th>Published R@10</th><th>Source / note</th></tr>
    </thead>
    <tbody>${publishedRows}</tbody>
  </table>`
    : "";

  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <title>Internal Memory Benchmark</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 2rem; color: #111; }
    h1 { font-size: 1.5rem; }
    h2 { font-size: 1.15rem; margin-top: 1.75rem; }
    table { border-collapse: collapse; width: 100%; margin-top: 1rem; }
    th, td { border: 1px solid #ddd; padding: 0.5rem 0.75rem; text-align: left; }
    th { background: #f6f6f6; }
    .note { margin-top: 1rem; color: #444; font-size: 0.9rem; }
  </style>
</head>
<body>
  <h1>Internal Memory Benchmark Dashboard</h1>
  <p>Run: ${escapeHtml(summary.run_id)} · Generated: ${escapeHtml(summary.generated_at)}</p>
  <h2>Reproduced (locally measured — same dataset / scorer)</h2>
  <table>
    <thead>
      <tr><th>Competitor</th><th>Layer</th><th>Recall@10</th><th>MRR</th><th>nDCG@10</th><th>P95 ms</th><th>Skipped</th></tr>
    </thead>
    <tbody>${reproducedRows}</tbody>
  </table>
  ${publishedTable}
  <div class="note">${summary.claim_safety.map(escapeHtml).join("<br/>")}</div>
</body>
</html>`;
}

export function renderReproducibility(summary: BenchmarkSummary, competitors: string[]): string {
  return [
    "# Reproducibility manifest",
    "",
    `- run_id: ${summary.run_id}`,
    `- generated_at: ${summary.generated_at}`,
    `- git_sha: ${summary.git_sha ?? "unknown"}`,
    `- datasets: ${summary.dataset_ids.join(", ")}`,
    `- competitors: ${competitors.join(", ")}`,
    `- node: ${process.version}`,
    `- platform: ${process.platform}`,
    "",
    "## Environment flags observed",
    "",
    `- AGENTMEMORY_BASE_URL: ${process.env.AGENTMEMORY_BASE_URL ? "set" : "unset"}`,
    `- SUPERMEMORY_API_KEY: ${process.env.SUPERMEMORY_API_KEY ? "set" : "unset"}`,
    `- CLAUDE_MEM_BASE_URL: ${process.env.CLAUDE_MEM_BASE_URL ? "set" : "unset"}`,
    `- HARNESS_MEM_BASE_URL: ${process.env.HARNESS_MEM_BASE_URL ? "set" : "unset"}`,
    `- OPENROUTER_API_KEY: ${process.env.OPENROUTER_API_KEY ? "set" : "unset"}`,
    `- INTERNAL_BENCH_BUDGET_USD: ${process.env.INTERNAL_BENCH_BUDGET_USD ?? "20 (default)"}`,
    "",
    "## OpenRouter budget",
    "",
    summary.openrouter_budget
      ? `- cap_usd: ${summary.openrouter_budget.cap_usd}`
      : "- cap_usd: n/a (OpenRouter judge disabled)",
    summary.openrouter_budget
      ? `- spent_usd: ${summary.openrouter_budget.spent_usd.toFixed(6)}`
      : "- spent_usd: 0",
    summary.openrouter_budget
      ? `- request_count: ${summary.openrouter_budget.request_count}`
      : "- request_count: 0",
    summary.env_files_loaded?.length
      ? `\n## Env files loaded\n\n${summary.env_files_loaded.map((path) => `- ${redactPath(path)}`).join("\n")}\n`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function writeReportPack(
  summary: BenchmarkSummary,
  results: ScoredCaseResult[],
  outDir: string = REPORT_DIR,
): void {
  mkdirSync(outDir, { recursive: true });
  // Redact personal absolute paths before persisting; env_files_loaded would
  // otherwise leak the operator's home directory into the committed report.
  const redactedSummary: BenchmarkSummary = {
    ...summary,
    env_files_loaded: summary.env_files_loaded?.map(redactPath),
  };
  writeFileSync(join(outDir, "summary.json"), `${JSON.stringify(redactedSummary, null, 2)}\n`);
  writeFileSync(
    join(outDir, "raw-results.jsonl"),
    `${results.map((row) => JSON.stringify(row)).join("\n")}\n`,
  );
  writeFileSync(join(outDir, "scorecard.md"), renderScorecard(summary, results));
  writeFileSync(join(outDir, "dashboard.html"), renderDashboardHtml(summary));
  writeFileSync(
    join(outDir, "reproducibility.md"),
    renderReproducibility(
      summary,
      summary.competitors.map((row) => row.competitor_id),
    ),
  );
}

if (import.meta.main) {
  const summary = JSON.parse(readFileSync(join(REPORT_DIR, "summary.json"), "utf8")) as BenchmarkSummary;
  const raw = readFileSync(join(REPORT_DIR, "raw-results.jsonl"), "utf8")
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ScoredCaseResult);
  writeReportPack(summary, raw);
  console.log(`dashboard pack refreshed at ${REPORT_DIR}`);
}
