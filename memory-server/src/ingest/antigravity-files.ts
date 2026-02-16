import { createHash } from "node:crypto";
import { basename, extname } from "node:path";

export type AntigravityFileKind = "checkpoint" | "codex_response";

export interface ParsedAntigravityFileEvent {
  kind: AntigravityFileKind;
  eventType: "checkpoint" | "tool_use";
  sessionId: string;
  project: string;
  timestamp: string;
  payload: Record<string, unknown>;
  contentHash: string;
  dedupeHash: string;
}

export function parseAntigravityFile(params: {
  sourceKey: string;
  filePath: string;
  workspaceRoot: string;
  content: string;
  fallbackNowIso: () => string;
  mtimeMs?: number;
}): ParsedAntigravityFileEvent | null {
  const normalizedPath = normalizePath(params.filePath);
  const kind = detectAntigravityFileKind(normalizedPath);
  if (!kind) {
    return null;
  }

  const trimmed = params.content.trim();
  if (!trimmed) {
    return null;
  }

  const project = basename(params.workspaceRoot) || "unknown";
  const fileStem = getFileStem(params.filePath) || "unknown";
  const timestamp = toIsoFromUnixMs(params.mtimeMs) || params.fallbackNowIso();
  const titleFromDoc = extractMarkdownHeading(trimmed);
  const content = trimmed.slice(0, 12000);
  const contentHash = createHash("sha256").update(content).digest("hex");
  const dedupeHash = createHash("sha256")
    .update(`${params.sourceKey}:${contentHash}`)
    .digest("hex");

  if (kind === "checkpoint") {
    const title = titleFromDoc || `checkpoint:${fileStem}`;
    return {
      kind,
      eventType: "checkpoint",
      sessionId: `antigravity:${project}:${fileStem}`,
      project,
      timestamp,
      payload: {
        source_type: "antigravity_checkpoint",
        title,
        content,
        file_path: params.filePath,
        file_stem: fileStem,
      },
      contentHash,
      dedupeHash,
    };
  }

  const toolName = inferCodexToolNameFromStem(fileStem);
  const title = titleFromDoc || `${toolName}: ${fileStem}`;
  return {
    kind,
    eventType: "tool_use",
    sessionId: `antigravity:${project}:${fileStem}`,
    project,
    timestamp,
    payload: {
      source_type: "antigravity_codex_response",
      title,
      content,
      tool_name: toolName,
      file_path: params.filePath,
      file_stem: fileStem,
    },
    contentHash,
    dedupeHash,
  };
}

export function detectAntigravityFileKind(filePath: string): AntigravityFileKind | null {
  const normalized = normalizePath(filePath);
  if (normalized.includes("/docs/checkpoints/")) {
    return "checkpoint";
  }
  if (normalized.includes("/logs/codex-responses/")) {
    return "codex_response";
  }
  return null;
}

function inferCodexToolNameFromStem(stem: string): string {
  const lowerStem = stem.toLowerCase();
  if (lowerStem.startsWith("review-")) {
    return "codex-review";
  }
  if (lowerStem.startsWith("design-") || lowerStem.startsWith("analyze-")) {
    return "codex-design";
  }
  if (lowerStem.startsWith("debug-")) {
    return "codex-debug";
  }
  return "codex-review";
}

function extractMarkdownHeading(content: string): string {
  const lines = content.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith("#")) {
      continue;
    }
    const heading = line.replace(/^#+\s*/, "").trim();
    if (!heading) {
      continue;
    }
    return heading.slice(0, 200);
  }
  return "";
}

function getFileStem(filePath: string): string {
  const fileName = basename(filePath);
  const ext = extname(fileName);
  if (!ext) {
    return fileName;
  }
  return fileName.slice(0, -ext.length);
}

function toIsoFromUnixMs(value: unknown): string {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return "";
  }
  return new Date(value).toISOString();
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/");
}
