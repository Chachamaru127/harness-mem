#!/usr/bin/env bun
import {
  AdrValidationError,
  buildAdrNewPlan,
  type AdrNewInput,
  type AdrNewPlan,
} from "./adr-template";

type AdrSubcommand = "new" | "help";

interface CliOptions extends AdrNewInput {
  write: boolean;
  dryRun: boolean;
  json: boolean;
}

function main(argv: string[]): number {
  const subcommand = normalizeSubcommand(argv[0]);
  if (subcommand === "help") {
    printUsage();
    return 0;
  }

  const options = parseNewOptions(argv.slice(1));
  const payload = buildAdrNewPlan(options, options.write);
  printResult(payload, options.json);
  return 0;
}

function normalizeSubcommand(raw: string | undefined): AdrSubcommand {
  if (!raw || raw === "help" || raw === "-h" || raw === "--help") return "help";
  if (raw === "new") return raw;
  throw new Error(`unknown adr subcommand: ${raw}`);
}

function parseNewOptions(args: string[]): CliOptions {
  const options: CliOptions = {
    project: process.cwd(),
    title: "",
    status: "",
    options: [],
    consequences: [],
    supersedes: [],
    sourcePlansSection: "",
    boundary: [],
    evidence: [],
    signals: [],
    write: false,
    dryRun: true,
    json: false,
  };
  let writeSeen = false;
  let dryRunSeen = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    switch (arg) {
      case "--project":
        options.project = requireValue(args, ++index, arg);
        break;
      case "--title":
        options.title = requireValue(args, ++index, arg);
        break;
      case "--status":
        options.status = requireValue(args, ++index, arg);
        break;
      case "--option":
      case "--options":
        options.options.push(requireValue(args, ++index, arg));
        break;
      case "--consequence":
      case "--consequences":
        options.consequences.push(requireValue(args, ++index, arg));
        break;
      case "--supersedes":
        options.supersedes.push(requireValue(args, ++index, arg));
        break;
      case "--source-plans":
      case "--source-plans-section":
        options.sourcePlansSection = requireValue(args, ++index, arg);
        break;
      case "--context":
        options.context = requireValue(args, ++index, arg);
        break;
      case "--boundary":
        options.boundary.push(requireValue(args, ++index, arg));
        break;
      case "--evidence":
        options.evidence.push(requireValue(args, ++index, arg));
        break;
      case "--decision":
        options.decision = requireValue(args, ++index, arg);
        break;
      case "--signal":
      case "--signals":
        options.signals.push(requireValue(args, ++index, arg));
        break;
      case "--slug":
        options.slug = requireValue(args, ++index, arg);
        break;
      case "--number":
        options.number = parsePositiveInteger(requireValue(args, ++index, arg), arg);
        break;
      case "--now":
        options.now = requireValue(args, ++index, arg);
        break;
      case "--write":
        writeSeen = true;
        options.write = true;
        options.dryRun = false;
        break;
      case "--dry-run":
        dryRunSeen = true;
        options.dryRun = true;
        options.write = false;
        break;
      case "--json":
        options.json = true;
        break;
      case "-h":
      case "--help":
        printUsage();
        process.exit(0);
      default:
        if (arg?.startsWith("-")) {
          throw new Error(`unknown adr new option: ${arg}`);
        }
        if (!options.title) {
          options.title = arg ?? "";
        } else {
          throw new Error(`unexpected extra argument: ${arg}`);
        }
    }
  }

  if (writeSeen && dryRunSeen) {
    throw new Error("adr new accepts either --dry-run or --write, not both");
  }

  return options;
}

function printResult(payload: AdrNewPlan, json: boolean): void {
  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(`adr new ${payload.mode}`);
  console.log(`path: ${payload.relative_path}`);
  console.log(`writes: ${payload.writes}`);
  console.log(`validation: ok`);
  if (payload.legacy.migration_candidates.length > 0) {
    console.log(`legacy_candidates: ${payload.legacy.migration_candidates.join(", ")}`);
  }
  console.log("");
  console.log(payload.content);
}

function printUsage(): void {
  console.log(`Usage:
  harness-mem adr new --title <title> --status <Proposed|Accepted|Superseded|Deprecated|Rejected> \\
    --options <text> --consequences <text> --supersedes <text> --source-plans "Plans.md §NNN" \\
    [--context <text>] [--boundary <text>] [--evidence <text>] [--decision <text>] [--signals <text>] \\
    [--slug <slug>] [--number <n>] [--project <path>] [--dry-run|--write] [--json]

Notes:
  dry-run is the default. Use --write to create docs/adr/ADR-NNN-*.md.
`);
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function parsePositiveInteger(value: string, flag: string): number {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`${flag} requires a positive integer`);
  }
  return number;
}

try {
  process.exit(main(process.argv.slice(2)));
} catch (error) {
  if (error instanceof AdrValidationError) {
    console.error(`[harness-mem][adr][error] ${error.message}`);
    process.exit(2);
  }
  console.error(`[harness-mem][adr][error] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
