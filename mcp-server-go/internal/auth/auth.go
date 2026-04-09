// Package auth resolves user and team identity for MCP authentication.
// Port of mcp-server/src/auth-inject.ts
package auth

import (
	"os"
	"strings"
)

// Config holds optional token-to-team mapping.
type Config struct {
	TokenMap map[string]string // user_id -> team_id
}

// Identity holds the resolved user and team IDs.
type Identity struct {
	UserID string
	TeamID string
}

// ResolveUserID determines the user ID.
// Priority: HARNESS_MEM_USER_ID > USER/LOGNAME > hostname > "unknown"
func ResolveUserID(hostname string, _ *Config) string {
	if v := strings.TrimSpace(os.Getenv("HARNESS_MEM_USER_ID")); v != "" {
		return v
	}
	if v := strings.TrimSpace(os.Getenv("USER")); v != "" {
		return v
	}
	if v := strings.TrimSpace(os.Getenv("LOGNAME")); v != "" {
		return v
	}
	if hostname != "" {
		return hostname
	}
	h, err := os.Hostname()
	if err == nil && h != "" {
		return h
	}
	return "unknown"
}

// ResolveTeamID determines the team ID.
// Priority: HARNESS_MEM_TEAM_ID > tokenMap[userID] > userID
func ResolveTeamID(userID string, cfg *Config) string {
	if v := strings.TrimSpace(os.Getenv("HARNESS_MEM_TEAM_ID")); v != "" {
		return v
	}
	if cfg != nil && cfg.TokenMap != nil {
		if mapped, ok := cfg.TokenMap[userID]; ok && mapped != "" {
			return mapped
		}
	}
	return userID
}

// ResolveIdentity resolves both user and team IDs from the current environment.
func ResolveIdentity(cfg *Config) Identity {
	userID := ResolveUserID("", cfg)
	teamID := ResolveTeamID(userID, cfg)
	return Identity{UserID: userID, TeamID: teamID}
}

// InjectFromEnvironment resolves identity and sets env vars if not already set.
// Returns the resolved identity.
func InjectFromEnvironment(cfg *Config) Identity {
	id := ResolveIdentity(cfg)
	if os.Getenv("HARNESS_MEM_USER_ID") == "" {
		os.Setenv("HARNESS_MEM_USER_ID", id.UserID)
	}
	if os.Getenv("HARNESS_MEM_TEAM_ID") == "" {
		os.Setenv("HARNESS_MEM_TEAM_ID", id.TeamID)
	}
	return id
}
