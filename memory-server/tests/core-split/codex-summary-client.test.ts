import { test, expect, spyOn } from "bun:test";
import { summarizeWithCodex } from "../../src/core/codex-summary-client";

test("spawn failure returns a bounded failure", async () => {
  const mock = spyOn(Bun, "spawn").mockImplementation(() => { throw new Error("unavailable"); });
  try { expect(await summarizeWithCodex("text", "gpt-6-luna", 20)).toEqual({ ok: false, reason: "codex_spawn_failed" }); }
  finally { mock.mockRestore(); }
});

for (const mode of ["success", "rpc", "timeout", "tool", "failed", "empty", "split", "mismatch", "started", "invalid"]) {
  test(`App Server ${mode} cleans up and returns only completed output`, async () => {
    let controller: ReadableStreamDefaultController<Uint8Array>;
    let end!: (n: number) => void;
    const exited = new Promise<number>(r => { end = r; });
    let killed = false;
    const emit = (v: unknown) => {
      const bytes = new TextEncoder().encode(JSON.stringify(v) + "\n");
      if (mode === "split") for (const byte of bytes) controller.enqueue(Uint8Array.of(byte));
      else controller.enqueue(bytes);
    };
    const mock = spyOn(Bun, "spawn").mockImplementation((cmd: any, opts: any) => {
      expect(opts.env.CLOUDFLARE_API_TOKEN).toBeUndefined();
      expect(cmd).toContain("features.unified_exec=false");
      return ({
      stdout: new ReadableStream({ start(c) { controller = c; } }), exited,
      stdin: { write(line: string) {
        const m = JSON.parse(line);
        if (m.id === 1) emit({ id: 1, result: {} });
        if (m.id === 2) { expect(m.params.ephemeral).toBe(true); expect(m.params.sandbox).toBe("read-only"); }
        if (m.id === 2) emit({ id: 2, result: { model: mode === "mismatch" ? "other" : "gpt-6-luna", cwd: opts.cwd, approvalPolicy: "never", sandbox: { type: "readOnly" }, thread: { id: "t" } } });
        if (m.id === 3) {
          if (mode === "rpc") return emit({ id: 3, error: { message: "failure" } });
          emit({ id: 3, result: { turn: { id: "u" } } });
          if (mode === "timeout") return;
          if (mode === "invalid") return controller.enqueue(new TextEncoder().encode("not-json\n"));
          if (mode === "started") return emit({ method: "item/started", params: { threadId: "t", item: {type:"commandExecution"} } });
          if (mode === "tool") return emit({ id: 99, method: "item/commandExecution/requestApproval" });
          emit({ method: "item/completed", params: { threadId: "t", turnId: "u", item: { type: "agentMessage", phase: "final_answer", text: mode === "empty" ? "" : "要約" } } });
          emit({ method: "turn/completed", params: { threadId: "t", turn: { id: "u", status: mode === "failed" ? "failed" : "completed" } } });
        }
      } }, kill() { killed = true; end(0); try { controller.close(); } catch {} },
    }) as any; });
    try {
      const result = await summarizeWithCodex("text", "gpt-6-luna", 30);
      expect(result.ok).toBe(["success", "split"].includes(mode));
      if (result.ok) expect(result.summary).toBe("要約");
      else expect(result.reason).toBe(({
        rpc: "codex_rpc_error", timeout: "codex_timeout", tool: "codex_tool_request",
        failed: "codex_turn_failed", empty: "empty", mismatch: "codex_config_mismatch",
        started: "codex_tool_used", invalid: "codex_protocol_error",
      } as Record<string, string>)[mode]);
      expect(killed).toBe(true);
    } finally { mock.mockRestore(); }
  });
}
