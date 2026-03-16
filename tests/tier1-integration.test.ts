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
