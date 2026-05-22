import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessMemCore, type Config } from "../../src/core/harness-mem-core";
import { startHarnessMemServer } from "../../src/server";

const SAMPLE_ADR = `# ADR-004: Recall Runtime ADR Ingestion

Date: 2026-05-22
Status: Accepted
Source Plans Section: Plans.md §128 S128-011

## Status

Accepted

## Source Plans Section

Plans.md §128 S128-011

## Evidence

- .claude/memory/decisions.md#D13

## Options

- SQLite projection
- Qdrant sidecar

## Decision

Use local projection as the hot recall path for ADR decisions.

## Consequences

- Repeat recall stays stable under large DBs
- ADR explanations can cite source plans

## Supersedes

- ADR-003
`;

function createRuntime(name: string): {
  baseUrl: string;
  stop: () => void;
} {
  const dir = mkdtempSync(join(tmpdir(), `harness-mem-adr-recall-${name}-`));
  const config: Config = {
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
  const core = new HarnessMemCore(config);
  const server = startHarnessMemServer(core, config);
  return {
    baseUrl: `http://127.0.0.1:${server.port}`,
    stop: () => {
      core.shutdown("test");
      server.stop(true);
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function postJson(baseUrl: string, path: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("ADR recall runtime ingestion", () => {
  test("retrieves ADR decisions by status/options/consequences/supersedes with provenance", async () => {
    const runtime = createRuntime("projection");
    const project = "adr-recall-project";
    try {
      const ingest = await postJson(runtime.baseUrl, "/v1/ingest/knowledge-file", {
        file_path: "docs/adr/ADR-004-recall-runtime-adr-ingestion.md",
        content: SAMPLE_ADR,
        kind: "adr",
        project,
      });
      expect(ingest.status).toBe(200);
      const ingestPayload = await ingest.json() as { ok: boolean; items: Array<Record<string, unknown>> };
      expect(ingestPayload.ok).toBe(true);
      expect(ingestPayload.items[0].entries_imported).toBe(1);

      const refresh = await postJson(runtime.baseUrl, "/v1/admin/recall-projection", {
        project,
        action: "write",
      });
      expect(refresh.status).toBe(200);

      for (const query of ["Accepted", "Qdrant sidecar", "stable under large DBs", "ADR-003"]) {
        const recall = await postJson(runtime.baseUrl, "/v1/recall", {
          query,
          project,
          limit: 5,
        });
        expect(recall.status).toBe(200);
        const payload = await recall.json() as {
          ok: boolean;
          items: Array<{
            recall_type?: string;
            source_type?: string;
            source_ref?: string;
            metadata?: Record<string, unknown>;
            provenance?: Record<string, unknown>;
            explanation?: Record<string, unknown>;
          }>;
          meta: Record<string, unknown>;
        };

        expect(payload.ok).toBe(true);
        expect(payload.meta.ranking).toBe("recall_projection_v1");
        expect(payload.items.length).toBeGreaterThan(0);
        expect(payload.items[0]).toMatchObject({
          recall_type: "decision",
          source_type: "adr",
          source_ref: "adr:docs/adr/ADR-004-recall-runtime-adr-ingestion.md",
        });
        expect(payload.items[0].metadata).toMatchObject({
          status: "accepted",
          sourcePlansSection: "Plans.md §128 S128-011",
          supersedes: ["ADR-003"],
        });
        expect(payload.items[0].provenance).toMatchObject({
          file_path: "docs/adr/ADR-004-recall-runtime-adr-ingestion.md",
          source_plans_section: "Plans.md §128 S128-011",
          decisions_md_refs: [".claude/memory/decisions.md#D13"],
          work_refs: ["S128-011", "§128"],
          supersedes: ["ADR-003"],
        });
        expect(payload.items[0].explanation).toMatchObject({
          version: "recall_explanation_v1",
          scope: "project",
          type: "decision",
          source: {
            type: "adr",
            ref: "adr:docs/adr/ADR-004-recall-runtime-adr-ingestion.md",
          },
          adr: {
            status: "accepted",
            source_plans_section: "Plans.md §128 S128-011",
            option_count: 2,
            consequence_count: 2,
            supersedes: ["ADR-003"],
          },
          work: {
            refs: ["S128-011", "§128"],
            source_plans_section: "Plans.md §128 S128-011",
          },
        });
        expect(payload.items[0].explanation?.reasons).toEqual(
          expect.arrayContaining(["scope_match", "type_match", "source_match", "lexical_match", "adr_provenance", "work_ref"]),
        );
        const explanationJson = JSON.stringify(payload.items[0].explanation);
        expect(explanationJson).not.toContain("Qdrant sidecar");
        expect(explanationJson).not.toContain("Repeat recall stays stable under large DBs");
        expect(explanationJson).not.toContain(project);
      }
    } finally {
      runtime.stop();
    }
  });
});
