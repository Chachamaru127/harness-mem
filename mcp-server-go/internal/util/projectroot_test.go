package util

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// --- SafeReadJSON ---

type testStruct struct {
	Name  string `json:"name"`
	Value int    `json:"value"`
}

func TestSafeReadJSON_ValidFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "data.json")

	want := testStruct{Name: "hello", Value: 42}
	b, err := json.Marshal(want)
	if err != nil {
		t.Fatalf("json.Marshal: %v", err)
	}
	if err := os.WriteFile(path, b, 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	got := SafeReadJSON(path, testStruct{})
	if got.Name != want.Name || got.Value != want.Value {
		t.Errorf("SafeReadJSON = %+v, want %+v", got, want)
	}
}

func TestSafeReadJSON_FileNotFound(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "missing.json")

	defaultVal := testStruct{Name: "default", Value: 0}
	got := SafeReadJSON(path, defaultVal)
	if got.Name != defaultVal.Name {
		t.Errorf("SafeReadJSON (missing file) = %+v, want default %+v", got, defaultVal)
	}
}

func TestSafeReadJSON_BrokenJSON(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "broken.json")

	if err := os.WriteFile(path, []byte("{not valid json"), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	defaultVal := testStruct{Name: "fallback", Value: -1}
	got := SafeReadJSON(path, defaultVal)
	if got.Name != defaultVal.Name || got.Value != defaultVal.Value {
		t.Errorf("SafeReadJSON (broken JSON) = %+v, want default %+v", got, defaultVal)
	}
}

// --- SafeWriteJSON ---

func TestSafeWriteJSON_WriteAndReadBack(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "output.json")

	want := testStruct{Name: "round-trip", Value: 99}
	ok := SafeWriteJSON(path, want)
	if !ok {
		t.Fatal("SafeWriteJSON returned false")
	}

	got := SafeReadJSON(path, testStruct{})
	if got.Name != want.Name || got.Value != want.Value {
		t.Errorf("round-trip: got %+v, want %+v", got, want)
	}
}

// --- FormatTimeAgo ---

func TestFormatTimeAgo_Seconds(t *testing.T) {
	got := FormatTimeAgo(30)
	want := "30s ago"
	if got != want {
		t.Errorf("FormatTimeAgo(30) = %q, want %q", got, want)
	}
}

func TestFormatTimeAgo_Hours(t *testing.T) {
	got := FormatTimeAgo(7200) // 2 hours
	want := "2h ago"
	if got != want {
		t.Errorf("FormatTimeAgo(7200) = %q, want %q", got, want)
	}
}

// --- EnsureDir ---

func TestEnsureDir_CreatesDirectory(t *testing.T) {
	dir := t.TempDir()
	newDir := filepath.Join(dir, "sub", "nested")

	if err := EnsureDir(newDir); err != nil {
		t.Fatalf("EnsureDir(%q) error: %v", newDir, err)
	}

	info, err := os.Stat(newDir)
	if err != nil {
		t.Fatalf("os.Stat(%q) after EnsureDir: %v", newDir, err)
	}
	if !info.IsDir() {
		t.Errorf("%q exists but is not a directory", newDir)
	}
}
