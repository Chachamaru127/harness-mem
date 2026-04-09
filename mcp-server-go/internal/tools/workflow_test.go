package tools

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// --- handlePlan ---

// TestHandlePlan_EmptyTask verifies that an empty task returns an error.
func TestHandlePlan_EmptyTask(t *testing.T) {
	makeProjectRoot(t)

	result := handlePlan(map[string]any{"task": ""})

	if !result.IsError {
		t.Fatal("handlePlan empty task: expected IsError=true")
	}
	if !strings.Contains(result.Content[0].Text, "task description is required") {
		t.Errorf("handlePlan empty task: got %q", result.Content[0].Text)
	}
}

// TestHandlePlan_ValidTask verifies that a valid task writes Plans.md and
// the response contains the task name.
func TestHandlePlan_ValidTask(t *testing.T) {
	root := makeProjectRoot(t)

	task := "implement-authentication"
	result := handlePlan(map[string]any{"task": task})

	if result.IsError {
		t.Fatalf("handlePlan valid: unexpected IsError=true, text=%q", result.Content[0].Text)
	}
	// Response should mention the task name.
	if !strings.Contains(result.Content[0].Text, task) {
		t.Errorf("handlePlan valid: response %q does not contain task name %q", result.Content[0].Text, task)
	}
	// Plans.md should have been created and contain the task.
	data, err := os.ReadFile(filepath.Join(root, "Plans.md"))
	if err != nil {
		t.Fatalf("handlePlan valid: Plans.md not created: %v", err)
	}
	if !strings.Contains(string(data), task) {
		t.Errorf("handlePlan valid: Plans.md does not contain task name %q", task)
	}
}

// --- handleWork ---

// TestHandleWork_NoPlansFile verifies that a missing Plans.md returns a
// "not found" message (not an error).
func TestHandleWork_NoPlansFile(t *testing.T) {
	makeProjectRoot(t)

	result := handleWork(map[string]any{})

	if result.IsError {
		t.Fatalf("handleWork no Plans.md: unexpected IsError=true")
	}
	text := result.Content[0].Text
	if !strings.Contains(strings.ToLower(text), "not found") {
		t.Errorf("handleWork no Plans.md: got %q, want 'not found' in output", text)
	}
}

// TestHandleWork_WithTODO verifies that TODO count is reported when Plans.md
// contains cc:TODO markers.
func TestHandleWork_WithTODO(t *testing.T) {
	root := makeProjectRoot(t)

	content := "# Plans\n\n- task A <!-- cc:TODO -->\n- task B <!-- cc:TODO -->\n- task C <!-- cc:TODO -->\n"
	if err := os.WriteFile(filepath.Join(root, "Plans.md"), []byte(content), 0o644); err != nil {
		t.Fatalf("WriteFile Plans.md: %v", err)
	}

	result := handleWork(map[string]any{})

	if result.IsError {
		t.Fatalf("handleWork with TODO: unexpected IsError=true")
	}
	text := result.Content[0].Text
	// Should report 3 TODOs.
	if !strings.Contains(text, "3") {
		t.Errorf("handleWork with TODO: got %q, expected '3' in output", text)
	}
	if !strings.Contains(text, "TODO") {
		t.Errorf("handleWork with TODO: got %q, expected 'TODO' label", text)
	}
}

// --- handleReview ---

// TestHandleReview_NoFilesNoGitChanges verifies that passing no files and
// having no git changes returns the "no files to review" message.
func TestHandleReview_NoFilesNoGitChanges(t *testing.T) {
	// Use a fresh temp dir that is NOT a git repo so that getRecentChanges
	// returns nothing.
	root := t.TempDir()
	// Use .claude marker to make GetProjectRoot resolve here.
	if err := os.MkdirAll(filepath.Join(root, ".claude"), 0o755); err != nil {
		t.Fatalf("MkdirAll .claude: %v", err)
	}
	withProjectRoot(t, root)

	result := handleReview(map[string]any{})

	if result.IsError {
		t.Fatalf("handleReview no files: unexpected IsError=true")
	}
	text := result.Content[0].Text
	if !strings.Contains(strings.ToLower(text), "no files to review") {
		t.Errorf("handleReview no files: got %q, want 'no files to review'", text)
	}
}
