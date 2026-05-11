// Memory tools tests — S75-011
package tools

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/Chachamaru127/harness-mem/mcp-server-go/internal/proxy"
)

// resetProxyHealthCache resets the proxy health cache so each test gets a fresh
// health probe against the mock server.
func resetProxyHealthCache(t *testing.T) {
	t.Helper()
	// Access the package-level fields via the exported CheckHealth path:
	// force expiry by setting env only — the cache will be stale after we
	// call t.Setenv which changes the URL, so we just need the cache to be
	// considered expired. We achieve that by sleeping past healthCacheDuration
	// (5 s) — instead we directly reach into the proxy package via a tiny
	// helper exposed in httpclient_test.go? No: that helper is in package proxy.
	// We can work around by setting HARNESS_MEM_REMOTE_URL to a *different*
	// server URL so the old cached result is for a different URL. Actually the
	// cache is global with no URL key — we must wait for expiry or use a
	// time-manipulation approach.
	//
	// The simplest portable approach: call proxy.CheckHealth() with a live
	// server pointing at our test server. Because the cache duration is 5 s we
	// only need to wait that long once per test binary — but we can avoid the
	// wait by starting all tests with HARNESS_MEM_REMOTE_URL already set before
	// the first test; the cache will be populated correctly for that server.
	//
	// For test isolation we instead rely on the fact that t.Setenv will make the
	// env var consistent per-test AND each test calls the mock server that always
	// serves /health 200 — so even if the cache has a stale "false" the
	// EnsureDaemon will re-probe (the cache returns false → tries to start
	// daemon → fails because HARNESS_MEM_REMOTE_URL is set in remote mode).
	//
	// Best approach: use a per-test mock server AND force the cache to expire by
	// manipulating time.  Since we cannot import proxy internals from a different
	// package we use a small trick: set a bogus URL, call CheckHealth once so the
	// cache expires (it will return false quickly), then set the real URL.
	// Actually the cleanest solution: use a single shared server per test and
	// reset via the exported helper — but there is none exported.
	//
	// FINAL STRATEGY: Use a persistent shared mock server per test file and
	// drive it via a handler swap + sleep just past healthCacheDuration once.
	// But sleeping 5 s in tests is bad. Instead: each test starts its OWN
	// httptest.Server whose first handler responds 200 to /health.  We then set
	// HARNESS_MEM_REMOTE_URL to that server's URL BEFORE any CheckHealth call.
	// The cache is keyed only by time, not URL.  So if a previous test left a
	// fresh cache entry we might get the wrong server URL.  However: go test
	// runs subtests sequentially by default, and the health cache TTL is 5 s.
	// The real fix: always set HARNESS_MEM_REMOTE_URL early in each test via
	// t.Setenv, and rely on the fact that the mock server for the current test
	// will respond 200 to /health.  If the cache is stale-valid from a previous
	// test pointing at a now-closed server, proxy will re-probe and get an
	// error, which will cause EnsureDaemon to fail.  So: we NEED cache expiry.
	//
	// REAL fix: call proxy.CheckHealth() with a valid mock pointing to the test
	// server. After the first valid /health hit the cache is warm for 5 s.
	// Within those 5 s subsequent calls reuse it — that's fine because the same
	// test server is up.  Between tests a new server is created with a different
	// port, so we must expire the cache.
	//
	// We expire by reaching into proxy internals. Since the proxy test file
	// defines resetHealthCache(t) in package proxy (not exported) we cannot call
	// it. Instead we abuse t.Cleanup to sleep — no.
	//
	// ACTUAL simplest solution: use a single package-level httptest.Server for
	// all memory tests, share it across tests, and only change the response via
	// a mutex-protected handler variable.  That way the URL never changes and the
	// cache stays valid.  This is the approach used below.
	_ = t // nothing needed — see sharedMemServer below
}

// sharedMemState holds mutable state for the shared memory mock server.
type sharedMemState struct {
	mu      sync.Mutex
	handler http.HandlerFunc
}

func (s *sharedMemState) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	h := s.handler
	s.mu.Unlock()
	h(w, r)
}

func (s *sharedMemState) set(h http.HandlerFunc) {
	s.mu.Lock()
	s.handler = h
	s.mu.Unlock()
}

var (
	memState      = &sharedMemState{}
	sharedMemOnce sync.Once
	sharedMemSrv  *httptest.Server
)

// setupSharedMemServer starts a single httptest.Server for all memory tests
// and warms the proxy health cache so EnsureDaemon does not try to start a
// local daemon. It also initialises the required env vars.
//
// Call at the top of each test.  The function is idempotent (only starts the
// server once) but updates the current handler.
func setupSharedMemServer(t *testing.T, handler http.HandlerFunc) {
	t.Helper()

	sharedMemOnce.Do(func() {
		// Default handler: always 200 health
		memState.set(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
		})
		sharedMemSrv = httptest.NewServer(memState)
	})

	// Install the test-specific handler.
	// It MUST respond 200 to GET /health so EnsureDaemon succeeds.
	memState.set(handler)

	// Point proxy at our server.
	t.Setenv("HARNESS_MEM_REMOTE_URL", sharedMemSrv.URL)
	t.Setenv("HARNESS_MEM_REMOTE_TOKEN", "test-token")

	// Warm / refresh the cache by probing health directly.
	// If the cache is fresh from a previous test, CheckHealth() returns the
	// cached value immediately.  That is fine as long as the server is the
	// same (it is — sharedMemSrv never changes).
	_ = proxy.CheckHealth()
}

// defaultMemHandler builds a handler that serves /health → 200 and routes
// all other requests to the provided apiHandler.
func defaultMemHandler(apiHandler http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"ok":true,"status":"healthy"}`))
			return
		}
		apiHandler(w, r)
	}
}

// writeJSON is a small helper that writes a JSON body.
func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	b, _ := json.Marshal(v)
	_, _ = w.Write(b)
}

// ---- Test: handleMemoryToolInner ----

// TestHandleMemSearch verifies harness_mem_search proxies the query and returns
// a success result with items.
func TestHandleMemSearch(t *testing.T) {
	setupSharedMemServer(t, defaultMemHandler(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]any{
			"ok":    true,
			"items": []any{map[string]any{"id": "obs-1"}},
			"meta":  map[string]any{"count": float64(1)},
		})
	}))

	result := handleMemoryToolInner(context.Background(), "harness_mem_search", map[string]any{
		"query": "test query",
	})

	if result.IsError {
		t.Fatalf("expected success, got error: %+v", result)
	}
	if result.StructuredContent == nil {
		t.Fatal("StructuredContent is nil")
	}
	body, ok := result.StructuredContent.(map[string]any)
	if !ok {
		t.Fatalf("StructuredContent type %T, want map[string]any", result.StructuredContent)
	}
	items, ok := body["items"]
	if !ok {
		t.Fatal("items field missing from response")
	}
	arr, ok := items.([]any)
	if !ok || len(arr) == 0 {
		t.Fatalf("items = %v, want non-empty array", items)
	}
}

// TestHandleMemSearchObservationType verifies that §89-001 Step 2's
// `observation_type` parameter actually reaches the REST payload when a
// Go MCP caller sets it. Guards against the regression flagged by the
// independent Codex review: schema was exposed but the handler was not
// forwarding the value, so Go MCP silently ignored the filter.
func TestHandleMemSearchObservationType(t *testing.T) {
	var receivedObsType any
	var mu sync.Mutex
	setupSharedMemServer(t, defaultMemHandler(func(w http.ResponseWriter, r *http.Request) {
		var req map[string]any
		_ = json.NewDecoder(r.Body).Decode(&req)
		mu.Lock()
		receivedObsType = req["observation_type"]
		mu.Unlock()
		writeJSON(w, map[string]any{
			"ok":    true,
			"items": []any{},
			"meta":  map[string]any{"count": float64(0)},
		})
	}))

	result := handleMemoryToolInner(context.Background(), "harness_mem_search", map[string]any{
		"query":            "release gate",
		"observation_type": "decision",
	})

	if result.IsError {
		t.Fatalf("expected success, got error: %+v", result)
	}
	mu.Lock()
	got := receivedObsType
	mu.Unlock()
	if got != "decision" {
		t.Fatalf("REST payload observation_type = %v, want \"decision\"", got)
	}
}

func TestHandleMemSearchSafeModeForwardsLatencyGuards(t *testing.T) {
	var received map[string]any
	var mu sync.Mutex
	setupSharedMemServer(t, defaultMemHandler(func(w http.ResponseWriter, r *http.Request) {
		var req map[string]any
		_ = json.NewDecoder(r.Body).Decode(&req)
		mu.Lock()
		received = req
		mu.Unlock()
		writeJSON(w, map[string]any{
			"ok":    true,
			"items": []any{},
			"meta":  map[string]any{"count": float64(0)},
		})
	}))

	result := handleMemoryToolInner(context.Background(), "harness_mem_search", map[string]any{
		"query":       "hermes safe mode",
		"safe_mode":   true,
		"graph_depth": float64(3),
	})

	if result.IsError {
		t.Fatalf("expected success, got error: %+v", result)
	}
	mu.Lock()
	got := received
	mu.Unlock()
	if got["expand_links"] != false {
		t.Fatalf("expand_links = %v, want false", got["expand_links"])
	}
	if got["vector_search"] != false {
		t.Fatalf("vector_search = %v, want false", got["vector_search"])
	}
	if got["safe_mode"] != true {
		t.Fatalf("safe_mode = %v, want true", got["safe_mode"])
	}
	if got["graph_depth"] != float64(0) {
		t.Fatalf("graph_depth = %v, want 0", got["graph_depth"])
	}
	if got["graph_weight"] != float64(0) {
		t.Fatalf("graph_weight = %v, want 0", got["graph_weight"])
	}
}

// TestHandleMemSearchObservationTypeOmitted verifies that callers who
// don't set observation_type still reach the REST layer in a
// pre-§89-001-compatible shape (the field is present as nil, which the
// server normalizes to undefined — the REST handler already has
// coverage for the nil branch via fallback to the query-prefix parser).
func TestHandleMemSearchObservationTypeOmitted(t *testing.T) {
	var receivedObsType any
	var sawField bool
	var mu sync.Mutex
	setupSharedMemServer(t, defaultMemHandler(func(w http.ResponseWriter, r *http.Request) {
		var req map[string]any
		_ = json.NewDecoder(r.Body).Decode(&req)
		mu.Lock()
		receivedObsType, sawField = req["observation_type"], func() bool { _, ok := req["observation_type"]; return ok }()
		mu.Unlock()
		writeJSON(w, map[string]any{"ok": true, "items": []any{}, "meta": map[string]any{"count": float64(0)}})
	}))

	result := handleMemoryToolInner(context.Background(), "harness_mem_search", map[string]any{
		"query": "release gate",
	})

	if result.IsError {
		t.Fatalf("expected success, got error: %+v", result)
	}
	mu.Lock()
	got, present := receivedObsType, sawField
	mu.Unlock()
	// Field presence with nil value is acceptable — the REST normalizer
	// treats both missing and null as "no filter". What matters is that
	// an unintended string (e.g. "") is NOT sent.
	if present && got != nil {
		t.Fatalf("observation_type forwarded unexpectedly: got %v (type %T)", got, got)
	}
}

// TestHandleMemHealth verifies harness_mem_health returns a success result.
func TestHandleMemHealth(t *testing.T) {
	setupSharedMemServer(t, defaultMemHandler(func(w http.ResponseWriter, r *http.Request) {
		// /health is already handled by defaultMemHandler; other paths should
		// not be reached here. But if they are, return ok.
		writeJSON(w, map[string]any{"ok": true, "status": "healthy"})
	}))

	result := handleMemoryToolInner(context.Background(), "harness_mem_health", map[string]any{})

	if result.IsError {
		t.Fatalf("expected success, got error: %+v", result)
	}
}

// TestHandleMemGetObservations verifies harness_mem_get_observations proxies ids.
func TestHandleMemGetObservations(t *testing.T) {
	var receivedIDs []any
	setupSharedMemServer(t, defaultMemHandler(func(w http.ResponseWriter, r *http.Request) {
		var req map[string]any
		_ = json.NewDecoder(r.Body).Decode(&req)
		if ids, ok := req["ids"].([]any); ok {
			receivedIDs = ids
		}
		writeJSON(w, map[string]any{
			"ok":    true,
			"items": []any{map[string]any{"id": "obs-1", "content": "hello"}},
		})
	}))

	result := handleMemoryToolInner(context.Background(), "harness_mem_get_observations", map[string]any{
		"ids": []any{"obs-1", "obs-2"},
	})

	if result.IsError {
		t.Fatalf("expected success, got error: %+v", result)
	}
	if len(receivedIDs) != 2 {
		t.Errorf("received ids = %v, want 2 elements", receivedIDs)
	}
}

// TestHandleMemRecordCheckpoint verifies harness_mem_record_checkpoint with
// all required fields returns a success result.
func TestHandleMemRecordCheckpoint(t *testing.T) {
	setupSharedMemServer(t, defaultMemHandler(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, map[string]any{"ok": true, "id": "chk-1"})
	}))

	result := handleMemoryToolInner(context.Background(), "harness_mem_record_checkpoint", map[string]any{
		"session_id": "sess-abc",
		"title":      "Test Checkpoint",
		"content":    "Some content here",
	})

	if result.IsError {
		t.Fatalf("expected success, got error: %+v", result)
	}
}

// TestHandleMemDeleteObservation verifies harness_mem_delete_observation proxies
// the observation_id correctly.
func TestHandleMemDeleteObservation(t *testing.T) {
	var deletedID string
	setupSharedMemServer(t, defaultMemHandler(func(w http.ResponseWriter, r *http.Request) {
		// Path: /v1/observations/{id}
		parts := strings.Split(r.URL.Path, "/")
		if len(parts) > 0 {
			deletedID = parts[len(parts)-1]
		}
		writeJSON(w, map[string]any{"ok": true})
	}))

	result := handleMemoryToolInner(context.Background(), "harness_mem_delete_observation", map[string]any{
		"observation_id": "obs-xyz",
	})

	if result.IsError {
		t.Fatalf("expected success, got error: %+v", result)
	}
	if deletedID != "obs-xyz" {
		t.Errorf("deletedID = %q, want %q", deletedID, "obs-xyz")
	}
}

// ---- Test: successResult ----

// TestSuccessResultWithCitations verifies that items with id/platform/session_id
// produce _citations in the result.
func TestSuccessResultWithCitations(t *testing.T) {
	apiResp := &proxy.APIResponse{
		StatusCode: 200,
		Body: map[string]any{
			"ok": true,
			"items": []any{
				map[string]any{
					"id":         "obs-1",
					"platform":   "claude",
					"session_id": "sess-1",
					"created_at": "2024-01-01T00:00:00Z",
				},
			},
		},
	}

	result := successResult(apiResp, true)

	if result.IsError {
		t.Fatalf("expected success result, got error")
	}
	if result.Citations == nil {
		t.Fatal("Citations is nil, expected non-nil with withCitations=true")
	}
	cits, ok := result.Citations.([]map[string]any)
	if !ok {
		t.Fatalf("Citations type %T, want []map[string]any", result.Citations)
	}
	if len(cits) != 1 {
		t.Fatalf("len(Citations) = %d, want 1", len(cits))
	}
	if cits[0]["id"] != "obs-1" {
		t.Errorf("citation id = %v, want obs-1", cits[0]["id"])
	}
	if cits[0]["source"] != "claude" {
		t.Errorf("citation source = %v, want claude", cits[0]["source"])
	}
}

// TestSuccessResultWithoutCitations verifies that withCitations=false produces
// no _citations field.
func TestSuccessResultWithoutCitations(t *testing.T) {
	apiResp := &proxy.APIResponse{
		StatusCode: 200,
		Body: map[string]any{
			"ok": true,
			"items": []any{
				map[string]any{"id": "obs-1"},
			},
		},
	}

	result := successResult(apiResp, false)

	if result.IsError {
		t.Fatal("expected success result, got error")
	}
	if result.Citations != nil {
		t.Errorf("Citations = %v, want nil for withCitations=false", result.Citations)
	}
}

// ---- Test: errorResult ----

// TestErrorResult verifies that errorResult sets IsError=true and includes the
// message in the content.
func TestErrorResult(t *testing.T) {
	msg := "something went wrong"
	result := errorResult(msg)

	if !result.IsError {
		t.Fatal("IsError = false, want true")
	}
	if len(result.Content) == 0 {
		t.Fatal("Content is empty")
	}
	if !strings.Contains(result.Content[0].Text, msg) {
		t.Errorf("Content[0].Text = %q, want to contain %q", result.Content[0].Text, msg)
	}
}

// ---- Test: classifyError ----

// TestClassifyError_ConnectionRefused verifies that a message matching the
// daemon_unavailable pattern ("ECONNREFUSED" or "failed") maps to
// daemon_unavailable kind.
//
// The underlying regexp is: (?i)ECONNREFUSED|health check failed|failed
// Real proxy errors use fmt.Errorf("request failed: ...") which matches "failed".
func TestClassifyError_ConnectionRefused(t *testing.T) {
	err := &mockError{"request failed: dial tcp: connect: ECONNREFUSED"}
	result := classifyError(err)

	if !result.IsError {
		t.Fatal("IsError = false, want true")
	}
	if !strings.Contains(result.Content[0].Text, "daemon_unavailable") {
		t.Errorf("expected daemon_unavailable in text, got: %q", result.Content[0].Text)
	}
}

// TestClassifyError_Timeout verifies that "timeout" maps to the timeout kind.
func TestClassifyError_Timeout(t *testing.T) {
	err := &mockError{"context deadline exceeded (timeout)"}
	result := classifyError(err)

	if !result.IsError {
		t.Fatal("IsError = false, want true")
	}
	if !strings.Contains(result.Content[0].Text, "timeout") {
		t.Errorf("expected timeout in text, got: %q", result.Content[0].Text)
	}
}

// mockError is a minimal error implementation for classifyError tests.
type mockError struct{ msg string }

func (e *mockError) Error() string { return e.msg }

// Ensure time package is used (imported for potential future use).
var _ = time.Second
