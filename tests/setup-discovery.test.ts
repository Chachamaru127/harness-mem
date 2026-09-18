import { describe, expect, test } from "bun:test";
import { chmodSync, cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const script = readFileSync(join(ROOT, "scripts/harness-mem"), "utf8");

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "hmem-setup-discovery-"));
  const home = join(dir, "home");
  const bin = join(dir, "bin");
  mkdirSync(home);
  mkdirSync(bin);
  mkdirSync(join(dir, "scripts/lib"), { recursive: true });
  cpSync(join(ROOT, "scripts/lib/setup-discovery.sh"), join(dir, "scripts/lib/setup-discovery.sh"));
  // A closed PATH keeps installed developer clients out of discovery.
  for (const name of ["dirname", "tr", "xargs", "uname", "pwd", "cat", "echo"]) {
    const actual = Bun.which(name)!;
    symlinkSync(actual, join(bin, name));
  }
  const entry = join(dir, "scripts/harness-mem");
  function file(path: string, body = "{}") {
    const target = join(home, path);
    mkdirSync(resolve(target, ".."), { recursive: true });
    writeFileSync(target, body);
  }
  function client(name: string) {
    const target = join(bin, name);
    writeFileSync(target, `#!/bin/sh\necho CLIENT_EXECUTED >&2\nexit 91\n`);
    chmodSync(target, 0o755);
  }
  async function run(input: string, driver: string, env: Record<string, string> = {}) {
    writeFileSync(entry, script.replace(/main "\$@"\s*$/, "") + "\n" + driver);
    const proc = Bun.spawn(["/bin/bash", entry], {
      cwd: dir,
      stdin: new TextEncoder().encode(input), stdout: "pipe", stderr: "pipe",
      env: { HOME: home, PATH: bin, HARNESS_MEM_HOME: join(home, ".harness-mem"), HARNESS_MEM_FORCE_PLATFORM_PROMPT: "1", ...env },
    });
    const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
    expect(err).not.toContain("CLIENT_EXECUTED");
    return { out, err, code };
  }
  const noApps = 'setup_app_present() { return 1; }\n';
  return { dir, home, file, client, run, noApps, clean: () => rmSync(dir, { recursive: true, force: true }) };
}

// Exercise the real main decision ordering, replacing only downstream installation work.
const installationDriver = `
setup_app_present() { return 1; }
check_codex_skill_bundle() { return 0; }
should_use_stable_runtime_root() { return 0; }
sync_to_stable_runtime_root() { echo MUTATION_SYNC; }
maybe_auto_update() { echo MUTATION_UPDATE; }
apply_mcp_transport_default_for_command() { echo TRANSPORT_DEFAULT; }
setup_impl() { echo "INSTALL:$PLATFORM"; }
main setup
`;

describe("guided setup discovery", () => {
  test("detects commands and settings without running clients or reading secret content", async () => {
    const f = fixture();
    try {
      f.client("codex"); f.client("opencode"); f.file(".claude.json", "DO_NOT_PRINT_SECRET");
      const r = await f.run("\n", f.noApps + 'prompt_platform_selection\nprintf "RESULT:%s\\n" "$PLATFORM"');
      expect(r.code, r.err).toBe(0);
      expect(r.out).toContain("RESULT:codex,claude");
      expect(r.out).toContain("設定あり（実行環境は未確認）");
      expect(r.out).toContain("試験対応、手動選択");
      expect(r.out).not.toContain("DO_NOT_PRINT_SECRET");
      expect(readdirSync(f.home)).toEqual([".claude.json"]);
    } finally { f.clean(); }
  });

  test("detects desktop presence as a candidate, never as healthy wiring", async () => {
    const f = fixture();
    try {
      const r = await f.run("\n", 'setup_app_present() { [ "$1" = "Cursor" ]; }\nprompt_platform_selection\nprintf "RESULT:%s\\n" "$PLATFORM"');
      expect(r.out).toContain("RESULT:cursor");
      expect(r.out).toContain("アプリあり（実行環境は未確認）");
    } finally { f.clean(); }
  });

  test("no detections requires explicit selection; invalid input retries and duplicates collapse", async () => {
    const f = fixture();
    try {
      const r = await f.run("\n9\n4, 1,4\n", f.noApps + 'prompt_platform_selection\nprintf "RESULT:%s\\n" "$PLATFORM"');
      expect(r.code, r.err).toBe(0);
      expect(r.out).toContain("推奨候補: なし");
      expect(r.err).toContain("無効な選択");
      expect(r.out).toContain("RESULT:claude,codex");
    } finally { f.clean(); }
  });

  test("English selection and explicit experimental choice work", async () => {
    const f = fixture();
    try {
      f.client("antigravity");
      const r = await f.run("3,5\n", f.noApps + 'UI_LANG=en\nprompt_platform_selection\nprintf "RESULT:%s\\n" "$PLATFORM"');
      expect(r.out).toContain("Recommended: none");
      expect(r.out).toContain("experimental, opt-in");
      expect(r.out).toContain("RESULT:opencode,antigravity");
    } finally { f.clean(); }
  });

  for (const [name, input] of [
    ["language EOF", ""], ["selection EOF", "1\n"], ["quit", "1\nq\n"],
    ["confirmation no", "1\n4\nn\nn\nn\n"],
    ["confirmation EOF", "1\n4\nn\nn\n"],
    ["confirmation empty", "1\n4\nn\nn\n\n"],
  ]) {
    test(`${name} cancels before runtime sync, updates or installation`, async () => {
      const f = fixture();
      try {
        const r = await f.run(input, installationDriver);
        expect(r.code, r.err).toBe(0);
        expect(r.out).toContain("Setup cancelled");
        expect(r.out).not.toContain("MUTATION_");
        expect(r.out).not.toContain("INSTALL:");
        expect(readdirSync(f.home)).toEqual([]);
      } finally { f.clean(); }
    });
  }

  test("confirmation installs exactly the chosen clients after showing the plan", async () => {
    const f = fixture();
    try {
      f.client("codex"); f.client("claude");
      const r = await f.run("1\n\nn\nn\ny\n", installationDriver);
      expect(r.code, r.err).toBe(0);
      expect(r.out).toContain("接続先: codex,claude");
      expect(r.out).toContain("INSTALL:codex,claude");
      expect(r.out.indexOf("インストール内容")).toBeLessThan(r.out.indexOf("MUTATION_SYNC"));
    } finally { f.clean(); }
  });

  test("plain non-TTY setup rejects implicit all before any mutation", async () => {
    const f = fixture();
    try {
      const r = await f.run("", installationDriver, { HARNESS_MEM_FORCE_PLATFORM_PROMPT: "0" });
      expect(r.code, r.err).toBe(1);
      expect(r.err).toContain("interactive terminal");
      expect(r.out).not.toContain("MUTATION_");
      expect(r.out).not.toContain("INSTALL:");
      expect(readdirSync(f.home)).toEqual([]);
    } finally { f.clean(); }
  });

  test("explicit platform keeps the non-interactive automation contract", async () => {
    const f = fixture();
    try {
      const r = await f.run("", installationDriver.replace("main setup", "main setup --platform claude"));
      expect(r.code, r.err).toBe(0);
      expect(r.out).toContain("INSTALL:claude");
      expect(r.out).not.toContain("推奨候補");
      expect(r.out).not.toContain("インストール内容");
    } finally { f.clean(); }
  });
});
