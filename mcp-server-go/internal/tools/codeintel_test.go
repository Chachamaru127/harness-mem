// Code Intelligence tools tests — S75-013
package tools

import (
	"context"
	"strings"
	"testing"
)

// TestHandleAstSearch_SgNotFound verifies that handleAstSearch returns an
// error message about installing ast-grep when `sg` is not in PATH.
//
// This test is valid in the CI / test environment where ast-grep is not
// installed. If sg happens to be installed, the test is skipped.
func TestHandleAstSearch_SgNotFound(t *testing.T) {
	// Only run when sg is not present. We detect that by attempting the call
	// and checking whether the error text mentions installation — the code
	// itself does LookPath("sg") and returns the install hint when it fails.
	result := handleAstSearch(context.Background(), map[string]any{
		"pattern":  "console.log($$$)",
		"language": "typescript",
		"path":     ".",
	})

	// If sg IS installed the test would proceed to run it — skip gracefully.
	if !result.IsError {
		// sg was found and ran (or returned no-matches success) — skip.
		t.Skip("sg (ast-grep) is installed; skipping 'not found' path test")
	}

	text := result.Content[0].Text
	if !strings.Contains(strings.ToLower(text), "ast-grep") {
		t.Errorf("error text = %q, expected to mention ast-grep installation", text)
	}
	// The error text should contain one of the install instructions.
	if !strings.Contains(text, "brew install") && !strings.Contains(text, "npm install") && !strings.Contains(text, "cargo install") {
		t.Errorf("error text = %q, expected to contain install instructions", text)
	}
}

// TestHandleLspRefs verifies handleLspRefs returns instruction text mentioning
// "Find References".
func TestHandleLspRefs(t *testing.T) {
	result := handleLspRefs(map[string]any{
		"file":   "src/main.ts",
		"line":   float64(10),
		"column": float64(5),
	})

	if result.IsError {
		t.Fatalf("expected success, got error: %+v", result)
	}
	if len(result.Content) == 0 {
		t.Fatal("Content is empty")
	}
	if !strings.Contains(result.Content[0].Text, "Find References") {
		t.Errorf("text = %q, expected to contain 'Find References'", result.Content[0].Text)
	}
}

// TestHandleLspDef verifies handleLspDef returns instruction text mentioning
// "Go to Definition".
func TestHandleLspDef(t *testing.T) {
	result := handleLspDef(map[string]any{
		"file":   "src/app.go",
		"line":   float64(20),
		"column": float64(8),
	})

	if result.IsError {
		t.Fatalf("expected success, got error: %+v", result)
	}
	if len(result.Content) == 0 {
		t.Fatal("Content is empty")
	}
	if !strings.Contains(result.Content[0].Text, "Go to Definition") {
		t.Errorf("text = %q, expected to contain 'Go to Definition'", result.Content[0].Text)
	}
}

// TestHandleLspHover verifies handleLspHover returns instruction text mentioning
// "Hover Info".
func TestHandleLspHover(t *testing.T) {
	result := handleLspHover(map[string]any{
		"file":   "src/utils.ts",
		"line":   float64(5),
		"column": float64(3),
	})

	if result.IsError {
		t.Fatalf("expected success, got error: %+v", result)
	}
	if len(result.Content) == 0 {
		t.Fatal("Content is empty")
	}
	if !strings.Contains(result.Content[0].Text, "Hover Info") {
		t.Errorf("text = %q, expected to contain 'Hover Info'", result.Content[0].Text)
	}
}

// TestHandleLspDiag verifies handleLspDiag returns instruction text mentioning
// "Get Diagnostics" for a non-TypeScript file (so tsc is not invoked).
func TestHandleLspDiag(t *testing.T) {
	result := handleLspDiag(context.Background(), map[string]any{
		"file": "main.go",
	})

	if result.IsError {
		t.Fatalf("expected success, got error: %+v", result)
	}
	if len(result.Content) == 0 {
		t.Fatal("Content is empty")
	}
	if !strings.Contains(result.Content[0].Text, "Get Diagnostics") {
		t.Errorf("text = %q, expected to contain 'Get Diagnostics'", result.Content[0].Text)
	}
}
