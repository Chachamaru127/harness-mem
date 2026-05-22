import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

export const REQUIRED_ADR_FIELDS = [
  "title",
  "status",
  "options",
  "consequences",
  "supersedes",
  "source_plans_section",
] as const;

export const ADR_STATUSES = [
  "Proposed",
  "Accepted",
  "Superseded",
  "Deprecated",
  "Rejected",
] as const;

export type RequiredAdrField = (typeof REQUIRED_ADR_FIELDS)[number];

export interface AdrNewInput {
  project: string;
  title: string;
  status: string;
  options: string[];
  consequences: string[];
  supersedes: string[];
  sourcePlansSection: string;
  context?: string;
  boundary: string[];
  evidence: string[];
  decision?: string;
  signals: string[];
  slug?: string;
  number?: number;
  now?: string;
}

export interface AdrNewPlan {
  ok: true;
  command: "adr.new";
  mode: "dry-run" | "write";
  project: string;
  path: string;
  relative_path: string;
  number: number;
  slug: string;
  title: string;
  status: string;
  writes: 0 | 1;
  validation: {
    ok: true;
    required_fields: RequiredAdrField[];
  };
  legacy: {
    migration_candidates: string[];
    index_target: string;
  };
  content: string;
}

export class AdrValidationError extends Error {
  readonly fields: string[];

  constructor(fields: string[]) {
    super(`ADR validation failed: missing or invalid required fields: ${fields.join(", ")}`);
    this.name = "AdrValidationError";
    this.fields = fields;
  }
}

export function buildAdrNewPlan(input: AdrNewInput, write: boolean): AdrNewPlan {
  const project = resolve(input.project || process.cwd());
  const validationErrors = validateAdrInput(input);
  if (validationErrors.length > 0) {
    throw new AdrValidationError(validationErrors);
  }

  const existingNumbers = collectExistingAdrNumbers(project);
  const number = input.number ?? nextAdrNumber(existingNumbers);
  if (!Number.isInteger(number) || number <= 0) {
    throw new AdrValidationError(["number"]);
  }
  if (input.number && existingNumbers.has(input.number)) {
    throw new Error(`ADR number already exists: ADR-${padAdrNumber(input.number)}`);
  }

  const slug = slugify(input.slug || input.title);
  const relativePath = ["docs", "adr", `ADR-${padAdrNumber(number)}-${slug}.md`].join("/");
  const outputPath = join(project, ...relativePath.split("/"));
  const status = normalizeStatus(input.status);
  const content = renderAdrTemplate({
    ...input,
    project,
    status,
    number,
    slug,
    now: input.now ?? new Date().toISOString().slice(0, 10),
  });

  const plan: AdrNewPlan = {
    ok: true,
    command: "adr.new",
    mode: write ? "write" : "dry-run",
    project,
    path: outputPath,
    relative_path: relativePath,
    number,
    slug,
    title: input.title.trim(),
    status,
    writes: write ? 1 : 0,
    validation: {
      ok: true,
      required_fields: [...REQUIRED_ADR_FIELDS],
    },
    legacy: {
      migration_candidates: collectLegacyAdrCandidates(project),
      index_target: "docs/adr/README.md",
    },
    content,
  };

  if (write) {
    if (existsSync(outputPath)) {
      throw new Error(`ADR file already exists: ${outputPath}`);
    }
    mkdirSync(join(project, "docs", "adr"), { recursive: true });
    writeFileSync(outputPath, content, "utf8");
  }

  return plan;
}

export function validateAdrInput(input: AdrNewInput): string[] {
  const missing: string[] = [];

  if (!input.title?.trim()) missing.push("title");
  if (!input.status?.trim() || !isKnownStatus(input.status)) missing.push("status");
  if (cleanList(input.options).length === 0) missing.push("options");
  if (cleanList(input.consequences).length === 0) missing.push("consequences");
  if (cleanList(input.supersedes).length === 0) missing.push("supersedes");
  if (!isPlansSectionRef(input.sourcePlansSection)) missing.push("source_plans_section");

  return missing;
}

export function renderAdrTemplate(input: AdrNewInput & {
  number: number;
  slug: string;
  now: string;
}): string {
  const title = input.title.trim();
  const date = input.now.slice(0, 10);
  const status = normalizeStatus(input.status);
  const context = input.context?.trim() || "TBD";
  const decision = input.decision?.trim() || "TBD";
  const boundary = cleanList(input.boundary);
  const evidence = cleanList(input.evidence);
  const signals = cleanList(input.signals);

  return [
    `# ADR-${padAdrNumber(input.number)}: ${title}`,
    "",
    `Date: ${date}`,
    `Status: ${status}`,
    `Source Plans Section: ${input.sourcePlansSection.trim()}`,
    "",
    "---",
    "",
    "## Status",
    "",
    status,
    "",
    "## Source Plans Section",
    "",
    input.sourcePlansSection.trim(),
    "",
    "## Context",
    "",
    context,
    "",
    "## Boundary",
    "",
    renderList(boundary, ["Owner repo: harness-mem", "Non-goals: TBD"]),
    "",
    "## Evidence",
    "",
    renderList(evidence, [input.sourcePlansSection.trim()]),
    "",
    "## Options",
    "",
    renderList(cleanList(input.options)),
    "",
    "## Decision",
    "",
    decision,
    "",
    "## Signals",
    "",
    renderList(signals, ["Review if the validation gates for this ADR stop passing."]),
    "",
    "## Consequences",
    "",
    renderList(cleanList(input.consequences)),
    "",
    "## Supersedes",
    "",
    renderList(cleanList(input.supersedes)),
    "",
  ].join("\n");
}

export function collectExistingAdrNumbers(project: string): Set<number> {
  const numbers = new Set<number>();
  const docsDir = join(project, "docs");
  const adrDir = join(docsDir, "adr");

  for (const filename of safeReadDir(adrDir)) {
    addAdrNumber(numbers, filename);
  }
  for (const filename of safeReadDir(docsDir)) {
    if (/^adr-\d+/i.test(filename)) {
      addAdrNumber(numbers, filename);
    }
  }

  return numbers;
}

export function collectLegacyAdrCandidates(project: string): string[] {
  const docsDir = join(project, "docs");
  return safeReadDir(docsDir)
    .filter((filename) => /^adr-\d+-.+\.md$/i.test(filename))
    .map((filename) => `docs/${filename}`)
    .sort();
}

export function nextAdrNumber(existingNumbers: Set<number>): number {
  let max = 0;
  for (const number of existingNumbers) {
    max = Math.max(max, number);
  }
  return max + 1;
}

export function padAdrNumber(number: number): string {
  return String(number).padStart(3, "0");
}

export function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64)
    .replace(/-+$/g, "");
  return slug || "decision";
}

export function cleanList(values: string[]): string[] {
  return values
    .flatMap((value) => splitListValue(value))
    .map((value) => value.trim())
    .filter(Boolean);
}

function splitListValue(value: string): string[] {
  return String(value ?? "")
    .split(/\r?\n|;/)
    .flatMap((part) => part.split(/,(?=\s*[A-Za-z0-9_-]+:)/));
}

function normalizeStatus(status: string): string {
  const raw = status.trim().toLowerCase();
  const found = ADR_STATUSES.find((candidate) => candidate.toLowerCase() === raw);
  return found ?? status.trim();
}

function isKnownStatus(status: string): boolean {
  const raw = status.trim().toLowerCase();
  return ADR_STATUSES.some((candidate) => candidate.toLowerCase() === raw);
}

function isPlansSectionRef(value: string): boolean {
  const raw = value?.trim() ?? "";
  return /(?:^|\b)Plans\.md\b/i.test(raw) && /§\s*\d+/.test(raw);
}

function renderList(values: string[], fallback: string[] = []): string {
  return (values.length > 0 ? values : fallback).map((value) => `- ${value}`).join("\n");
}

function safeReadDir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function addAdrNumber(numbers: Set<number>, filenameOrPath: string): void {
  const filename = basename(filenameOrPath);
  const match = filename.match(/^ADR-(\d+)-/i) ?? filename.match(/^adr-(\d+)-/i);
  if (!match) return;
  const number = Number(match[1]);
  if (Number.isInteger(number) && number > 0) {
    numbers.add(number);
  }
}
