import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ProjectPathResolver, type ProjectPathResolution, type ProjectResolverProcess } from "../../src/core/project-path-resolver";

const resolvers: ProjectPathResolver[] = [];
const directories: string[] = [];
afterEach(() => {
  for (const resolver of resolvers.splice(0)) resolver.stop();
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function fake() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let exit!: (code: number) => void;
  let kills = 0;
  const proc: ProjectResolverProcess = {
    stdout: new ReadableStream({ start(value) { controller = value; } }),
    exited: new Promise<number>((resolve) => { exit = resolve; }),
    kill() { kills++; },
  };
  return {
    proc, exit, kills: () => kills,
    send(value: unknown) { controller.enqueue(new TextEncoder().encode(typeof value === "string" ? value : JSON.stringify(value))); },
    close() { controller.close(); },
  };
}

async function until(condition: () => boolean, timeout = 3000) {
  const end = Date.now() + timeout;
  while (!condition() && Date.now() < end) await Bun.sleep(5);
  expect(condition()).toBe(true);
}

function make(options: ConstructorParameters<typeof ProjectPathResolver>[0]) {
  const resolver = new ProjectPathResolver(options);
  resolvers.push(resolver);
  return resolver;
}

describe("project path resolver process ownership", () => {
  test("permanent stalls retain slots, queue stays finite under 1000 requests, and a spare slot progresses", async () => {
    const children: ReturnType<typeof fake>[] = [];
    const results: ProjectPathResolution[] = [];
    const resolver = make({ maxChildren: 2, maxQueue: 2, timeoutMs: 30, onResult: (_, result) => results.push(result), spawn: () => { const child = fake(); children.push(child); return child.proc; } });
    expect(resolver.schedule("/stalled")).toBe(true);
    expect(resolver.schedule("/healthy")).toBe(true);
    children[1].send({ input: "/healthy", canonical: "/repo", kind: "confirmed" });
    children[1].close();
    children[1].exit(0);
    await until(() => results.some((result) => result.kind === "confirmed"));
    expect(resolver.schedule("/stalled-two")).toBe(true);
    for (let index = 0; index < 1000; index++) resolver.schedule(`/queued-${index}`);
    expect(resolver.status().queued).toBe(2);
    await until(() => resolver.status().stopping === 2);
    expect(children.length).toBe(3);
    expect(resolver.status().active).toBe(2);
    expect(results.filter((result) => result.reason === "timeout")).toHaveLength(2);
    resolver.stop();
    expect(resolver.status()).toEqual({ active: 2, queued: 0, stopping: 2, stopped: true });
  });

  test("confirmed output is not applied before successful exit; late exit after timeout is ignored", async () => {
    const child = fake();
    const results: ProjectPathResolution[] = [];
    const resolver = make({ timeoutMs: 20, onResult: (_, result) => results.push(result), spawn: () => child.proc });
    resolver.schedule("/input");
    child.send({ input: "/input", canonical: "/other", kind: "confirmed" });
    child.close();
    await Bun.sleep(5);
    expect(results).toHaveLength(0);
    await until(() => results.length === 1);
    expect(results[0].reason).toBe("timeout");
    child.exit(0);
    await until(() => resolver.status().active === 0);
    expect(results).toHaveLength(1);
    for (let index = 0; index < 1000; index++) expect(resolver.schedule("/input")).toBe(false);
  });

  test("malformed or oversized IPC exposes only a fixed reason and retains process ownership", async () => {
    const children: ReturnType<typeof fake>[] = [];
    const results: ProjectPathResolution[] = [];
    const resolver = make({ onResult: (_, result) => results.push(result), spawn: () => { const child = fake(); children.push(child); return child.proc; } });
    resolver.schedule("/one");
    resolver.schedule("/two");
    children[0].send("private-secret".repeat(10000));
    children[1].send({ input: "/wrong", canonical: "/private-secret", kind: "confirmed" });
    children[1].close();
    await until(() => results.length === 2);
    expect(results.every((result) => result.reason === "protocol")).toBe(true);
    expect(JSON.stringify(results)).not.toContain("private-secret");
    expect(resolver.status().active).toBe(2);
    expect(children.every((child) => child.kills() === 1)).toBe(true);
  });

  test("stop returns immediately and suppresses late replies", async () => {
    const child = fake();
    const results: ProjectPathResolution[] = [];
    const resolver = make({ onResult: (_, result) => results.push(result), spawn: () => child.proc });
    resolver.schedule("/input");
    resolver.stop();
    child.exit(0);
    await until(() => resolver.status().active === 0);
    expect(results).toHaveLength(0);
    expect(resolver.schedule("/new")).toBe(false);
  });

  test("spawn exceptions use cooldown without exposing exception contents", () => {
    let attempts = 0;
    const results: ProjectPathResolution[] = [];
    const resolver = make({ onResult: (_, result) => results.push(result), spawn: () => { attempts++; throw new Error("private-secret"); } });
    expect(resolver.schedule("/input")).toBe(false);
    for (let index = 0; index < 1000; index++) expect(resolver.schedule("/input")).toBe(false);
    expect(attempts).toBe(1);
    expect(results[0]).toEqual({ input: "/input", canonical: "/input", kind: "unresolved", reason: "spawn" });
  });
});

describe("dedicated filesystem worker", () => {
  test("a real synchronously blocked child cannot stall the parent or the spare child", async () => {
    const temp = mkdtempSync(join(tmpdir(), "project-resolver-stall-"));
    directories.push(temp);
    const scriptPath = join(temp, "stall.ts");
    writeFileSync(scriptPath, `const {input} = JSON.parse(await Bun.stdin.text());
if (input === '/stalled') Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
await Bun.write(Bun.stdout, JSON.stringify({input, canonical: input, kind: 'confirmed'}));\n`);
    const results: ProjectPathResolution[] = [];
    const resolver = make({ scriptPath, maxChildren: 2, timeoutMs: 300, onResult: (_, result) => results.push(result) });
    resolver.schedule("/stalled");
    resolver.schedule("/healthy");
    await until(() => results.some((result) => result.input === "/healthy"));
    expect(results.find((result) => result.input === "/healthy")?.kind).toBe("confirmed");
    await until(() => results.length === 2);
    expect(results.find((result) => result.input === "/stalled")?.reason).toBe("timeout");
    await until(() => resolver.status().active === 0);
  });

  test("actual process resolves symlink, nested git root, worktree and independent folder; missing path stays unresolved", async () => {
    const temp = mkdtempSync(join(tmpdir(), "project-resolver-"));
    directories.push(temp);
    const root = realpathSync(temp);
    const repo = join(root, "repo");
    const nested = join(repo, "src", "deep");
    const worktree = join(root, "worktree");
    const gitdir = join(repo, ".git", "worktrees", "linked");
    for (const path of [nested, gitdir, worktree, join(root, "independent", ".git")]) mkdirSync(path, { recursive: true });
    writeFileSync(join(repo, ".git", "HEAD"), "ref: refs/heads/main\n");
    writeFileSync(join(gitdir, "HEAD"), "ref: refs/heads/linked\n");
    writeFileSync(join(gitdir, "commondir"), "../..\n");
    writeFileSync(join(worktree, ".git"), `gitdir: ${gitdir}\n`);
    const link = join(root, "link");
    symlinkSync(nested, link);
    const results = new Map<string, ProjectPathResolution>();
    const resolver = make({ timeoutMs: 3000, onResult: (input, result) => results.set(input, result) });
    for (const input of [link, nested, worktree, join(root, "independent"), join(root, "missing")]) expect(resolver.schedule(input)).toBe(true);
    await until(() => results.size === 5, 10000);
    for (const input of [link, nested, worktree]) expect(results.get(input)).toEqual({ input, canonical: repo, kind: "confirmed" });
    expect(results.get(join(root, "independent"))?.canonical).toBe(join(root, "independent"));
    expect(results.get(join(root, "missing"))?.kind).toBe("unresolved");
    expect(results.get(join(root, "missing"))?.reason).toBe("unreadable");
  });

  test("actual process rejects malformed git markers without returning their contents", async () => {
    const temp = mkdtempSync(join(tmpdir(), "project-resolver-invalid-"));
    directories.push(temp);
    writeFileSync(join(temp, ".git"), "private-secret");
    const results: ProjectPathResolution[] = [];
    make({ onResult: (_, result) => results.push(result) }).schedule(temp);
    await until(() => results.length === 1);
    expect(results[0].reason).toBe("invalid_git");
    expect(JSON.stringify(results)).not.toContain("private-secret");
  });
});
