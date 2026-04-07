/**
 * S74-005: Provenance Extractor ユニットテスト
 *
 * - Edit ツールの payload から provenance 抽出
 * - Write ツールの payload から provenance 抽出
 * - Read ツールの payload から provenance 抽出
 * - Bash ツールの payload から provenance 推定
 * - 不明な payload で null を返す
 * - file extension から language 推定
 * - old_string / new_string フィールドによる edit 推定
 * - file_path / path / filePath の各フィールド名対応
 */

import { describe, expect, test } from "bun:test";
import { extractCodeProvenance } from "../../src/core/provenance-extractor";

// ---------------------------------------------------------------------------
// Write ツール
// ---------------------------------------------------------------------------

describe("extractCodeProvenance — Write ツール", () => {
  test("file_path フィールドから create アクションを抽出する", () => {
    const payload = {
      tool_name: "Write",
      file_path: "src/components/Header.tsx",
      content: "export default function Header() {}",
    };
    const result = extractCodeProvenance(payload);
    expect(result).not.toBeNull();
    expect(result!.file_path).toBe("src/components/Header.tsx");
    expect(result!.action).toBe("create");
    expect(result!.language).toBe("typescript");
  });

  test("path フィールドを file_path として扱う", () => {
    const payload = {
      tool_name: "Write",
      path: "scripts/deploy.sh",
    };
    const result = extractCodeProvenance(payload);
    expect(result).not.toBeNull();
    expect(result!.file_path).toBe("scripts/deploy.sh");
    expect(result!.action).toBe("create");
    expect(result!.language).toBe("shell");
  });

  test("file_path がなければ null を返す", () => {
    const payload = {
      tool_name: "Write",
      content: "some content without a path",
    };
    const result = extractCodeProvenance(payload);
    expect(result).toBeNull();
  });

  test("model_id フィールドを引き継ぐ", () => {
    const payload = {
      tool_name: "Write",
      file_path: "lib/utils.ts",
      model_id: "anthropic/claude-opus-4-6",
    };
    const result = extractCodeProvenance(payload);
    expect(result!.model_id).toBe("anthropic/claude-opus-4-6");
  });
});

// ---------------------------------------------------------------------------
// Edit ツール
// ---------------------------------------------------------------------------

describe("extractCodeProvenance — Edit ツール", () => {
  test("file_path フィールドから edit アクションを抽出する", () => {
    const payload = {
      tool_name: "Edit",
      file_path: "memory-server/src/core/event-recorder.ts",
      old_string: "old code",
      new_string: "new code",
    };
    const result = extractCodeProvenance(payload);
    expect(result).not.toBeNull();
    expect(result!.file_path).toBe("memory-server/src/core/event-recorder.ts");
    expect(result!.action).toBe("edit");
    expect(result!.language).toBe("typescript");
  });

  test("filePath (camelCase) フィールドに対応する", () => {
    const payload = {
      tool_name: "Edit",
      filePath: "src/index.js",
    };
    const result = extractCodeProvenance(payload);
    expect(result).not.toBeNull();
    expect(result!.file_path).toBe("src/index.js");
    expect(result!.action).toBe("edit");
    expect(result!.language).toBe("javascript");
  });

  test("file_path がなければ null を返す", () => {
    const payload = {
      tool_name: "Edit",
      old_string: "x",
      new_string: "y",
    };
    const result = extractCodeProvenance(payload);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Read ツール
// ---------------------------------------------------------------------------

describe("extractCodeProvenance — Read ツール", () => {
  test("file_path フィールドから read アクションを抽出する", () => {
    const payload = {
      tool_name: "Read",
      file_path: "docs/architecture.md",
    };
    const result = extractCodeProvenance(payload);
    expect(result).not.toBeNull();
    expect(result!.file_path).toBe("docs/architecture.md");
    expect(result!.action).toBe("read");
    expect(result!.language).toBe("markdown");
  });

  test("file_path がなければ null を返す", () => {
    const payload = {
      tool_name: "Read",
    };
    const result = extractCodeProvenance(payload);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Bash ツール（best-effort）
// ---------------------------------------------------------------------------

describe("extractCodeProvenance — Bash ツール", () => {
  test("rm コマンドから delete アクションを推定する", () => {
    const payload = {
      tool_name: "Bash",
      command: "rm src/legacy/old-module.ts",
    };
    const result = extractCodeProvenance(payload);
    expect(result).not.toBeNull();
    expect(result!.action).toBe("delete");
    expect(result!.file_path).toContain("old-module.ts");
    expect(result!.language).toBe("typescript");
  });

  test("touch コマンドから create アクションを推定する", () => {
    const payload = {
      tool_name: "Bash",
      command: "touch src/new-file.py",
    };
    const result = extractCodeProvenance(payload);
    expect(result).not.toBeNull();
    expect(result!.action).toBe("create");
    expect(result!.language).toBe("python");
  });

  test("cat コマンドから read アクションを推定する", () => {
    const payload = {
      tool_name: "Bash",
      command: "cat package.json",
    };
    const result = extractCodeProvenance(payload);
    expect(result).not.toBeNull();
    expect(result!.action).toBe("read");
    expect(result!.file_path).toContain("package.json");
    expect(result!.language).toBe("json");
  });

  test("ファイルパスがないコマンドは null を返す", () => {
    const payload = {
      tool_name: "Bash",
      command: "ls -la",
    };
    const result = extractCodeProvenance(payload);
    expect(result).toBeNull();
  });

  test("command がなければ null を返す", () => {
    const payload = {
      tool_name: "Bash",
    };
    const result = extractCodeProvenance(payload);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// tool_name なし / 汎用フィールド
// ---------------------------------------------------------------------------

describe("extractCodeProvenance — tool_name なし", () => {
  test("old_string + new_string + file_path があれば edit を返す", () => {
    const payload = {
      file_path: "config/settings.toml",
      old_string: "[database]",
      new_string: "[database]\nhost = 'localhost'",
    };
    const result = extractCodeProvenance(payload);
    expect(result).not.toBeNull();
    expect(result!.action).toBe("edit");
    expect(result!.file_path).toBe("config/settings.toml");
    expect(result!.language).toBe("toml");
  });

  test("file_path のみあれば read を返す", () => {
    const payload = {
      file_path: "src/server.ts",
    };
    const result = extractCodeProvenance(payload);
    expect(result).not.toBeNull();
    expect(result!.action).toBe("read");
    expect(result!.file_path).toBe("src/server.ts");
  });

  test("何もなければ null を返す", () => {
    const payload = {
      some_random_key: "some_value",
    };
    const result = extractCodeProvenance(payload);
    expect(result).toBeNull();
  });

  test("空オブジェクトは null を返す", () => {
    const result = extractCodeProvenance({});
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// language 推定
// ---------------------------------------------------------------------------

describe("extractCodeProvenance — language 推定", () => {
  const cases: Array<[string, string | undefined]> = [
    ["src/app.ts", "typescript"],
    ["src/app.tsx", "typescript"],
    ["lib/helper.js", "javascript"],
    ["lib/helper.jsx", "javascript"],
    ["module/main.py", "python"],
    ["service/main.go", "go"],
    ["src/lib.rs", "rust"],
    ["app/Main.java", "java"],
    ["script.sh", "shell"],
    ["query.sql", "sql"],
    ["styles.css", "css"],
    ["page.html", "html"],
    ["config.json", "json"],
    ["config.yaml", "yaml"],
    ["config.yml", "yaml"],
    ["config.toml", "toml"],
    ["README.md", "markdown"],
    ["Component.vue", "vue"],
    ["App.svelte", "svelte"],
    ["schema.graphql", "graphql"],
    ["schema.gql", "graphql"],
    ["infra.tf", "terraform"],
    ["Makefile", undefined],  // 拡張子なし
    ["noextension", undefined],
  ];

  for (const [filePath, expectedLanguage] of cases) {
    test(`${filePath} → ${expectedLanguage ?? "undefined"}`, () => {
      const payload = {
        tool_name: "Read",
        file_path: filePath,
      };
      const result = extractCodeProvenance(payload);
      if (expectedLanguage === undefined) {
        // 拡張子なしのファイルでも Read なら結果は返る（language が undefined）
        if (result !== null) {
          expect(result.language).toBeUndefined();
        }
      } else {
        expect(result).not.toBeNull();
        expect(result!.language).toBe(expectedLanguage);
      }
    });
  }
});

// ---------------------------------------------------------------------------
// エッジケース
// ---------------------------------------------------------------------------

describe("extractCodeProvenance — エッジケース", () => {
  test("null-like payload は null を返す", () => {
    // @ts-expect-error テスト用
    expect(extractCodeProvenance(null)).toBeNull();
    // @ts-expect-error テスト用
    expect(extractCodeProvenance(undefined)).toBeNull();
  });

  test("空白だけのファイルパスは無視される", () => {
    const payload = {
      tool_name: "Write",
      file_path: "   ",
    };
    const result = extractCodeProvenance(payload);
    expect(result).toBeNull();
  });

  test("ファイルパスの前後の空白はトリムされる", () => {
    const payload = {
      tool_name: "Edit",
      file_path: "  src/core/index.ts  ",
    };
    const result = extractCodeProvenance(payload);
    expect(result).not.toBeNull();
    expect(result!.file_path).toBe("src/core/index.ts");
  });
});
