// Context Box tools tests — S75-012
package tools

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

// sharedCBState is a mutex-protected handler for the shared CB mock server.
type sharedCBState struct {
	mu      sync.Mutex
	handler http.HandlerFunc
}

func (s *sharedCBState) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.mu.Lock()
	h := s.handler
	s.mu.Unlock()
	h(w, r)
}

func (s *sharedCBState) set(h http.HandlerFunc) {
	s.mu.Lock()
	s.handler = h
	s.mu.Unlock()
}

var (
	cbState      = &sharedCBState{}
	sharedCBOnce sync.Once
	sharedCBSrv  *httptest.Server
)

// setupSharedCBServer initialises a single shared httptest.Server for Context
// Box tests and sets CONTEXT_BOX_URL to point at it.
func setupSharedCBServer(t *testing.T, handler http.HandlerFunc) {
	t.Helper()

	sharedCBOnce.Do(func() {
		cbState.set(func(w http.ResponseWriter, r *http.Request) {
			w.WriteHeader(http.StatusOK)
		})
		sharedCBSrv = httptest.NewServer(cbState)
	})

	cbState.set(handler)
	t.Setenv("CONTEXT_BOX_URL", sharedCBSrv.URL)
	// Clear workspace env so individual tests control it.
	t.Setenv("CONTEXT_BOX_WORKSPACE_ID", "")
}

// writeCBJSON writes a 200 JSON response for CB handlers.
func writeCBJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	b, _ := json.Marshal(v)
	_, _ = w.Write(b)
}

// ---- Tests ----

// TestHandleCBRecall verifies handleCBRecall proxies the query and returns a
// success result.
func TestHandleCBRecall(t *testing.T) {
	setupSharedCBServer(t, func(w http.ResponseWriter, r *http.Request) {
		writeCBJSON(w, map[string]any{
			"ok":    true,
			"items": []any{map[string]any{"id": "doc-1", "text": "hello"}},
		})
	})

	result := handleCBRecall(map[string]any{
		"query":        "some query",
		"workspace_id": "ws-test",
	})

	if result.IsError {
		t.Fatalf("expected success, got error: %+v", result)
	}
	body, ok := result.StructuredContent.(map[string]any)
	if !ok {
		t.Fatalf("StructuredContent type %T, want map[string]any", result.StructuredContent)
	}
	if body["ok"] != true {
		t.Errorf("ok = %v, want true", body["ok"])
	}
}

// TestHandleCBSearch_MissingWorkspace verifies handleCBSearch returns an error
// when no workspace_id is provided and CONTEXT_BOX_WORKSPACE_ID is unset.
func TestHandleCBSearch_MissingWorkspace(t *testing.T) {
	setupSharedCBServer(t, func(w http.ResponseWriter, r *http.Request) {
		// Should not be reached.
		w.WriteHeader(http.StatusOK)
	})
	// Ensure env is empty (already set by setupSharedCBServer).

	result := handleCBSearch(map[string]any{
		"query": "search query",
		// workspace_id omitted
	})

	if !result.IsError {
		t.Fatal("expected error for missing workspace_id, got success")
	}
	if !strings.Contains(result.Content[0].Text, "workspace_id is required") {
		t.Errorf("error text = %q, want to contain 'workspace_id is required'", result.Content[0].Text)
	}
}

// TestHandleCBSearch_Valid verifies handleCBSearch with a valid query and
// workspace_id proxies successfully.
func TestHandleCBSearch_Valid(t *testing.T) {
	var receivedBody map[string]any
	setupSharedCBServer(t, func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&receivedBody)
		writeCBJSON(w, map[string]any{
			"ok":      true,
			"results": []any{map[string]any{"text": "result1", "score": 0.9}},
		})
	})

	result := handleCBSearch(map[string]any{
		"query":        "my search",
		"workspace_id": "ws-abc",
	})

	if result.IsError {
		t.Fatalf("expected success, got error: %+v", result)
	}
	if receivedBody == nil {
		t.Fatal("request body was not captured")
	}
	if receivedBody["workspaceId"] != "ws-abc" {
		t.Errorf("workspaceId = %v, want ws-abc", receivedBody["workspaceId"])
	}
	if receivedBody["query"] != "my search" {
		t.Errorf("query = %v, want 'my search'", receivedBody["query"])
	}
}

// TestHandleCBTrace verifies handleCBTrace proxies document_id successfully.
func TestHandleCBTrace(t *testing.T) {
	var receivedBody map[string]any
	setupSharedCBServer(t, func(w http.ResponseWriter, r *http.Request) {
		_ = json.NewDecoder(r.Body).Decode(&receivedBody)
		writeCBJSON(w, map[string]any{
			"ok":      true,
			"content": "full document text",
		})
	})

	result := handleCBTrace(map[string]any{
		"document_id": "doc-uuid-123",
	})

	if result.IsError {
		t.Fatalf("expected success, got error: %+v", result)
	}
	if receivedBody == nil {
		t.Fatal("request body was not captured")
	}
	if receivedBody["documentId"] != "doc-uuid-123" {
		t.Errorf("documentId = %v, want doc-uuid-123", receivedBody["documentId"])
	}
}

// TestHandleCBStatus_Connected verifies handleCBStatus returns status=connected
// when the mock server returns 200.
//
// handleCBStatus sets result["status"] = "connected" first, then merges
// resp.Body fields on top. To avoid the mock overwriting "status", the mock
// must NOT include a "status" key of its own.
func TestHandleCBStatus_Connected(t *testing.T) {
	setupSharedCBServer(t, func(w http.ResponseWriter, r *http.Request) {
		writeCBJSON(w, map[string]any{
			"ok": true,
		})
	})

	result := handleCBStatus(map[string]any{})

	if result.IsError {
		t.Fatalf("expected success, got error: %+v", result)
	}
	body, ok := result.StructuredContent.(map[string]any)
	if !ok {
		t.Fatalf("StructuredContent type %T, want map[string]any", result.StructuredContent)
	}
	if body["status"] != "connected" {
		t.Errorf("status = %v, want connected", body["status"])
	}
}
