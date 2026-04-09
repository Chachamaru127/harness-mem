package proxy

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// resetHealthCache resets the package-level health cache between tests.
func resetHealthCache(t *testing.T) {
	t.Helper()
	t.Cleanup(func() {
		healthMu.Lock()
		healthOK = false
		healthChecked = time.Time{}
		healthMu.Unlock()
	})
	healthMu.Lock()
	healthOK = false
	healthChecked = time.Time{}
	healthMu.Unlock()
}

// ---- GetBaseURL ----

func TestGetBaseURL_RemoteURL(t *testing.T) {
	t.Setenv("HARNESS_MEM_REMOTE_URL", "https://remote.example.com/")
	t.Setenv("HARNESS_MEM_HOST", "")
	t.Setenv("HARNESS_MEM_PORT", "")

	got := GetBaseURL()
	want := "https://remote.example.com"
	if got != want {
		t.Errorf("GetBaseURL() = %q, want %q", got, want)
	}
}

func TestGetBaseURL_HostAndPort(t *testing.T) {
	t.Setenv("HARNESS_MEM_REMOTE_URL", "")
	t.Setenv("HARNESS_MEM_HOST", "192.168.1.10")
	t.Setenv("HARNESS_MEM_PORT", "8080")

	got := GetBaseURL()
	want := "http://192.168.1.10:8080"
	if got != want {
		t.Errorf("GetBaseURL() = %q, want %q", got, want)
	}
}

func TestGetBaseURL_Defaults(t *testing.T) {
	t.Setenv("HARNESS_MEM_REMOTE_URL", "")
	t.Setenv("HARNESS_MEM_HOST", "")
	t.Setenv("HARNESS_MEM_PORT", "")

	got := GetBaseURL()
	want := "http://127.0.0.1:37888"
	if got != want {
		t.Errorf("GetBaseURL() = %q, want %q", got, want)
	}
}

// ---- IsRemoteMode ----

func TestIsRemoteMode_Set(t *testing.T) {
	t.Setenv("HARNESS_MEM_REMOTE_URL", "https://remote.example.com")

	if !IsRemoteMode() {
		t.Error("IsRemoteMode() = false, want true")
	}
}

func TestIsRemoteMode_NotSet(t *testing.T) {
	t.Setenv("HARNESS_MEM_REMOTE_URL", "")

	if IsRemoteMode() {
		t.Error("IsRemoteMode() = true, want false")
	}
}

// ---- CheckHealth ----

func TestCheckHealth_Returns200(t *testing.T) {
	resetHealthCache(t)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" {
			w.WriteHeader(http.StatusOK)
		} else {
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer srv.Close()

	t.Setenv("HARNESS_MEM_REMOTE_URL", srv.URL)

	if !CheckHealth() {
		t.Error("CheckHealth() = false, want true for 200 response")
	}
}

func TestCheckHealth_Returns500(t *testing.T) {
	resetHealthCache(t)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer srv.Close()

	t.Setenv("HARNESS_MEM_REMOTE_URL", srv.URL)

	if CheckHealth() {
		t.Error("CheckHealth() = true, want false for 500 response")
	}
}

// ---- CallMemoryAPI ----

func TestCallMemoryAPI_ParsesJSON(t *testing.T) {
	resetHealthCache(t)

	payload := map[string]any{"result": "ok", "count": float64(3)}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusOK)
		_ = json.NewEncoder(w).Encode(payload)
	}))
	defer srv.Close()

	t.Setenv("HARNESS_MEM_REMOTE_URL", srv.URL)
	t.Setenv("HARNESS_MEM_REMOTE_TOKEN", "")
	t.Setenv("HARNESS_MEM_ADMIN_TOKEN", "")
	t.Setenv("HARNESS_MEM_USER_ID", "")
	t.Setenv("HARNESS_MEM_TEAM_ID", "")

	resp, err := CallMemoryAPI(http.MethodGet, "/v1/search", nil)
	if err != nil {
		t.Fatalf("CallMemoryAPI returned error: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Errorf("StatusCode = %d, want 200", resp.StatusCode)
	}
	if resp.Body == nil {
		t.Fatal("Body is nil, expected parsed JSON")
	}
	if got, ok := resp.Body["result"]; !ok || got != "ok" {
		t.Errorf("Body[result] = %v, want %q", got, "ok")
	}
}

func TestCallMemoryAPI_Returns500(t *testing.T) {
	resetHealthCache(t)

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":"internal"}`))
	}))
	defer srv.Close()

	t.Setenv("HARNESS_MEM_REMOTE_URL", srv.URL)
	t.Setenv("HARNESS_MEM_REMOTE_TOKEN", "")
	t.Setenv("HARNESS_MEM_ADMIN_TOKEN", "")
	t.Setenv("HARNESS_MEM_USER_ID", "")
	t.Setenv("HARNESS_MEM_TEAM_ID", "")

	resp, err := CallMemoryAPI(http.MethodPost, "/v1/save", map[string]string{"key": "val"})
	// CallMemoryAPI itself does not error on non-2xx; it returns the status code.
	// The caller is expected to check StatusCode.
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if resp.StatusCode != http.StatusInternalServerError {
		t.Errorf("StatusCode = %d, want 500", resp.StatusCode)
	}
}

// ---- GetCBBaseURL ----

func TestGetCBBaseURL_Set(t *testing.T) {
	t.Setenv("CONTEXT_BOX_URL", "https://cb.example.com/")

	got := GetCBBaseURL()
	want := "https://cb.example.com"
	if got != want {
		t.Errorf("GetCBBaseURL() = %q, want %q", got, want)
	}
}

func TestGetCBBaseURL_NotSet(t *testing.T) {
	t.Setenv("CONTEXT_BOX_URL", "")

	got := GetCBBaseURL()
	if got != "" {
		t.Errorf("GetCBBaseURL() = %q, want empty string", got)
	}
}
