import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("MCP daemon autostart contract", () => {
  test("Node MCP frontend does not implicitly start the Mem UI", () => {
    const source = readFileSync(join(process.cwd(), "mcp-server/src/tools/memory.ts"), "utf8");

    expect(source).toContain("HARNESS_MEM_ENABLE_UI:");
    expect(source).toContain('process.env.HARNESS_MEM_ENABLE_UI || "false"');
  });

  test("Go MCP frontend does not implicitly start the Mem UI", () => {
    const source = readFileSync(join(process.cwd(), "mcp-server-go/internal/proxy/httpclient.go"), "utf8");

    expect(source).toContain("func daemonStartEnv()");
    expect(source).toContain('"HARNESS_MEM_ENABLE_UI=false"');
    expect(source).toContain("cmd.Env = daemonStartEnv()");
  });

  test("high-level CLI preflight does not implicitly start the Mem UI", () => {
    const source = readFileSync(join(process.cwd(), "scripts/harness-mem"), "utf8");
    const client = readFileSync(join(process.cwd(), "scripts/harness-mem-client.sh"), "utf8");

    expect(source).toContain('HARNESS_MEM_ENABLE_UI="${HARNESS_MEM_ENABLE_UI:-false}"');
    expect(source).toContain('HARNESS_MEM_ENABLE_UI="${HARNESS_MEM_ENABLE_UI:-true}" start_daemon');
    expect(client).toContain('HARNESS_MEM_ENABLE_UI="${HARNESS_MEM_ENABLE_UI:-false}" "$DAEMON_SCRIPT" start --quiet');
  });
});
