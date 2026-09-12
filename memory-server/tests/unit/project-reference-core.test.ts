import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HarnessMemCore, type Config, type EventEnvelope } from "../../src/core/harness-mem-core";

function config(root: string): Config {
  return {
    dbPath: join(root, "memory.db"), bindHost: "127.0.0.1", bindPort: 0,
    vectorDimension: 64, embeddingProvider: "fallback", captureEnabled: true,
    retrievalEnabled: true, injectionEnabled: true, codexHistoryEnabled: false,
    codexProjectRoot: "/unavailable/project", codexSessionsRoot: "/unavailable/sessions",
    codexIngestIntervalMs: 5000, codexBackfillHours: 24, backgroundWorkersEnabled: false,
  };
}

function event(project: string, id: string, content: string): EventEnvelope {
  return { project, event_id: id, session_id: id, platform: "codex", event_type: "user_prompt", payload: { content } };
}

test("a repointed confirmed alias retains its registered identity and exposes the conflict", async () => {
  const root = mkdtempSync(join(tmpdir(), "mem-project-change-"));
  const a = join(root, "a"), b = join(root, "b"), alias = join(root, "current");
  mkdirSync(a); mkdirSync(b); symlinkSync(a, alias);
  const core = new HarnessMemCore(config(root));
  try {
    expect((await core.prepareProject(alias)).state).toBe("confirmed");
    expect(core.recordEvent(event(alias, "before", "retainedmemory before change")).ok).toBe(true);
    rmSync(alias); symlinkSync(b, alias);
    const changed = await core.prepareProject(alias, { force: true });
    expect(changed).toMatchObject({ state: "conflict", project: realpathSync(a), candidate: realpathSync(b) });
    const recorded = core.recordEvent(event(alias, "after", "retainedmemory after change"));
    expect(recorded.ok).toBe(true);
    expect(recorded.items[0]).toMatchObject({ project: realpathSync(a) });
    expect(recorded.meta.project_resolution).toMatchObject({ state: "conflict", project: realpathSync(a) });
    const found = core.search({ project: alias, query: "retainedmemory", strict_project: true, include_private: true });
    expect(found.items).toHaveLength(2);
    expect(found.items.every(item => (item as { project: string }).project === realpathSync(a))).toBe(true);
    expect(found.meta.project_resolution).toMatchObject({ state: "conflict" });
    const isolated = core.search({ project: realpathSync(b), query: "retainedmemory", strict_project: true, include_private: true });
    expect(isolated.items).toHaveLength(0);
    expect(isolated.meta.project_resolution).toMatchObject({ state: "unresolved" });
  } finally { await core.shutdown("test"); rmSync(root, { recursive: true, force: true }); }
});

test("empty registry on restart keeps stored keys usable and unknown path scope unresolved", async () => {
  const root = mkdtempSync(join(tmpdir(), "mem-project-empty-"));
  let core = new HarnessMemCore(config(root));
  try {
    expect(core.recordEvent(event("/offline/original", "old", "oldscope content")).ok).toBe(true);
    core.getRawDb().query("DELETE FROM mem_meta WHERE key LIKE 'project_identity:v1:%'").run();
    await core.shutdown("test");
    core = new HarnessMemCore(config(root));
    expect(core.getProjectResolverStatus()).toMatchObject({ active: 0, queued: 0 });
    const stored = core.search({ project: "/offline/original", query: "oldscope", strict_project: true, include_private: true });
    expect(stored.items).toHaveLength(1);
    expect(core.getProjectResolution("/offline/original").state).toBe("confirmed");
    const unknown = core.search({ project: "/offline/alias", query: "oldscope", strict_project: true, include_private: true });
    expect(unknown.items).toHaveLength(0);
    expect(unknown.meta.project_resolution).toMatchObject({ state: "unresolved", input: "/offline/alias" });
    expect(core.recordEvent(event("/offline/alias", "new", "independentscope content")).ok).toBe(true);
    expect(core.getProjectResolution("/offline/alias").state).toBe("unresolved");
    expect(core.projectMatchesSelection("/offline/original", "/offline/alias")).toBe(false);
  } finally { await core.shutdown("test"); rmSync(root, { recursive: true, force: true }); }
});

test("an explicit scope suffix remains separate from its project root", async () => {
  const root = mkdtempSync(join(tmpdir(), "mem-project-suffix-"));
  const core = new HarnessMemCore(config(root));
  try {
    expect(core.recordEvent(event("/offline/repo::scope-a", "a", "scopedidentity memory")).ok).toBe(true);
    expect(core.recordEvent(event("/offline/repo::scope-b", "b", "scopedidentity memory")).ok).toBe(true);
    expect(core.projectMatchesSelection("/offline/repo::scope-a", "/offline/repo::scope-b")).toBe(false);
    const result = core.search({ project: "/offline/repo::scope-a", query: "scopedidentity", strict_project: true, include_private: true });
    expect(result.items).toHaveLength(1);
    expect(core.getProjectResolverStatus()).toMatchObject({ active: 0, queued: 0 });
  } finally { await core.shutdown("test"); rmSync(root, { recursive: true, force: true }); }
});
