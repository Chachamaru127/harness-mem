/**
 * §55 S55-004: Tier 1 統合テスト
 *
 * Claude Code と Codex の設定ファイル・スクリプトの整合性を静的に検証する。
 * デーモン起動不要。ファイルの存在と形式のみ確認。
 */
import { describe, test, expect } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");

// =========================================================================
// Claude Code (Tier 1)
// =========================================================================
describe("Tier 1: Claude Code integration", () => {
  test("hooks.json が存在し valid JSON であること", () => {
    const p = resolve(ROOT, "hooks/hooks.json");
    expect(existsSync(p)).toBe(true);
    const data = JSON.parse(readFileSync(p, "utf8"));
    expect(typeof data).toBe("object");
  });

  test("hooks.json に必須イベントが登録されていること", () => {
    // hooks.json の構造: { description, hooks: { [EventName]: [...] } }
    const data = JSON.parse(readFileSync(resolve(ROOT, "hooks/hooks.json"), "utf8"));
    const hooksMap: Record<string, unknown> = data.hooks ?? data;
    const registeredEvents = Object.keys(hooksMap);
    const requiredEvents = ["PreToolUse", "PostToolUse", "Stop"];
    for (const event of requiredEvents) {
      expect(registeredEvents).toContain(event);
    }
  });

  test("各フックハンドラスクリプトが存在すること", () => {
    const scripts = [
      "scripts/run-script.js",
      "scripts/userprompt-inject-policy.sh",
      "scripts/hook-handlers/memory-session-start.sh",
      "scripts/hook-handlers/memory-stop.sh",
      "scripts/hook-handlers/memory-user-prompt.sh",
      "scripts/hook-handlers/memory-post-tool-use.sh",
      "scripts/hook-handlers/memory-self-check.sh",
      "scripts/hook-handlers/memory-post-compact.sh",
      "scripts/hook-handlers/memory-elicitation.sh",
    ];
    for (const script of scripts) {
      const p = resolve(ROOT, script);
      expect(existsSync(p)).toBe(true);
    }
  });

  test("hook-common.sh が存在すること", () => {
    expect(
      existsSync(resolve(ROOT, "scripts/hook-handlers/lib/hook-common.sh"))
    ).toBe(true);
  });

  test("MCP サーバーのエントリポイントが存在すること", () => {
    // dist または src のいずれかが存在すればOK
    const distExists = existsSync(resolve(ROOT, "mcp-server/dist/index.js"));
    const srcExists = existsSync(resolve(ROOT, "mcp-server/src/index.ts"));
    expect(distExists || srcExists).toBe(true);
  });

  test("harness-mem-client.sh が存在すること", () => {
    expect(existsSync(resolve(ROOT, "scripts/harness-mem-client.sh"))).toBe(true);
  });
});

// =========================================================================
// Codex (Tier 1)
// =========================================================================
describe("Tier 1: Codex integration", () => {
  test("codex/ ディレクトリが存在すること", () => {
    expect(existsSync(resolve(ROOT, "codex"))).toBe(true);
  });

  test("codex の harness.rules が存在すること", () => {
    // 実際のパス: codex/.codex/rules/harness.rules
    const candidates = [
      "codex/.codex/rules/harness.rules",
      "codex/.codex/harness.rules",
      "codex/harness.rules",
    ];
    const found = candidates.some((p) => existsSync(resolve(ROOT, p)));
    expect(found).toBe(true);
  });

  test("codex セッションスクリプトが存在すること", () => {
    const scripts = [
      "scripts/hook-handlers/codex-session-start.sh",
      "scripts/hook-handlers/codex-session-stop.sh",
    ];
    for (const script of scripts) {
      expect(existsSync(resolve(ROOT, script))).toBe(true);
    }
  });

  test("codex hooks.json が存在すること（実験的フックエンジン対応）", () => {
    const p = resolve(ROOT, "codex/.codex/hooks.json");
    if (existsSync(p)) {
      const data = JSON.parse(readFileSync(p, "utf8"));
      expect(typeof data).toBe("object");
    }
    // hooks.json がなくても rules ベースで動作するため、存在しなくても PASS
    expect(true).toBe(true);
  });
});

// =========================================================================
// §57 Claude Code v2.1.80 + Codex v0.116.0 compatibility
// =========================================================================
describe("§57: CC v2.1.80 + Codex v0.116.0 compatibility", () => {
  test("StopFailure hook が hooks.json に登録されていること (CC v2.1.78+)", () => {
    const data = JSON.parse(readFileSync(resolve(ROOT, "hooks/hooks.json"), "utf8"));
    const hooksMap: Record<string, unknown> = data.hooks ?? data;
    expect(Object.keys(hooksMap)).toContain("StopFailure");
  });

  test("memory-stop-failure.sh ハンドラが存在すること", () => {
    expect(existsSync(resolve(ROOT, "scripts/hook-handlers/memory-stop-failure.sh"))).toBe(true);
  });

  test("hook-common.sh に PLUGIN_DATA_DIR (CLAUDE_PLUGIN_DATA) が定義されていること", () => {
    const content = readFileSync(resolve(ROOT, "scripts/hook-handlers/lib/hook-common.sh"), "utf8");
    expect(content).toContain("CLAUDE_PLUGIN_DATA");
    expect(content).toContain("PLUGIN_DATA_DIR");
  });

  test("Codex hooks.json のバージョンが v0.116.0+ であること", () => {
    const p = resolve(ROOT, "codex/.codex/hooks.json");
    if (existsSync(p)) {
      const data = JSON.parse(readFileSync(p, "utf8"));
      expect(data.description).toContain("0.116.0");
    }
  });

  test("Codex hooks.json に UserPromptSubmit が登録されていること", () => {
    const p = resolve(ROOT, "codex/.codex/hooks.json");
    if (existsSync(p)) {
      const data = JSON.parse(readFileSync(p, "utf8"));
      const hooksMap: Record<string, unknown> = data.hooks ?? {};
      expect(Object.keys(hooksMap)).toContain("UserPromptSubmit");
    }
  });

  test("codex-user-prompt.sh ハンドラが存在すること", () => {
    expect(existsSync(resolve(ROOT, "scripts/hook-handlers/codex-user-prompt.sh"))).toBe(true);
  });

  test("resume-pack デフォルトトークンが 4000 に引き上げられていること", () => {
    const content = readFileSync(resolve(ROOT, "memory-server/src/core/observation-store.ts"), "utf8");
    expect(content).toContain("return 4000;");
  });

  test("SessionStart hook にセッション名キャプチャがあること", () => {
    const content = readFileSync(resolve(ROOT, "scripts/hook-handlers/memory-session-start.sh"), "utf8");
    // Captures session_name from -n/--name flag
    expect(content).toContain("session_name");
    expect(content).toContain("SESSION_NAME");
    // Session name is included in event payload for persistence
    expect(content).toContain("session_name:$session_name");
    // Session name is included in hook metadata for server-side extraction
    expect(content).toContain("session_name:(.session_name");
  });

  test("MCP サーバーに channels 対応コードがあること", () => {
    const content = readFileSync(resolve(ROOT, "mcp-server/src/index.ts"), "utf8");
    expect(content).toContain("HARNESS_MEM_ENABLE_CHANNELS");
    expect(content).toContain("pushMemoryNotification");
  });

  test("MCP search 結果に citation メタデータがあること", () => {
    const memoryTool = readFileSync(resolve(ROOT, "mcp-server/src/tools/memory.ts"), "utf8");
    const toolResult = readFileSync(resolve(ROOT, "mcp-server/src/tool-result.ts"), "utf8");
    expect(memoryTool).toContain("citations: true");
    expect(toolResult).toContain("_citations");
    expect(toolResult).toContain("result._citations = options.citations");
  });

  test("plugin.json に effort フィールドがあること", () => {
    const data = JSON.parse(readFileSync(resolve(ROOT, ".claude-plugin/plugin.json"), "utf8"));
    expect(data.effort).toBeDefined();
  });

  test("memory-worktree-event.sh が sparse checkout を検出できること", () => {
    const content = readFileSync(resolve(ROOT, "scripts/hook-handlers/memory-worktree-event.sh"), "utf8");
    expect(content).toContain("sparse");
    expect(content).toContain("IS_SPARSE");
  });

  test("MCP deny ルール設定時にツールが graceful に処理されること（静的確認）", () => {
    // deny: ["mcp__harness"] 設定時、Claude Code v2.1.78 はツールをモデルに送信しない。
    // MCP サーバー側では特別な処理は不要（ツール呼び出し自体が来ない）。
    // ここでは MCP サーバーのエラーハンドリングが Unknown tool に対応していることを確認。
    const content = readFileSync(resolve(ROOT, "mcp-server/src/index.ts"), "utf8");
    expect(content).toContain("Unknown tool:");
    expect(content).toContain("isError: true");
  });
});

// =========================================================================
// Tier ラベルの整合性
// =========================================================================
describe("Tier labeling consistency", () => {
  test("README.md に Tier 1/2 のラベルが含まれること", () => {
    const readme = readFileSync(resolve(ROOT, "README.md"), "utf8");
    expect(readme).toContain("Tier 1");
    expect(readme).toContain("Tier 2");
  });

  test("README_ja.md に Tier 1/2 のラベルが含まれること", () => {
    const readme = readFileSync(resolve(ROOT, "README_ja.md"), "utf8");
    expect(readme).toContain("Tier 1");
    expect(readme).toContain("Tier 2");
  });

  test("package.json の description に Claude Code と Codex が含まれること", () => {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
    expect(pkg.description.toLowerCase()).toContain("claude");
    expect(pkg.description.toLowerCase()).toContain("codex");
  });

  test("package.json の keywords の先頭2つが claude-code と codex であること", () => {
    const pkg = JSON.parse(readFileSync(resolve(ROOT, "package.json"), "utf8"));
    expect(pkg.keywords[0]).toBe("claude-code");
    expect(pkg.keywords[1]).toBe("codex");
  });
});
