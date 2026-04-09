// Code Intelligence tools — 5 tools for AST search and LSP instructions.
// Port of mcp-server/src/tools/code-intelligence.ts
package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/mark3labs/mcp-go/mcp"

	"github.com/Chachamaru127/harness-mem/mcp-server-go/internal/types"
	"github.com/Chachamaru127/harness-mem/mcp-server-go/internal/util"
)

var allowedLanguages = map[string]bool{
	"typescript": true, "javascript": true, "python": true, "go": true,
	"rust": true, "java": true, "c": true, "cpp": true,
}

func CodeIntelToolDefs() []ToolDef {
	return []ToolDef{
		{ciToolAstSearch, func(ctx context.Context, args map[string]any) types.ToolResult { return handleAstSearch(ctx, args) }},
		{ciToolLspReferences, func(_ context.Context, args map[string]any) types.ToolResult { return handleLspRefs(args) }},
		{ciToolLspDefinition, func(_ context.Context, args map[string]any) types.ToolResult { return handleLspDef(args) }},
		{ciToolLspDiagnostics, func(ctx context.Context, args map[string]any) types.ToolResult { return handleLspDiag(ctx, args) }},
		{ciToolLspHover, func(_ context.Context, args map[string]any) types.ToolResult { return handleLspHover(args) }},
	}
}

var ciToolAstSearch = mcp.NewTool("harness_ast_search",
	mcp.WithDescription("Search code by structural patterns using AST-Grep. Use for: finding code smells, pattern matching, structural refactoring. Examples: 'console.log($$$)', 'if ($COND) { return $X }', 'async function $NAME($$$) { $$$ }'"),
	mcp.WithString("pattern", mcp.Required(), mcp.Description("AST pattern using ast-grep syntax. Use $ for single node, $$$ for multiple nodes.")),
	mcp.WithString("language", mcp.Required(), mcp.Description("Target language"), mcp.Enum("typescript", "javascript", "python", "go", "rust", "java", "c", "cpp")),
	mcp.WithString("path", mcp.Description("Search path (default: current directory)")),
)

var ciToolLspReferences = mcp.NewTool("harness_lsp_references",
	mcp.WithDescription("Find all references to a symbol across the codebase. Use for: impact analysis before refactoring, understanding usage patterns."),
	mcp.WithString("file", mcp.Required(), mcp.Description("File path containing the symbol")),
	mcp.WithNumber("line", mcp.Required(), mcp.Description("Line number (1-indexed)")),
	mcp.WithNumber("column", mcp.Required(), mcp.Description("Column number (1-indexed)")),
)

var ciToolLspDefinition = mcp.NewTool("harness_lsp_definition",
	mcp.WithDescription("Go to the definition of a symbol. Use for: understanding implementation details, navigating to source."),
	mcp.WithString("file", mcp.Required(), mcp.Description("File path")),
	mcp.WithNumber("line", mcp.Required(), mcp.Description("Line number")),
	mcp.WithNumber("column", mcp.Required(), mcp.Description("Column number")),
)

var ciToolLspDiagnostics = mcp.NewTool("harness_lsp_diagnostics",
	mcp.WithDescription("Get code diagnostics (errors, warnings, hints) for a file. Use for: pre-commit validation, error detection."),
	mcp.WithString("file", mcp.Required(), mcp.Description("File path to diagnose")),
)

var ciToolLspHover = mcp.NewTool("harness_lsp_hover",
	mcp.WithDescription("Get type information and documentation for a symbol. Use for: understanding types, checking signatures."),
	mcp.WithString("file", mcp.Required(), mcp.Description("File path")),
	mcp.WithNumber("line", mcp.Required(), mcp.Description("Line number")),
	mcp.WithNumber("column", mcp.Required(), mcp.Description("Column number")),
)

// ---- AST Search Handler ----

type astResult struct {
	File  string `json:"file"`
	Range struct {
		Start struct {
			Line   int `json:"line"`
			Column int `json:"column"`
		} `json:"start"`
	} `json:"range"`
	Text string `json:"text"`
}

func handleAstSearch(_ context.Context, args map[string]any) types.ToolResult {
	pattern := argString(args, "pattern")
	language := argString(args, "language")
	searchPath := argString(args, "path")
	if searchPath == "" {
		searchPath = "."
	}

	if pattern == "" || language == "" {
		return types.ErrorText("Invalid arguments for ast_search. Required: pattern (string), language (string)")
	}
	if !allowedLanguages[language] {
		return types.ErrorText(fmt.Sprintf("Invalid language: %s. Allowed: typescript, javascript, python, go, rust, java, c, cpp", language))
	}

	// Check sg installed
	if _, err := exec.LookPath("sg"); err != nil {
		return types.ErrorText(`ast-grep not installed.

To install:
- macOS: brew install ast-grep
- npm: npm install -g @ast-grep/cli
- cargo: cargo install ast-grep --locked

Fallback: Use the Grep tool for basic text pattern search.`)
	}

	projectRoot := util.GetProjectRoot()
	fullPath, err := filepath.Abs(filepath.Join(projectRoot, searchPath))
	if err != nil {
		return types.ErrorText(fmt.Sprintf("Invalid path: %s", searchPath))
	}

	// Validate path within project root
	rel, err := filepath.Rel(projectRoot, fullPath)
	if err != nil || strings.HasPrefix(rel, "..") || filepath.IsAbs(rel) {
		return types.ErrorText(fmt.Sprintf("Path must be within project root. Got: %s", searchPath))
	}

	// Symlink check
	if realFull, err := filepath.EvalSymlinks(fullPath); err == nil {
		if realRoot, err2 := filepath.EvalSymlinks(projectRoot); err2 == nil {
			relReal, _ := filepath.Rel(realRoot, realFull)
			if strings.HasPrefix(relReal, "..") || filepath.IsAbs(relReal) {
				return types.ErrorText(fmt.Sprintf("Path resolves outside project root (symlink detected). Got: %s", searchPath))
			}
		}
	}

	cmd := exec.Command("sg", "--pattern", pattern, "--lang", language, "--json", fullPath)
	out, err := cmd.Output()
	if err != nil {
		// sg returns non-zero when no matches
		if len(out) == 0 {
			return types.SuccessText(fmt.Sprintf("AST Search Results for `%s` (%s)\n\nNo matches found.", pattern, language))
		}
	}

	var results []astResult
	if err := json.Unmarshal(out, &results); err != nil || len(results) == 0 {
		return types.SuccessText(fmt.Sprintf("AST Search Results for `%s` (%s)\n\nNo matches found.", pattern, language))
	}

	// Format (limit to 50)
	var sb strings.Builder
	sb.WriteString(fmt.Sprintf("**AST Search Results** for `%s` (%s)\n\n**Matches: %d**", pattern, language, len(results)))
	if len(results) > 50 {
		sb.WriteString(" (showing first 50)")
	}
	sb.WriteString("\n\n")

	limit := len(results)
	if limit > 50 {
		limit = 50
	}
	for _, r := range results[:limit] {
		relPath := strings.TrimPrefix(r.File, projectRoot+"/")
		text := strings.TrimSpace(r.Text)
		if len(text) > 100 {
			text = text[:100] + "..."
		}
		sb.WriteString(fmt.Sprintf("- **%s:%d:%d**\n  `%s`\n\n", relPath, r.Range.Start.Line, r.Range.Start.Column, text))
	}

	return types.SuccessText(sb.String())
}

// ---- LSP Instruction Handlers ----

func handleLspRefs(args map[string]any) types.ToolResult {
	file := argString(args, "file")
	line, _ := argInt(args, "line")
	col, _ := argInt(args, "column")

	return types.SuccessText(fmt.Sprintf(`**Find References** for %s:%d:%d

To find references, use one of these methods:

1. Claude Code native (recommended): Use the LSP tool: lsp_references
2. IDE: VSCode/Cursor: F12 or right-click -> "Find All References"
3. Fallback: Use Grep to search for the symbol name`, file, line, col))
}

func handleLspDef(args map[string]any) types.ToolResult {
	file := argString(args, "file")
	line, _ := argInt(args, "line")
	col, _ := argInt(args, "column")

	return types.SuccessText(fmt.Sprintf(`**Go to Definition** for %s:%d:%d

To find the definition:
1. Claude Code native (recommended): Use the LSP tool: lsp_definition
2. Read the file directly — follow import statements
3. IDE: VSCode/Cursor: Cmd+Click on the symbol`, file, line, col))
}

func handleLspDiag(_ context.Context, args map[string]any) types.ToolResult {
	file := argString(args, "file")
	if file == "" {
		return types.ErrorText("Invalid arguments for lsp_diagnostics. Required: file (string)")
	}

	projectRoot := util.GetProjectRoot()

	// Try tsc for TS files
	if strings.HasSuffix(file, ".ts") || strings.HasSuffix(file, ".tsx") {
		cmd := exec.Command("npx", "tsc", "--noEmit", "--pretty", "false")
		cmd.Dir = projectRoot
		out, _ := cmd.Output()
		if len(out) > 0 {
			fullPath, _ := filepath.Abs(filepath.Join(projectRoot, file))
			relPath, _ := filepath.Rel(projectRoot, fullPath)
			lines := strings.Split(string(out), "\n")
			var diag []string
			for _, l := range lines {
				if strings.HasPrefix(l, relPath) {
					diag = append(diag, l)
				}
			}
			if len(diag) > 0 {
				return types.SuccessText(fmt.Sprintf("**Diagnostics for %s**\n\n```\n%s\n```", file, strings.Join(diag, "\n")))
			}
			return types.SuccessText(fmt.Sprintf("**Diagnostics for %s**\n\nNo TypeScript errors found.", file))
		}
	}

	return types.SuccessText(fmt.Sprintf(`**Get Diagnostics** for %s

To get diagnostics:
- TypeScript: npx tsc --noEmit
- ESLint: npx eslint %s
- Python: mypy %s or ruff check %s`, file, file, file, file))
}

func handleLspHover(args map[string]any) types.ToolResult {
	file := argString(args, "file")
	line, _ := argInt(args, "line")
	col, _ := argInt(args, "column")
	_ = os.Getenv // suppress

	return types.SuccessText(fmt.Sprintf(`**Hover Info** for %s:%d:%d

To get type information:
1. Read the file and infer types from context
2. Check .d.ts files or TypeScript declarations
3. IDE: VSCode/Cursor: Hover over the symbol`, file, line, col))
}
