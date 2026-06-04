import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { CandidateCase, FilterStats } from "./types";

export interface PipelineCheckpoint {
  schema_version: "real-data-checkpoint-v1";
  saved_at: string;
  phase: "exported" | "generated" | "filtered" | "judged" | "accepted";
  corpus_rounds?: number;
  candidates?: CandidateCase[];
  filter_stats?: FilterStats;
  passed?: CandidateCase[];
  judged?: CandidateCase[];
  accepted?: CandidateCase[];
}

export function loadCheckpoint(path: string): PipelineCheckpoint | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as PipelineCheckpoint;
  } catch {
    return null;
  }
}

export function saveCheckpoint(path: string, data: PipelineCheckpoint): void {
  writeFileSync(path, JSON.stringify(data, null, 2));
}
