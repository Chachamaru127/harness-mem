// Package util - path and ID validation.
// Port of isValidPath() and related validation from utils.ts
package util

import (
	"path/filepath"
	"regexp"
	"strings"
)

// dangerousChars matches shell-injection characters.
var dangerousChars = regexp.MustCompile(`[;&|` + "`" + `$(){}[\]<>'"\\!#*?~\n\r]`)

// SafeIDPattern validates session/client IDs: alphanumeric + underscore + dash, 1-128 chars.
var SafeIDPattern = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,128}$`)

// IsValidPath checks that a path is safe for use in shell commands.
// Rejects empty paths, command-injection chars, null bytes, and traversal above root.
func IsValidPath(inputPath string) bool {
	if strings.TrimSpace(inputPath) == "" {
		return false
	}
	if dangerousChars.MatchString(inputPath) {
		return false
	}
	if strings.Contains(inputPath, "\x00") {
		return false
	}
	normalized := filepath.Clean(inputPath)
	if strings.HasPrefix(normalized, "..") {
		return false
	}
	return true
}

// IsValidID checks that an ID matches the safe pattern.
func IsValidID(id string) bool {
	return SafeIDPattern.MatchString(id)
}
