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

  test("generates co-occurs relations between entities", () => {
    const { entities, relations } = extractEntitiesAndRelations(OBSERVATION);
    expect(relations.length).toBeGreaterThan(0);
    expect(relations.every((r) => r.kind === "co-occurs")).toBe(true);
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

    // At least one co-occurrence relation should have been inserted
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.kind === "co-occurs")).toBe(true);

    // Sanity: src/dst should look like lowercased entity labels
    const allIds = rows.flatMap((r) => [r.src, r.dst]);
    // "worker.ts" and "deploy.sh" should appear as src or dst
    expect(allIds.some((id) => id.includes("worker.ts") || id.includes("racecondition") || id.includes("deploy.sh"))).toBe(true);

    core.close?.();
  });
});
