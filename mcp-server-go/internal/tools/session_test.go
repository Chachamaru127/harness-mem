package tools

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// withProjectRoot changes cwd to dir (which must contain a marker recognised
// by util.GetProjectRoot) and restores the original cwd on test cleanup.
func withProjectRoot(t *testing.T, dir string) {
	t.Helper()
	orig, err := os.Getwd()
	if err != nil {
		t.Fatalf("Getwd: %v", err)
	}
	if err := os.Chdir(dir); err != nil {
		t.Fatalf("Chdir(%q): %v", dir, err)
	}
	t.Cleanup(func() {
		_ = os.Chdir(orig)
	})
}

// makeProjectRoot creates a temp dir with a .claude marker so that
// GetProjectRoot() will resolve to it, then chdirs into it.
func makeProjectRoot(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	// Create .claude directory — one of the markers GetProjectRoot looks for.
	if err := os.MkdirAll(filepath.Join(root, ".claude"), 0o755); err != nil {
		t.Fatalf("MkdirAll .claude: %v", err)
	}
	withProjectRoot(t, root)
	return root
}

// --- handleListSessions ---

// TestHandleListSessions_NoActiveFile verifies an empty-list message when
// active.json does not exist.
func TestHandleListSessions_NoActiveFile(t *testing.T) {
	makeProjectRoot(t)

	result := handleListSessions()

	if result.IsError {
		t.Fatalf("handleListSessions: unexpected IsError=true")
	}
	if len(result.Content) == 0 {
		t.Fatal("handleListSessions: Content is empty")
	}
	text := result.Content[0].Text
	if !strings.Contains(text, "No active sessions") {
		t.Errorf("handleListSessions: got %q, want 'No active sessions'", text)
	}
}

// --- handleBroadcast ---

// TestHandleBroadcast_EmptyMessage verifies that an empty message returns an error.
func TestHandleBroadcast_EmptyMessage(t *testing.T) {
	makeProjectRoot(t)

	result := handleBroadcast(map[string]any{"message": ""})

	if !result.IsError {
		t.Fatal("handleBroadcast empty message: expected IsError=true")
	}
	if len(result.Content) == 0 {
		t.Fatal("handleBroadcast: Content is empty")
	}
	if !strings.Contains(result.Content[0].Text, "message is required") {
		t.Errorf("handleBroadcast: got %q, want error about 'message is required'", result.Content[0].Text)
	}
}

// TestHandleBroadcast_ValidMessage verifies that a non-empty message succeeds.
func TestHandleBroadcast_ValidMessage(t *testing.T) {
	makeProjectRoot(t)

	result := handleBroadcast(map[string]any{"message": "hello from test"})

	if result.IsError {
		t.Fatalf("handleBroadcast valid: unexpected IsError=true, text=%q", result.Content[0].Text)
	}
	if len(result.Content) == 0 {
		t.Fatal("handleBroadcast: Content is empty")
	}
	text := result.Content[0].Text
	if !strings.Contains(text, "Broadcast sent") {
		t.Errorf("handleBroadcast valid: got %q, want 'Broadcast sent'", text)
	}
}

// --- handleInbox ---

// TestHandleInbox_NoBroadcastFile verifies that a missing broadcast.md
// results in "No new messages".
func TestHandleInbox_NoBroadcastFile(t *testing.T) {
	makeProjectRoot(t)

	result := handleInbox(map[string]any{})

	if result.IsError {
		t.Fatalf("handleInbox no file: unexpected IsError=true")
	}
	if len(result.Content) == 0 {
		t.Fatal("handleInbox: Content is empty")
	}
	text := result.Content[0].Text
	if !strings.Contains(text, "No new messages") {
		t.Errorf("handleInbox no file: got %q, want 'No new messages'", text)
	}
}

// --- handleRegister ---

// TestHandleRegister_InvalidSessionID verifies that special characters in
// sessionId produce an error.
func TestHandleRegister_InvalidSessionID(t *testing.T) {
	makeProjectRoot(t)

	result := handleRegister(map[string]any{
		"client":    "claude-code",
		"sessionId": "bad id!@#",
	})

	if !result.IsError {
		t.Fatal("handleRegister invalid id: expected IsError=true")
	}
	text := result.Content[0].Text
	if !strings.Contains(text, "sessionId") {
		t.Errorf("handleRegister invalid id: got %q, want error mentioning 'sessionId'", text)
	}
}

// TestHandleRegister_ValidRegistration verifies that a well-formed registration
// succeeds and returns a confirmation message.
func TestHandleRegister_ValidRegistration(t *testing.T) {
	makeProjectRoot(t)

	result := handleRegister(map[string]any{
		"client":    "claude-code",
		"sessionId": "test-session-001",
	})

	if result.IsError {
		t.Fatalf("handleRegister valid: unexpected IsError=true, text=%q", result.Content[0].Text)
	}
	text := result.Content[0].Text
	if !strings.Contains(text, "Session registered") {
		t.Errorf("handleRegister valid: got %q, want 'Session registered'", text)
	}
	if !strings.Contains(text, "test-session-001") {
		t.Errorf("handleRegister valid: got %q, want sessionId in output", text)
	}
}
