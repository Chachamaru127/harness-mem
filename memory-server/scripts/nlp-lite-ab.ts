#!/usr/bin/env bun
/**
 * nlp-lite-ab.ts  (§F-1 / S78-C02b)
 *
 * A/B comparison harness for the NLP-lite discriminators.
 *
 *   - Baseline (§78-C02): no type/kind classification — every entity is
 *     implicitly "other" and every relation is implicitly "generic".
 *   - Treatment (§F-1):   classifyEntityType + classifyRelationKind.
 *
 * Inputs:  memory-server/tests/fixtures/nlp-lite-corpus.json
 * Outputs: docs/benchmarks/s78-c02b-nlp-ab-2026-06-19.json
 *
 * The output JSON is **measured**, not synthetic — every number comes from
 * comparing classifier output against the hand-labeled corpus.  The only
 * synthetic field is the comparison against the baseline, which is trivially
 * predictable (baseline = constant "other" / "generic") but we still
 * compute it explicitly here so the numbers carry their own provenance.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import {
  classifyEntityType,
  classifyRelationKind,
  type EntityType,
  type RelationKind,
} from "../src/core/nlp-lite";

interface Corpus {
  observations: Array<{
    id: string;
    text: string;
    entities: Record<string, EntityType>;
    relations: Record<string, RelationKind>;
  }>;
}

const ENTITY_LABELS: EntityType[] = ["person", "technology", "action", "other"];
const RELATION_LABELS: RelationKind[] = ["is_a", "uses", "fixes", "generic"];

interface ConfusionRow {
  tp: number;
  fp: number;
  fn: number;
}

function emptyConfusion<T extends string>(labels: readonly T[]): Record<T, ConfusionRow> {
  const out = {} as Record<T, ConfusionRow>;
  for (const l of labels) out[l] = { tp: 0, fp: 0, fn: 0 };
  return out;
}

function add(c: Record<string, ConfusionRow>, gold: string, pred: string): void {
  if (gold === pred) {
    c[gold].tp += 1;
  } else {
    c[pred].fp += 1;
    c[gold].fn += 1;
  }
}

function pr(row: ConfusionRow): { precision: number; recall: number; f1: number } {
  const precision = row.tp + row.fp === 0 ? 0 : row.tp / (row.tp + row.fp);
  const recall = row.tp + row.fn === 0 ? 0 : row.tp / (row.tp + row.fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return { precision, recall, f1 };
}

function macroF1<T extends string>(
  c: Record<T, ConfusionRow>,
  labels: readonly T[],
): number {
  let sum = 0;
  for (const l of labels) sum += pr(c[l]).f1;
  return sum / labels.length;
}

function summarize<T extends string>(
  c: Record<T, ConfusionRow>,
  labels: readonly T[],
): Record<T, { precision: number; recall: number; f1: number; support: number }> {
  const out: Record<string, { precision: number; recall: number; f1: number; support: number }> = {};
  for (const l of labels) {
    const { precision, recall, f1 } = pr(c[l]);
    out[l] = {
      precision: round(precision),
      recall: round(recall),
      f1: round(f1),
      support: c[l].tp + c[l].fn,
    };
  }
  return out as Record<T, { precision: number; recall: number; f1: number; support: number }>;
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function main(): void {
  const corpusPath = resolve(__dirname, "..", "tests", "fixtures", "nlp-lite-corpus.json");
  const corpus: Corpus = JSON.parse(readFileSync(corpusPath, "utf8"));

  // --- Entity classification --------------------------------------------
  const baselineEntity = emptyConfusion(ENTITY_LABELS);
  const treatmentEntity = emptyConfusion(ENTITY_LABELS);
  let totalEntities = 0;
  let entityLatencyNs = 0;

  for (const obs of corpus.observations) {
    for (const [label, gold] of Object.entries(obs.entities)) {
      // Baseline: everything is "other".
      add(baselineEntity, gold, "other");

      const t0 = performance.now();
      const pred = classifyEntityType(label, obs.text);
      entityLatencyNs += (performance.now() - t0) * 1e6;
      add(treatmentEntity, gold, pred);
      totalEntities += 1;
    }
  }

  // --- Relation classification ------------------------------------------
  const baselineRelation = emptyConfusion(RELATION_LABELS);
  const treatmentRelation = emptyConfusion(RELATION_LABELS);
  let totalRelations = 0;
  let relationLatencyNs = 0;

  for (const obs of corpus.observations) {
    for (const [pairKey, gold] of Object.entries(obs.relations)) {
      const [src, dst] = pairKey.split("::");
      // Baseline: everything is "generic" (former "co-occurs").
      add(baselineRelation, gold, "generic");

      const t0 = performance.now();
      const pred = classifyRelationKind(src, dst, obs.text);
      relationLatencyNs += (performance.now() - t0) * 1e6;
      add(treatmentRelation, gold, pred);
      totalRelations += 1;
    }
  }

  const result = {
    schema: "harness-mem/nlp-lite-ab/v1",
    generated_at: new Date().toISOString(),
    corpus: {
      path: "memory-server/tests/fixtures/nlp-lite-corpus.json",
      observation_count: corpus.observations.length,
      entity_label_count: totalEntities,
      relation_label_count: totalRelations,
      measured: true,
      synthetic: false,
    },
    entity_type: {
      measured: true,
      synthetic: false,
      baseline: {
        strategy: "constant: every entity classified as 'other'",
        per_class: summarize(baselineEntity, ENTITY_LABELS),
        macro_f1: round(macroF1(baselineEntity, ENTITY_LABELS)),
      },
      treatment: {
        strategy: "classifyEntityType heuristic (§F-1)",
        per_class: summarize(treatmentEntity, ENTITY_LABELS),
        macro_f1: round(macroF1(treatmentEntity, ENTITY_LABELS)),
      },
      mean_latency_us: round(entityLatencyNs / Math.max(totalEntities, 1) / 1000),
    },
    relation_kind: {
      measured: true,
      synthetic: false,
      baseline: {
        strategy: "constant: every relation classified as 'generic'",
        per_class: summarize(baselineRelation, RELATION_LABELS),
        macro_f1: round(macroF1(baselineRelation, RELATION_LABELS)),
      },
      treatment: {
        strategy: "classifyRelationKind heuristic (§F-1)",
        per_class: summarize(treatmentRelation, RELATION_LABELS),
        macro_f1: round(macroF1(treatmentRelation, RELATION_LABELS)),
      },
      mean_latency_us: round(relationLatencyNs / Math.max(totalRelations, 1) / 1000),
    },
    go_mcp_cold_start: {
      measured: false,
      synthetic: true,
      note: "Populated by mcp-server-go/internal/tools/coldstart_test.go (see TestColdStart_HarnessMemSubset).  Run `go test ./internal/tools -run TestColdStart_HarnessMemSubset -v` and copy the reported median ms here.",
      target_ms: 5
    }
  };

  const outDir = resolve(__dirname, "..", "..", "docs", "benchmarks");
  mkdirSync(outDir, { recursive: true });
  const outPath = resolve(outDir, "s78-c02b-nlp-ab-2026-06-19.json");
  writeFileSync(outPath, JSON.stringify(result, null, 2) + "\n", "utf8");
  console.log(`wrote ${outPath}`);
}

main();
