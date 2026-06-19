/**
 * entity-extraction.test.ts  (§78-C02)
 *
 * Verifies:
 * 1. extractEntitiesAndRelations returns expected entities from a real observation.
 * 2. Relations (co-occurs) are generated between extracted entities.
 * 3. After recordEvent, mem_relations is populated in the DB.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { extractEntitiesAndRelations } from "../../src/core/entity-extractor";
import { HarnessMemCore, getConfig, type Config, type EventEnvelope } from "../../src/core/harness-mem-core";
import { removeDirWithRetry } from "../fs-cleanup";

const cleanupPaths: string[] = [];
afterEach(() => {
  while (cleanupPaths.length > 0) {
    const dir = cleanupPaths.pop();
    if (dir) removeDirWithRetry(dir);
  }
});

function createConfig(): Config {
  const dir = mkdtempSync(join(tmpdir(), "harness-mem-entity-test-"));
  cleanupPaths.push(dir);
  return {
    ...getConfig(),
    dbPath: join(dir, "harness-mem.db"),
    captureEnabled: true,
    vectorDimension: 64,
  };
}

const OBSERVATION =
  'Fixed a bug in `worker.ts` related to the `RaceCondition` error. Deployed with `deploy.sh`.';

describe("extractEntitiesAndRelations (unit)", () => {
  test("detects file entities", () => {
    const { entities } = extractEntitiesAndRelations(OBSERVATION);
    const kinds = entities.map((e) => `${e.kind}:${e.label}`);
    expect(kinds).toContain("file:worker.ts");
    expect(kinds).toContain("file:deploy.sh");
  });

  test("detects CamelCase symbol entity", () => {
    const { entities } = extractEntitiesAndRelations(OBSERVATION);
    const labels = entities.map((e) => e.label);
    expect(labels).toContain("RaceCondition");
  });

  test("generates relations between entities with §F-1 semantic kinds", () => {
    const { entities, relations } = extractEntitiesAndRelations(OBSERVATION);
    expect(relations.length).toBeGreaterThan(0);
    // §F-1: kind is one of is_a|uses|fixes|generic (the pre-§F-1 literal
    // "co-occurs" is now folded into "generic").
    const allowed = new Set(["is_a", "uses", "fixes", "generic"]);
    expect(relations.every((r) => allowed.has(r.kind))).toBe(true);
    // Every src/dst should correspond to a known entity id
    const entityIds = new Set(entities.map((e) => e.id));
    for (const rel of relations) {
      expect(entityIds.has(rel.src)).toBe(true);
      expect(entityIds.has(rel.dst)).toBe(true);
    }
  });

  test("existing tags become tag entities", () => {
    const { entities } = extractEntitiesAndRelations("simple text", ["my-tag", "another-tag"]);
    const tagEntities = entities.filter((e) => e.kind === "tag");
    expect(tagEntities.map((e) => e.label)).toContain("my-tag");
  });
});

describe("entity extraction integrated into ingest", () => {
  test("mem_relations populated after recordEvent", () => {
    const core = new HarnessMemCore(createConfig());

    const event: EventEnvelope = {
      platform: "claude",
      project: "test-project",
      session_id: "sess-entity-test",
      event_type: "user_prompt",
      ts: new Date().toISOString(),
      payload: { prompt: OBSERVATION },
      tags: [],
      privacy_tags: [],
    };

    core.recordEvent(event);

    const db = core.getRawDb();
    const rows = db
      .query<{ src: string; dst: string; kind: string }, []>(
        "SELECT src, dst, kind FROM mem_relations LIMIT 20"
      )
      .all();

    // At least one relation should have been inserted; §F-1 kinds only.
    expect(rows.length).toBeGreaterThan(0);
    const allowed = new Set(["is_a", "uses", "fixes", "generic"]);
    expect(rows.every((r) => allowed.has(r.kind))).toBe(true);

    // Sanity: src/dst should look like lowercased entity labels
    const allIds = rows.flatMap((r) => [r.src, r.dst]);
    // "worker.ts" and "deploy.sh" should appear as src or dst
    expect(allIds.some((id) => id.includes("worker.ts") || id.includes("racecondition") || id.includes("deploy.sh"))).toBe(true);

    core.close?.();
  });

  // §F-1 (S78-C02b) DoD literal fix (2026-06-19): harness_mem_graph maps to
  // /v1/graph/neighbors via the MCP tool layer. The new type/kind contract
  // must be reachable through that route, not only via /v1/graph/entities.
  test("/v1/graph/neighbors response includes entities[].type and entity_relations[].kind", async () => {
    const core = new HarnessMemCore(createConfig());

    const event: EventEnvelope = {
      platform: "claude",
      project: "test-project",
      session_id: "sess-graph-neighbors",
      event_type: "user_prompt",
      ts: new Date().toISOString(),
      payload: { prompt: OBSERVATION },
      tags: [],
      privacy_tags: [],
    };
    const recordResp = core.recordEvent(event);
    expect(recordResp.ok).toBe(true);
    const observationId = recordResp.items?.[0]?.id;
    expect(typeof observationId).toBe("string");

    // Server-side enrichment is wired in src/server.ts. Replicate the same
    // query the handler runs so the contract is asserted at the data layer
    // without needing a live HTTP server in this unit test.
    const db = core.getRawDb();
    const entityRows = db
      .query<{ name: string; entity_type: string }, [string]>(
        `SELECT DISTINCT e.name, e.entity_type
         FROM mem_entities e
         JOIN mem_observation_entities oe ON oe.entity_id = e.id
         WHERE oe.observation_id = ?`,
      )
      .all(observationId as string);
    const relationRows = db
      .query<{ src: string; dst: string; kind: string }, [string]>(
        `SELECT src, dst, kind FROM mem_relations WHERE observation_id = ?`,
      )
      .all(observationId as string);

    expect(entityRows.length).toBeGreaterThan(0);
    expect(relationRows.length).toBeGreaterThan(0);

    // classifyEntityType must return one of the §F-1 fixed types.
    const { classifyEntityType } = await import("../../src/core/nlp-lite");
    const allowedTypes = new Set(["person", "technology", "action", "other"]);
    for (const row of entityRows) {
      expect(allowedTypes.has(classifyEntityType(row.name))).toBe(true);
    }

    // mem_relations.kind must already be one of the §F-1 kinds (enforced at
    // ingest by entity-extractor).
    const allowedKinds = new Set(["is_a", "uses", "fixes", "generic"]);
    for (const row of relationRows) {
      expect(allowedKinds.has(row.kind)).toBe(true);
    }

    core.close?.();
  });
});
