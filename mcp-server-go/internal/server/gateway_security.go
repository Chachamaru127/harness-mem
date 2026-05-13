package server

import (
	"context"
	"crypto/subtle"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"

	mcpserver "github.com/mark3labs/mcp-go/server"

	"github.com/Chachamaru127/harness-mem/mcp-server-go/internal/proxy"
)

const (
	gatewayAuthHeader       = "Authorization"
	gatewayTokenHeader      = "x-harness-mem-token"
	gatewayProjectKeyHeader = "X-Harness-Project-Key"
)

type gatewaySecurityConfig struct {
	Addr  string
	Token string
}

func gatewaySecurityConfigFromEnv(addr string) (gatewaySecurityConfig, error) {
	if strings.TrimSpace(addr) == "" {
		addr = defaultStreamableHTTPAddr
	}
	if err := validateStreamableHTTPBindAddr(addr); err != nil {
		return gatewaySecurityConfig{}, err
	}
	token := resolveGatewayTokenFromEnv()
	if token == "" {
		return gatewaySecurityConfig{}, fmt.Errorf("HARNESS_MEM_MCP_TOKEN is required when HARNESS_MEM_MCP_TRANSPORT=http or streamable_http (HARNESS_MEM_REMOTE_TOKEN is accepted as a compatibility fallback)")
	}
	return gatewaySecurityConfig{Addr: addr, Token: token}, nil
}

func resolveGatewayTokenFromEnv() string {
	if token := strings.TrimSpace(os.Getenv("HARNESS_MEM_MCP_TOKEN")); token != "" {
		return token
	}
	return strings.TrimSpace(os.Getenv("HARNESS_MEM_REMOTE_TOKEN"))
}

func validateStreamableHTTPBindAddr(addr string) error {
	host, port, err := net.SplitHostPort(strings.TrimSpace(addr))
	if err != nil {
		return fmt.Errorf("HARNESS_MEM_MCP_ADDR must be an explicit loopback host:port, got %q: %w", addr, err)
	}
	if strings.TrimSpace(host) == "" {
		return fmt.Errorf("HARNESS_MEM_MCP_ADDR must include a loopback host, got %q", addr)
	}
	portNum, err := strconv.Atoi(port)
	if err != nil {
		return fmt.Errorf("HARNESS_MEM_MCP_ADDR port must be numeric, got %q", addr)
	}
	if portNum <= 0 || portNum > 65535 {
		return fmt.Errorf("HARNESS_MEM_MCP_ADDR port must be between 1 and 65535, got %q", addr)
	}
	if strings.EqualFold(host, "localhost") {
		return nil
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return fmt.Errorf("HARNESS_MEM_MCP_ADDR host must be localhost or a loopback IP, got %q", host)
	}
	if ip.IsUnspecified() || !ip.IsLoopback() {
		return fmt.Errorf("HARNESS_MEM_MCP_ADDR host must be loopback-only, got %q", host)
	}
	return nil
}

func newSecureStreamableHTTPHandler(addr string, opts ...mcpserver.StreamableHTTPOption) (http.Handler, error) {
	cfg, err := gatewaySecurityConfigFromEnv(addr)
	if err != nil {
		return nil, err
	}
	opts = append([]mcpserver.StreamableHTTPOption{mcpserver.WithHTTPContextFunc(gatewayHTTPContextFunc)}, opts...)
	return secureStreamableHTTPHandler(NewStreamableHTTPServer(opts...), cfg), nil
}

func secureStreamableHTTPHandler(next http.Handler, cfg gatewaySecurityConfig) http.Handler {
	_, expectedPort, _ := net.SplitHostPort(cfg.Addr)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !allowedLoopbackHostPort(r.Host, expectedPort) {
			http.Error(w, "forbidden host", http.StatusForbidden)
			return
		}
		if !allowedOrigin(r.Header.Get("Origin"), expectedPort) {
			http.Error(w, "forbidden origin", http.StatusForbidden)
			return
		}
		if !validGatewayToken(r, cfg.Token) {
			w.Header().Set("WWW-Authenticate", "Bearer")
			http.Error(w, "missing or invalid gateway token", http.StatusUnauthorized)
			return
		}

		projectKey := strings.TrimSpace(r.Header.Get(gatewayProjectKeyHeader))
		if projectKey == "" {
			projectKey = strings.TrimSpace(os.Getenv("HARNESS_MEM_PROJECT_KEY"))
		}
		if projectKey != "" {
			r = r.WithContext(proxy.ContextWithProjectKey(r.Context(), projectKey))
		}
		next.ServeHTTP(w, r)
	})
}

func gatewayHTTPContextFunc(ctx context.Context, r *http.Request) context.Context {
	return proxy.ContextWithProjectKey(ctx, proxy.ProjectKeyFromContext(r.Context()))
}

func validGatewayToken(r *http.Request, expected string) bool {
	if expected == "" {
		return false
	}
	if token := bearerToken(r.Header.Get(gatewayAuthHeader)); constantTimeTokenEqual(token, expected) {
		return true
	}
	return constantTimeTokenEqual(strings.TrimSpace(r.Header.Get(gatewayTokenHeader)), expected)
}

func bearerToken(raw string) string {
	raw = strings.TrimSpace(raw)
	if len(raw) < len("Bearer ") {
		return ""
	}
	if !strings.EqualFold(raw[:len("Bearer")], "Bearer") || raw[len("Bearer")] != ' ' {
		return ""
	}
	return strings.TrimSpace(raw[len("Bearer "):])
}

func constantTimeTokenEqual(got, want string) bool {
	if got == "" || want == "" || len(got) != len(want) {
		return false
	}
	return subtle.ConstantTimeCompare([]byte(got), []byte(want)) == 1
}

func allowedOrigin(rawOrigin, expectedPort string) bool {
	rawOrigin = strings.TrimSpace(rawOrigin)
	if rawOrigin == "" {
		return true
	}
	if rawOrigin == "null" {
		return false
	}
	u, err := url.Parse(rawOrigin)
	if err != nil || u.Host == "" {
		return false
	}
	if u.Scheme != "http" && u.Scheme != "https" {
		return false
	}
	return allowedLoopbackHostPort(u.Host, expectedPort)
}

func allowedLoopbackHostPort(rawHostPort, expectedPort string) bool {
	host, port, err := net.SplitHostPort(strings.TrimSpace(rawHostPort))
	if err != nil {
		return false
	}
	if _, err := strconv.Atoi(port); err != nil {
		return false
	}
	expectedPort = strings.TrimSpace(expectedPort)
	expected, err := strconv.Atoi(expectedPort)
	if expectedPort == "" || err != nil || expected <= 0 || expected > 65535 {
		return false
	}
	if port != expectedPort {
		return false
	}
	if strings.EqualFold(host, "localhost") {
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback() && !ip.IsUnspecified()
}
