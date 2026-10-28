import { expect, spyOn, test } from "bun:test";
import { existsSync } from "node:fs";
import { summarizeWithClaude } from "../../src/core/claude-summary-client";

const model = "claude-haiku-5-5";

test("Haiku is pinned without spawning another model", async () => {
  expect(await summarizeWithClaude("text", "other")).toEqual({ ok: false, reason: "claude_model_not_allowed" });
});

test("missing headless entry returns a safe failure", async () => {
  const mock = spyOn(Bun, "spawn").mockImplementation(() => { throw new Error("secret must not escape"); });
  try { expect(await summarizeWithClaude("text")).toEqual({ ok: false, reason: "claude_spawn_failed" }); }
  finally { mock.mockRestore(); }
});

for (const mode of ["success", "split", "wrong-model", "api-key", "tools", "mcp", "tool-use", "denial", "failed", "auth", "rate", "empty", "invalid", "truncated", "exit", "unavailable", "timeout", "limit", "no-init", "no-result", "fallback"]) {
  test(`Claude ${mode} is isolated, bounded and cleaned up`, async () => {
    let root = "", received = "", killed = false;
    let controller: ReadableStreamDefaultController<Uint8Array>;
    let end!: (n: number) => void;
    const exited = new Promise<number>(r => { end = r; });
    const emit = (obj: unknown) => {
      const bytes = new TextEncoder().encode(JSON.stringify(obj) + "\n");
      if (mode === "split") for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      else controller.enqueue(bytes);
    };
    const mock = spyOn(Bun, "spawn").mockImplementation((cmd: any, opts: any) => {
      root = opts.cwd;
      expect(cmd[0]).toBe("claude-headless");
      for (const flag of ["--safe-mode", "--no-session-persistence", "--strict-mcp-config", "--disable-slash-commands"]) expect(cmd).toContain(flag);
      expect(cmd[cmd.indexOf("--tools") + 1]).toBe("");
      expect(cmd[cmd.indexOf("--model") + 1]).toBe(model);
      expect(cmd[cmd.indexOf("--effort") + 1]).toBe("low");
      expect(cmd).not.toContain("private prompt");
      expect(Object.keys(opts.env).every(k => ["PATH", "HOME", "TMPDIR", "LANG", "USER", "LOGNAME", "SHELL"].includes(k))).toBe(true);
      return ({ stdout: new ReadableStream({ start(c) { controller = c; } }), exited,
        stdin: { write(text: string) { received += text; }, end() {
          if (mode === "timeout") return;
          if (mode === "invalid") controller.enqueue(new TextEncoder().encode("invalid\n"));
          else if (mode === "truncated") controller.enqueue(new TextEncoder().encode('{"type":'));
          else if (mode === "limit") controller.enqueue(new Uint8Array(1_000_001));
          else {
            if (mode !== "no-init") emit({ type: "system", subtype: "init", model: mode === "wrong-model" ? "other" : model,
              apiKeySource: mode === "api-key" ? "environment" : "none", tools: mode === "tools" ? ["Bash"] : [], mcp_servers: mode === "mcp" ? [{ name: "external" }] : [] });
            if (mode === "tool-use") emit({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash" }] } });
            if (mode !== "no-result") emit({ type: "result", subtype: "success", is_error: ["failed", "auth", "rate"].includes(mode), result: mode === "empty" ? "" : mode === "auth" ? "Not logged in · Please run /login" : mode === "rate" ? "429 rate limit" : "  日本語の要約  ",
              modelUsage: { [mode === "fallback" ? "other" : model]: {} }, permission_denials: mode === "denial" ? [{}] : [] });
          }
          controller.close(); end(mode === "exit" ? 1 : mode === "unavailable" ? 2 : 0);
        } }, kill() { killed = true; end(137); try { controller.close(); } catch {} },
      }) as any;
    });
    try {
      const result = await summarizeWithClaude("private prompt", model, 40);
      expect(received).toBe("private prompt");
      if (["success", "split"].includes(mode)) expect(result).toEqual({ ok: true, summary: "日本語の要約" });
      else {
        const reasons: Record<string, string> = { "wrong-model": "claude_config_mismatch", "api-key": "claude_config_mismatch", tools: "claude_config_mismatch", mcp: "claude_config_mismatch", "tool-use": "claude_tool_used", denial: "claude_tool_used", failed: "claude_turn_failed", auth: "claude_auth_error", rate: "claude_rate_limited", empty: "empty", invalid: "claude_protocol_error", truncated: "claude_protocol_error", exit: "claude_exit", unavailable: "claude_account_unavailable", timeout: "claude_timeout", limit: "claude_output_limit", "no-init": "claude_config_mismatch", "no-result": "claude_protocol_error", fallback: "claude_config_mismatch" };
        expect(result).toEqual({ ok: false, reason: reasons[mode] });
      }
      expect(killed).toBe(true);
      expect(existsSync(root)).toBe(false);
    } finally { mock.mockRestore(); }
  });
}
