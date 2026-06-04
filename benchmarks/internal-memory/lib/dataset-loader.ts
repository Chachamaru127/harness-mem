import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assertBenchmarkCase } from "./schema";
import type { BenchmarkCase } from "./types";

const ROOT = join(import.meta.dir, "..");

export function loadJsonlDataset(relativePath: string): BenchmarkCase[] {
  const fullPath = join(ROOT, relativePath);
  const source = readFileSync(fullPath, "utf8");
  const lines = source.split(/\r?\n/).filter((line) => line.trim().length > 0);
  return lines.map((line, index) => assertBenchmarkCase(JSON.parse(line), index + 1));
}

export function loadDefaultDatasets(): BenchmarkCase[] {
  return [
    ...loadJsonlDataset("datasets/public-retrieval-v1.jsonl"),
    ...loadJsonlDataset("datasets/coding-memory-ja-mixed-v1.jsonl"),
    ...loadRealDataDataset(),
  ];
}

export function loadRealDataDataset(): BenchmarkCase[] {
  try {
    return loadJsonlDataset("datasets/coding-memory-real-ja-mixed-v2.jsonl");
  } catch {
    try {
      return loadJsonlDataset("datasets/coding-memory-real-ja-mixed-v1.jsonl");
    } catch {
      return [];
    }
  }
}
