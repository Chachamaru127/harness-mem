import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const HARNESS_MEM_SCRIPT = join(ROOT, "scripts/harness-mem");
const HARNESS_MEM_SOURCE = readFileSync(HARNESS_MEM_SCRIPT, "utf8");

async function runHarnessMem(args: string[], env: NodeJS.ProcessEnv) {
  const proc = Bun.spawn(["bash", HARNESS_MEM_SCRIPT, ...args], {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
    env,
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const code = await proc.exited;
  return { code, stdout, stderr };
}

describe("S128-009 telemetry CLI contract", () => {
  test("scripts/harness-mem exposes telemetry status/export without an external collector", () => {
    expect(HARNESS_MEM_SOURCE).toContain("telemetry status|export");
    expect(HARNESS_MEM_SOURCE).toContain("telemetry_impl()");
    expect(HARNESS_MEM_SOURCE).toContain("/v1/admin/telemetry/status");
    expect(HARNESS_MEM_SOURCE).toContain("/v1/admin/telemetry/export");
  });

  test("telemetry status --json and export call the local daemon admin endpoint", async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), "hmem-telemetry-cli-"));
    const fakeBin = join(tmpRoot, "bin");
    const curlLog = join(tmpRoot, "curl.log");
    mkdirSync(fakeBin, { recursive: true });
    writeFileSync(
      join(fakeBin, "curl"),
      [
        "#!/usr/bin/env bash",
        "config=\"$(cat)\"",
        "printf '%s\\n---\\n' \"$config\" >> \"$CURL_LOG\"",
        "if printf '%s' \"$config\" | grep -q '/v1/admin/telemetry/export'; then",
        "  cat <<'JSON'",
        "{\"ok\":true,\"schema\":\"harness_mem.telemetry.export.v1\",\"summary\":{\"span_counts\":{\"recall.search\":1},\"metrics\":[{\"name\":\"recall_latency_ms\",\"count\":1,\"sum\":9,\"min\":9,\"max\":9,\"latest\":9}]},\"spans\":[{\"name\":\"recall.search\",\"attributes\":{\"recall.scope\":\"project\"}}]}",
        "JSON",
        "else",
        "  cat <<'JSON'",
        "{\"ok\":true,\"schema\":\"harness_mem.telemetry.status.v1\",\"status\":{\"service_name\":\"harness-mem-memory-daemon\",\"service_version\":\"0.24.1\",\"exporter\":{\"mode\":\"local\",\"pending_spans\":1,\"flushed_spans\":0,\"last_flush_ok\":null,\"last_flush_error\":null}},\"summary\":{\"span_count_total\":1,\"span_counts\":{\"recall.search\":1},\"metrics\":[]}}",
        "JSON",
        "fi",
      ].join("\n"),
    );
    chmodSync(join(fakeBin, "curl"), 0o755);

    try {
      const env = {
        ...process.env,
        PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
        CURL_LOG: curlLog,
        HARNESS_MEM_HOME: join(tmpRoot, ".harness-mem"),
        HARNESS_MEM_SKIP_AUTO_UPDATE: "1",
        HARNESS_MEM_NON_INTERACTIVE: "1",
        HARNESS_MEM_PORT: "39888",
        HARNESS_MEM_ADMIN_TOKEN: "test-admin-token",
      };
      const status = await runHarnessMem(["telemetry", "status", "--json"], env);
      const exported = await runHarnessMem(["telemetry", "export", "--limit", "3"], env);

      expect(status.code).toBe(0);
      expect(exported.code).toBe(0);
      expect(JSON.parse(status.stdout).schema).toBe("harness_mem.telemetry.status.v1");
      expect(JSON.parse(exported.stdout).summary.span_counts["recall.search"]).toBe(1);

      const curlConfig = readFileSync(curlLog, "utf8");
      expect(curlConfig).toContain("http://127.0.0.1:39888/v1/admin/telemetry/status");
      expect(curlConfig).toContain("http://127.0.0.1:39888/v1/admin/telemetry/export?limit=3");
      expect(curlConfig).toContain("x-harness-mem-token: test-admin-token");
    } finally {
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });
});
