/**
 * marketplace-schema.test.ts
 *
 * マーケットプレイス配布の契約テスト:
 * - marketplace.json のスキーマ準拠
 * - plugin.json のスキーマ準拠
 * - バージョン一貫性 (package.json / plugin.json / marketplace.json)
 * - hooks.json シンボリックリンクの存在
 * - MCP サーバー設定の妥当性
 * - 予約名の不使用
 */
import { describe, expect, test } from "bun:test";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const PLUGIN_DIR = resolve(ROOT, ".claude-plugin");
const MARKETPLACE_JSON = resolve(PLUGIN_DIR, "marketplace.json");
const PLUGIN_JSON = resolve(PLUGIN_DIR, "plugin.json");
const HOOKS_JSON = resolve(PLUGIN_DIR, "hooks.json");
const PACKAGE_JSON = resolve(ROOT, "package.json");

// 予約名 (Anthropic 公式)
const RESERVED_NAMES = [
  "claude-code-marketplace",
  "claude-code-plugins",
  "claude-plugins-official",
  "anthropic-marketplace",
  "anthropic-plugins",
  "agent-skills",
  "life-sciences",
];

describe("marketplace.json schema", () => {
  const raw = readFileSync(MARKETPLACE_JSON, "utf8");
  const marketplace = JSON.parse(raw);

  test("file exists and is valid JSON", () => {
    expect(marketplace).toBeDefined();
  });

  test("has required 'name' field (kebab-case, no spaces)", () => {
    expect(typeof marketplace.name).toBe("string");
    expect(marketplace.name.length).toBeGreaterThan(0);
    expect(marketplace.name).not.toContain(" ");
  });

  test("name is not a reserved Anthropic name", () => {
    for (const reserved of RESERVED_NAMES) {
      expect(marketplace.name).not.toBe(reserved);
    }
  });

  test("has required 'owner' with 'name' field", () => {
    expect(marketplace.owner).toBeDefined();
    expect(typeof marketplace.owner.name).toBe("string");
    expect(marketplace.owner.name.length).toBeGreaterThan(0);
  });

  test("has required 'plugins' array with at least 1 entry", () => {
    expect(Array.isArray(marketplace.plugins)).toBe(true);
    expect(marketplace.plugins.length).toBeGreaterThanOrEqual(1);
  });

  test("each plugin has required 'name' and 'source' fields", () => {
    for (const plugin of marketplace.plugins) {
      expect(typeof plugin.name).toBe("string");
      expect(plugin.name.length).toBeGreaterThan(0);
      expect(plugin.source).toBeDefined();
    }
  });

  test("plugin source uses github format with repo field", () => {
    const plugin = marketplace.plugins[0];
    if (typeof plugin.source === "object") {
      expect(plugin.source.source).toBe("github");
      expect(typeof plugin.source.repo).toBe("string");
      expect(plugin.source.repo).toContain("/");
    }
  });

  test("has optional metadata with description", () => {
    if (marketplace.metadata) {
      expect(typeof marketplace.metadata.description).toBe("string");
    }
  });
});

describe("plugin.json schema", () => {
  const raw = readFileSync(PLUGIN_JSON, "utf8");
  const plugin = JSON.parse(raw);

  test("file exists and is valid JSON", () => {
    expect(plugin).toBeDefined();
  });

  test("has required 'name' field", () => {
    expect(typeof plugin.name).toBe("string");
    expect(plugin.name).toBe("harness-mem");
  });

  test("has 'version' field", () => {
    expect(typeof plugin.version).toBe("string");
    expect(plugin.version).toMatch(/^\d+\.\d+\.\d+/);
  });

  test("has 'description' field", () => {
    expect(typeof plugin.description).toBe("string");
    expect(plugin.description.length).toBeGreaterThan(10);
  });

  test("has 'author' with 'name'", () => {
    expect(plugin.author).toBeDefined();
    expect(typeof plugin.author.name).toBe("string");
  });

  test("has mcpServers configuration", () => {
    expect(plugin.mcpServers).toBeDefined();
    expect(plugin.mcpServers.harness).toBeDefined();
  });

  test("mcpServers uses ${CLAUDE_PLUGIN_ROOT} for portable paths", () => {
    const harness = plugin.mcpServers.harness;
    expect(harness.command).toBe("node");
    const argsStr = JSON.stringify(harness.args);
    expect(argsStr).toContain("${CLAUDE_PLUGIN_ROOT}");
    expect(argsStr).not.toContain("/Users/");
  });

  test("mcpServers points to built MCP server dist", () => {
    const argsStr = JSON.stringify(plugin.mcpServers.harness.args);
    expect(argsStr).toContain("mcp-server/dist/index.js");
    // Verify the dist file actually exists
    expect(existsSync(resolve(ROOT, "mcp-server/dist/index.js"))).toBe(true);
  });
});

describe("version consistency", () => {
  const pkg = JSON.parse(readFileSync(PACKAGE_JSON, "utf8"));
  const plugin = JSON.parse(readFileSync(PLUGIN_JSON, "utf8"));
  const marketplace = JSON.parse(readFileSync(MARKETPLACE_JSON, "utf8"));

  test("plugin.json version matches package.json version", () => {
    expect(plugin.version).toBe(pkg.version);
  });

  test("marketplace.json plugin version matches package.json version", () => {
    const mp = marketplace.plugins.find((p: { name: string }) => p.name === "harness-mem");
    expect(mp).toBeDefined();
    expect(mp.version).toBe(pkg.version);
  });

  test("marketplace.json metadata version matches package.json version", () => {
    if (marketplace.metadata?.version) {
      expect(marketplace.metadata.version).toBe(pkg.version);
    }
  });
});

describe("hooks.json symlink", () => {
  test("hooks.json exists in .claude-plugin/", () => {
    expect(existsSync(HOOKS_JSON)).toBe(true);
  });

  test("hooks.json is a symlink to ../hooks/hooks.json", () => {
    const stat = lstatSync(HOOKS_JSON);
    expect(stat.isSymbolicLink()).toBe(true);
  });

  test("symlink target (hooks/hooks.json) exists", () => {
    expect(existsSync(resolve(ROOT, "hooks/hooks.json"))).toBe(true);
  });
});
