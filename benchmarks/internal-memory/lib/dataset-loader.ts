import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { assertBenchmarkCase } from "./schema";
import type { BenchmarkCase } from "./types";

const ROOT = join(import.meta.dir, "..");

export const CODINGMEMORY_V3_DATASET_ID = "coding-memory-real-ja-mixed-v3";
export const CODINGMEMORY_V3_FILE = "datasets/coding-memory-real-ja-mixed-v3.jsonl";
export const CODINGMEMORY_V2_FILE = "datasets/coding-memory-real-ja-mixed-v2.jsonl";
export const CODINGMEMORY_V1_FILE = "datasets/coding-memory-real-ja-mixed-v1.jsonl";

export function loadJsonlDataset(relativePath: string): BenchmarkCase[] {
  const fullPath = join(ROOT, relativePath);
  const source = readFileSync(fullPath, "utf8");
  const lines = source.split(/\r?\n/).filter((line) => line.trim().length > 0);
  return lines.map((line, index) => assertBenchmarkCase(JSON.parse(line), index + 1));
}

export function resolveRealDataDatasetFile(): string | null {
  for (const file of [CODINGMEMORY_V3_FILE, CODINGMEMORY_V2_FILE, CODINGMEMORY_V1_FILE]) {
    if (existsSync(join(ROOT, file))) return file;
  }
  return null;
}

export function loadRealDataDataset(): BenchmarkCase[] {
  const file = resolveRealDataDatasetFile();
  if (!file) return [];
  return loadJsonlDataset(file);
}

export function loadCodingMemoryDataset(version: "auto" | "v3" | "v2" | "v1" = "auto"): BenchmarkCase[] {
  const order =
    version === "auto"
      ? [CODINGMEMORY_V3_FILE, CODINGMEMORY_V2_FILE, CODINGMEMORY_V1_FILE]
      : version === "v3"
        ? [CODINGMEMORY_V3_FILE]
        : version === "v2"
          ? [CODINGMEMORY_V2_FILE]
          : [CODINGMEMORY_V1_FILE];
  for (const file of order) {
    try {
      return loadJsonlDataset(file);
    } catch {
      // try next
    }
  }
  return [];
}

export function loadDefaultDatasets(): BenchmarkCase[] {
  return [
    ...loadJsonlDataset("datasets/public-retrieval-v1.jsonl"),
    ...loadJsonlDataset("datasets/coding-memory-ja-mixed-v1.jsonl"),
    ...loadRealDataDataset(),
  ];
}
