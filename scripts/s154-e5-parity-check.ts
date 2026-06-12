/**
 * S154-503: incumbent-path parity check (exit 0/1).
 *
 * Compares the live multilingual-e5 local ONNX provider against the
 * pre-refactor snapshot (mean pooling + fitDimension era) on synthetic probe
 * strings. The per-model pooling refactor must not move the production
 * embedding path: worst-case cosine must stay above 1 - 1e-6.
 *
 * Runs as a standalone script because loading onnxruntime inside the bun
 * test runner crashes the runner (observed Bun 1.3.10); the test suite
 * spawns this script instead.
 */

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createEmbeddingProviderRegistry } from "../memory-server/src/embedding/registry";

const ROOT = resolve(import.meta.dir, "..");
const SNAPSHOT_PATH = join(ROOT, "memory-server/tests/fixtures/e5-parity-snapshot.json");

interface ParitySnapshot {
  model: string;
  dimension: number;
  probes: string[];
  passages: number[][];
  queries: number[][];
  single_passage_1: number[];
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / Math.sqrt(na * nb);
}

const snapshot = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")) as ParitySnapshot;
const registry = createEmbeddingProviderRegistry({
  providerName: "local",
  dimension: snapshot.dimension,
  localModelId: snapshot.model,
} as Parameters<typeof createEmbeddingProviderRegistry>[0]);
const provider = registry.provider;
if (provider.name !== "local" || provider.model !== snapshot.model) {
  console.error(`[s154-503-parity] provider fell back: ${provider.name}/${provider.model} (${registry.warnings.join("; ")})`);
  process.exit(1);
}

const primeBatch = (provider as unknown as {
  primeBatch: (texts: string[], mode: "passage" | "query") => Promise<number[][]>;
}).primeBatch.bind(provider);

const passages = await primeBatch(snapshot.probes, "passage");
const queries = await primeBatch(snapshot.probes, "query");
const single = await (provider as unknown as { prime: (text: string) => Promise<number[]> }).prime(
  snapshot.probes[1],
);

let worst = 1;
snapshot.passages.forEach((vector, index) => {
  worst = Math.min(worst, cosine(vector, passages[index]));
});
snapshot.queries.forEach((vector, index) => {
  worst = Math.min(worst, cosine(vector, queries[index]));
});
worst = Math.min(worst, cosine(snapshot.single_passage_1, single));

const pass = worst > 1 - 1e-6;
console.log(JSON.stringify({ check: "s154-503-e5-parity", worst_cosine: worst, threshold: 1 - 1e-6, pass }));
process.exit(pass ? 0 : 1);
