import { expect, test } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { HarnessMemCore } from "../../src/core/harness-mem-core";
import { startHarnessMemServer } from "../../src/server";
import { createTestConfig, makeEvent } from "../core-split/test-helpers";

const sourceScripts = resolve(import.meta.dir, "../../../scripts");

function runtime() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "hmem-hook-identity-")));
  const config = createTestConfig({
    dbPath: join(dir, "memory.db"), bindPort: 0, backgroundWorkersEnabled: false, embeddingProvider: "fallback",
    codexHistoryEnabled: true, codexProjectRoot: dir, codexSessionsRoot: join(dir, "rollouts"),
  });
  const core = new HarnessMemCore(config);
  const server = startHarnessMemServer(core, config);
  return {
    dir, core, server,
    async post(path: string, body: unknown) {
      return fetch(`http://127.0.0.1:${server.port}${path}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
    },
    async close() { server.stop(true); await core.shutdown("test"); rmSync(dir, { recursive: true, force: true }); },
  };
}

test("real Codex hooks store physical repo identity and roundtrip across search, resume, latest, and thread", async () => {
  const rt = runtime();
  try {
    const scripts = join(rt.dir, "scripts");
    const handlers = join(scripts, "hook-handlers");
    mkdirSync(join(handlers, "lib"), { recursive: true });
    for (const file of ["harness-mem-client.sh", "hook-handlers/codex-user-prompt.sh", "hook-handlers/lib/hook-common.sh", "hook-handlers/lib/project-context.sh"]) {
      copyFileSync(join(sourceScripts, file), join(scripts, file));
    }
    // The real client talks only to the disposable server. No installed daemon is started.
    writeFileSync(join(scripts, "harness-memd"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    const home = join(rt.dir, "home");
    const memHome = join(home, ".harness-mem");
    mkdirSync(memHome, { recursive: true });
    writeFileSync(join(memHome, "config.json"), JSON.stringify({ recall: { mode: "off" } }));
    const projects = [join(rt.dir, "a", "repo"), join(rt.dir, "b", "repo")];
    mkdirSync(join(rt.dir, "rollouts"));
    for (const [index, project] of projects.entries()) {
      mkdirSync(join(project, "nested"), { recursive: true });
      const git = Bun.spawnSync(["git", "init", "--quiet", project]);
      expect(git.exitCode).toBe(0);
      const alias = join(rt.dir, `alias-${index}`);
      symlinkSync(project, alias);
      const proc = Bun.spawn(["bash", join(handlers, "codex-user-prompt.sh")], {
        cwd: rt.dir,
        env: { ...process.env, HOME: home, HARNESS_MEM_HOME: memHome, HARNESS_MEM_PORT: String(rt.server.port), HARNESS_MEM_HOST: "127.0.0.1", HARNESS_MEM_DB_PATH: join(rt.dir, "memory.db") },
        stdin: "pipe", stdout: "pipe", stderr: "pipe",
      });
      proc.stdin.write(JSON.stringify({ cwd: join(alias, "nested"), thread_id: `hook-session-${index}`, prompt: `hookidentitymarker conversation ${index}` }));
      proc.stdin.end();
      const [, stderr, exit] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
      expect(exit, stderr).toBe(0);
      writeFileSync(join(rt.dir, "rollouts", `rollout-identity-${index}.jsonl`), [
        { type: "session_meta", payload: { id: `hook-session-${index}`, cwd: join(alias, "nested") } },
        { type: "response_item", timestamp: new Date(Date.now() + 1000).toISOString(), payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: `hookidentitymarker answer ${index}` }] } },
      ].map(line => JSON.stringify(line)).join("\n") + "\n");
    }
    expect((await rt.core.ingestCodexHistory()).ok).toBe(true);
    // A legacy basename remains separately addressable; it is never auto-aliased.
    expect(rt.core.recordEvent(makeEvent({ project: "repo", session_id: "legacy", payload: { content: "hookidentitymarker legacy" } })).ok).toBe(true);
    for (const [index, project] of projects.entries()) {
      const response = await rt.post("/v1/search", { project, query: "hookidentitymarker", strict_project: true });
      expect(response.status).toBe(200);
      const searched = await response.json() as { ok: boolean; items: Array<{ project: string; content: string }> };
      expect(searched.ok).toBe(true);
      expect(searched.items).toHaveLength(2);
      expect(searched.items.every(item => item.project === project)).toBe(true);
      expect(searched.items.some(item => item.content.includes(`conversation ${index}`))).toBe(true);
      const latest = rt.core.search({ project, query: "直近を調べて", strict_project: true }).meta.latest_interaction;
      expect(latest).toMatchObject({ project, session_id: `hook-session-${index}`, incomplete: false });
      const resumed = await (await rt.post("/v1/resume-pack", { project, session_id: "new-session", limit: 10 })).json() as { ok: boolean; items: Array<{ type: string; project: string }>; meta: Record<string, unknown> };
      expect(resumed.ok).toBe(true);
      const observations = resumed.items.filter(item => item.type === "observation");
      expect(observations.length).toBeGreaterThan(0);
      expect(observations.every(item => item.project === project)).toBe(true);
      const thread = rt.core.sessionThread({ project, session_id: `hook-session-${index}` });
      expect(thread.ok).toBe(true);
      expect(thread.items).toHaveLength(2);
      expect(rt.core.sessionThread({ project: projects[1 - index], session_id: `hook-session-${index}` }).items).toHaveLength(0);
    }
    expect(rt.core.search({ project: "repo", query: "hookidentitymarker", strict_project: true }).items).toHaveLength(1);
  } finally { await rt.close(); }
}, 30_000);

test("root and unknown scopes remain usable while malformed scopes return structured errors", async () => {
  const rt = runtime();
  try {
    for (const [index, project] of ["/", "C:/", "C:", "/unavailable/project"].entries()) {
      const response = await rt.post("/v1/events/record", { event: makeEvent({ project, session_id: `root-${index}`, payload: { content: `rootidentitymarker ${index}` } }) });
      expect(response.status).toBe(200);
      expect((await response.json() as { ok: boolean }).ok).toBe(true);
      expect(rt.core.search({ project, query: "rootidentitymarker", strict_project: true }).items).toHaveLength(1);
      expect(rt.core.resumePack({ project }).ok).toBe(true);
    }
    expect(rt.core.search({ query: "rootidentitymarker", project: "/unknown/other", strict_project: true }).items).toHaveLength(0);
    expect(rt.core.search({ query: "rootidentitymarker" }).items.length).toBeGreaterThan(0);
    expect(rt.core.recordEvent(makeEvent({ project: undefined as unknown as string })).ok).toBe(false);
    expect(rt.core.resumePack({ project: "   " }).ok).toBe(false);
    for (const project of [null, 42, {}, [], false, "bad\0path"]) {
      const malformed = project as unknown as string;
      const event = makeEvent({ project: malformed });
      for (const result of [rt.core.recordEvent(event), await rt.core.recordEventQueued(event), rt.core.search({ project: malformed, query: "rootidentitymarker" }), await rt.core.searchPrepared({ project: malformed, query: "rootidentitymarker" }), rt.core.resumePack({ project: malformed }), rt.core.sessionThread({ project: malformed, session_id: "root-0" })]) {
        expect(result).toMatchObject({ ok: false, meta: { error_code: "invalid_project", http_status: 400 } });
      }
      for (const [path, body] of [
        ["/v1/events/record", { event }],
        ["/v1/search", { project, query: "rootidentitymarker" }],
        ["/v1/search", { scope: { project }, query: "rootidentitymarker" }],
        ["/v1/resume-pack", { project }],
      ] as const) {
        const response = await rt.post(path, body);
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ ok: false });
      }
    }
    expect((await rt.post("/v1/resume-pack", { project: "   " })).status).toBe(400);
    expect(rt.core.search({ project: "/", query: "rootidentitymarker" }).items).toHaveLength(1);
  } finally { await rt.close(); }
}, 30_000);
