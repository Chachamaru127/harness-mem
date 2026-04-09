// Package util provides shared utilities for the MCP server.
// Port of mcp-server/src/utils.ts
package util

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
)

// Constants matching the TypeScript version.
const (
	StaleThresholdSeconds = 3600
	MaxBroadcastMessages  = 100
	SessionsDir           = ".claude/sessions"
	ActiveSessionsFile    = ".claude/sessions/active.json"
	BroadcastFile         = ".claude/sessions/broadcast.md"
)

// Markers used to detect project root.
var projectRootMarkers = []string{".git", "package.json", "Plans.md", ".claude"}

// GetProjectRoot finds the project root by traversing up the directory tree
// looking for common marker files/directories.
// Returns cwd if no marker is found.
func GetProjectRoot() string {
	current, err := os.Getwd()
	if err != nil {
		return "."
	}

	root := filepath.VolumeName(current) + string(filepath.Separator)

	for current != root {
		for _, marker := range projectRootMarkers {
			p := filepath.Join(current, marker)
			if _, err := os.Stat(p); err == nil {
				return current
			}
		}
		parent := filepath.Dir(current)
		if parent == current {
			break
		}
		current = parent
	}

	cwd, _ := os.Getwd()
	return cwd
}

// EnsureDir creates a directory and all parents if they don't exist.
func EnsureDir(dirPath string) error {
	return os.MkdirAll(dirPath, 0o755)
}

// SafeReadJSON reads and parses a JSON file, returning defaultValue on any error.
func SafeReadJSON[T any](filePath string, defaultValue T) T {
	data, err := os.ReadFile(filePath)
	if err != nil {
		return defaultValue
	}
	var result T
	if err := json.Unmarshal(data, &result); err != nil {
		fmt.Fprintf(os.Stderr, "[harness-mcp] Failed to parse JSON from %s: %v\n", filePath, err)
		return defaultValue
	}
	return result
}

// SafeWriteJSON writes data as formatted JSON to a file.
// Creates parent directories if needed. Returns true on success.
func SafeWriteJSON(filePath string, data any) bool {
	if err := EnsureDir(filepath.Dir(filePath)); err != nil {
		fmt.Fprintf(os.Stderr, "[harness-mcp] Failed to create dir for %s: %v\n", filePath, err)
		return false
	}
	b, err := json.MarshalIndent(data, "", "  ")
	if err != nil {
		fmt.Fprintf(os.Stderr, "[harness-mcp] Failed to marshal JSON for %s: %v\n", filePath, err)
		return false
	}
	if err := os.WriteFile(filePath, b, 0o644); err != nil {
		fmt.Fprintf(os.Stderr, "[harness-mcp] Failed to write JSON to %s: %v\n", filePath, err)
		return false
	}
	return true
}

// FormatTimeAgo formats a duration in seconds to a human-readable string.
func FormatTimeAgo(seconds int) string {
	if seconds < 60 {
		return fmt.Sprintf("%ds ago", seconds)
	}
	if seconds < 3600 {
		return fmt.Sprintf("%dm ago", seconds/60)
	}
	return fmt.Sprintf("%dh ago", seconds/3600)
}
