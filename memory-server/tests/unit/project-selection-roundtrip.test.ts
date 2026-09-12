import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessMemCore } from "../../src/core/harness-mem-core";
import { createTestConfig, makeEvent } from "../core-split/test-helpers";

const cores: HarnessMemCore[] = [];
const directories: string[] = [];
afterEach(() => {
  for (const core of cores.splice(0)) core.shutdown("test");
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function seed(projects: string[]): HarnessMemCore {
  const directory = mkdtempSync(join(tmpdir(), "project-selection-"));
  directories.push(directory);
  const core = new HarnessMemCore(createTestConfig({ dbPath: join(directory, "memory.db") }));
  cores.push(core);
  for (const [index, project] of projects.entries()) {
    expect(core.recordEvent(makeEvent({
      project,
      event_id: `roundtrip-event-${index}`,
      session_id: `roundtrip-session-${index}`,
      payload: { prompt: `roundtripmarker item ${index}` },
    })).ok).toBe(true);
  }
  return core;
}

function expectSearchRoundtrip(core: HarnessMemCore, project: string): void {
  const result = core.search({ query: "roundtripmarker", project, strict_project: true, include_private: true });
  expect(result.ok).toBe(true);
  expect(result.items).toHaveLength(1);
  expect((result.items[0] as { project: string }).project).toBe(project);
}

test("same-basename facet values remain distinct and each selects exactly its own observation", () => {
  const projects = ["/a/repo", "/b/repo"];
  const core = seed(projects);
  const response = core.searchFacets({ query: "roundtripmarker", include_private: true });
  expect(response.ok).toBe(true);
  const facets = (response.items[0] as { projects: Array<{ value: string; count: number; display_name?: string }> }).projects;
  expect(facets.map((item) => item.value).sort()).toEqual(projects);
  for (const facet of facets) {
    expect(facet.count).toBe(1);
    expect(facet.display_name).toBe("repo");
    expectSearchRoundtrip(core, facet.value);
  }
});

test("same-basename statistics never aggregate distinct identities and both selectable fields roundtrip", () => {
  const projects = ["/a/repo", "/b/repo"];
  const core = seed(projects);
  const response = core.projectsStats({ include_private: true });
  expect(response.ok).toBe(true);
  const stats = response.items as Array<{ project: string; canonical_project: string; display_name?: string; observations: number; sessions: number; member_projects: string[] }>;
  expect(stats.map((item) => item.project).sort()).toEqual(projects);
  for (const stat of stats) {
    expect(stat.canonical_project).toBe(stat.project);
    expect(stat.display_name).toBe("repo");
    expect(stat.observations).toBe(1);
    expect(stat.sessions).toBe(1);
    expect(stat.member_projects).toEqual([stat.project]);
    expectSearchRoundtrip(core, stat.project);
    expectSearchRoundtrip(core, stat.canonical_project);
    const scoped = core.projectsStats({ project: stat.project, include_private: true });
    expect(scoped.items).toHaveLength(1);
    expect((scoped.items[0] as { project: string }).project).toBe(stat.project);
  }
});

test("logical IDs and explicit scope suffixes remain selectable without merging into the root", () => {
  const projects = ["logical", "logical::team-a", "logical::team-b", "/a/repo::team-a", "/a/repo::team-b"];
  const core = seed(projects);
  const facets = (core.searchFacets({ query: "roundtripmarker", include_private: true }).items[0] as { projects: Array<{ value: string; display_name?: string }> }).projects;
  const stats = core.projectsStats({ include_private: true }).items as Array<{ project: string; canonical_project: string; display_name?: string }>;
  expect(facets.map((item) => item.value).sort()).toEqual([...projects].sort());
  expect(stats.map((item) => item.project).sort()).toEqual([...projects].sort());
  for (const facet of facets) {
    if (!facet.value.startsWith("/")) expect(facet.display_name).toBeUndefined();
    expectSearchRoundtrip(core, facet.value);
  }
  for (const stat of stats) {
    expect(stat.canonical_project).toBe(stat.project);
    if (!stat.project.startsWith("/")) expect(stat.display_name).toBeUndefined();
    expectSearchRoundtrip(core, stat.project);
  }
});

test("latest interaction metadata keeps the selectable project key for incomplete and completed turns", () => {
  const core = seed(["/a/repo"]);
  const incomplete = core.search({ query: "直近を調べて", project: "/a/repo", include_private: true }).meta.latest_interaction as { project: string; display_name: string; incomplete: boolean };
  expect(incomplete.project).toBe("/a/repo");
  expect(incomplete.display_name).toBe("repo");
  expect(incomplete.incomplete).toBe(true);
  expectSearchRoundtrip(core, incomplete.project);
  expect(core.recordEvent(makeEvent({ project: "/a/repo", event_id: "roundtrip-response", session_id: "roundtrip-session-0", event_type: "checkpoint", ts: new Date(Date.now() + 1000).toISOString(), payload: { title: "assistant_response", content: "completed answer" } })).ok).toBe(true);
  const completed = core.search({ query: "直近を調べて", project: "/a/repo", include_private: true }).meta.latest_interaction as { project: string; display_name: string; incomplete: boolean };
  expect(completed.project).toBe("/a/repo");
  expect(completed.display_name).toBe("repo");
  expect(completed.incomplete).toBe(false);
});
