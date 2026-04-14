// projectkey_test.go — S81-A01 unit tests.
package util

import (
	"os"
	"path/filepath"
	"testing"
)

// writeGitHEAD creates a minimal .git/HEAD file so ResolveProjectKey's
// "real repo" check (round 12 P2 parity with TS) accepts the directory.
func writeGitHEAD(t *testing.T, gitDir string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(gitDir, "HEAD"), []byte("ref: refs/heads/main\n"), 0o644); err != nil {
		t.Fatalf("write .git/HEAD: %v", err)
	}
}

func TestResolveProjectKey_PlainRepo(t *testing.T) {
	root := t.TempDir()
	repo := filepath.Join(root, "myrepo")
	gitDir := filepath.Join(repo, ".git")
	if err := os.MkdirAll(gitDir, 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	writeGitHEAD(t, gitDir)
	nested := filepath.Join(repo, "src", "internal")
	if err := os.MkdirAll(nested, 0o755); err != nil {
		t.Fatalf("mkdir nested: %v", err)
	}

	resolved := ResolveProjectKey(nested)
	expected, _ := filepath.EvalSymlinks(repo)
	if resolved != expected {
		t.Errorf("ResolveProjectKey(%q) = %q, want %q", nested, resolved, expected)
	}
}

func TestResolveProjectKey_ThreeWorktreesSameRoot(t *testing.T) {
	// Simulate: /tmp/fixture/main-repo (main) + feature-a + feature-b worktrees
	root := t.TempDir()
	mainRepo := filepath.Join(root, "main-repo")
	if err := os.MkdirAll(filepath.Join(mainRepo, ".git", "worktrees", "feature-a"), 0o755); err != nil {
		t.Fatalf("mkdir main/.git/worktrees/feature-a: %v", err)
	}
	if err := os.MkdirAll(filepath.Join(mainRepo, ".git", "worktrees", "feature-b"), 0o755); err != nil {
		t.Fatalf("mkdir main/.git/worktrees/feature-b: %v", err)
	}
	writeGitHEAD(t, filepath.Join(mainRepo, ".git"))

	mkWorktree := func(name string) string {
		wt := filepath.Join(root, name)
		if err := os.MkdirAll(filepath.Join(wt, "src"), 0o755); err != nil {
			t.Fatalf("mkdir %s: %v", name, err)
		}
		pointer := "gitdir: " + filepath.Join(mainRepo, ".git", "worktrees", name) + "\n"
		if err := os.WriteFile(filepath.Join(wt, ".git"), []byte(pointer), 0o644); err != nil {
			t.Fatalf("write .git pointer %s: %v", name, err)
		}
		return wt
	}
	featureA := mkWorktree("feature-a")
	featureB := mkWorktree("feature-b")

	expected, _ := filepath.EvalSymlinks(mainRepo)

	mainNested := filepath.Join(mainRepo, "src")
	if err := os.MkdirAll(mainNested, 0o755); err != nil {
		t.Fatalf("mkdir main/src: %v", err)
	}

	for _, cwd := range []string{mainNested, filepath.Join(featureA, "src"), filepath.Join(featureB, "src")} {
		got := ResolveProjectKey(cwd)
		if got != expected {
			t.Errorf("ResolveProjectKey(%q) = %q, want %q (all 3 worktrees should collapse to main repo)", cwd, got, expected)
		}
	}
}

func TestResolveProjectKey_NoGitFallsBackToCwd(t *testing.T) {
	root := t.TempDir()
	expected, _ := filepath.EvalSymlinks(root)
	got := ResolveProjectKey(root)
	if got != expected {
		t.Errorf("ResolveProjectKey(no .git) = %q, want %q", got, expected)
	}
}

func TestResolveProjectKey_EmptyCwdUsesProcessWd(t *testing.T) {
	got := ResolveProjectKey("")
	// got should be some absolute path — either cwd or its repo root if cwd
	// is inside a worktree (in which case it collapses to the main repo root).
	if got == "" || got == "." {
		t.Errorf("ResolveProjectKey(\"\") returned %q; want non-empty absolute path", got)
	}
	if !filepath.IsAbs(got) {
		t.Errorf("ResolveProjectKey(\"\") = %q; want absolute path", got)
	}
}

// TestResolveProjectKey_WorktreeFromParentDir verifies that invoking
// ResolveProjectKey from the worktree root itself (not a subdir) also
// collapses to the main repo. This catches regressions where the walk-up
// logic stops too early.
func TestResolveProjectKey_WorktreeFromParentDir(t *testing.T) {
	root := t.TempDir()
	mainRepo := filepath.Join(root, "main-repo")
	if err := os.MkdirAll(filepath.Join(mainRepo, ".git", "worktrees", "wt"), 0o755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	writeGitHEAD(t, filepath.Join(mainRepo, ".git"))

	wt := filepath.Join(root, "wt")
	if err := os.MkdirAll(wt, 0o755); err != nil {
		t.Fatalf("mkdir wt: %v", err)
	}
	pointer := "gitdir: " + filepath.Join(mainRepo, ".git", "worktrees", "wt") + "\n"
	if err := os.WriteFile(filepath.Join(wt, ".git"), []byte(pointer), 0o644); err != nil {
		t.Fatalf("write .git: %v", err)
	}

	expected, _ := filepath.EvalSymlinks(mainRepo)
	got := ResolveProjectKey(wt)
	if got != expected {
		t.Errorf("ResolveProjectKey(worktree root) = %q, want %q", got, expected)
	}
}

