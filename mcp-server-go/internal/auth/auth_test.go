package auth

import (
	"os"
	"testing"
)

// TestResolveUserID_ExplicitEnv: HARNESS_MEM_USER_ID set → returns it.
func TestResolveUserID_ExplicitEnv(t *testing.T) {
	t.Setenv("HARNESS_MEM_USER_ID", "alice")
	t.Setenv("USER", "bob")

	got := ResolveUserID("somehost", nil)
	if got != "alice" {
		t.Errorf("want %q, got %q", "alice", got)
	}
}

// TestResolveUserID_UserEnv: HARNESS_MEM_USER_ID not set, USER set → returns USER.
func TestResolveUserID_UserEnv(t *testing.T) {
	t.Setenv("USER", "bob")
	// Ensure the higher-priority env is absent.
	t.Setenv("HARNESS_MEM_USER_ID", "")

	got := ResolveUserID("somehost", nil)
	if got != "bob" {
		t.Errorf("want %q, got %q", "bob", got)
	}
}

// TestResolveUserID_Hostname: neither env set → falls back to provided hostname.
func TestResolveUserID_Hostname(t *testing.T) {
	t.Setenv("HARNESS_MEM_USER_ID", "")
	t.Setenv("USER", "")
	t.Setenv("LOGNAME", "")

	got := ResolveUserID("myhost", nil)
	// The function returns the hostname argument when nothing else is set.
	if got != "myhost" {
		t.Errorf("want %q, got %q", "myhost", got)
	}
}

// TestResolveUserID_Unknown: nothing set and empty hostname → returns hostname or "unknown".
func TestResolveUserID_Unknown(t *testing.T) {
	t.Setenv("HARNESS_MEM_USER_ID", "")
	t.Setenv("USER", "")
	t.Setenv("LOGNAME", "")

	got := ResolveUserID("", nil)
	// With no env and no hostname arg, the function tries os.Hostname().
	// We accept any non-empty string (the real hostname) or "unknown".
	if got == "" {
		t.Errorf("want non-empty result, got %q", got)
	}
}

// TestResolveTeamID_ExplicitEnv: HARNESS_MEM_TEAM_ID set → returns it.
func TestResolveTeamID_ExplicitEnv(t *testing.T) {
	t.Setenv("HARNESS_MEM_TEAM_ID", "team-alpha")

	got := ResolveTeamID("alice", nil)
	if got != "team-alpha" {
		t.Errorf("want %q, got %q", "team-alpha", got)
	}
}

// TestResolveTeamID_DerivedFromUserID: no HARNESS_MEM_TEAM_ID → uses userID.
func TestResolveTeamID_DerivedFromUserID(t *testing.T) {
	t.Setenv("HARNESS_MEM_TEAM_ID", "")

	got := ResolveTeamID("alice", nil)
	if got != "alice" {
		t.Errorf("want %q (userID), got %q", "alice", got)
	}
}

// TestResolveTeamID_TokenMap: cfg.TokenMap maps userID → team.
func TestResolveTeamID_TokenMap(t *testing.T) {
	t.Setenv("HARNESS_MEM_TEAM_ID", "")

	cfg := &Config{
		TokenMap: map[string]string{
			"alice": "team-beta",
		},
	}
	got := ResolveTeamID("alice", cfg)
	if got != "team-beta" {
		t.Errorf("want %q, got %q", "team-beta", got)
	}
}

// TestInjectFromEnvironment: sets HARNESS_MEM_USER_ID and HARNESS_MEM_TEAM_ID in env.
func TestInjectFromEnvironment(t *testing.T) {
	// Start with both absent so InjectFromEnvironment will set them.
	t.Setenv("HARNESS_MEM_USER_ID", "")
	t.Setenv("HARNESS_MEM_TEAM_ID", "")
	t.Setenv("USER", "carol")

	id := InjectFromEnvironment(nil)

	// The returned Identity must be non-empty.
	if id.UserID == "" {
		t.Error("UserID should not be empty")
	}
	if id.TeamID == "" {
		t.Error("TeamID should not be empty")
	}

	// env vars must now be set.
	if got := os.Getenv("HARNESS_MEM_USER_ID"); got == "" {
		t.Error("HARNESS_MEM_USER_ID should have been injected into env")
	}
	if got := os.Getenv("HARNESS_MEM_TEAM_ID"); got == "" {
		t.Error("HARNESS_MEM_TEAM_ID should have been injected into env")
	}
}

// TestIdentityFields: Identity struct carries correct UserID and TeamID values.
func TestIdentityFields(t *testing.T) {
	t.Setenv("HARNESS_MEM_USER_ID", "dave")
	t.Setenv("HARNESS_MEM_TEAM_ID", "team-dave")

	id := ResolveIdentity(nil)

	if id.UserID != "dave" {
		t.Errorf("UserID: want %q, got %q", "dave", id.UserID)
	}
	if id.TeamID != "team-dave" {
		t.Errorf("TeamID: want %q, got %q", "team-dave", id.TeamID)
	}
}
