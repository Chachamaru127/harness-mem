import type { BenchmarkCase } from "./types";

export type SourcePlatform = "claude" | "codex" | "cursor" | "mixed" | "unknown";

const PLATFORM_HINTS: Array<{ platform: SourcePlatform; patterns: RegExp[] }> = [
  {
    platform: "codex",
    patterns: [/codex_sessions/i, /\bcodex\b/i, /openai\.codex/i],
  },
  {
    platform: "cursor",
    patterns: [/\bcursor\b/i, /\.cursor\//i, /cursor-agent/i],
  },
  {
    platform: "claude",
    patterns: [/claude[- ]code/i, /\bclaude\b/i, /anthropic/i],
  },
];

export function inferPlatformFromText(text: string): SourcePlatform | null {
  const hits = new Set<SourcePlatform>();
  for (const { platform, patterns } of PLATFORM_HINTS) {
    if (patterns.some((pattern) => pattern.test(text))) {
      hits.add(platform);
    }
  }
  if (hits.size === 0) return null;
  if (hits.size === 1) return [...hits][0]!;
  return "mixed";
}

export function inferCaseSourcePlatform(caseRow: BenchmarkCase): SourcePlatform {
  const counts = new Map<SourcePlatform, number>();
  for (const memory of caseRow.memories) {
    const fromMeta = memory.metadata?.platform ?? memory.metadata?.source_platform;
    if (fromMeta === "claude" || fromMeta === "codex" || fromMeta === "cursor") {
      counts.set(fromMeta, (counts.get(fromMeta) ?? 0) + 1);
      continue;
    }
    const inferred = inferPlatformFromText(`${memory.content}\n${caseRow.project}`);
    if (inferred && inferred !== "mixed" && inferred !== "unknown") {
      counts.set(inferred, (counts.get(inferred) ?? 0) + 1);
    }
  }
  if (counts.size === 0) {
    const projectHint = inferPlatformFromText(caseRow.project);
    return projectHint ?? "unknown";
  }
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (sorted.length > 1 && sorted[0]![1] === sorted[1]![1]) return "mixed";
  return sorted[0]![0];
}

export function normalizeDbPlatform(platform: string | null | undefined): SourcePlatform | null {
  const value = platform?.trim().toLowerCase() ?? "";
  if (!value) return null;
  if (value.includes("codex")) return "codex";
  if (value.includes("cursor")) return "cursor";
  if (value.includes("claude")) return "claude";
  return null;
}
