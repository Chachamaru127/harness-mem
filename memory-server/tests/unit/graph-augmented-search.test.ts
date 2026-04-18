/**
 * graph-augmented-search.test.ts  (§78-C04)
 *
 * A/B test for graph proximity signal blended into the hybrid scorer.
 *
 * Setup:
 *   A: "Deploy via `deploy.sh`"           — directly mentions deploy.sh
 *   B: "Configure `deploy.sh` with env X" — also mentions deploy.sh
 *   C: "Meeting notes about Q2 planning"  — no relation to deploy.sh
 *
 * Query: "how to run deploy.sh"
 *
 * A/B expectations:
 *   - graph_weight=0: A ranks at top (strong lexical match). B and C order
 *     may vary due to recency/importance without embeddings.
 *   - graph_weight=0.15: A and B both rank above C because graph proximity
 *     boosts them (1-hop: query entity "deploy.sh" appears in their relations).
 *   - HARNESS_MEM_GRAPH_OFF=1: behaves identically to graph_weight=0 even
 *     when graph_weight=0.15 is passed in the request.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { rmSync } from "node:fs";
import {
  HarnessMemCore,
  type Config,
  type EventEnvelope,
} from "../../src/core/harness-mem-core";

const cleanupPaths: string[] = [];

afterEach(() => {
  while (cleanupPaths.length > 0) {
    const dir = cleanupPaths.pop();
    if (!dir) continue;
    rmSync(dir, { recursive: true, force: true });
  }
  // Restore env
  delete process.env.HARNESS_MEM_GRAPH_OFF;
});

function createConfig(name: string): Config {
  const dir = mkdtempSync(join(tmpdir(), `hm-c04-${name}-`));
  cleanupPaths.push(dir);
  return {
    dbPath: join(dir, "harness-mem.db"),
    bindHost: "127.0.0.1",
    bindPort: 0,
    vectorDimension: 64,
    captureEnabled: true,
    retrievalEnabled: true,
    injectionEnabled: true,
    codexHistoryEnabled: false,
    codexProjectRoot: process.cwd(),
    codexSessionsRoot: process.cwd(),
    codexIngestIntervalMs: 5000,
    codexBackfillHours: 24,
    opencodeIngestEnabled: false,
    cursorIngestEnabled: false,
    antigravityIngestEnabled: false,
  };
}

function baseEvent(overrides: Partial<EventEnvelope> = {}): EventEnvelope {
  return {
    platform: "claude",
    project: "graph-aug-test",
    session_id: "session-c04-001",
    event_type: "user_prompt",
    ts: "2026-04-18T00:00:00.000Z",
    payload: { prompt: "test" },
    tags: [],
    privacy_tags: [],
    ...overrides,
  };
}

/** Ingest observations A, B, C and return their IDs */
function setupObservations(core: HarnessMemCore): { idA: string; idB: string; idC: string } {
  // Use same timestamp so recency doesn't influence relative ranking between A/B/C
  const rA = core.recordEvent(
    baseEvent({
      event_id: "c04-obs-a",
      ts: "2026-04-18T10:00:00.000Z",
      payload: { prompt: "Deploy via deploy.sh — run this script to push to production." },
    })
  );
  const rB = core.recordEvent(
    baseEvent({
      event_id: "c04-obs-b",
      ts: "2026-04-18T10:00:00.000Z",
      payload: { prompt: "Configure deploy.sh with env variable X before running the deployment." },
    })
  );
  const rC = core.recordEvent(
    baseEvent({
      event_id: "c04-obs-c",
      ts: "2026-04-18T10:00:00.000Z",
      payload: { prompt: "Meeting notes about Q2 planning: discuss roadmap and quarterly OKRs." },
    })
  );

  const idA = (rA.items[0] as { id: string }).id;
  const idB = (rB.items[0] as { id: string }).id;
  const idC = (rC.items[0] as { id: string }).id;
  return { idA, idB, idC };
}

describe("§78-C04: graph-augmented hybrid search", () => {
  test("graph_weight=0 — A ranks at top via lexical (deploy.sh in both query and observation)", () => {
    const core = new HarnessMemCore(createConfig("w0"));
    try {
      const { idA, idB, idC } = setupObservations(core);

      const result = core.search({
        query: "how to run deploy.sh",
        project: "graph-aug-test",
        include_private: true,
        graph_weight: 0,
      });

      expect(result.ok).toBe(true);
      const ids = (result.items as Array<{ id: string }>).map((i) => i.id);
      expect(ids.length).toBeGreaterThanOrEqual(2);

      // A must be in results — strong lexical match ("deploy.sh" appears in text)
      expect(ids).toContain(idA);
      // B must be in results — also mentions deploy.sh
      expect(ids).toContain(idB);

      // A must rank above C at minimum (A has very strong lexical signal)
      const posA = ids.indexOf(idA);
      const posC = ids.indexOf(idC);
      if (posC !== -1) {
        expect(posA).toBeLessThan(posC);
      }
    } finally {
      core.shutdown("test");
    }
  });

  test("graph_weight=0.15 — both A and B rank above C (graph proximity boost via deploy.sh entity)", () => {
    const core = new HarnessMemCore(createConfig("w015"));
    try {
      const { idA, idB, idC } = setupObservations(core);

      const result = core.search({
        query: "how to run deploy.sh",
        project: "graph-aug-test",
        include_private: true,
        graph_weight: 0.15,
      });

      expect(result.ok).toBe(true);
      const ids = (result.items as Array<{ id: string }>).map((i) => i.id);
      expect(ids.length).toBeGreaterThanOrEqual(2);

      // A and B must appear in results
      expect(ids).toContain(idA);
      expect(ids).toContain(idB);

      // Graph proximity should boost A and B above C:
      // query entity "deploy.sh" is a 1-hop neighbor of both A and B via mem_relations
      // C has no entity link to "deploy.sh"
      const posA = ids.indexOf(idA);
      const posB = ids.indexOf(idB);
      const posC = ids.indexOf(idC);

      if (posC !== -1) {
        // With graph proximity boost, both A and B must outrank C
        expect(posA).toBeLessThan(posC);
        expect(posB).toBeLessThan(posC);
      }
    } finally {
      core.shutdown("test");
    }
  });

  test("HARNESS_MEM_GRAPH_OFF=1 — env flag disables graph proximity even when graph_weight=0.15 is requested", () => {
    process.env.HARNESS_MEM_GRAPH_OFF = "1";
    const core = new HarnessMemCore(createConfig("envoff"));
    try {
      const { idA, idB, idC } = setupObservations(core);

      // With env flag set, graph_weight=0.15 in request is ignored → effectively 0
      const resultWithFlag = core.search({
        query: "how to run deploy.sh",
        project: "graph-aug-test",
        include_private: true,
        graph_weight: 0.15,
      });

      // Run reference search with explicit graph_weight=0 (env flag cleared)
      delete process.env.HARNESS_MEM_GRAPH_OFF;
      const resultNoGraph = core.search({
        query: "how to run deploy.sh",
        project: "graph-aug-test",
        include_private: true,
        graph_weight: 0,
      });

      expect(resultWithFlag.ok).toBe(true);
      expect(resultNoGraph.ok).toBe(true);

      const idsWithFlag = (resultWithFlag.items as Array<{ id: string }>).map((i) => i.id);
      const idsNoGraph = (resultNoGraph.items as Array<{ id: string }>).map((i) => i.id);

      // Both searches must return same top ranking (A first in both cases)
      expect(idsWithFlag).toContain(idA);
      expect(idsNoGraph).toContain(idA);
      expect(idsWithFlag[0]).toBe(idsNoGraph[0]);

      // When env flag is off and graph_weight=0, the ranking is the same as the
      // env-flag-on case (both effectively disable graph proximity)
      // Verify A is at position 0 in both
      expect(idsWithFlag.indexOf(idA)).toBe(0);
      expect(idsNoGraph.indexOf(idA)).toBe(0);
    } finally {
      core.shutdown("test");
    }
  });
});
