package proxy

import "context"

type projectKeyContextKey struct{}

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
