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
	root := makeProjectRoot(t)

	result := handlePlan(map[string]any{"task": "", "cwd": root})

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
	result := handlePlan(map[string]any{"task": task, "cwd": root})

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

func TestHandlePlan_MissingScopeDoesNotWriteServerPlans(t *testing.T) {
	serverRoot := makeProjectRoot(t)
	clientRoot := t.TempDir()
	if err := os.MkdirAll(filepath.Join(clientRoot, ".claude"), 0o755); err != nil {
		t.Fatalf("MkdirAll client .claude: %v", err)
	}
	serverPlans := filepath.Join(serverRoot, "Plans.md")
	original := "# Server Plans\n\n"
	if err := os.WriteFile(serverPlans, []byte(original), 0o644); err != nil {
		t.Fatalf("WriteFile server Plans.md: %v", err)
	}

	result := handlePlan(map[string]any{"task": "must-not-write"})

	if !result.IsError {
		t.Fatalf("handlePlan missing scope: expected IsError=true")
	}
	if !strings.Contains(result.Content[0].Text, "scope_required") {
		t.Fatalf("handlePlan missing scope: got %q, want scope_required", result.Content[0].Text)
	}
	data, err := os.ReadFile(serverPlans)
	if err != nil {
		t.Fatalf("ReadFile server Plans.md: %v", err)
	}
	if string(data) != original {
		t.Fatalf("handlePlan missing scope modified server Plans.md: got %q", string(data))
	}
	if _, err := os.Stat(filepath.Join(clientRoot, "Plans.md")); !os.IsNotExist(err) {
		t.Fatalf("handlePlan missing scope unexpectedly wrote client Plans.md: %v", err)
	}
}

func TestHandlePlan_ShortProjectRejected(t *testing.T) {
	makeProjectRoot(t)

	result := handlePlan(map[string]any{"task": "x", "project": "harness-mem"})

	if !result.IsError {
		t.Fatalf("handlePlan short project: expected IsError=true")
	}
	if !strings.Contains(result.Content[0].Text, "project must be an absolute filesystem path") {
		t.Fatalf("handlePlan short project: got %q", result.Content[0].Text)
	}
}

func TestHandlePlan_PlansPathOutsideCwdRejected(t *testing.T) {
	root := makeProjectRoot(t)
	outside := t.TempDir()
	plansPath := filepath.Join(outside, "Plans.md")

	result := handlePlan(map[string]any{"task": "x", "cwd": root, "plans_path": plansPath})

	if !result.IsError {
		t.Fatalf("handlePlan outside plans_path: expected IsError=true")
	}
	if !strings.Contains(result.Content[0].Text, "plans_path must stay within") {
		t.Fatalf("handlePlan outside plans_path: got %q", result.Content[0].Text)
	}
}

func TestHandlePlan_PlansSymlinkOutsideCwdRejected(t *testing.T) {
	root := makeProjectRoot(t)
	outside := t.TempDir()
	outsidePlans := filepath.Join(outside, "Plans.md")
	if err := os.WriteFile(outsidePlans, []byte("# Outside Plans\n\n"), 0o644); err != nil {
		t.Fatalf("WriteFile outside Plans.md: %v", err)
	}
	if err := os.Symlink(outsidePlans, filepath.Join(root, "Plans.md")); err != nil {
		t.Skipf("Symlink not available: %v", err)
	}

	result := handlePlan(map[string]any{"task": "x", "cwd": root})

	if !result.IsError {
		t.Fatalf("handlePlan symlink plans_path: expected IsError=true")
	}
	if !strings.Contains(result.Content[0].Text, "Plans.md realpath must stay within") {
		t.Fatalf("handlePlan symlink plans_path: got %q", result.Content[0].Text)
	}
	data, err := os.ReadFile(outsidePlans)
	if err != nil {
		t.Fatalf("ReadFile outside Plans.md: %v", err)
	}
	if strings.Contains(string(data), "x") {
		t.Fatalf("handlePlan symlink plans_path modified outside Plans.md: %q", string(data))
	}
}

// --- handleWork ---

// TestHandleWork_NoPlansFile verifies that a missing Plans.md returns a
// "not found" message (not an error).
func TestHandleWork_NoPlansFile(t *testing.T) {
	root := makeProjectRoot(t)

	result := handleWork(map[string]any{"cwd": root})

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

	result := handleWork(map[string]any{"cwd": root})

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
	if !strings.Contains(text, "Mark as cc:完了") {
		t.Errorf("handleWork with TODO: got %q, expected canonical completion guidance", text)
	}
	if strings.Contains(text, "Mark as cc:DONE") {
		t.Errorf("handleWork with TODO: got %q, should not emit legacy completion guidance", text)
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
