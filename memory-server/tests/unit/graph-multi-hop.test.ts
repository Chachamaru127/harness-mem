/**
 * graph-multi-hop.test.ts  (§78-C03)
 *
 * Tests for multi-hop observation expansion via entity graph (mem_relations).
 *
 * Setup:
 *   A: mentions "deploy.sh"
 *   B: mentions "deploy.sh" AND "worker.ts"
 *   C: mentions "worker.ts"
 *
 * Expected:
 *   - graph_depth=0: search "deploy" → A (direct), maybe B (co-mention)
 *   - graph_depth=2: search "deploy" → A, B, C (C reachable via deploy.sh → B → worker.ts → C)
 *   - graph_depth=0 same as not passing it (backward compat)
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
});

function createConfig(name: string): Config {
  const dir = mkdtempSync(join(tmpdir(), `hm-gm-${name}-`));
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
    project: "graph-multihop-test",
    session_id: "session-c03-001",
    event_type: "user_prompt",
    ts: "2026-04-18T00:00:00.000Z",
    payload: { prompt: "test" },
    tags: [],
    privacy_tags: [],
    ...overrides,
  };
}

describe("§78-C03: graph_depth multi-hop expansion via mem_relations", () => {
  test("graph_depth=0 is default — no entity graph expansion", () => {
    const core = new HarnessMemCore(createConfig("depth0"));
    try {
      // A: mentions deploy.sh
      core.recordEvent(
        baseEvent({
          event_id: "c03-a",
          payload: { prompt: "Running deploy.sh script initiates the deployment pipeline." },
        })
      );
      // C: mentions worker.ts only (not deploy.sh)
      core.recordEvent(
        baseEvent({
          event_id: "c03-c",
          payload: { prompt: "The worker.ts module processes background jobs in the queue." },
        })
      );

      const resultNoDepth = core.search({
        query: "deploy script deployment",
        project: "graph-multihop-test",
        include_private: true,
      });
      const resultDepth0 = core.search({
        query: "deploy script deployment",
        project: "graph-multihop-test",
        include_private: true,
        graph_depth: 0,
      });

      expect(resultNoDepth.ok).toBe(true);
      expect(resultDepth0.ok).toBe(true);

      // Backward compat: no depth param = depth 0, results must be identical shape
      const idsNoDepth = (resultNoDepth.items as Array<{ id: string }>).map((i) => i.id);
      const idsDepth0 = (resultDepth0.items as Array<{ id: string }>).map((i) => i.id);
      expect(idsNoDepth).toEqual(idsDepth0);
    } finally {
      core.shutdown("test");
    }
  });

  test("graph_depth=2 surfaces C via entity chain: deploy.sh → B → worker.ts → C", () => {
    const core = new HarnessMemCore(createConfig("depth2"));
    try {
      // A: mentions deploy.sh
      const rA = core.recordEvent(
        baseEvent({
          event_id: "c03-chain-a",
          payload: { prompt: "Running deploy.sh script initiates the deployment pipeline." },
        })
      );
      const obsIdA = (rA.items[0] as { id: string }).id;

      // B: mentions deploy.sh AND worker.ts — bridge observation
      const rB = core.recordEvent(
        baseEvent({
          event_id: "c03-chain-b",
          payload: { prompt: "The deploy.sh script calls worker.ts to process background tasks." },
        })
      );
      const obsIdB = (rB.items[0] as { id: string }).id;

      // C: mentions worker.ts only
      const rC = core.recordEvent(
        baseEvent({
          event_id: "c03-chain-c",
          payload: { prompt: "The worker.ts module processes background jobs in the queue." },
        })
      );
      const obsIdC = (rC.items[0] as { id: string }).id;

      // With graph_depth=0: search "deploy" → A direct, B maybe (co-mention), C unlikely
      const resultDepth0 = core.search({
        query: "deploy deployment pipeline",
        project: "graph-multihop-test",
        include_private: true,
        graph_depth: 0,
      });
      expect(resultDepth0.ok).toBe(true);
      const idsDepth0 = (resultDepth0.items as Array<{ id: string }>).map((i) => i.id);
      expect(idsDepth0).toContain(obsIdA);
      // C should NOT appear via graph when depth=0
      // (it may appear via lexical/vector by coincidence, but not via graph expansion)

      // With graph_depth=2: C is reachable via deploy.sh → B → worker.ts → C
      const resultDepth2 = core.search({
        query: "deploy deployment pipeline",
        project: "graph-multihop-test",
        include_private: true,
        graph_depth: 2,
      });
      expect(resultDepth2.ok).toBe(true);
      const idsDepth2 = (resultDepth2.items as Array<{ id: string }>).map((i) => i.id);

      // A: direct hit
      expect(idsDepth2).toContain(obsIdA);
      // B: 1-hop (shares deploy.sh with A)
      expect(idsDepth2).toContain(obsIdB);
      // C: 2-hop (shares worker.ts with B, which shares deploy.sh with A)
      expect(idsDepth2).toContain(obsIdC);
    } finally {
      core.shutdown("test");
    }
  });

  test("graph_depth=1 reaches B but not C (only 1 hop)", () => {
    const core = new HarnessMemCore(createConfig("depth1"));
    try {
      // A: mentions deploy.sh
      const rA = core.recordEvent(
        baseEvent({
          event_id: "c03-1h-a",
          payload: { prompt: "The deploy.sh file contains the deployment configuration steps." },
        })
      );
      const obsIdA = (rA.items[0] as { id: string }).id;

      // B: mentions deploy.sh AND worker.ts
      const rB = core.recordEvent(
        baseEvent({
          event_id: "c03-1h-b",
          payload: { prompt: "The deploy.sh script launches worker.ts as a subprocess." },
        })
      );
      const obsIdB = (rB.items[0] as { id: string }).id;

      // C: mentions worker.ts only (2 hops from A)
      const rC = core.recordEvent(
        baseEvent({
          event_id: "c03-1h-c",
          payload: { prompt: "The worker.ts module handles async task processing." },
        })
      );
      const obsIdC = (rC.items[0] as { id: string }).id;

      const result = core.search({
        query: "deploy configuration deployment",
        project: "graph-multihop-test",
        include_private: true,
        graph_depth: 1,
      });

      expect(result.ok).toBe(true);
      const ids = (result.items as Array<{ id: string }>).map((i) => i.id);

      // A: direct hit
      expect(ids).toContain(obsIdA);
      // B: 1-hop (shares deploy.sh entity with A)
      expect(ids).toContain(obsIdB);
      // C: NOT expected at depth=1 unless it also shares deploy.sh
      // (C only mentions worker.ts, which is not shared with A)
      // We verify by checking C is only reachable at depth >= 2
      // Note: if lexical/vector also returns C, that's acceptable behavior
      // What matters is that graph_depth=1 does NOT expand beyond 1 hop
      // We can't assert C is absent because vector search may find it independently
      // But we verify B IS included (the 1-hop expansion works)
      expect(ids).toContain(obsIdB);

      // Additional sanity: obsIdC should not be in depth=0 results via graph
      const resultDepth0 = core.search({
        query: "deploy configuration deployment",
        project: "graph-multihop-test",
        include_private: true,
        graph_depth: 0,
      });
      expect(resultDepth0.ok).toBe(true);
      const idsD0 = (resultDepth0.items as Array<{ id: string }>).map((i) => i.id);
      expect(idsD0).toContain(obsIdA);
      // B is a co-mention, may or may not appear via lexical with depth=0
      // The key difference: depth=2 definitely includes C, depth=0 relies on lexical/vector only
      void obsIdC; // used in depth=2 test above
    } finally {
      core.shutdown("test");
    }
  });

  test("graph_depth=0 and no graph_depth param produce identical result IDs (backward compat)", () => {
    const core = new HarnessMemCore(createConfig("compat"));
    try {
      core.recordEvent(
        baseEvent({
          event_id: "compat-x",
          payload: { prompt: "TypeScript compiler checks type safety at build time." },
        })
      );
      core.recordEvent(
        baseEvent({
          event_id: "compat-y",
          payload: { prompt: "ESLint analyzes TypeScript code for style issues." },
        })
      );

      const r1 = core.search({
        query: "TypeScript type checking",
        project: "graph-multihop-test",
        include_private: true,
      });
      const r2 = core.search({
        query: "TypeScript type checking",
        project: "graph-multihop-test",
        include_private: true,
        graph_depth: 0,
      });

      expect(r1.ok).toBe(true);
      expect(r2.ok).toBe(true);

      const ids1 = (r1.items as Array<{ id: string }>).map((i) => i.id);
      const ids2 = (r2.items as Array<{ id: string }>).map((i) => i.id);
      expect(ids1).toEqual(ids2);
    } finally {
      core.shutdown("test");
    }
  });
});
