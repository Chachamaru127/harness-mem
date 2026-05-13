import { describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const SCRIPT = resolve(ROOT, "scripts/harness-mem");

async function runHarnessMem(
  args: string[],
  env: NodeJS.ProcessEnv
): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["bash", SCRIPT, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env,
  });
  const stdoutPromise = new Response(proc.stdout).text();
  const stderrPromise = new Response(proc.stderr).text();
  const code = await proc.exited;
  const [stdout, stderr] = await Promise.all([stdoutPromise, stderrPromise]);
  return { code, stdout, stderr };
}

function writeHealthyReadOnlyConfig(home: string): string {
  const harnessHome = join(home, ".harness-mem");
  mkdirSync(harnessHome, { recursive: true });
  writeFileSync(
    join(harnessHome, "config.json"),
    JSON.stringify(
      {
        backend_mode: "local",
        recall: { mode: "quiet" },
        embedding_provider: "auto",
        embedding_model: "multilingual-e5",
        managed: { endpoint: "", api_key: "" },
      },
      null,
      2
    )
  );
  return harnessHome;
}

function writePsFixture(home: string): string {
  const fixture = join(home, "ps-fixture.txt");
  writeFileSync(
    fixture,
    [
      "10 1 01:00:00 501000 /opt/homebrew/bin/codex",
      "101 10 00:02 12345 /Users/example/harness-mem/bin/harness-mcp-darwin-arm64",
      "20 1 02:00:00 601000 /Applications/Hermes.app/Contents/MacOS/Hermes",
      "202 20 00:05 23456 /Users/example/harness-mem/bin/harness-mcp-darwin-arm64",
      "303 1 12:34 34567 /tmp/harness-mcp-darwin-arm64",
      "404 99999 1-02:03:04 45678 /tmp/harness-mcp-darwin-arm64",
      "505 10 00:01 111 grep harness-mcp-darwin-arm64",
      "606 1 00:10 45678 /tmp/harness-mcp-http-gateway --transport http --listen 127.0.0.1:37889/mcp",
      "",
    ].join("\n")
  );
  return fixture;
}

function writeChangedRevalidationFixture(home: string): string {
  const fixture = join(home, "ps-revalidation-fixture.txt");
  writeFileSync(
    fixture,
    [
      "10 1 01:00:00 501000 /opt/homebrew/bin/codex",
      "303 10 00:20 34567 /tmp/harness-mcp-darwin-arm64",
      "404 1 12:34 45678 /usr/bin/true harness-mcp-darwin-arm64",
      "",
    ].join("\n")
  );
  return fixture;
}

describe("doctor --processes", () => {
  test("JSON advisory classifies live Codex/Hermes stdio children and stale candidates without failing doctor", async () => {
    const tmpHome = mkdtempSync(join(tmpdir(), "hmem-doctor-processes-"));
    try {
      const harnessHome = writeHealthyReadOnlyConfig(tmpHome);
      const fixture = writePsFixture(tmpHome);

      const result = await runHarnessMem(["doctor", "--processes", "--json", "--read-only", "--skip-version-check"], {
        ...process.env,
        HOME: tmpHome,
        HARNESS_MEM_HOME: harnessHome,
        HARNESS_MEM_NON_INTERACTIVE: "1",
        HARNESS_MEM_PORT: "48977",
        HARNESS_MEM_PS_FIXTURE: fixture,
      });

      expect(result.code).toBe(0);
      const parsed = JSON.parse(result.stdout) as {
        all_green: boolean;
        process_advisory: {
          count: number;
          active_count: number;
          stale_candidate_count: number;
          streamable_http_count: number;
          processes: Array<{
            pid: number;
            ppid: number;
            executable_name: string;
            parent_kind: string;
            parent_command: string | null;
            transport_estimate: string;
            classification: string;
            stale_candidate: boolean;
            stale_reasons: string[];
          }>;
        };
      };

      expect(parsed.all_green).toBe(true);
      expect(parsed.process_advisory.count).toBe(5);
      expect(parsed.process_advisory.active_count).toBe(3);
      expect(parsed.process_advisory.stale_candidate_count).toBe(2);
      expect(parsed.process_advisory.streamable_http_count).toBe(1);

      const byPid = new Map(parsed.process_advisory.processes.map((process) => [process.pid, process]));
      expect(byPid.has(505)).toBe(false);
      expect(byPid.get(101)?.classification).toBe("active_stdio_child");
      expect(byPid.get(101)?.executable_name).toBe("harness-mcp-darwin-arm64");
      expect(byPid.get(101)?.parent_kind).toBe("codex");
      expect(byPid.get(101)?.transport_estimate).toBe("stdio");
      expect(byPid.get(202)?.classification).toBe("active_stdio_child");
      expect(byPid.get(202)?.parent_kind).toBe("hermes");
      expect(byPid.get(303)?.stale_candidate).toBe(true);
      expect(byPid.get(303)?.stale_reasons).toContain("ppid_1_or_lower");
      expect(byPid.get(404)?.stale_candidate).toBe(true);
      expect(byPid.get(404)?.stale_reasons).toContain("missing_parent_process");
      expect(byPid.get(606)?.classification).toBe("unknown_parent_http_gateway");
      expect(byPid.get(606)?.transport_estimate).toBe("streamable_http");
      expect(byPid.get(606)?.stale_candidate).toBe(false);
    } finally {
      rmSync(tmpHome, { recursive: true, force: true });
    }
  }, 60_000);

  test("human doctor prints a readable process advisory", async () => {
    const tmpHome = mkdtempSync(join(tmpdir(), "hmem-doctor-processes-human-"));
    try {
      const harnessHome = writeHealthyReadOnlyConfig(tmpHome);
      const fixture = writePsFixture(tmpHome);

      const result = await runHarnessMem(["doctor", "--processes", "--read-only", "--skip-version-check"], {
        ...process.env,
        HOME: tmpHome,
        HARNESS_MEM_HOME: harnessHome,
        HARNESS_MEM_NON_INTERACTIVE: "1",
        HARNESS_MEM_LANG: "en",
        HARNESS_MEM_PORT: "48978",
        HARNESS_MEM_PS_FIXTURE: fixture,
      });

      expect(result.code).toBe(0);
      expect(result.stdout).toContain("MCP process advisory");
      expect(result.stdout).toContain("process count alone is not a doctor failure");
      expect(result.stdout).toContain("pid=101");
      expect(result.stdout).toContain("class=active_stdio_child");
      expect(result.stdout).toContain("pid=303");
      expect(result.stdout).toContain("class=stale_candidate");
    } finally {
      rmSync(tmpHome, { recursive: true, force: true });
    }
  }, 60_000);
});

describe("cleanup-stale-mcp", () => {
  test("dry-run JSON lists only stale stdio candidates and skips active parents", async () => {
    const tmpHome = mkdtempSync(join(tmpdir(), "hmem-cleanup-stale-mcp-"));
    try {
      const harnessHome = writeHealthyReadOnlyConfig(tmpHome);
      const fixture = writePsFixture(tmpHome);
      const killLog = join(tmpHome, "kill.log");

      const result = await runHarnessMem(["cleanup-stale-mcp", "--json", "--skip-version-check"], {
        ...process.env,
        HOME: tmpHome,
        HARNESS_MEM_HOME: harnessHome,
        HARNESS_MEM_NON_INTERACTIVE: "1",
        HARNESS_MEM_PS_FIXTURE: fixture,
        HARNESS_MEM_MCP_CLEANUP_KILL_LOG: killLog,
      });

      expect(result.code).toBe(0);
      const parsed = JSON.parse(result.stdout) as {
        schema: string;
        mode: string;
        older_than: string | null;
        candidates: Array<{ pid: number; transport_estimate: string; stale_candidate: boolean }>;
        skipped: Array<{ pid: number; skip_reason: string; parent_kind: string; transport_estimate: string }>;
        attempted: Array<{ pid: number }>;
        killed: Array<{ pid: number }>;
        safety_note: string;
      };

      expect(parsed.schema).toBe("cleanup-stale-mcp.v1");
      expect(parsed.mode).toBe("dry_run");
      expect(parsed.older_than).toBeNull();
      expect(parsed.candidates.map((process) => process.pid).sort()).toEqual([303, 404]);
      expect(parsed.candidates.every((process) => process.transport_estimate === "stdio")).toBe(true);
      expect(parsed.candidates.every((process) => process.stale_candidate)).toBe(true);
      expect(parsed.attempted).toEqual([]);
      expect(parsed.killed).toEqual([]);
      expect(existsSync(killLog)).toBe(false);

      const skippedByPid = new Map(parsed.skipped.map((process) => [process.pid, process]));
      expect(skippedByPid.get(101)?.skip_reason).toBe("active_parent");
      expect(skippedByPid.get(101)?.parent_kind).toBe("codex");
      expect(skippedByPid.get(202)?.skip_reason).toBe("active_parent");
      expect(skippedByPid.get(202)?.parent_kind).toBe("hermes");
      expect(skippedByPid.get(606)?.skip_reason).toBe("streamable_http_gateway_not_cleanup_target");
      expect(skippedByPid.get(606)?.transport_estimate).toBe("streamable_http");
      expect(parsed.safety_note).toContain("Dry-run is the default");
    } finally {
      rmSync(tmpHome, { recursive: true, force: true });
    }
  }, 60_000);

  test("execute requires --older-than", async () => {
    const tmpHome = mkdtempSync(join(tmpdir(), "hmem-cleanup-stale-mcp-requires-age-"));
    try {
      const harnessHome = writeHealthyReadOnlyConfig(tmpHome);
      const fixture = writePsFixture(tmpHome);

      const result = await runHarnessMem(["cleanup-stale-mcp", "--execute", "--json", "--skip-version-check"], {
        ...process.env,
        HOME: tmpHome,
        HARNESS_MEM_HOME: harnessHome,
        HARNESS_MEM_NON_INTERACTIVE: "1",
        HARNESS_MEM_PS_FIXTURE: fixture,
      });

      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain("cleanup-stale-mcp --execute requires --older-than");
    } finally {
      rmSync(tmpHome, { recursive: true, force: true });
    }
  }, 60_000);

  test("execute with test kill log targets only eligible stale stdio candidates", async () => {
    const tmpHome = mkdtempSync(join(tmpdir(), "hmem-cleanup-stale-mcp-execute-"));
    try {
      const harnessHome = writeHealthyReadOnlyConfig(tmpHome);
      const fixture = writePsFixture(tmpHome);
      const killLog = join(tmpHome, "kill.log");

      const result = await runHarnessMem(
        ["cleanup-stale-mcp", "--execute", "--older-than", "10m", "--json", "--skip-version-check"],
        {
          ...process.env,
          HOME: tmpHome,
          HARNESS_MEM_HOME: harnessHome,
          HARNESS_MEM_NON_INTERACTIVE: "1",
          HARNESS_MEM_PS_FIXTURE: fixture,
          HARNESS_MEM_MCP_CLEANUP_KILL_LOG: killLog,
        }
      );

      expect(result.code).toBe(0);
      const parsed = JSON.parse(result.stdout) as {
        mode: string;
        older_than: string | null;
        older_than_seconds: number | null;
        candidates: Array<{ pid: number }>;
        skipped: Array<{ pid: number; skip_reason: string }>;
        attempted: Array<{ pid: number; result: string }>;
        killed: Array<{ pid: number; result: string }>;
      };

      expect(parsed.mode).toBe("execute");
      expect(parsed.older_than).toBe("10m");
      expect(parsed.older_than_seconds).toBe(600);
      expect(parsed.candidates.map((process) => process.pid).sort()).toEqual([303, 404]);
      expect(parsed.attempted.map((process) => process.pid).sort()).toEqual([303, 404]);
      expect(parsed.attempted.every((process) => process.result === "test_logged")).toBe(true);
      expect(parsed.killed.map((process) => process.pid).sort()).toEqual([303, 404]);

      const logLines = readFileSync(killLog, "utf8").trim().split("\n");
      expect(logLines).toEqual([
        "303\tSIGTERM\tppid_1_or_lower",
        "404\tSIGTERM\tmissing_parent_process",
      ]);

      const skippedPids = new Map(parsed.skipped.map((process) => [process.pid, process.skip_reason]));
      expect(skippedPids.get(101)).toBe("active_parent");
      expect(skippedPids.get(202)).toBe("active_parent");
      expect(skippedPids.get(606)).toBe("streamable_http_gateway_not_cleanup_target");
    } finally {
      rmSync(tmpHome, { recursive: true, force: true });
    }
  }, 60_000);

  test("execute revalidates each candidate before logging or signaling", async () => {
    const tmpHome = mkdtempSync(join(tmpdir(), "hmem-cleanup-stale-mcp-revalidate-"));
    try {
      const harnessHome = writeHealthyReadOnlyConfig(tmpHome);
      const fixture = writePsFixture(tmpHome);
      const revalidationFixture = writeChangedRevalidationFixture(tmpHome);
      const killLog = join(tmpHome, "kill.log");

      const result = await runHarnessMem(
        ["cleanup-stale-mcp", "--execute", "--older-than", "10m", "--json", "--skip-version-check"],
        {
          ...process.env,
          HOME: tmpHome,
          HARNESS_MEM_HOME: harnessHome,
          HARNESS_MEM_NON_INTERACTIVE: "1",
          HARNESS_MEM_PS_FIXTURE: fixture,
          HARNESS_MEM_MCP_CLEANUP_REVALIDATE_PS_FIXTURE: revalidationFixture,
          HARNESS_MEM_MCP_CLEANUP_KILL_LOG: killLog,
        }
      );

      expect(result.code).toBe(0);
      const parsed = JSON.parse(result.stdout) as {
        candidates: Array<{ pid: number }>;
        attempted: Array<{
          pid: number;
          result: string;
          error: string | null;
          revalidation: { valid: boolean; error: string | null };
        }>;
        killed: Array<{ pid: number }>;
      };

      expect(parsed.candidates.map((process) => process.pid).sort()).toEqual([303, 404]);
      expect(parsed.killed).toEqual([]);
      expect(existsSync(killLog)).toBe(false);

      const attemptsByPid = new Map(parsed.attempted.map((attempt) => [attempt.pid, attempt]));
      expect(attemptsByPid.get(303)?.result).toBe("skipped_revalidation_failed");
      expect(attemptsByPid.get(303)?.error).toBe("active_parent");
      expect(attemptsByPid.get(303)?.revalidation.valid).toBe(false);
      expect(attemptsByPid.get(404)?.result).toBe("skipped_revalidation_failed");
      expect(attemptsByPid.get(404)?.error).toBe("pid_not_found_or_argv0_not_harness_mcp");
      expect(attemptsByPid.get(404)?.revalidation.valid).toBe(false);
    } finally {
      rmSync(tmpHome, { recursive: true, force: true });
    }
  }, 60_000);
});
