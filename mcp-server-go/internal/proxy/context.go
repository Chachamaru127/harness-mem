package proxy

import "context"

type projectKeyContextKey struct{}
type mcpPlatformContextKey struct{}

// ContextWithProjectKey returns a child context carrying the request-scoped
// harness project key. Empty keys are ignored so legacy callers stay unchanged.
func ContextWithProjectKey(ctx context.Context, projectKey string) context.Context {
	if projectKey == "" {
		return ctx
	}
	return context.WithValue(ctx, projectKeyContextKey{}, projectKey)
}

// ProjectKeyFromContext returns the request-scoped harness project key.
func ProjectKeyFromContext(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	if value, ok := ctx.Value(projectKeyContextKey{}).(string); ok {
		return value
	}
	return ""
}

// ContextWithMCPPlatform returns a child context carrying a request-scoped MCP
// platform label used by self-tracking tool_use events.
func ContextWithMCPPlatform(ctx context.Context, platform string) context.Context {
	if platform == "" {
		return ctx
	}
	return context.WithValue(ctx, mcpPlatformContextKey{}, platform)
}

// MCPPlatformFromContext returns the request-scoped MCP platform label.
func MCPPlatformFromContext(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	if value, ok := ctx.Value(mcpPlatformContextKey{}).(string); ok {
		return value
	}
	return ""
}
