// Package proxy — shared HTTP client for memory server and Context Box proxying.
// Port of the HTTP proxy infrastructure from mcp-server/src/tools/memory.ts
package proxy

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"
)

// ---- Configuration ----

const (
	defaultHost          = "127.0.0.1"
	defaultPort          = "37888"
	healthTimeout        = 2500 * time.Millisecond
	startupHealthTimeout = 5 * time.Second
	healthRetries        = 10
	healthRetryDelay     = 150 * time.Millisecond
	healthCacheDuration  = 5 * time.Second
	apiTimeout           = 30 * time.Second
)

var healthProbePaths = []string{"/health/ready", "/health", "/v1/health"}

// ---- Singleton client ----

var client = &http.Client{
	Timeout: apiTimeout,
}

// ---- Health cache ----

var (
	healthMu        sync.Mutex
	healthOK        bool
	healthChecked   time.Time
	startDaemonFunc = startDaemon
)

// ---- URL resolution ----

// GetBaseURL returns the memory server base URL.
// Priority: HARNESS_MEM_REMOTE_URL > http://{host}:{port}
func GetBaseURL() string {
	if remote := os.Getenv("HARNESS_MEM_REMOTE_URL"); remote != "" {
		return strings.TrimRight(remote, "/")
	}
	host := os.Getenv("HARNESS_MEM_HOST")
	if host == "" {
		host = defaultHost
	}
	port := os.Getenv("HARNESS_MEM_PORT")
	if port == "" {
		port = defaultPort
	}
	return fmt.Sprintf("http://%s:%s", host, port)
}

// IsRemoteMode returns true if connecting to a remote memory server.
func IsRemoteMode() bool {
	return os.Getenv("HARNESS_MEM_REMOTE_URL") != ""
}

// GetCBBaseURL returns the Context Box base URL.
func GetCBBaseURL() string {
	return strings.TrimRight(os.Getenv("CONTEXT_BOX_URL"), "/")
}

// ---- Health check ----

// CheckHealth probes the memory server /health endpoint.
// Uses a cached result within healthCacheDuration.
func CheckHealth() bool {
	healthMu.Lock()
	if time.Since(healthChecked) < healthCacheDuration {
		ok := healthOK
		healthMu.Unlock()
		return ok
	}
	healthMu.Unlock()

	ok := probeHealth()

	healthMu.Lock()
	healthOK = ok
	healthChecked = time.Now()
	healthMu.Unlock()

	return ok
}

func probeHealth() bool {
	return probeHealthWithTimeout(getDurationEnv("HARNESS_MEM_HEALTH_TIMEOUT_MS", healthTimeout))
}

func probeHealthWithTimeout(timeout time.Duration) bool {
	for _, path := range healthProbePaths {
		url := GetBaseURL() + path
		ctx, cancel := context.WithTimeout(context.Background(), timeout)
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
		if err != nil {
			cancel()
			continue
		}
		resp, err := client.Do(req)
		cancel()
		if err != nil {
			continue
		}
		_ = resp.Body.Close()
		if resp.StatusCode == http.StatusOK {
			return true
		}
	}
	return false
}

func getDurationEnv(name string, fallback time.Duration) time.Duration {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return fallback
	}
	value, err := time.ParseDuration(raw)
	if err == nil && value > 0 {
		return value
	}
	ms, err := strconv.Atoi(raw)
	if err == nil && ms > 0 {
		return time.Duration(ms) * time.Millisecond
	}
	return fallback
}

// EnsureDaemon checks health and starts the daemon if not running (local mode only).
// Retries up to healthRetries times with healthRetryDelay between attempts.
func EnsureDaemon() error {
	if IsRemoteMode() {
		if !CheckHealth() {
			return fmt.Errorf("remote memory server at %s is not reachable", GetBaseURL())
		}
		return nil
	}

	if CheckHealth() {
		return nil
	}

	if probeHealthWithTimeout(getDurationEnv("HARNESS_MEM_STARTUP_HEALTH_TIMEOUT_MS", startupHealthTimeout)) {
		healthMu.Lock()
		healthOK = true
		healthChecked = time.Now()
		healthMu.Unlock()
		return nil
	}

	// Try starting the daemon
	if err := startDaemonFunc(); err != nil {
		if probeHealthWithTimeout(getDurationEnv("HARNESS_MEM_STARTUP_HEALTH_TIMEOUT_MS", startupHealthTimeout)) {
			healthMu.Lock()
			healthOK = true
			healthChecked = time.Now()
			healthMu.Unlock()
			return nil
		}
		return fmt.Errorf("failed to start daemon and existing daemon health is unreachable at %s: %w", GetBaseURL(), err)
	}

	// Wait for health with retries
	for i := range healthRetries {
		time.Sleep(healthRetryDelay)
		if probeHealth() {
			healthMu.Lock()
			healthOK = true
			healthChecked = time.Now()
			healthMu.Unlock()
			return nil
		}
		_ = i
	}

	return fmt.Errorf("daemon started but health check failed after %d retries", healthRetries)
}

func startDaemon() error {
	// Find harness-memd script relative to this binary or via known paths
	scriptPaths := []string{
		// Relative to plugin root (typical plugin layout)
		findPluginRoot() + "/scripts/harness-memd",
	}

	for _, p := range scriptPaths {
		if _, err := os.Stat(p); err == nil {
			cmd := exec.Command("bash", p, "start")
			cmd.Stdout = os.Stderr
			cmd.Stderr = os.Stderr
			return cmd.Run()
		}
	}

	// Fallback: try PATH
	cmd := exec.Command("harness-memd", "start")
	cmd.Stdout = os.Stderr
	cmd.Stderr = os.Stderr
	return cmd.Run()
}

func findPluginRoot() string {
	if root := os.Getenv("CLAUDE_PLUGIN_ROOT"); root != "" {
		return root
	}
	// Fallback: assume binary is in mcp-server-go/ under plugin root
	exe, err := os.Executable()
	if err != nil {
		return "."
	}
	// exe might be in bin/ or mcp-server-go/
	dir := strings.TrimSuffix(exe, "/"+lastSegment(exe))
	parent := strings.TrimSuffix(dir, "/"+lastSegment(dir))
	return parent
}

func lastSegment(path string) string {
	parts := strings.Split(path, "/")
	if len(parts) == 0 {
		return ""
	}
	return parts[len(parts)-1]
}

// ---- API Call ----

// APIResponse wraps a raw HTTP response body parsed as JSON.
type APIResponse struct {
	StatusCode int
	Body       map[string]any
	RawBody    []byte
}

// CallMemoryAPI makes an HTTP request to the memory server.
// method: GET or POST
// path: e.g. "/v1/search"
// body: request body (nil for GET)
func CallMemoryAPI(method, path string, body any) (*APIResponse, error) {
	return CallMemoryAPIWithContext(context.Background(), method, path, body)
}

// CallMemoryAPIWithContext makes an HTTP request to the memory server and
// carries request-scoped metadata from the context into outbound headers.
func CallMemoryAPIWithContext(ctx context.Context, method, path string, body any) (*APIResponse, error) {
	return callAPI(ctx, GetBaseURL(), BuildAPIHeadersWithContext(ctx), method, path, body)
}

// CallCBAPI makes an HTTP request to the Context Box API.
func CallCBAPI(method, path string, body any) (*APIResponse, error) {
	baseURL := GetCBBaseURL()
	if baseURL == "" {
		return nil, fmt.Errorf("CONTEXT_BOX_URL is not configured")
	}
	return callAPI(context.Background(), baseURL, BuildCBHeaders(), method, path, body)
}

func callAPI(ctx context.Context, baseURL string, headers map[string]string, method, path string, body any) (*APIResponse, error) {
	url := baseURL + path

	var bodyReader io.Reader
	if body != nil {
		b, err := json.Marshal(body)
		if err != nil {
			return nil, fmt.Errorf("failed to marshal request body: %w", err)
		}
		bodyReader = bytes.NewReader(b)
	}

	if ctx == nil {
		ctx = context.Background()
	}
	req, err := http.NewRequestWithContext(ctx, method, url, bodyReader)
	if err != nil {
		return nil, fmt.Errorf("failed to create request: %w", err)
	}

	for k, v := range headers {
		req.Header.Set(k, v)
	}

	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("failed to read response: %w", err)
	}

	result := &APIResponse{
		StatusCode: resp.StatusCode,
		RawBody:    raw,
	}

	// Try to parse as JSON
	var parsed map[string]any
	if err := json.Unmarshal(raw, &parsed); err == nil {
		result.Body = parsed
	}

	return result, nil
}
