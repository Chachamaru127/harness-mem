package tools

import (
	"testing"
)

// TestAllToolsCount verifies that AllTools returns exactly 46 tools.
func TestAllToolsCount(t *testing.T) {
	tools := AllTools()
	if len(tools) != 46 {
		t.Errorf("AllTools() returned %d tools, want 46", len(tools))
	}
}

// TestAllToolsNonEmptyName verifies that every tool has a non-empty Name.
func TestAllToolsNonEmptyName(t *testing.T) {
	for i, td := range AllTools() {
		if td.Tool.Name == "" {
			t.Errorf("tool[%d] has empty Name", i)
		}
	}
}

// TestAllToolsNonEmptyDescription verifies that every tool has a non-empty Description.
func TestAllToolsNonEmptyDescription(t *testing.T) {
	for i, td := range AllTools() {
		if td.Tool.Description == "" {
			t.Errorf("tool[%d] (%q) has empty Description", i, td.Tool.Name)
		}
	}
}

// TestArgStringPresent verifies that argString returns the value when the key exists.
func TestArgStringPresent(t *testing.T) {
	args := map[string]any{"key": "hello"}
	got := argString(args, "key")
	if got != "hello" {
		t.Errorf("argString present: got %q, want %q", got, "hello")
	}
}

// TestArgStringMissing verifies that argString returns "" when the key is absent.
func TestArgStringMissing(t *testing.T) {
	args := map[string]any{}
	got := argString(args, "missing")
	if got != "" {
		t.Errorf("argString missing: got %q, want %q", got, "")
	}
}

// TestArgStringWrongType verifies that argString returns "" when the value is not a string.
func TestArgStringWrongType(t *testing.T) {
	args := map[string]any{"key": 42}
	got := argString(args, "key")
	if got != "" {
		t.Errorf("argString wrong type: got %q, want %q", got, "")
	}
}

// TestArgBoolPresent verifies that argBool returns the stored bool value.
func TestArgBoolPresent(t *testing.T) {
	args := map[string]any{"verbose": true}
	got := argBool(args, "verbose", false)
	if !got {
		t.Errorf("argBool present true: got %v, want true", got)
	}
}

// TestArgBoolMissingUsesDefault verifies that argBool returns the fallback when absent.
func TestArgBoolMissingUsesDefault(t *testing.T) {
	args := map[string]any{}
	if argBool(args, "flag", false) != false {
		t.Error("argBool missing, fallback false: expected false")
	}
	if argBool(args, "flag", true) != true {
		t.Error("argBool missing, fallback true: expected true")
	}
}

// TestArgNumberPresent verifies that argNumber returns (value, true) when present.
func TestArgNumberPresent(t *testing.T) {
	args := map[string]any{"n": float64(3.14)}
	v, ok := argNumber(args, "n")
	if !ok {
		t.Fatal("argNumber present: ok=false, want true")
	}
	if v != 3.14 {
		t.Errorf("argNumber present: got %v, want 3.14", v)
	}
}

// TestArgNumberMissing verifies that argNumber returns (0, false) when absent.
func TestArgNumberMissing(t *testing.T) {
	args := map[string]any{}
	_, ok := argNumber(args, "missing")
	if ok {
		t.Error("argNumber missing: ok=true, want false")
	}
}

// TestArgStringArray verifies that argStringArray converts []any to []string correctly.
func TestArgStringArray(t *testing.T) {
	args := map[string]any{
		"files": []any{"a.go", "b.go", "c.go"},
	}
	got := argStringArray(args, "files")
	want := []string{"a.go", "b.go", "c.go"}
	if len(got) != len(want) {
		t.Fatalf("argStringArray: len=%d, want %d", len(got), len(want))
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("argStringArray[%d]: got %q, want %q", i, got[i], want[i])
		}
	}
}

// TestArgStringArrayMissing verifies that argStringArray returns nil when absent.
func TestArgStringArrayMissing(t *testing.T) {
	args := map[string]any{}
	got := argStringArray(args, "missing")
	if got != nil {
		t.Errorf("argStringArray missing: got %v, want nil", got)
	}
}
