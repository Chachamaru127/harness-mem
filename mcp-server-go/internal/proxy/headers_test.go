package proxy

import "testing"

func TestBuildAPIHeaders_RemoteToken(t *testing.T) {
	t.Setenv("HARNESS_MEM_REMOTE_TOKEN", "remote-secret")
	t.Setenv("HARNESS_MEM_ADMIN_TOKEN", "")
	t.Setenv("HARNESS_MEM_USER_ID", "")
	t.Setenv("HARNESS_MEM_TEAM_ID", "")

	headers := BuildAPIHeaders()

	want := "Bearer remote-secret"
	if got := headers["Authorization"]; got != want {
		t.Errorf("Authorization = %q, want %q", got, want)
	}
	if got := headers["x-harness-mem-token"]; got != "remote-secret" {
		t.Errorf("x-harness-mem-token = %q, want %q", got, "remote-secret")
	}
}

func TestBuildAPIHeaders_AdminTokenFallback(t *testing.T) {
	t.Setenv("HARNESS_MEM_REMOTE_TOKEN", "")
	t.Setenv("HARNESS_MEM_ADMIN_TOKEN", "admin-secret")
	t.Setenv("HARNESS_MEM_USER_ID", "")
	t.Setenv("HARNESS_MEM_TEAM_ID", "")

	headers := BuildAPIHeaders()

	want := "Bearer admin-secret"
	if got := headers["Authorization"]; got != want {
		t.Errorf("Authorization = %q, want %q", got, want)
	}
	if got := headers["x-harness-mem-token"]; got != "admin-secret" {
		t.Errorf("x-harness-mem-token = %q, want %q", got, "admin-secret")
	}
}

func TestBuildAPIHeaders_UserID(t *testing.T) {
	t.Setenv("HARNESS_MEM_REMOTE_TOKEN", "")
	t.Setenv("HARNESS_MEM_ADMIN_TOKEN", "")
	t.Setenv("HARNESS_MEM_USER_ID", "user-42")
	t.Setenv("HARNESS_MEM_TEAM_ID", "")

	headers := BuildAPIHeaders()

	if got := headers["x-harness-mem-user-id"]; got != "user-42" {
		t.Errorf("x-harness-mem-user-id = %q, want %q", got, "user-42")
	}
}

func TestBuildAPIHeaders_TeamID(t *testing.T) {
	t.Setenv("HARNESS_MEM_REMOTE_TOKEN", "")
	t.Setenv("HARNESS_MEM_ADMIN_TOKEN", "")
	t.Setenv("HARNESS_MEM_USER_ID", "")
	t.Setenv("HARNESS_MEM_TEAM_ID", "team-99")

	headers := BuildAPIHeaders()

	if got := headers["x-harness-mem-team-id"]; got != "team-99" {
		t.Errorf("x-harness-mem-team-id = %q, want %q", got, "team-99")
	}
}

func TestBuildCBHeaders_Token(t *testing.T) {
	t.Setenv("CONTEXT_BOX_API_TOKEN", "cb-token-xyz")

	headers := BuildCBHeaders()

	want := "Bearer cb-token-xyz"
	if got := headers["Authorization"]; got != want {
		t.Errorf("Authorization = %q, want %q", got, want)
	}
}

func TestBuildCBHeaders_NoToken(t *testing.T) {
	t.Setenv("CONTEXT_BOX_API_TOKEN", "")

	headers := BuildCBHeaders()

	if _, ok := headers["Authorization"]; ok {
		t.Error("Authorization header should not be present when no token is set")
	}
	if got := headers["Content-Type"]; got != "application/json" {
		t.Errorf("Content-Type = %q, want %q", got, "application/json")
	}
}
