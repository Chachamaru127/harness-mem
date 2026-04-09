package tools

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// --- handleStatus ---

// TestHandleStatus_NoPlansFile verifies that "Not found" appears in output
// when Plans.md does not exist.
func TestHandleStatus_NoPlansFile(t *testing.T) {
	makeProjectRoot(t)

	result := handleStatus(map[string]any{})

	if result.IsError {
		t.Fatalf("handleStatus no Plans.md: unexpected IsError=true")
	}
	text := result.Content[0].Text
	if !strings.Contains(text, "Not found") {
		t.Errorf("handleStatus no Plans.md: got %q, want 'Not found' in output", text)
	}
}

// TestHandleStatus_WithCounts verifies that TODO/WIP/DONE counts are
// correctly computed and rendered.
func TestHandleStatus_WithCounts(t *testing.T) {
	root := makeProjectRoot(t)

	// 2 TODO, 1 WIP, 1 DONE
	plans := "# Plans\n\n" +
		"- a <!-- cc:TODO -->\n" +
		"- b <!-- cc:TODO -->\n" +
		"- c <!-- cc:WIP -->\n" +
		"- d <!-- cc:DONE -->\n"
	if err := os.WriteFile(filepath.Join(root, "Plans.md"), []byte(plans), 0o644); err != nil {
		t.Fatalf("WriteFile Plans.md: %v", err)
	}

	result := handleStatus(map[string]any{})

	if result.IsError {
		t.Fatalf("handleStatus counts: unexpected IsError=true")
	}
	text := result.Content[0].Text

	// Check individual counts appear in the output.
	for label, want := range map[string]string{
		"TODO":  "2",
		"WIP":   "1",
		"Done":  "1",
	} {
		if !strings.Contains(text, want) {
			t.Errorf("handleStatus counts: output %q does not contain %q for %s", text, want, label)
		}
	}
}

// TestHandleStatus_VerboseSSOT verifies that verbose=true includes the
// SSOT Files section.
func TestHandleStatus_VerboseSSOT(t *testing.T) {
	makeProjectRoot(t)

	result := handleStatus(map[string]any{"verbose": true})

	if result.IsError {
		t.Fatalf("handleStatus verbose: unexpected IsError=true")
	}
	text := result.Content[0].Text
	if !strings.Contains(text, "SSOT Files") {
		t.Errorf("handleStatus verbose: got %q, want 'SSOT Files' section", text)
	}
}

// TestHandleStatus_SuggestedAction_NoPlanFile verifies suggested action when
// Plans.md is absent.
func TestHandleStatus_SuggestedAction_NoPlanFile(t *testing.T) {
	makeProjectRoot(t)

	result := handleStatus(map[string]any{})

	text := result.Content[0].Text
	if !strings.Contains(text, "harness_workflow_plan") {
		t.Errorf("handleStatus no plan: suggestion should mention harness_workflow_plan, got %q", text)
	}
}

// TestHandleStatus_SuggestedAction_WithTODO verifies that the suggestion
// mentions harness_workflow_work when there are pending TODOs.
func TestHandleStatus_SuggestedAction_WithTODO(t *testing.T) {
	root := makeProjectRoot(t)

	plans := "# Plans\n\n- a <!-- cc:TODO -->\n"
	if err := os.WriteFile(filepath.Join(root, "Plans.md"), []byte(plans), 0o644); err != nil {
		t.Fatalf("WriteFile Plans.md: %v", err)
	}

	result := handleStatus(map[string]any{})

	text := result.Content[0].Text
	if !strings.Contains(text, "harness_workflow_work") {
		t.Errorf("handleStatus TODO present: suggestion should mention harness_workflow_work, got %q", text)
	}
}

// TestHandleStatus_SuggestedAction_AllDone verifies that the suggestion
// mentions harness_workflow_review when all tasks are complete.
func TestHandleStatus_SuggestedAction_AllDone(t *testing.T) {
	root := makeProjectRoot(t)

	plans := "# Plans\n\n- a <!-- cc:DONE -->\n"
	if err := os.WriteFile(filepath.Join(root, "Plans.md"), []byte(plans), 0o644); err != nil {
		t.Fatalf("WriteFile Plans.md: %v", err)
	}

	result := handleStatus(map[string]any{})

	text := result.Content[0].Text
	if !strings.Contains(text, "harness_workflow_review") {
		t.Errorf("handleStatus all done: suggestion should mention harness_workflow_review, got %q", text)
	}
}
