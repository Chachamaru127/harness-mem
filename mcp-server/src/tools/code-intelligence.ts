/**
 * Code Intelligence Tools
 *
 * AST-Grep and LSP integration for enhanced code analysis.
 * These tools enable structural code search and semantic analysis.
 *
 * Requires external setup:
 * - AST-Grep: `brew install ast-grep` or `npm install -g @ast-grep/cli`
 * - LSP: Language-specific servers (typescript-language-server, etc.)
 *
 * Run `/dev-tools-setup` to install and configure these tools.
 */

import { type Tool } from "@modelcontextprotocol/sdk/types.js";
import { execFile } from "child_process";
import { promisify } from "util";
import * as path from "path";
import * as fs from "fs";
import { getProjectRoot } from "../utils.js";

const execFileAsync = promisify(execFile);
const realpathAsync = promisify(fs.realpath);

// Allowed languages for AST-Grep (runtime validation)
const ALLOWED_LANGUAGES = [
  "typescript",
  "javascript",
  "python",
  "go",
  "rust",
  "java",
  "c",
  "cpp",
] as const;

type AllowedLanguage = (typeof ALLOWED_LANGUAGES)[number];

// Tool definitions
export const codeIntelligenceTools: Tool[] = [
  // AST-Grep Tool
  {
    name: "harness_ast_search",
    description:
      "Search code by structural patterns using AST-Grep. Use for: finding code smells, pattern matching, structural refactoring. Examples: 'console.log($$$)', 'if ($COND) { return $X }', 'async function $NAME($$$) { $$$ }'",
    inputSchema: {
      type: "object",
      properties: {
        pattern: {
          type: "string",
          description:
            "AST pattern using ast-grep syntax. Use $ for single node, $$$ for multiple nodes.",
        },
        language: {
          type: "string",
          enum: [...ALLOWED_LANGUAGES],
          description: "Target language",
        },
        path: {
          type: "string",
          description: "Search path (default: current directory)",
        },
      },
      required: ["pattern", "language"],
    },
  },

  // LSP Tools
  {
    name: "harness_lsp_references",
    description:
      "Find all references to a symbol across the codebase. Use for: impact analysis before refactoring, understanding usage patterns.",
    inputSchema: {
      type: "object",
      properties: {
        file: {
          type: "string",
          description: "File path containing the symbol",
        },
        line: {
          type: "number",
          description: "Line number (1-indexed)",
        },
        column: {
          type: "number",
          description: "Column number (1-indexed)",
        },
      },
      required: ["file", "line", "column"],
    },
  },
  {
    name: "harness_lsp_definition",
    description:
      "Go to the definition of a symbol. Use for: understanding implementation details, navigating to source.",
    inputSchema: {
      type: "object",
      properties: {
        file: {
          type: "string",
          description: "File path",
        },
        line: {
          type: "number",
          description: "Line number",
        },
        column: {
          type: "number",
          description: "Column number",
        },
      },
      required: ["file", "line", "column"],
    },
  },
  {
    name: "harness_lsp_diagnostics",
    description:
      "Get code diagnostics (errors, warnings, hints) for a file. Use for: pre-commit validation, error detection.",
    inputSchema: {
      type: "object",
      properties: {
        file: {
          type: "string",
          description: "File path to diagnose",
        },
      },
      required: ["file"],
    },
  },
  {
    name: "harness_lsp_hover",
    description:
      "Get type information and documentation for a symbol. Use for: understanding types, checking signatures.",
    inputSchema: {
      type: "object",
      properties: {
        file: {
          type: "string",
          description: "File path",
        },
        line: {
          type: "number",
          description: "Line number",
        },
        column: {
          type: "number",
          description: "Column number",
        },
      },
      required: ["file", "line", "column"],
    },
  },
];

// Runtime type validators
function isValidAstSearchArgs(
  args: unknown
): args is { pattern: string; language: string; path?: string } {
  return (
    typeof args === "object" &&
    args !== null &&
    "pattern" in args &&
    typeof (args as Record<string, unknown>).pattern === "string" &&
    "language" in args &&
    typeof (args as Record<string, unknown>).language === "string"
  );
}

function isValidLspPositionArgs(
  args: unknown
): args is { file: string; line: number; column: number } {
  return (
    typeof args === "object" &&
    args !== null &&
    "file" in args &&
    typeof (args as Record<string, unknown>).file === "string" &&
    "line" in args &&
    typeof (args as Record<string, unknown>).line === "number" &&
    "column" in args &&
    typeof (args as Record<string, unknown>).column === "number"
  );
}

function isValidLspFileArgs(args: unknown): args is { file: string } {
  return (
    typeof args === "object" &&
    args !== null &&
    "file" in args &&
    typeof (args as Record<string, unknown>).file === "string"
  );
}

// Helper: Check if a command is available
async function checkCommand(cmd: string): Promise<boolean> {
  try {
    await execFileAsync("which", [cmd]);
    return true;
  } catch {
    return false;
  }
}

// Helper: Validate and resolve path within project root
// Uses realpath to resolve symlinks and prevent symlink-based traversal
async function validatePath(
  searchPath: string,
  projectRoot: string
): Promise<{ valid: boolean; fullPath: string; error?: string }> {
  // Resolve the path relative to project root
  const fullPath = path.resolve(projectRoot, searchPath);

  // Normalize projectRoot with trailing separator for strict comparison
  // This prevents /opt/proj from matching /opt/proj-evil
  const normalizedRoot = projectRoot.endsWith(path.sep)
    ? projectRoot
    : projectRoot + path.sep;

  // Check if the resolved path is within project root (prevent path traversal)
  // Must be either exactly projectRoot or start with projectRoot + separator
  if (fullPath !== projectRoot && !fullPath.startsWith(normalizedRoot)) {
    return {
      valid: false,
      fullPath: "",
      error: `Path must be within project root. Got: ${searchPath}`,
    };
  }

  // Additional check using path.relative to catch edge cases
  const relativePath = path.relative(projectRoot, fullPath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return {
      valid: false,
      fullPath: "",
      error: `Path escapes project root. Got: ${searchPath}`,
    };
  }

  // Check for symlink-based traversal by resolving real paths
  // This ensures that even if a symlink inside the project points outside,
  // we detect it and reject the path
  try {
    // Only check realpath if the path exists
    if (fs.existsSync(fullPath)) {
      const realFullPath = await realpathAsync(fullPath);
      const realProjectRoot = await realpathAsync(projectRoot);
      const normalizedRealRoot = realProjectRoot.endsWith(path.sep)
        ? realProjectRoot
        : realProjectRoot + path.sep;

      if (
        realFullPath !== realProjectRoot &&
        !realFullPath.startsWith(normalizedRealRoot)
      ) {
        return {
          valid: false,
          fullPath: "",
          error: `Path resolves outside project root (symlink detected). Got: ${searchPath}`,
        };
      }
    }
  } catch {
    // If realpath fails (e.g., path doesn't exist yet), allow the original check to pass
    // since we already validated the logical path above
  }

  return { valid: true, fullPath };
}

// AST-Grep handler
async function handleAstSearch(args: {
  pattern: string;
  language: string;
  path?: string;
}): Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}> {
  const { pattern, language, path: searchPath = "." } = args;

  // Validate language (runtime check to prevent injection)
  if (!ALLOWED_LANGUAGES.includes(language as AllowedLanguage)) {
    return {
      content: [
        {
          type: "text",
          text: `❌ Invalid language: ${language}. Allowed: ${ALLOWED_LANGUAGES.join(", ")}`,
        },
      ],
      isError: true,
    };
  }

  // Check if ast-grep (sg) is installed
  const installed = await checkCommand("sg");
  if (!installed) {
    return {
      content: [
        {
          type: "text",
          text: `❌ ast-grep not installed.

**To install:**
- macOS: \`brew install ast-grep\`
- npm: \`npm install -g @ast-grep/cli\`
- cargo: \`cargo install ast-grep --locked\`

Or run \`/dev-tools-setup\` to install all development tools.

**Fallback:** Use the Grep tool for basic text pattern search.`,
        },
      ],
      isError: true,
    };
  }

  try {
    const projectRoot = getProjectRoot();

    // Validate and resolve path (prevent path traversal)
    const pathValidation = await validatePath(searchPath, projectRoot);
    if (!pathValidation.valid) {
      return {
        content: [{ type: "text", text: `❌ ${pathValidation.error}` }],
        isError: true,
      };
    }

    // Execute ast-grep using execFile (prevents command injection)
    const { stdout, stderr } = await execFileAsync(
      "sg",
      ["--pattern", pattern, "--lang", language, "--json", pathValidation.fullPath],
      { maxBuffer: 10 * 1024 * 1024 } // 10MB buffer
    );

    if (stderr && !stdout) {
      return {
        content: [{ type: "text", text: `⚠️ ast-grep warning: ${stderr}` }],
      };
    }

    // Parse results
    let results: Array<{
      file: string;
      range: { start: { line: number; column: number } };
      text: string;
    }>;
    try {
      results = JSON.parse(stdout || "[]");
    } catch {
      return {
        content: [
          {
            type: "text",
            text: `🔍 AST Search Results for \`${pattern}\` (${language})\n\nNo matches found.`,
          },
        ],
      };
    }

    if (results.length === 0) {
      return {
        content: [
          {
            type: "text",
            text: `🔍 AST Search Results for \`${pattern}\` (${language})\n\nNo matches found.`,
          },
        ],
      };
    }

    // Format results
    const formattedResults = results
      .slice(0, 50) // Limit to 50 results
      .map((r) => {
        const relativePath = r.file.replace(projectRoot + "/", "");
        return `- **${relativePath}:${r.range.start.line}:${r.range.start.column}**\n  \`${r.text.trim().substring(0, 100)}${r.text.length > 100 ? "..." : ""}\``;
      })
      .join("\n\n");

    return {
      content: [
        {
          type: "text",
          text: `🔍 **AST Search Results** for \`${pattern}\` (${language})

**Matches: ${results.length}**${results.length > 50 ? " (showing first 50)" : ""}

${formattedResults}`,
        },
      ],
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      content: [{ type: "text", text: `❌ AST search error: ${message}` }],
      isError: true,
    };
  }
}

// LSP handlers (provide instructions since LSP requires daemon)
async function handleLspReferences(args: {
  file: string;
  line: number;
  column: number;
}): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { file, line, column } = args;

  return {
    content: [
      {
        type: "text",
        text: `🔍 **Find References** for ${file}:${line}:${column}

To find references, use one of these methods:

**1. Claude Code native (recommended):**
\`\`\`
Use the LSP tool: lsp_references
File: ${file}
Position: line ${line}, column ${column}
\`\`\`

**2. TypeScript/JavaScript:**
\`\`\`bash
npx ts-node -e "
const ts = require('typescript');
// Use TS Language Service API
"
\`\`\`

**3. IDE integration:**
- VSCode: F12 or right-click → "Find All References"
- Cursor: Same as VSCode

**Fallback:** Use Grep to search for the symbol name:
\`\`\`bash
grep -rn "symbolName" --include="*.ts" --include="*.tsx"
\`\`\`

💡 Run \`/dev-tools-setup\` to configure LSP integration.`,
      },
    ],
  };
}

async function handleLspDefinition(args: {
  file: string;
  line: number;
  column: number;
}): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { file, line, column } = args;

  return {
    content: [
      {
        type: "text",
        text: `🎯 **Go to Definition** for ${file}:${line}:${column}

To find the definition, use one of these methods:

**1. Claude Code native (recommended):**
\`\`\`
Use the LSP tool: lsp_definition
File: ${file}
Position: line ${line}, column ${column}
\`\`\`

**2. Read the file directly:**
The AI can read the import statements and navigate to the source file.

**3. IDE integration:**
- VSCode/Cursor: Cmd+Click on the symbol

💡 Run \`/dev-tools-setup\` to configure LSP integration.`,
      },
    ],
  };
}

async function handleLspDiagnostics(args: {
  file: string;
}): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { file } = args;

  // Validate file path
  const projectRoot = getProjectRoot();
  const pathValidation = await validatePath(file, projectRoot);
  if (!pathValidation.valid) {
    return {
      content: [{ type: "text", text: `❌ ${pathValidation.error}` }],
    };
  }

  // Try to run tsc for TypeScript files
  if (file.endsWith(".ts") || file.endsWith(".tsx")) {
    try {
      // Use execFile with proper args (no shell injection possible)
      const { stdout } = await execFileAsync(
        "npx",
        ["tsc", "--noEmit", "--pretty", "false"],
        { cwd: projectRoot, maxBuffer: 5 * 1024 * 1024 }
      );

      // Filter results in JavaScript (not shell) to prevent injection
      const relativePath = path.relative(projectRoot, pathValidation.fullPath);
      const lines = stdout.split("\n");
      const diagnostics = lines
        .filter((line) => line.startsWith(relativePath))
        .join("\n")
        .trim();

      if (!diagnostics) {
        return {
          content: [
            {
              type: "text",
              text: `✅ **Diagnostics for ${file}**\n\nNo TypeScript errors found.`,
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: `📊 **Diagnostics for ${file}**\n\n\`\`\`\n${diagnostics}\n\`\`\``,
          },
        ],
      };
    } catch {
      // Fall through to instructions
    }
  }

  return {
    content: [
      {
        type: "text",
        text: `📊 **Get Diagnostics** for ${file}

To get diagnostics, use one of these methods:

**1. TypeScript/JavaScript:**
\`\`\`bash
npx tsc --noEmit
\`\`\`

**2. ESLint:**
\`\`\`bash
npx eslint ${file}
\`\`\`

**3. Python:**
\`\`\`bash
mypy ${file}
# or
ruff check ${file}
\`\`\`

**4. IDE integration:**
- Errors appear in the Problems panel

💡 Run \`/dev-tools-setup\` to configure LSP integration.`,
      },
    ],
  };
}

async function handleLspHover(args: {
  file: string;
  line: number;
  column: number;
}): Promise<{ content: Array<{ type: string; text: string }> }> {
  const { file, line, column } = args;

  return {
    content: [
      {
        type: "text",
        text: `📝 **Hover Info** for ${file}:${line}:${column}

To get type information, the AI can:

**1. Read the file and infer types:**
The AI can analyze the code context to determine types.

**2. Check type definitions:**
Look for \`.d.ts\` files or TypeScript declarations.

**3. IDE integration:**
- VSCode/Cursor: Hover over the symbol

💡 Run \`/dev-tools-setup\` to configure LSP integration.`,
      },
    ],
  };
}

// Main handler
export async function handleCodeIntelligenceTool(
  name: string,
  args: Record<string, unknown> | undefined
): Promise<{
  content: Array<{ type: string; text: string }>;
  isError?: boolean;
}> {
  switch (name) {
    case "harness_ast_search":
      if (!isValidAstSearchArgs(args)) {
        return {
          content: [
            {
              type: "text",
              text: "❌ Invalid arguments for ast_search. Required: pattern (string), language (string)",
            },
          ],
          isError: true,
        };
      }
      return handleAstSearch(args);

    case "harness_lsp_references":
      if (!isValidLspPositionArgs(args)) {
        return {
          content: [
            {
              type: "text",
              text: "❌ Invalid arguments for lsp_references. Required: file (string), line (number), column (number)",
            },
          ],
          isError: true,
        };
      }
      return handleLspReferences(args);

    case "harness_lsp_definition":
      if (!isValidLspPositionArgs(args)) {
        return {
          content: [
            {
              type: "text",
              text: "❌ Invalid arguments for lsp_definition. Required: file (string), line (number), column (number)",
            },
          ],
          isError: true,
        };
      }
      return handleLspDefinition(args);

    case "harness_lsp_diagnostics":
      if (!isValidLspFileArgs(args)) {
        return {
          content: [
            {
              type: "text",
              text: "❌ Invalid arguments for lsp_diagnostics. Required: file (string)",
            },
          ],
          isError: true,
        };
      }
      return handleLspDiagnostics(args);

    case "harness_lsp_hover":
      if (!isValidLspPositionArgs(args)) {
        return {
          content: [
            {
              type: "text",
              text: "❌ Invalid arguments for lsp_hover. Required: file (string), line (number), column (number)",
            },
          ],
          isError: true,
        };
      }
      return handleLspHover(args);

    default:
      return {
        content: [
          { type: "text", text: `Unknown code intelligence tool: ${name}` },
        ],
        isError: true,
      };
  }
}
