package server

import (
	"bytes"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"reflect"
	"sort"
	"strings"
	"testing"

	"github.com/mark3labs/mcp-go/mcp"
	mcpserver "github.com/mark3labs/mcp-go/server"
)

func TestNewServerRegistersToolNamesFromSingleSource(t *testing.T) {
	t.Setenv("HARNESS_MEM_TOOLS", "all")

	got := serverToolNames(NewServer())
	want := registeredToolNames()

	assertSameNames(t, got, want)
	if len(got) == 0 {
		t.Fatal("expected all tool visibility to register tools")
	}
}

func TestNewServerRespectsCoreVisibility(t *testing.T) {
	t.Setenv("HARNESS_MEM_TOOLS", "core")

	got := serverToolNames(NewServer())
	want := registeredToolNames()

	assertSameNames(t, got, want)
	if len(got) != 7 {
		t.Fatalf("expected core visibility to expose 7 tools, got %d (%v)", len(got), got)
	}
}

func TestStreamableHTTPConstructorExposesSameToolsAsConfiguredServer(t *testing.T) {
	for _, visibility := range []string{"all", "core"} {
		t.Run(visibility, func(t *testing.T) {
			t.Setenv("HARNESS_MEM_TOOLS", visibility)

			httpServer := NewStreamableHTTPServer(mcpserver.WithStateLess(true))
			testServer := httptest.NewServer(httpServer)
			defer testServer.Close()

			got := listHTTPToolNames(t, testServer.URL)
			want := serverToolNames(NewServer())

			assertSameNames(t, got, want)
		})
	}
}

func TestTransportMCPServerFactoriesShareConfiguredToolSource(t *testing.T) {
	for _, visibility := range []string{"all", "core"} {
		t.Run(visibility, func(t *testing.T) {
			t.Setenv("HARNESS_MEM_TOOLS", visibility)

			want := registeredToolNames()
			stdioNames := serverToolNames(newStdioMCPServer())
			httpNames := serverToolNames(newStreamableHTTPMCPServer())

			assertSameNames(t, stdioNames, want)
			assertSameNames(t, httpNames, want)
			assertSameNames(t, stdioNames, httpNames)
		})
	}
}

func TestResolveTransportConfigFromEnvDefaultsToStdio(t *testing.T) {
	t.Setenv("HARNESS_MEM_MCP_TRANSPORT", "")
	t.Setenv("HARNESS_MEM_MCP_TOKEN", "")
	t.Setenv("HARNESS_MEM_REMOTE_TOKEN", "")

	cfg, err := ResolveTransportConfigFromEnv()
	if err != nil {
		t.Fatalf("ResolveTransportConfigFromEnv returned error: %v", err)
	}

	if cfg.Transport != transportStdio {
		t.Fatalf("transport = %q, want %q", cfg.Transport, transportStdio)
	}
	if cfg.Addr != defaultStreamableHTTPAddr {
		t.Fatalf("addr = %q, want %q", cfg.Addr, defaultStreamableHTTPAddr)
	}
	if cfg.Endpoint != defaultStreamableHTTPEndpoint {
		t.Fatalf("endpoint = %q, want %q", cfg.Endpoint, defaultStreamableHTTPEndpoint)
	}
}

func TestResolveTransportConfigFromEnvHTTPAndAddrOverride(t *testing.T) {
	t.Setenv("HARNESS_MEM_MCP_TRANSPORT", "http")
	t.Setenv("HARNESS_MEM_MCP_ADDR", "127.0.0.1:45678")
	t.Setenv("HARNESS_MEM_MCP_TOKEN", "gateway-secret")

	cfg, err := ResolveTransportConfigFromEnv()
	if err != nil {
		t.Fatalf("ResolveTransportConfigFromEnv returned error: %v", err)
	}

	if cfg.Transport != transportStreamableHTTP {
		t.Fatalf("transport = %q, want %q", cfg.Transport, transportStreamableHTTP)
	}
	if cfg.Addr != "127.0.0.1:45678" {
		t.Fatalf("addr = %q", cfg.Addr)
	}
	if cfg.Endpoint != defaultStreamableHTTPEndpoint {
		t.Fatalf("endpoint = %q, want %q", cfg.Endpoint, defaultStreamableHTTPEndpoint)
	}
}

func TestResolveTransportConfigFromEnvAcceptsStreamableHTTPAlias(t *testing.T) {
	t.Setenv("HARNESS_MEM_MCP_TRANSPORT", "streamable_http")
	t.Setenv("HARNESS_MEM_MCP_TOKEN", "gateway-secret")

	cfg, err := ResolveTransportConfigFromEnv()
	if err != nil {
		t.Fatalf("ResolveTransportConfigFromEnv returned error: %v", err)
	}
	if cfg.Transport != transportStreamableHTTP {
		t.Fatalf("transport = %q, want %q", cfg.Transport, transportStreamableHTTP)
	}
}

func TestResolveTransportConfigFromEnvHTTPRequiresToken(t *testing.T) {
	t.Setenv("HARNESS_MEM_MCP_TRANSPORT", "http")
	t.Setenv("HARNESS_MEM_MCP_TOKEN", "")
	t.Setenv("HARNESS_MEM_REMOTE_TOKEN", "")

	_, err := ResolveTransportConfigFromEnv()
	if err == nil {
		t.Fatal("expected missing token error")
	}
	if !strings.Contains(err.Error(), "HARNESS_MEM_MCP_TOKEN") {
		t.Fatalf("missing token error = %q", err.Error())
	}
}

func TestResolveTransportConfigFromEnvRejectsInvalidTransport(t *testing.T) {
	t.Setenv("HARNESS_MEM_MCP_TRANSPORT", "websocket")

	_, err := ResolveTransportConfigFromEnv()
	if err == nil {
		t.Fatal("expected invalid transport error")
	}
	msg := err.Error()
	if !strings.Contains(msg, "HARNESS_MEM_MCP_TRANSPORT") || !strings.Contains(msg, "websocket") {
		t.Fatalf("invalid transport error = %q", msg)
	}
}

func TestRunTransportDefaultUsesStdio(t *testing.T) {
	var called string
	err := runTransport(TransportConfig{Transport: transportStdio}, transportRunner{
		runStdio: func() error {
			called = transportStdio
			return nil
		},
		runStreamableHTTP: func(addr string) error {
			t.Fatalf("RunStreamableHTTP called unexpectedly with %s", addr)
			return nil
		},
	})
	if err != nil {
		t.Fatalf("runTransport returned error: %v", err)
	}
	if called != transportStdio {
		t.Fatalf("called = %q, want %q", called, transportStdio)
	}
}

func TestRunTransportHTTPUsesAddrAndWritesEndpoint(t *testing.T) {
	var calledAddr string
	var stderr bytes.Buffer

	err := runTransport(TransportConfig{
		Transport: transportStreamableHTTP,
		Addr:      "127.0.0.1:45678",
		Endpoint:  defaultStreamableHTTPEndpoint,
	}, transportRunner{
		stderr: &stderr,
		runStdio: func() error {
			t.Fatal("RunStdio called unexpectedly")
			return nil
		},
		runStreamableHTTP: func(addr string) error {
			calledAddr = addr
			return nil
		},
	})
	if err != nil {
		t.Fatalf("runTransport returned error: %v", err)
	}
	if calledAddr != "127.0.0.1:45678" {
		t.Fatalf("called addr = %q", calledAddr)
	}
	got := stderr.String()
	if !strings.Contains(got, "transport=streamable_http") || !strings.Contains(got, "http://127.0.0.1:45678/mcp") {
		t.Fatalf("stderr = %q", got)
	}
}

func TestStreamableHTTPMCPIntegrationInitializeToolsListAndHealth(t *testing.T) {
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

	mux := http.NewServeMux()
	mux.Handle(defaultStreamableHTTPEndpoint, NewStreamableHTTPServer())
	httpSrv := httptest.NewServer(mux)
	defer httpSrv.Close()

	endpoint := httpSrv.URL + defaultStreamableHTTPEndpoint
	sessionID := initializeHTTPMCP(t, httpSrv.Client(), endpoint)
	names := listHTTPToolNamesWithSession(t, httpSrv.Client(), endpoint, sessionID)
	if !stringSliceContains(names, "harness_mem_health") {
		t.Fatalf("expected harness_mem_health in tools/list, got %v", names)
	}

	result := callHTTPTool(t, httpSrv.Client(), endpoint, sessionID, "harness_mem_health")
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

func TestRunStreamableHTTPPortConflictReturnsClearError(t *testing.T) {
	t.Setenv("HARNESS_MEM_MCP_TOKEN", "gateway-secret")

	ln, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("listen: %v", err)
	}
	defer ln.Close()

	addr := ln.Addr().String()
	err = RunStreamableHTTP(addr)
	if err == nil {
		t.Fatal("expected port conflict error")
	}
	msg := err.Error()
	if !strings.Contains(msg, addr) || !strings.Contains(msg, "already in use or cannot bind") || !strings.Contains(msg, "bind") {
		t.Fatalf("port conflict error = %q", msg)
	}
}

func TestRunStreamableHTTPRequiresTokenBeforeListen(t *testing.T) {
	t.Setenv("HARNESS_MEM_MCP_TOKEN", "")
	t.Setenv("HARNESS_MEM_REMOTE_TOKEN", "")

	err := RunStreamableHTTP(defaultStreamableHTTPAddr)
	if err == nil {
		t.Fatal("expected missing token error")
	}
	if !strings.Contains(err.Error(), "HARNESS_MEM_MCP_TOKEN") {
		t.Fatalf("missing token error = %q", err.Error())
	}
}

func listHTTPToolNames(t *testing.T, endpoint string) []string {
	t.Helper()

	body := bytes.NewBufferString(`{"jsonrpc":"2.0","id":1,"method":"tools/list"}`)
	req, err := http.NewRequest(http.MethodPost, endpoint, body)
	if err != nil {
		t.Fatalf("create tools/list request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("post tools/list request: %v", err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read tools/list response: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("tools/list status = %d, body = %s", resp.StatusCode, string(raw))
	}

	var decoded struct {
		Result struct {
			Tools []struct {
				Name string `json:"name"`
			} `json:"tools"`
		} `json:"result"`
		Error any `json:"error"`
	}
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("decode tools/list response %q: %v", string(raw), err)
	}
	if decoded.Error != nil {
		t.Fatalf("tools/list returned error: %#v", decoded.Error)
	}

	names := make([]string, 0, len(decoded.Result.Tools))
	for _, tool := range decoded.Result.Tools {
		names = append(names, tool.Name)
	}
	sort.Strings(names)
	return names
}

func initializeHTTPMCP(t *testing.T, client *http.Client, endpoint string) string {
	t.Helper()

	resp := postHTTPMCP(t, client, endpoint, "", map[string]any{
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
	})
	if resp.Result.ProtocolVersion != mcp.LATEST_PROTOCOL_VERSION {
		t.Fatalf("protocolVersion = %q, want %q", resp.Result.ProtocolVersion, mcp.LATEST_PROTOCOL_VERSION)
	}
	sessionID := resp.Header.Get(mcpserver.HeaderKeySessionID)
	if sessionID == "" {
		t.Fatal("initialize did not return an MCP session id")
	}
	return sessionID
}

func listHTTPToolNamesWithSession(t *testing.T, client *http.Client, endpoint, sessionID string) []string {
	t.Helper()

	resp := postHTTPMCP(t, client, endpoint, sessionID, map[string]any{
		"jsonrpc": "2.0",
		"id":      2,
		"method":  "tools/list",
	})
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

func callHTTPTool(t *testing.T, client *http.Client, endpoint, sessionID, name string) httpMCPResponse {
	t.Helper()

	return postHTTPMCP(t, client, endpoint, sessionID, map[string]any{
		"jsonrpc": "2.0",
		"id":      3,
		"method":  "tools/call",
		"params": map[string]any{
			"name":      name,
			"arguments": map[string]any{},
		},
	})
}

func postHTTPMCP(t *testing.T, client *http.Client, endpoint, sessionID string, body any) httpMCPResponse {
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

	resp, err := client.Do(req)
	if err != nil {
		t.Fatalf("post MCP request: %v", err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read response: %v", err)
	}
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

type httpMCPResponse struct {
	Header http.Header       `json:"-"`
	ID     int               `json:"id"`
	Result httpMCPResult     `json:"result"`
	Error  *mcp.JSONRPCError `json:"error"`
}

type httpMCPResult struct {
	ProtocolVersion string `json:"protocolVersion"`
	Tools           []struct {
		Name string `json:"name"`
	} `json:"tools"`
	Content []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	} `json:"content"`
	IsError bool `json:"isError"`
}

func stringSliceContains(values []string, needle string) bool {
	for _, value := range values {
		if value == needle {
			return true
		}
	}
	return false
}

func assertSameNames(t *testing.T, got, want []string) {
	t.Helper()

	if !reflect.DeepEqual(got, want) {
		t.Fatalf("tool names mismatch\n got: %v\nwant: %v", got, want)
	}
}
