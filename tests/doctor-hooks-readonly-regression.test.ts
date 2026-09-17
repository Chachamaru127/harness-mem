import { afterEach, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const script = join(root, "scripts/harness-mem");
const temps: string[] = [];
const quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;
function fixture() {
  const home = mkdtempSync(join(tmpdir(), "mem-cli-regression-"));
  temps.push(home);
  const bin = join(home, "bin");
  mkdirSync(bin);
  const executable = (name: string, body: string) => {
    const p = join(bin, name);
    writeFileSync(p, `#!/bin/bash\n${body}\n`);
    chmodSync(p, 0o755);
  };
  executable("curl", 'exit 7'); // Never contact a live daemon or the network.
  for (const name of ["npm", "codex", "claude", "opencode", "cursor", "antigravity"]) {
    executable(name, `echo ${name} >> "$HOME/launched"; echo '9.9.9'`);
  }
  return {
    home, executable,
    env: { ...process.env, HOME: home, HARNESS_MEM_HOME: join(home, ".harness-mem"),
      HARNESS_MEM_DB_PATH: join(home, ".harness-mem/harness-mem.db"),
      HARNESS_MEM_NON_INTERACTIVE: "1", HARNESS_MEM_SKIP_AUTO_UPDATE: "0",
      PATH: `${bin}:${process.env.PATH}` },
  };
}
async function run(f: ReturnType<typeof fixture>, args: string[], body?: string) {
  let command = ["bash", script, ...args];
  if (body) {
    const extracted = readFileSync(script, "utf8")
      .replace('SCRIPT_SOURCE="${BASH_SOURCE[0]}"', `SCRIPT_SOURCE=${quote(script)}`)
      .replace(/main "\$@"\s*$/, body);
    const fixtureScript = join(f.home, "invoke.sh");
    writeFileSync(fixtureScript, extracted);
    command = ["bash", fixtureScript];
  }
  const proc = Bun.spawn(command, { env: f.env, stdout: "pipe", stderr: "pipe", cwd: root });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited,
  ]);
  return { stdout, stderr, code };
}
function snapshot(dir: string): Record<string, unknown> {
  return Object.fromEntries(readdirSync(dir).sort().map(name => {
    const path = join(dir, name), st = statSync(path);
    return [name, st.isDirectory() ? { mtime: st.mtimeMs, files: snapshot(path) }
      : { mtime: st.mtimeMs, bytes: readFileSync(path).toString("base64") }];
  }));
}
function wiring(f: ReturnType<typeof fixture>) {
  const codex = join(f.home, ".codex");
  mkdirSync(codex, { recursive: true });
  const alternate = join(f.home, "npm installation/harness-mem");
  mkdirSync(join(alternate, "scripts/hook-handlers"), { recursive: true });
  mkdirSync(join(alternate, "bin"), { recursive: true });
  mkdirSync(join(f.home, ".harness-mem"), { recursive: true });
  writeFileSync(join(alternate, "package.json"), JSON.stringify({ name: "@chachamaru127/harness-mem" }));
  writeFileSync(join(alternate, "bin/harness-mcp-server"), "");
  const handlers = { SessionStart: "codex-session-start", UserPromptSubmit: "codex-user-prompt", Stop: "codex-session-stop" };
  const hooks: Record<string, any[]> = {};
  for (const [event, name] of Object.entries(handlers)) {
    writeFileSync(join(alternate, `scripts/hook-handlers/${name}.sh`), "");
    hooks[event] = [{ hooks: [{ type: "command", command: `bash "${alternate}/scripts/hook-handlers/${name}.sh"` }] }];
  }
  writeFileSync(join(alternate, "scripts/hook-handlers/memory-codex-notify.sh"), "");
  writeFileSync(join(codex, "hooks.json"), JSON.stringify({ hooks }));
  writeFileSync(join(codex, "config.toml"), `
notify = ["bash", "${alternate}/scripts/hook-handlers/memory-codex-notify.sh"]
["features"]
"hooks" = true
[mcp_servers."harness"]
command = '${alternate}/bin/harness-mcp-server'
args = []
enabled = true
[mcp_servers.'harness'.env]
HARNESS_MEM_HOST = '127.0.0.1'
HARNESS_MEM_PORT = '37888'
HARNESS_MEM_DB_PATH = '${f.env.HARNESS_MEM_DB_PATH}'
`);
  for (const name of ["harness-mem", "harness-recall"]) {
    const path = join(f.home, `.agents/skills/${name}`);
    mkdirSync(path, { recursive: true });
    writeFileSync(join(path, "SKILL.md"), `---\nname: ${name}\ndescription: Shared operator skill\n---\nUse configured memory.\n`);
  }
  return { codex, hooks };
}
afterEach(() => { for (const p of temps.splice(0)) rmSync(p, { recursive: true, force: true }); });

describe("doctor and Codex repair regressions", () => {
  test("managed hook ownership normalizes Windows MSYS paths without reinterpreting POSIX /c folders", () => {
    const { managedHooks } = require("../scripts/lib/codex-managed-hooks.js");
    const suffix = "/scripts/hook-handlers/codex-session-start.sh";
    const msys = `/c/Users/Example/harness-mem${suffix}`;
    const native = `C:/Users/Example/harness-mem${suffix}`;
    const input = { hooks: { SessionStart: [{ hooks: [
      { type: "command", command: `bash ${msys}` },
      { type: "command", command: `bash "${native}"` },
      { type: "command", command: `bash /c/unrelated${suffix}` },
    ] }] } };
    const found = managedHooks(input, "C:/Users/Example/harness-mem", "win32").SessionStart;
    expect(found).toEqual([
      { command: `bash ${msys}`, path: msys },
      { command: `bash "${native}"`, path: native },
    ]);
    expect(managedHooks(input, "/c/Users/Example/harness-mem", "win32").SessionStart).toEqual(found);
    expect(managedHooks(input, "C:/Users/Example/harness-mem", "linux").SessionStart).toEqual([]);
    expect(managedHooks(input, "/c/Users/Example/harness-mem", "linux").SessionStart).toEqual([found[0]]);
  });
  test("readonly leaves existing bytes/mtimes untouched even with auto-update enabled and --fix last", async () => {
    const f = fixture();
    wiring(f);
    writeFileSync(join(f.home, ".harness-mem/config.json"), '{"backend_mode":"hybrid","managed":{"endpoint":"http://127.0.0.1:1"},"auto_update":{"enabled":true}}');
    const before = snapshot(f.home);
    const result = await run(f, ["doctor", "--read-only", "--fix", "--json", "--platform", "codex"]);
    expect(result.code).toBe(0);
    expect(snapshot(f.home)).toEqual(before);
    const checks = JSON.parse(result.stdout).checks;
    expect(checks.find((c: any) => c.name === "codex_wiring").status).toBe("ok");
    expect(checks.find((c: any) => c.name === "codex_skill_drift").status).toBe("ok");
  }, 20_000);
  test("readonly on an empty HOME creates no config, snapshots, or process launches", async () => {
    const f = fixture();
    const before = snapshot(f.home);
    await run(f, ["doctor", "--read-only", "--platform", "codex"]);
    expect(snapshot(f.home)).toEqual(before);
  }, 20_000);
  test("readonly skips installed MCP executable initialization", async () => {
    const f = fixture();
    f.executable("go-test", 'echo unexpected > "$HOME/go-started"');
    const result = await run(f, [], `HARNESS_ROOT=${quote(f.home)}; _resolve_go_bin_name() { echo go-test; }; READ_ONLY_MODE=1; JSON_OUTPUT=1; QUIET=1; PLATFORM=antigravity; PLATFORM_EXPLICIT=1; VERSION_CHECK_IN_SETUP=0; doctor_impl`);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).checks.find((c: any) => c.name === "go_mcp_binary").status).toBe("skipped");
    expect(readdirSync(f.home)).not.toContain("go-started");
  }, 20_000);
  test("Claude and Cursor accept a verified alternate package entrypoint and reject missing or unrelated files", async () => {
    const f = fixture();
    wiring(f);
    const packageRoot = join(f.home, "npm installation/harness-mem");
    const command = join(packageRoot, "bin/harness-mcp-server");
    const config = { mcpServers: { harness: { command }, "harness-mem": { command } } };
    writeFileSync(join(f.home, ".claude.json"), JSON.stringify(config));
    mkdirSync(join(f.home, ".cursor/hooks"), { recursive: true });
    writeFileSync(join(f.home, ".cursor/hooks/memory-cursor-event.sh"), "");
    writeFileSync(join(f.home, ".cursor/mcp.json"), JSON.stringify(config));
    writeFileSync(join(f.home, ".cursor/hooks.json"), JSON.stringify({ hooks: Object.fromEntries(
      ["sessionStart", "beforeSubmitPrompt", "afterAgentResponse", "afterMCPExecution", "afterShellExecution", "afterFileEdit", "sessionEnd", "stop"]
        .map(event => [event, [{ command: "bash memory-cursor-event.sh" }]])
    ) }));
    const statuses = async () => {
      const before = snapshot(f.home);
      const result = await run(f, ["doctor", "--read-only", "--json", "--platform", "claude,cursor"]);
      expect(result.code).toBe(0);
      expect(snapshot(f.home)).toEqual(before);
      return JSON.parse(result.stdout).checks.filter((c: any) => ["claude_wiring", "cursor_wiring"].includes(c.name)).map((c: any) => c.status);
    };
    expect(await statuses()).toEqual(["ok", "ok"]);
    writeFileSync(join(packageRoot, "package.json"), JSON.stringify({ name: "unrelated-tool" }));
    expect(await statuses()).toEqual(["missing", "missing"]);
    writeFileSync(join(packageRoot, "package.json"), JSON.stringify({ name: "@chachamaru127/harness-mem" }));
    rmSync(command);
    expect(await statuses()).toEqual(["missing", "missing"]);
  }, 20_000);
  test("doctor flags duplicate managed hooks across installations", async () => {
    const f = fixture();
    const { codex, hooks } = wiring(f);
    hooks.SessionStart.push({ hooks: [{ type: "command", command: `bash ${root}/scripts/hook-handlers/codex-session-start.sh` }] });
    writeFileSync(join(codex, "hooks.json"), JSON.stringify({ hooks }));
    const result = await run(f, ["doctor", "--read-only", "--json", "--platform", "codex"]);
    expect(JSON.parse(result.stdout).checks.find((c: any) => c.name === "codex_wiring").status).toBe("missing");
  }, 20_000);
  test("setup hook merge removes stale and duplicate managed hooks but preserves unrelated commands in their group", async () => {
    const f = fixture();
    const { codex, hooks } = wiring(f);
    const custom = { type: "command", command: "bash /other/scripts/hook-handlers/codex-session-start.sh" };
    hooks.SessionStart[0].hooks.push(custom);
    hooks.SessionStart[0].matcher = "resume";
    hooks.SessionStart.push({ hooks: [{ type: "command", command: `bash ${root}/scripts/hook-handlers/codex-session-start.sh` }] });
    hooks.SessionStart.push({ hooks: [{ type: "command", command: "bash /stale/node_modules/@chachamaru127/harness-mem/scripts/hook-handlers/codex-session-start.sh" }] });
    hooks.SessionStart.push({ hooks: [{ type: "command", command: `echo bash ${root}/scripts/hook-handlers/codex-session-start.sh` }] });
    writeFileSync(join(codex, "hooks.json"), JSON.stringify({ hooks }));
    // Invoke the production setup wiring, without runtime installation/startup.
    const result = await run(f, [], 'setup_codex_wiring; setup_codex_wiring');
    expect(result.code).toBe(0);
    const updated = JSON.parse(readFileSync(join(codex, "hooks.json"), "utf8"));
    expect(updated.hooks.SessionStart[0]).toEqual({ matcher: "resume", hooks: [custom] });
    for (const [event, name] of Object.entries({ SessionStart: "codex-session-start", UserPromptSubmit: "codex-user-prompt", Stop: "codex-session-stop" })) {
      const commands = updated.hooks[event].flatMap((e: any) => e.hooks.map((h: any) => h.command));
      expect(commands.filter((c: string) => c === `bash ${root}/scripts/hook-handlers/${name}.sh`)).toHaveLength(1);
      expect(commands.some((c: string) => c.includes("npm installation"))).toBe(false);
    }
    expect(updated.hooks.SessionStart[1].hooks[0].command).toStartWith("echo bash");
    expect(readFileSync(join(codex, "config.toml"), "utf8")).toContain('[mcp_servers."harness"]');
  }, 20_000);
  test("versions honors platform selection and never runs GUI launchers", async () => {
    const f = fixture();
    f.executable("curl", `echo "$*" >> "$HOME/fetched"\nwhile [ "$#" -gt 0 ]; do if [ "$1" = "-o" ]; then shift; printf '[]' > "$1"; fi; shift; done`);
    const result = await run(f, ["versions", "--platform", "codex"]);
    expect(result.code).toBe(0);
    expect(readFileSync(join(f.home, "launched"), "utf8")).toBe("codex\n");
    const versions = JSON.parse(readFileSync(join(f.home, ".harness-mem/versions/tool-versions.json"), "utf8"));
    expect(versions.status.cursor).toBe("not_checked");
    expect(versions.upstream.antigravity.hooks_detected).toBeNull();
    expect(readFileSync(join(f.home, "fetched"), "utf8").trim().split("\n")).toHaveLength(1);
    expect(readFileSync(join(f.home, "fetched"), "utf8")).toContain("openai/codex");
    const gui = await run(f, ["versions", "--platform", "cursor,antigravity"]);
    expect(gui.code).toBe(0);
    expect(readFileSync(join(f.home, "launched"), "utf8")).toBe("codex\n");
  }, 20_000);
  test("Codex additional context omits unsupported top-level continue", async () => {
    const f = fixture();
    const result = await run(f, [], `source ${quote(join(root, "scripts/hook-handlers/lib/hook-common.sh"))}; hook_emit_codex_additional_context SessionStart 'memory context'`);
    expect(JSON.parse(result.stdout)).toEqual({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: "memory context" } });
  });
});
