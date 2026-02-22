import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

interface LocomoRecord {
  sample_id: string;
  question_id: string;
  category: string;
  question: string;
  answer: string;
  prediction: string;
  em: number;
  f1: number;
  question_kind?: string;
  answer_strategy?: string;
  selected_evidence_ids?: string[];
  answer_trace?: {
    extraction?: {
      strategy?: string;
      selected_candidates?: Array<{ id?: string; sentence?: string; score?: number }>;
    };
    normalization?: {
      notes?: string[];
      multi_hop_reasoning?: {
        format?: string;
        facts?: Array<{ id?: string; fact?: string; relation?: string; confidence?: number }>;
      };
    };
  };
}

interface LocomoResult {
  records: LocomoRecord[];
}

interface JudgeFile {
  items?: Array<{
    sample_id: string;
    question_id: string;
    category: string;
    label: "CORRECT" | "WRONG";
    reasoning?: string;
  }>;
}

interface FailureBacklogItem {
  rank: number;
  sample_id: string;
  question_id: string;
  category: string;
  question_kind: string;
  answer_strategy: string;
  em: number;
  f1: number;
  judge_label: "CORRECT" | "WRONG" | "UNKNOWN";
  priority_score: number;
  improvement_tags: string[];
  question: string;
  answer: string;
  prediction: string;
}

interface FailureBacklog {
  schema_version: "locomo-failure-backlog-v1";
  generated_at: string;
  source_result_path: string;
  source_judge_path?: string;
  limit: number;
  summary: {
    total_failures_considered: number;
    selected_failures: number;
    by_category: Record<string, number>;
    by_tag: Record<string, number>;
  };
  review_evidence_spec: {
    required_artifacts: string[];
    rejection_conditions: string[];
    comparison_requirements: string[];
  };
  actions: Record<string, string>;
  improvement_tickets: Array<{
    tag: string;
    owner: string;
    due: string;
    status: "todo" | "in_progress" | "done";
    re_evaluation_result: string;
  }>;
  failures: FailureBacklogItem[];
}

interface CliOptions {
  resultPath: string;
  judgePath?: string;
  outputPath?: string;
  markdownPath?: string;
  limit: number;
}

function parseArgs(argv: string[]): CliOptions {
  let resultPath = "";
  let judgePath: string | undefined;
  let outputPath: string | undefined;
  let markdownPath: string | undefined;
  let limit = 100;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--result" && i + 1 < argv.length) {
      resultPath = argv[i + 1] || "";
      i += 1;
      continue;
    }
    if (token === "--judge-result" && i + 1 < argv.length) {
      judgePath = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--output" && i + 1 < argv.length) {
      outputPath = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--markdown-output" && i + 1 < argv.length) {
      markdownPath = argv[i + 1];
      i += 1;
      continue;
    }
    if (token === "--limit" && i + 1 < argv.length) {
      const parsed = Number(argv[i + 1] || "");
      if (Number.isFinite(parsed) && parsed > 0) {
        limit = Math.floor(parsed);
      }
      i += 1;
    }
  }

  if (!resultPath) {
    throw new Error("--result is required");
  }
  return { resultPath, judgePath, outputPath, markdownPath, limit };
}

function detectQuestionKind(question: string): string {
  const normalized = question.trim().toLowerCase();
  if (/\bwhen\b|\bhow long\b|\bwhat year\b|\bwhat month\b/.test(normalized)) return "temporal";
  if (normalized.startsWith("where ") || normalized.includes(" where ")) return "location";
  if (/^(is|are|was|were|do|does|did|has|have|had|can|could|would|should|will)\b/.test(normalized)) return "yes_no";
  if (/\bwould\b.+\bif\b|\blikely\b/.test(normalized)) return "multi_hop";
  if (/\bwhat activities\b|\bwhich\b/.test(normalized)) return "list";
  return "factual";
}

function inferTags(record: LocomoRecord): string[] {
  const question = record.question.toLowerCase();
  const tags = new Set<string>();
  const kind = record.question_kind || detectQuestionKind(record.question);
  const normalizationNotes = record.answer_trace?.normalization?.notes || [];
  const multiHopFacts = record.answer_trace?.normalization?.multi_hop_reasoning?.facts || [];
  const selectedCandidates = record.answer_trace?.extraction?.selected_candidates || [];
  const selectedEvidence = record.selected_evidence_ids || [];

  if (record.category === "cat-2" || kind === "temporal") tags.add("temporal_normalization");
  if (normalizationNotes.some((note) => note.startsWith("temporal:resolved_relative_weekday"))) {
    tags.add("temporal_reference_anchor");
  }
  if (record.category === "cat-3" || kind === "multi_hop") tags.add("multi_hop_reasoning");
  if ((record.category === "cat-3" || kind === "multi_hop") && multiHopFacts.length === 0) {
    tags.add("multi_hop_fact_extraction");
  }
  if ((record.category === "cat-3" || kind === "multi_hop") && !/\breason:/i.test(record.prediction)) {
    tags.add("counterfactual_format");
  }
  if (kind === "yes_no") tags.add("yes_no_decision");
  if (kind === "location") tags.add("location_extraction");
  if (/\bwho\b|\bidentity\b|\brelationship status\b/.test(question)) tags.add("entity_extraction");
  if (kind === "list" || /,\s*\w+/.test(record.answer)) tags.add("list_structuring");
  if (record.f1 === 0) tags.add("retrieval_alignment");
  if ((record.category === "cat-2" || record.category === "cat-3") && selectedCandidates.length < 3) {
    tags.add("retrieval_depth");
  }
  if ((record.category === "cat-2" || record.category === "cat-3") && selectedEvidence.length < 2) {
    tags.add("evidence_coverage");
  }
  if (record.prediction.length > 180) tags.add("response_compression");

  return [...tags];
}

function priorityScore(record: LocomoRecord, judgeLabel: "CORRECT" | "WRONG" | "UNKNOWN"): number {
  let score = 0;
  if (judgeLabel === "WRONG") score += 3;
  if (record.f1 === 0) score += 2;
  if (record.em === 0) score += 1;
  if (record.category === "cat-3") score += 1.5;
  if (record.category === "cat-2") score += 1;
  return score;
}

function buildMarkdown(backlog: FailureBacklog): string {
  const lines: string[] = [];
  lines.push("# LoCoMo Failure Backlog");
  lines.push("");
  lines.push(`- Generated at: ${backlog.generated_at}`);
  lines.push(`- Source result: ${backlog.source_result_path}`);
  if (backlog.source_judge_path) {
    lines.push(`- Source judge: ${backlog.source_judge_path}`);
  }
  lines.push(`- Selected failures: ${backlog.summary.selected_failures}`);
  lines.push("");
  lines.push("## Action Buckets");
  lines.push("");
  for (const [tag, action] of Object.entries(backlog.actions)) {
    lines.push(`- ${tag}: ${action}`);
  }
  lines.push("");
  lines.push("## Reviewer Evidence Spec");
  lines.push("");
  lines.push("- Required Artifacts:");
  for (const artifact of backlog.review_evidence_spec.required_artifacts) {
    lines.push(`  - ${artifact}`);
  }
  lines.push("- Rejection Conditions:");
  for (const condition of backlog.review_evidence_spec.rejection_conditions) {
    lines.push(`  - ${condition}`);
  }
  lines.push("- Comparison Requirements:");
  for (const requirement of backlog.review_evidence_spec.comparison_requirements) {
    lines.push(`  - ${requirement}`);
  }
  lines.push("");
  lines.push("## Improvement Tickets");
  lines.push("");
  lines.push("| Tag | Owner | Due | Status | Re-evaluation |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const ticket of backlog.improvement_tickets) {
    lines.push(
      `| ${ticket.tag} | ${ticket.owner} | ${ticket.due} | ${ticket.status} | ${ticket.re_evaluation_result} |`
    );
  }
  lines.push("");
  lines.push("## Top Failures");
  lines.push("");
  lines.push("| Rank | Cat | QID | F1 | Judge | Strategy | Tags | Question |");
  lines.push("| ---: | --- | --- | ---: | --- | --- | --- | --- |");
  for (const failure of backlog.failures) {
    lines.push(
      `| ${failure.rank} | ${failure.category} | ${failure.question_id} | ${failure.f1.toFixed(3)} | ${failure.judge_label} | ${failure.answer_strategy} | ${failure.improvement_tags.join(", ")} | ${failure.question.replace(/\|/g, "/")} |`
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export function buildLocomoFailureBacklog(options: CliOptions): FailureBacklog {
  const resultPath = resolve(options.resultPath);
  const result = JSON.parse(readFileSync(resultPath, "utf8")) as LocomoResult;
  const judgeMap = new Map<string, "CORRECT" | "WRONG">();

  if (options.judgePath) {
    const judgePath = resolve(options.judgePath);
    const judge = JSON.parse(readFileSync(judgePath, "utf8")) as JudgeFile;
    for (const item of judge.items || []) {
      judgeMap.set(`${item.sample_id}:${item.question_id}`, item.label);
    }
  }

  const failures = result.records
    .filter((record) => record.em === 0 || record.f1 < 1)
    .map((record) => {
      const key = `${record.sample_id}:${record.question_id}`;
      const judgeLabel = judgeMap.get(key) || "UNKNOWN";
      const tags = inferTags(record);
      return {
        record,
        judgeLabel,
        tags,
        priority: priorityScore(record, judgeLabel),
      };
    })
    .sort((lhs, rhs) => {
      if (rhs.priority !== lhs.priority) return rhs.priority - lhs.priority;
      if (lhs.record.f1 !== rhs.record.f1) return lhs.record.f1 - rhs.record.f1;
      return lhs.record.question_id.localeCompare(rhs.record.question_id);
    })
    .slice(0, options.limit);

  const byCategory: Record<string, number> = {};
  const byTag: Record<string, number> = {};
  const topFailures: FailureBacklogItem[] = failures.map((entry, index) => {
    byCategory[entry.record.category] = (byCategory[entry.record.category] || 0) + 1;
    for (const tag of entry.tags) {
      byTag[tag] = (byTag[tag] || 0) + 1;
    }
    return {
      rank: index + 1,
      sample_id: entry.record.sample_id,
      question_id: entry.record.question_id,
      category: entry.record.category,
      question_kind: entry.record.question_kind || detectQuestionKind(entry.record.question),
      answer_strategy: entry.record.answer_strategy || "unknown",
      em: entry.record.em,
      f1: entry.record.f1,
      judge_label: entry.judgeLabel,
      priority_score: entry.priority,
      improvement_tags: entry.tags,
      question: entry.record.question,
      answer: entry.record.answer,
      prediction: entry.record.prediction,
    };
  });

  const actions: Record<string, string> = {
    temporal_normalization: "Normalize and canonicalize time expressions before final answer generation.",
    temporal_reference_anchor: "Resolve relative temporal words against conversation timestamp and persist the anchor.",
    multi_hop_reasoning: "Combine top evidence from multiple observations and output causal summary.",
    multi_hop_fact_extraction: "Stage multi-hop answers through fact JSON extraction before final one-sentence output.",
    counterfactual_format: "Force counterfactual output to 'Conclusion. Reason: ...' format.",
    yes_no_decision: "Add contradiction/negation detection for yes/no responses.",
    location_extraction: "Extract location entities from top evidence and prefer shortest answer phrase.",
    entity_extraction: "Add entity-focused extraction rule for identity/relationship questions.",
    list_structuring: "Return comma-separated compact lists instead of conversational prose.",
    retrieval_alignment: "Increase candidate depth and query variants for zero-overlap failures.",
    retrieval_depth: "Increase search depth and keep at least top-3 quality candidates for cat-2/cat-3.",
    evidence_coverage: "Expand evidence merge to include multiple observation IDs before synthesis.",
    response_compression: "Trim filler text and keep one concise evidence-backed sentence.",
  };

  const topTags = Object.entries(byTag)
    .sort((lhs, rhs) => rhs[1] - lhs[1])
    .slice(0, 5);
  const now = new Date();
  const improvementTickets = topTags.map(([tag], index) => {
    const due = new Date(now.getTime());
    due.setUTCDate(now.getUTCDate() + 7 + index * 3);
    return {
      tag,
      owner: "owner:TBD",
      due: due.toISOString().slice(0, 10),
      status: "todo" as const,
      re_evaluation_result: "pending",
    };
  });

  return {
    schema_version: "locomo-failure-backlog-v1",
    generated_at: new Date().toISOString(),
    source_result_path: resultPath,
    ...(options.judgePath ? { source_judge_path: resolve(options.judgePath) } : {}),
    limit: options.limit,
    summary: {
      total_failures_considered: result.records.filter((record) => record.em === 0 || record.f1 < 1).length,
      selected_failures: topFailures.length,
      by_category: byCategory,
      by_tag: byTag,
    },
    review_evidence_spec: {
      required_artifacts: [
        "locomo10.runX.score-report.full.json",
        "locomo10.repro-report.json",
        "locomo10.failure-backlog.judged.json",
        "locomo10.failure-backlog.judged.md",
        "locomo10.runX.risk-notes.md",
      ],
      rejection_conditions: [
        "same dataset / judge / category constraints are not met",
        "missing required artifacts",
        "3-run stats (mean/stddev/min/max) are incomplete",
        "gate thresholds (Judge mean/stddev/p95/token avg) are unmet",
      ],
      comparison_requirements: [
        "same dataset path",
        "same judge model/temperature/prompt",
        "same category scope (cat-1..cat-4 for Judge)",
      ],
    },
    actions,
    improvement_tickets: improvementTickets,
    failures: topFailures,
  };
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const backlog = buildLocomoFailureBacklog(options);
  if (options.outputPath) {
    const outputPath = resolve(options.outputPath);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, `${JSON.stringify(backlog, null, 2)}\n`, "utf8");
  }
  if (options.markdownPath) {
    const markdownPath = resolve(options.markdownPath);
    mkdirSync(dirname(markdownPath), { recursive: true });
    writeFileSync(markdownPath, buildMarkdown(backlog), "utf8");
  }
  process.stdout.write(`${JSON.stringify(backlog, null, 2)}\n`);
}

if (import.meta.main) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
