package server

import (
	"bytes"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"reflect"
	"sort"
	"strings"
	"sync"
	"testing"

	"github.com/mark3labs/mcp-go/mcp"
	mcpserver "github.com/mark3labs/mcp-go/server"
)

func TestValidateStreamableHTTPBindAddrMatrix(t *testing.T) {
	tests := []struct {
		name    string
		addr    string
		wantErr bool
	}{
		{name: "ipv4 loopback", addr: "127.0.0.1:37889"},
		{name: "localhost", addr: "localhost:37889"},
		{name: "ipv6 loopback", addr: "[::1]:37889"},
		{name: "zero port", addr: "127.0.0.1:0", wantErr: true},
		{name: "empty host", addr: ":37889", wantErr: true},
		{name: "ipv4 unspecified", addr: "0.0.0.0:37889", wantErr: true},
		{name: "ipv6 unspecified", addr: "[::]:37889", wantErr: true},
		{name: "lan ip", addr: "192.168.1.9:37889", wantErr: true},
		{name: "external hostname", addr: "example.com:37889", wantErr: true},
		{name: "localhost suffix", addr: "localhost.evil.com:37889", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateStreamableHTTPBindAddr(tt.addr)
			if tt.wantErr && err == nil {
				t.Fatalf("validateStreamableHTTPBindAddr(%q) returned nil", tt.addr)
			}
			if !tt.wantErr && err != nil {
				t.Fatalf("validateStreamableHTTPBindAddr(%q) returned error: %v", tt.addr, err)
			}
		})
	}
}

func TestAllowedLoopbackHostPortRequiresExactExpectedPort(t *testing.T) {
	if !allowedLoopbackHostPort("127.0.0.1:37889", "37889") {
		t.Fatal("expected exact loopback host:port to be allowed")
	}
	if allowedLoopbackHostPort("127.0.0.1:37890", "37889") {
		t.Fatal("expected mismatched port to be denied")
	}
	if allowedLoopbackHostPort("127.0.0.1:37889", "0") {
		t.Fatal("expected zero expected port to be denied, not treated as wildcard")
	}
}

func TestSecureGatewayMissingAndWrongTokenReturn401(t *testing.T) {
	ts, endpoint := startSecureGatewayTestServer(t, "gateway-secret")

	for _, token := range []string{"", "wrong-secret"} {
		resp, body := rawMCPRequest(t, ts.Client(), endpoint, rawMCPRequestOptions{token: token})
		if resp.StatusCode != http.StatusUnauthorized {
			t.Fatalf("token %q status = %d, body = %s", token, resp.StatusCode, body)
		}
		if strings.Contains(body, `"jsonrpc"`) {
			t.Fatalf("expected HTTP auth rejection before JSON-RPC, body = %s", body)
		}
	}
}

func TestSecureGatewayBadHostAndOriginReturn403(t *testing.T) {
	ts, endpoint := startSecureGatewayTestServer(t, "gateway-secret")
	port := mustURLPort(t, endpoint)

	tests := []rawMCPRequestOptions{
		{token: "gateway-secret", host: "192.168.1.9:" + port},
		{token: "gateway-secret", host: "localhost.evil.com:" + port},
		{token: "gateway-secret", origin: "http://evil.example:" + port},
		{token: "gateway-secret", origin: "null"},
	}
	for _, opts := range tests {
		resp, body := rawMCPRequest(t, ts.Client(), endpoint, opts)
		if resp.StatusCode != http.StatusForbidden {
			t.Fatalf("opts %+v status = %d, body = %s", opts, resp.StatusCode, body)
		}
		if strings.Contains(body, `"jsonrpc"`) {
			t.Fatalf("expected HTTP policy rejection before JSON-RPC, body = %s", body)
		}
	}
}

func TestSecureGatewayGoodTokenHostOriginReachesMCPAndHealth(t *testing.T) {
	t.Setenv("HARNESS_MEM_TOOLS", "core")
	memSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet && (r.URL.Path == "/health/ready" || r.URL.Path == "/health") {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"ok":true,"status":"healthy"}`))
			return
		}
		http.Error(w, "unexpected memory daemon request", http.StatusNotFound)
	}))
	defer memSrv.Close()
	t.Setenv("HARNESS_MEM_REMOTE_URL", memSrv.URL)

	ts, endpoint := startSecureGatewayTestServer(t, "gateway-secret")
	origin := "http://127.0.0.1:" + mustURLPort(t, endpoint)
	opts := rawMCPRequestOptions{token: "gateway-secret", origin: origin}

	sessionID := initializeSecureHTTPMCP(t, ts.Client(), endpoint, opts)
	names := listSecureHTTPToolNames(t, ts.Client(), endpoint, sessionID, opts)
	if !stringSliceContains(names, "harness_mem_health") {
		t.Fatalf("expected harness_mem_health in tools/list, got %v", names)
	}

	result := callSecureHTTPTool(t, ts.Client(), endpoint, sessionID, "harness_mem_health", opts)
	if result.Error != nil {
		t.Fatalf("harness_mem_health returned error: %#v", result.Error)
	}
	if result.Result.IsError {
		t.Fatalf("harness_mem_health result is error: %+v", result.Result)
	}
	if len(result.Result.Content) == 0 || !strings.Contains(result.Result.Content[0].Text, "healthy") {
		t.Fatalf("harness_mem_health content = %+v", result.Result.Content)
	}
}

func TestSecureGatewayProjectKeyHeaderBeatsEnvAndDoesNotLeak(t *testing.T) {
	t.Setenv("HARNESS_MEM_TOOLS", "core")
	t.Setenv("HARNESS_MEM_PROJECT_KEY", "env-project")

	var mu sync.Mutex
	var observed []string
	memSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet && (r.URL.Path == "/health/ready" || r.URL.Path == "/health") {
			if projectKey := r.Header.Get(gatewayProjectKeyHeader); projectKey != "" {
				mu.Lock()
				observed = append(observed, projectKey)
				mu.Unlock()
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"ok":true,"status":"healthy"}`))
			return
		}
		http.Error(w, "unexpected memory daemon request", http.StatusNotFound)
	}))
	defer memSrv.Close()
	t.Setenv("HARNESS_MEM_REMOTE_URL", memSrv.URL)

	ts, endpoint := startSecureGatewayTestServer(t, "gateway-secret")
	sessionID := initializeSecureHTTPMCP(t, ts.Client(), endpoint, rawMCPRequestOptions{token: "gateway-secret"})

	for _, projectKey := range []string{"header-project-a", "header-project-b"} {
		result := callSecureHTTPTool(t, ts.Client(), endpoint, sessionID, "harness_mem_health", rawMCPRequestOptions{
			token:      "gateway-secret",
			projectKey: projectKey,
		})
		if result.Error != nil || result.Result.IsError {
			t.Fatalf("health with project %q failed: %+v", projectKey, result)
		}
	}

	mu.Lock()
	got := append([]string(nil), observed...)
	mu.Unlock()
	want := []string{"header-project-a", "header-project-b"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("observed project keys = %v, want %v", got, want)
	}
}

func TestSecureGatewayProjectKeyFallsBackToEnv(t *testing.T) {
	t.Setenv("HARNESS_MEM_TOOLS", "core")
	t.Setenv("HARNESS_MEM_PROJECT_KEY", "env-project")

	var observed string
	var mu sync.Mutex
	memSrv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodGet && r.URL.Path == "/health" {
			if projectKey := r.Header.Get(gatewayProjectKeyHeader); projectKey != "" {
				mu.Lock()
				observed = projectKey
				mu.Unlock()
			}
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"ok":true,"status":"healthy"}`))
			return
		}
		if r.Method == http.MethodGet && r.URL.Path == "/health/ready" {
			w.WriteHeader(http.StatusOK)
			return
		}
		http.Error(w, "unexpected memory daemon request", http.StatusNotFound)
	}))
	defer memSrv.Close()
	t.Setenv("HARNESS_MEM_REMOTE_URL", memSrv.URL)

	ts, endpoint := startSecureGatewayTestServer(t, "gateway-secret")
	sessionID := initializeSecureHTTPMCP(t, ts.Client(), endpoint, rawMCPRequestOptions{token: "gateway-secret"})
	result := callSecureHTTPTool(t, ts.Client(), endpoint, sessionID, "harness_mem_health", rawMCPRequestOptions{token: "gateway-secret"})
	if result.Error != nil || result.Result.IsError {
		t.Fatalf("health failed: %+v", result)
	}

	mu.Lock()
	got := observed
	mu.Unlock()
	if got != "env-project" {
		t.Fatalf("observed project key = %q, want env-project", got)
	}
}

func startSecureGatewayTestServer(t *testing.T, token string) (*httptest.Server, string) {
	t.Helper()
	t.Setenv("HARNESS_MEM_MCP_TOKEN", token)
	t.Setenv("HARNESS_MEM_REMOTE_TOKEN", "")

	ts := httptest.NewUnstartedServer(nil)
	addr := ts.Listener.Addr().String()
	handler, err := newSecureStreamableHTTPHandler(addr)
	if err != nil {
		t.Fatalf("new secure handler: %v", err)
	}
	mux := http.NewServeMux()
	mux.Handle(defaultStreamableHTTPEndpoint, handler)
	ts.Config.Handler = mux
	ts.Start()
	t.Cleanup(ts.Close)
	return ts, ts.URL + defaultStreamableHTTPEndpoint
}

type rawMCPRequestOptions struct {
	token      string
	host       string
	origin     string
	projectKey string
}

func rawMCPRequest(t *testing.T, client *http.Client, endpoint string, opts rawMCPRequestOptions) (*http.Response, string) {
	t.Helper()
	body := map[string]any{
		"jsonrpc": "2.0",
		"id":      1,
		"method":  "initialize",
		"params": map[string]any{
			"protocolVersion": mcp.LATEST_PROTOCOL_VERSION,
			"clientInfo": map[string]any{
				"name":    "harness-mem-test-client",
				"version": "1.0.0",
			},
		},
	}
	resp, raw := doSecureHTTPMCP(t, client, endpoint, "", body, opts)
	return resp, string(raw)
}

func initializeSecureHTTPMCP(t *testing.T, client *http.Client, endpoint string, opts rawMCPRequestOptions) string {
	t.Helper()

	decoded := postSecureHTTPMCP(t, client, endpoint, "", map[string]any{
		"jsonrpc": "2.0",
		"id":      1,
		"method":  "initialize",
		"params": map[string]any{
			"protocolVersion": mcp.LATEST_PROTOCOL_VERSION,
			"clientInfo": map[string]any{
				"name":    "harness-mem-test-client",
				"version": "1.0.0",
			},
		},
	}, opts)
	if decoded.Result.ProtocolVersion != mcp.LATEST_PROTOCOL_VERSION {
		t.Fatalf("protocolVersion = %q, want %q", decoded.Result.ProtocolVersion, mcp.LATEST_PROTOCOL_VERSION)
	}
	sessionID := decoded.Header.Get(mcpserver.HeaderKeySessionID)
	if sessionID == "" {
		t.Fatal("initialize did not return an MCP session id")
	}
	return sessionID
}

func listSecureHTTPToolNames(t *testing.T, client *http.Client, endpoint, sessionID string, opts rawMCPRequestOptions) []string {
	t.Helper()

	resp := postSecureHTTPMCP(t, client, endpoint, sessionID, map[string]any{
		"jsonrpc": "2.0",
		"id":      2,
		"method":  "tools/list",
	}, opts)
	if resp.Error != nil {
		t.Fatalf("tools/list returned error: %#v", resp.Error)
	}
	names := make([]string, 0, len(resp.Result.Tools))
	for _, tool := range resp.Result.Tools {
		names = append(names, tool.Name)
	}
	sort.Strings(names)
	return names
}

func callSecureHTTPTool(t *testing.T, client *http.Client, endpoint, sessionID, name string, opts rawMCPRequestOptions) httpMCPResponse {
	t.Helper()

	return postSecureHTTPMCP(t, client, endpoint, sessionID, map[string]any{
		"jsonrpc": "2.0",
		"id":      3,
		"method":  "tools/call",
		"params": map[string]any{
			"name":      name,
			"arguments": map[string]any{},
		},
	}, opts)
}

func postSecureHTTPMCP(t *testing.T, client *http.Client, endpoint, sessionID string, body any, opts rawMCPRequestOptions) httpMCPResponse {
	t.Helper()

	resp, raw := doSecureHTTPMCP(t, client, endpoint, sessionID, body, opts)
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("MCP status = %d, body = %s", resp.StatusCode, string(raw))
	}
	var decoded httpMCPResponse
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("decode MCP response %q: %v", string(raw), err)
	}
	decoded.Header = resp.Header.Clone()
	return decoded
}

func doSecureHTTPMCP(t *testing.T, client *http.Client, endpoint, sessionID string, body any, opts rawMCPRequestOptions) (*http.Response, []byte) {
	t.Helper()

	rawBody, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("marshal request body: %v", err)
	}
	req, err := http.NewRequest(http.MethodPost, endpoint, bytes.NewReader(rawBody))
	if err != nil {
		t.Fatalf("create request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")
	if sessionID != "" {
		req.Header.Set(mcpserver.HeaderKeySessionID, sessionID)
	}
	if opts.token != "" {
		req.Header.Set(gatewayAuthHeader, "Bearer "+opts.token)
	}
	if opts.origin != "" {
		req.Header.Set("Origin", opts.origin)
	}
	if opts.projectKey != "" {
		req.Header.Set(gatewayProjectKeyHeader, opts.projectKey)
	}
	if opts.host != "" {
		req.Host = opts.host
	}

	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("post MCP request: %v", err)
	}
	raw, err := ioReadAllAndClose(resp)
	if err != nil {
		t.Fatalf("read response: %v", err)
	}
	return resp, raw
}

func ioReadAllAndClose(resp *http.Response) ([]byte, error) {
	defer resp.Body.Close()
	return io.ReadAll(resp.Body)
}

func mustURLPort(t *testing.T, endpoint string) string {
	t.Helper()
	u, err := url.Parse(endpoint)
	if err != nil {
		t.Fatalf("parse endpoint: %v", err)
	}
	_, port, err := net.SplitHostPort(u.Host)
	if err != nil {
		t.Fatalf("split endpoint host: %v", err)
	}
	return port
}
