// Package proxy provides HTTP client infrastructure for proxying requests
// to the memory server and Context Box.
package proxy

import "os"

// BuildAPIHeaders returns the standard headers for memory server API calls.
// Mirrors the header construction in memory.ts.
func BuildAPIHeaders() map[string]string {
	headers := map[string]string{
		"Content-Type": "application/json",
	}

	// Token priority: HARNESS_MEM_REMOTE_TOKEN > HARNESS_MEM_ADMIN_TOKEN
	token := os.Getenv("HARNESS_MEM_REMOTE_TOKEN")
	if token == "" {
		token = os.Getenv("HARNESS_MEM_ADMIN_TOKEN")
	}
	if token != "" {
		headers["Authorization"] = "Bearer " + token
		headers["x-harness-mem-token"] = token
	}

	// Inject user/team identity
	if uid := os.Getenv("HARNESS_MEM_USER_ID"); uid != "" {
		headers["x-harness-mem-user-id"] = uid
	}
	if tid := os.Getenv("HARNESS_MEM_TEAM_ID"); tid != "" {
		headers["x-harness-mem-team-id"] = tid
	}

	return headers
}

// BuildCBHeaders returns the standard headers for Context Box API calls.
func BuildCBHeaders() map[string]string {
	headers := map[string]string{
		"Content-Type": "application/json",
	}
	if token := os.Getenv("CONTEXT_BOX_API_TOKEN"); token != "" {
		headers["Authorization"] = "Bearer " + token
	}
	return headers
}
