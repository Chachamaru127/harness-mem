import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
