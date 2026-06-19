import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { inferCaseSourcePlatform } from "../lib/codingmemory-platform";
import { CODINGMEMORY_V3_DATASET_ID } from "../lib/dataset-loader";
import { assertBenchmarkCase } from "../lib/schema";
import type { BenchmarkCase } from "../lib/types";

const ROOT = join(import.meta.dir, "..");
const V2_PATH = join(ROOT, "datasets/coding-memory-real-ja-mixed-v2.jsonl");
const V3_PATH = join(ROOT, "datasets/coding-memory-real-ja-mixed-v3.jsonl");
const MANIFEST_PATH = join(ROOT, "datasets/codingmemory-v3-corpus-manifest.json");

export interface CodingMemoryCorpusManifest {
  schema_version: "codingmemory-corpus-v3";
  generated_at: string;
  source_dataset: string;
  case_count: number;
  language_profile: Record<string, number>;
  competency: Record<string, number>;
  source_platform: Record<string, number>;
  v2_diff: {
    case_count_delta: number;
    added_platform_metadata: boolean;
  };
}

export function buildV3FromV2(sourcePath: string = V2_PATH): {
  cases: BenchmarkCase[];
  manifest: CodingMemoryCorpusManifest;
} {
  const source = readFileSync(sourcePath, "utf8");
  const lines = source.split(/\r?\n/).filter((line) => line.trim().length > 0);
  const cases: BenchmarkCase[] = lines.map((line, index) => {
    const raw = JSON.parse(line) as BenchmarkCase;
    const validated = assertBenchmarkCase(raw, index + 1);
    return {
      ...validated,
      source_platform: inferCaseSourcePlatform(validated),
      source_dataset: CODINGMEMORY_V3_DATASET_ID,
    };
  });

  const language_profile: Record<string, number> = {};
  const competency: Record<string, number> = {};
  const source_platform: Record<string, number> = {};
  for (const row of cases) {
    language_profile[row.language_profile] = (language_profile[row.language_profile] ?? 0) + 1;
    const comp = row.competency ?? "AR";
    competency[comp] = (competency[comp] ?? 0) + 1;
    const platform = row.source_platform ?? "unknown";
    source_platform[platform] = (source_platform[platform] ?? 0) + 1;
  }

  const manifest: CodingMemoryCorpusManifest = {
    schema_version: "codingmemory-corpus-v3",
    generated_at: new Date().toISOString(),
    source_dataset: CODINGMEMORY_V3_DATASET_ID,
    case_count: cases.length,
    language_profile,
    competency,
    source_platform,
    v2_diff: {
      case_count_delta: 0,
      added_platform_metadata: true,
    },
  };

  return { cases, manifest };
}

export function writeCodingMemoryV3(outputPath: string = V3_PATH, sourcePath?: string): CodingMemoryCorpusManifest {
  const { cases, manifest } = buildV3FromV2(sourcePath ?? V2_PATH);
  writeFileSync(outputPath, `${cases.map((row) => JSON.stringify(row)).join("\n")}\n`);
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

if (import.meta.main) {
  if (!existsSync(V2_PATH)) {
    console.error(`missing source dataset: ${V2_PATH}`);
    process.exit(1);
  }
  const manifest = writeCodingMemoryV3();
  console.log(JSON.stringify({ ok: true, path: V3_PATH, manifest }, null, 2));
}
