// projectkey.go — S80-A01: Worktree / repo-root unifier.
//
// ResolveProjectKey inspects `cwd` and returns a canonical project key that
// collapses all linked worktrees of the same repo onto the same key.
//
// Algorithm:
//  1. Walk up from cwd looking for a .git entry (directory or file).
//  2. If .git is a directory, the enclosing dir is the project key.
//  3. If .git is a file (linked worktree), parse `gitdir: <path>` and look for
//     ".git/worktrees/<name>" token. The path preceding the token is the
//     common git root → that is the project key.
//  4. Resolve symlinks where possible (macOS /var → /private/var).
//  5. If no .git marker is found, fall back to cwd itself.
//
// Parity with memory-server/src/core/harness-mem-core.ts (resolveDirectGitWorkspaceRoot).
package util

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// worktreeToken is the path segment inside .git that identifies linked worktrees.
const worktreeToken = "/.git/worktrees/"

var gitdirLineRe = regexp.MustCompile(`(?m)^\s*gitdir:\s*(.+?)\s*$`)

// ResolveProjectKey returns the canonical project key for the given cwd.
// If cwd is empty, the current process cwd is used. The return value is
// always an absolute path after symlink resolution; empty string is never
// returned.
func ResolveProjectKey(cwd string) string {
	dir := strings.TrimSpace(cwd)
	if dir == "" {
		wd, err := os.Getwd()
		if err != nil {
			return "."
		}
		dir = wd
	}

	abs, err := filepath.Abs(dir)
	if err != nil {
		abs = dir
	}

	// Walk up looking for .git.
	current := abs
	root := filepath.VolumeName(current) + string(filepath.Separator)
	for current != root {
		gitPath := filepath.Join(current, ".git")
		if info, err := os.Lstat(gitPath); err == nil {
			if info.IsDir() {
				// Plain repo root.
				return realpathOrSelf(current)
			}
			if info.Mode().IsRegular() {
				// Linked worktree. Parse gitdir pointer.
				if commonRoot := commonRootFromGitFile(gitPath); commonRoot != "" {
					return realpathOrSelf(commonRoot)
				}
				// Fallback: treat as normal root.
				return realpathOrSelf(current)
			}
		}
		parent := filepath.Dir(current)
		if parent == current {
			break
		}
		current = parent
	}

	// No .git marker up-tree: return abs cwd after realpath.
	return realpathOrSelf(abs)
}

// commonRootFromGitFile reads the `gitdir: <path>` line from a linked
// worktree's .git file and returns the common git root path (the directory
// that contains .git/worktrees). Returns "" if it cannot be determined.
func commonRootFromGitFile(gitFile string) string {
	data, err := os.ReadFile(gitFile)
	if err != nil {
		return ""
	}
	match := gitdirLineRe.FindStringSubmatch(string(data))
	if len(match) < 2 {
		return ""
	}
	gitdir := strings.TrimSpace(match[1])
	if gitdir == "" {
		return ""
	}

	// Resolve relative gitdir against the worktree's directory.
	if !filepath.IsAbs(gitdir) {
		gitdir = filepath.Join(filepath.Dir(gitFile), gitdir)
	}
	// Normalize to forward slashes for token search (matches TS parity).
	forward := filepath.ToSlash(gitdir)
	idx := strings.Index(forward, worktreeToken)
	if idx <= 0 {
		return ""
	}
	commonRoot := forward[:idx]
	// Convert back to OS-native separators.
	return filepath.FromSlash(commonRoot)
}

// realpathOrSelf resolves symlinks. Returns the original path if realpath
// fails (e.g., path does not exist on disk).
func realpathOrSelf(p string) string {
	if resolved, err := filepath.EvalSymlinks(p); err == nil {
		return resolved
	}
	return p
}
