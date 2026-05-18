export type PlansTaskStatus = "open" | "in_progress" | "closed" | "blocked";

export interface PlansParserOptions {
  source?: string;
  includeArchivedSections?: boolean;
}

export interface PlansSectionMetadata {
  id?: string;
  number?: string;
  title: string;
  heading: string;
  level: number;
  line: number;
  status?: PlansTaskStatus;
  raw_status?: string;
}

export interface ParsedPlansTask {
  id: string;
  source_ref: string;
  title: string;
  description: string;
  dod: string;
  depends_on: string[];
  status: PlansTaskStatus;
  raw_status: string;
  metadata: {
    parallel: boolean;
    section: PlansSectionMetadata;
    row_line: number;
    raw_task: string;
    raw_content: string;
    source?: string;
  };
}

export interface PlansParserDiagnostic {
  code: "malformed_table_row" | "unknown_status" | "invalid_dependency";
  severity: "warning";
  line: number;
  message: string;
  raw?: string;
}

export interface PlansSkippedRow {
  line: number;
  reason: "malformed_table_row" | "unknown_status";
  raw: string;
}

export interface PlansParseResult {
  tasks: ParsedPlansTask[];
  diagnostics: PlansParserDiagnostic[];
  skipped: PlansSkippedRow[];
}

interface TaskTableColumns {
  task: number;
  content: number;
  dod: number;
  depends: number;
  status: number;
}

const TASK_ID_PATTERN = /\b(?:S\d+(?:-[A-Za-z0-9.]+)+|[A-Z][A-Z0-9]*(?:-[A-Z0-9.]+)+|\d+(?:\.[A-Za-z0-9]+)+)\b/g;
const SECTION_PATTERN = /^(#{2,6})\s+(.+?)\s*$/;

const emptySection: PlansSectionMetadata = {
  title: "Unsectioned",
  heading: "",
  level: 0,
  line: 0,
};

export function parseActivePlansMarkdown(markdown: string, options: PlansParserOptions = {}): PlansParseResult {
  const tasks: ParsedPlansTask[] = [];
  const diagnostics: PlansParserDiagnostic[] = [];
  const skipped: PlansSkippedRow[] = [];
  const lines = markdown.split(/\r?\n/);

  let section: PlansSectionMetadata = emptySection;
  let tableColumns: TaskTableColumns | null = null;
  let skipSection = false;

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const heading = parseSectionHeading(line, lineNumber);
    if (heading) {
      section = heading;
      tableColumns = null;
      skipSection = !options.includeArchivedSections && isArchiveSection(heading);
      return;
    }

    if (skipSection) {
      return;
    }

    const cells = splitMarkdownTableRow(line);
    if (!cells) {
      tableColumns = null;
      return;
    }

    const headerColumns = parseTaskTableHeader(cells);
    if (headerColumns) {
      tableColumns = headerColumns;
      return;
    }

    if (!tableColumns || isMarkdownSeparatorRow(cells)) {
      return;
    }

    const highestColumn = Math.max(
      tableColumns.task,
      tableColumns.content,
      tableColumns.dod,
      tableColumns.depends,
      tableColumns.status
    );

    if (cells.length <= highestColumn) {
      addSkipped(
        diagnostics,
        skipped,
        "malformed_table_row",
        lineNumber,
        "Task table row does not contain all required columns",
        line
      );
      return;
    }

    const taskCell = cells[tableColumns.task] ?? "";
    const contentCell = cells[tableColumns.content] ?? "";
    const dodCell = cells[tableColumns.dod] ?? "";
    const dependsCell = cells[tableColumns.depends] ?? "";
    const statusCell = cells[tableColumns.status] ?? "";
    const taskId = extractTaskId(taskCell);

    if (!taskId) {
      addSkipped(
        diagnostics,
        skipped,
        "malformed_table_row",
        lineNumber,
        "Task table row does not contain a task id",
        line
      );
      return;
    }

    const status = normalizePlansStatus(statusCell);
    if (!status) {
      addSkipped(
        diagnostics,
        skipped,
        "unknown_status",
        lineNumber,
        `Unknown task status: ${stripMarkdown(statusCell) || "(empty)"}`,
        line
      );
      return;
    }

    const fallbackTitle = stripTaskAnnotations(stripMarkdown(taskCell).replace(taskId, "")).trim() || taskId;
    const { title, description } = extractTitleAndDescription(contentCell, fallbackTitle);
    const dependencyResult = parseDependsCell(dependsCell, lineNumber);
    diagnostics.push(...dependencyResult.diagnostics);

    tasks.push({
      id: taskId,
      source_ref: toPlansSourceRef(taskId),
      title,
      description,
      dod: stripMarkdown(dodCell),
      depends_on: dependencyResult.sourceRefs,
      status: status.status,
      raw_status: status.raw,
      metadata: {
        parallel: hasParallelMarker(taskCell) || hasParallelMarker(contentCell),
        section: { ...section },
        row_line: lineNumber,
        raw_task: taskCell,
        raw_content: contentCell,
        ...(options.source ? { source: options.source } : {}),
      },
    });
  });

  return { tasks, diagnostics, skipped };
}

export function parsePlansDryRun(markdown: string, options: PlansParserOptions = {}): PlansParseResult {
  return parseActivePlansMarkdown(markdown, options);
}

export function toPlansSourceRef(taskId: string): string {
  return `plans:${taskId}`;
}

export function normalizePlansStatus(rawStatus: string): { status: PlansTaskStatus; raw: string } | null {
  const raw = stripMarkdown(rawStatus);
  if (/^cc:TODO(?:\s|$|\[)/i.test(raw)) return { status: "open", raw };
  if (/^cc:WIP(?:\s|$|\[)/i.test(raw)) return { status: "in_progress", raw };
  if (/^cc:完了(?:\s|$|\[)/i.test(raw)) return { status: "closed", raw };
  if (/^blocked(?:\s|$|\[)/i.test(raw)) return { status: "blocked", raw };
  return null;
}

export function splitMarkdownTableRow(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|")) return null;

  const cells: string[] = [];
  let current = "";
  let escaped = false;
  let inCodeSpan = false;

  for (const char of trimmed) {
    if (char === "`" && !escaped) {
      inCodeSpan = !inCodeSpan;
    }

    if (char === "|" && !escaped && !inCodeSpan) {
      cells.push(current.trim());
      current = "";
    } else {
      current += char;
    }
    escaped = char === "\\" && !escaped;
    if (char !== "\\") escaped = false;
  }
  cells.push(current.trim());

  if (trimmed.startsWith("|")) cells.shift();
  if (trimmed.endsWith("|")) cells.pop();
  return cells.map((cell) => cell.replace(/\\\|/g, "|").trim());
}

function parseSectionHeading(line: string, lineNumber: number): PlansSectionMetadata | null {
  const match = line.match(SECTION_PATTERN);
  if (!match) return null;

  const level = match[1].length;
  const heading = match[2].trim();
  const sectionIdMatch = heading.match(/^(§(\d+(?:\.\d+)?))\s*(.*)$/);
  const rawTitle = sectionIdMatch ? sectionIdMatch[3].trim() : heading;
  const rawStatus = extractRawStatus(heading);
  const normalizedStatus = rawStatus ? normalizePlansStatus(rawStatus) : null;
  const title = stripMarkdown(
    rawTitle.replace(/\s+[—-]\s+(?:cc:TODO|cc:WIP|cc:完了(?:\s+\[[^\]]+\])?|blocked).*$/i, "")
  );

  return {
    ...(sectionIdMatch ? { id: sectionIdMatch[1], number: sectionIdMatch[2] } : {}),
    title: title || stripMarkdown(rawTitle) || heading,
    heading,
    level,
    line: lineNumber,
    ...(normalizedStatus ? { status: normalizedStatus.status, raw_status: normalizedStatus.raw } : {}),
  };
}

function parseTaskTableHeader(cells: string[]): TaskTableColumns | null {
  const normalized = cells.map((cell) => stripMarkdown(cell));
  const columns: TaskTableColumns = {
    task: normalized.indexOf("Task"),
    content: normalized.indexOf("内容"),
    dod: normalized.indexOf("DoD"),
    depends: normalized.indexOf("Depends"),
    status: normalized.indexOf("Status"),
  };

  if (Object.values(columns).some((column) => column < 0)) {
    return null;
  }
  return columns;
}

function isMarkdownSeparatorRow(cells: string[]): boolean {
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell.trim()));
}

function extractTaskId(cell: string): string | null {
  const match = stripMarkdown(cell).match(TASK_ID_PATTERN);
  return match?.[0] ?? null;
}

function extractTitleAndDescription(contentCell: string, fallbackTitle: string): { title: string; description: string } {
  const description = stripMarkdown(contentCell);
  const boldMatch = contentCell.match(/\*\*([^*]+)\*\*/);

  if (boldMatch) {
    const title = stripTaskAnnotations(stripMarkdown(boldMatch[1])).trim();
    return { title: title || fallbackTitle, description };
  }

  const [firstPart] = description.split(/\s+[—–-]\s+/);
  const title = stripTaskAnnotations(firstPart ?? "").trim();
  return { title: title || fallbackTitle, description };
}

function parseDependsCell(cell: string, line: number): { sourceRefs: string[]; diagnostics: PlansParserDiagnostic[] } {
  const diagnostics: PlansParserDiagnostic[] = [];
  const cleaned = stripMarkdown(cell);
  if (!cleaned || cleaned === "-" || cleaned === "—") {
    return { sourceRefs: [], diagnostics };
  }

  const refs = new Set<string>();
  for (const part of cleaned.split(/[,、]/)) {
    const ids = part.match(TASK_ID_PATTERN) ?? [];
    if (ids.length === 0 && part.trim()) {
      diagnostics.push({
        code: "invalid_dependency",
        severity: "warning",
        line,
        message: `Dependency does not contain a task id: ${part.trim()}`,
        raw: cell,
      });
      continue;
    }
    ids.forEach((id) => refs.add(toPlansSourceRef(id)));
  }

  return { sourceRefs: Array.from(refs), diagnostics };
}

function addSkipped(
  diagnostics: PlansParserDiagnostic[],
  skipped: PlansSkippedRow[],
  reason: PlansSkippedRow["reason"],
  line: number,
  message: string,
  raw: string
): void {
  diagnostics.push({ code: reason, severity: "warning", line, message, raw });
  skipped.push({ line, reason, raw });
}

function extractRawStatus(text: string): string | null {
  const match = stripMarkdown(text).match(/(?:cc:TODO|cc:WIP|cc:完了(?:\s+\[[^\]]+\])?|blocked)(?:\s|$|\[)/i);
  return match?.[0].trim() ?? null;
}

function hasParallelMarker(text: string): boolean {
  return /\[P\]/i.test(text);
}

function stripTaskAnnotations(text: string): string {
  return text.replace(/\s+\[[^\]]+\]/g, "").replace(/\[P\]/gi, "").trim();
}

function stripMarkdown(text: string): string {
  return text
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\\\|/g, "|")
    .replace(/\s+/g, " ")
    .trim();
}

function isArchiveSection(section: PlansSectionMetadata): boolean {
  const heading = stripMarkdown(section.heading).toLowerCase();
  const title = stripMarkdown(section.title).toLowerCase();
  return heading.includes("アーカイブ") || heading.includes("archive") || title.includes("アーカイブ") || title.includes("archive");
}
