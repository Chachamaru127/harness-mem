package tools

import (
	"context"
	"encoding/json"
	"net/http"
	"reflect"
	"sync"
	"testing"
)

func TestHandleMemBulkAddNormalizesPayloadWithoutMutation(t *testing.T) {
	var mu sync.Mutex
	var received []map[string]any
	setupSharedMemServer(t, defaultMemHandler(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health/ready" {
			writeJSON(w, map[string]any{"ok": true})
			return
		}
		if r.Method != http.MethodPost || r.URL.Path != "/v1/events/record" {
			t.Errorf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
		var body struct {
			Event map[string]any `json:"event"`
		}
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Errorf("decode event: %v", err)
		}
		mu.Lock()
		received = append(received, body.Event)
		mu.Unlock()
		writeJSON(w, map[string]any{"ok": true, "items": []any{}})
	}))

	events := []any{
		map[string]any{
			"platform": "codex", "project": "bulk-project", "session_id": "bulk-session", "event_type": "decision",
			"title": "決定", "content": "判断の理由", "tags": []any{"design"}, "privacy_tags": []any{"private"},
			"metadata": map[string]any{"source": "fixture"}, "dedupe_hash": "bulk-1",
		},
		map[string]any{
			"platform": "codex", "project": "bulk-project", "session_id": "bulk-session", "event_type": "decision",
			"title": "ignored", "content": "fill missing content", "payload": map[string]any{"title": "", "extra": "retained"},
		},
		map[string]any{
			"platform": "codex", "project": "bulk-project", "session_id": "bulk-session", "event_type": "decision",
			"title": "ignored", "content": "ignored", "payload": map[string]any{"title": "canonical", "content": nil}, "tags": []any{}, "privacy_tags": []any{},
		},
	}
	before := normalizeJSON(events)
	result := handleMemoryToolInner(context.Background(), "harness_mem_bulk_add", map[string]any{"events": events})
	if result.IsError {
		t.Fatalf("unexpected error: %+v", result)
	}
	if !reflect.DeepEqual(before, normalizeJSON(events)) {
		t.Fatal("bulk handler mutated its input events or payload")
	}
	mu.Lock()
	defer mu.Unlock()
	if len(received) != 3 {
		t.Fatalf("received %d events, want 3", len(received))
	}
	wantPayloads := []map[string]any{
		{"title": "決定", "content": "判断の理由"},
		{"title": "", "content": "fill missing content", "extra": "retained"},
		{"title": "canonical", "content": nil},
	}
	for i, event := range received {
		if !reflect.DeepEqual(event["payload"], wantPayloads[i]) {
			t.Errorf("event %d payload = %#v, want %#v", i, event["payload"], wantPayloads[i])
		}
		for key, value := range events[i].(map[string]any) {
			if key != "payload" && !reflect.DeepEqual(event[key], normalizeJSON(value)) {
				t.Errorf("event %d field %s changed: %#v", i, key, event[key])
			}
		}
	}
}

func TestHandleMemBulkAddRejectsMalformedBatchBeforeWrites(t *testing.T) {
	validEvent := func() map[string]any {
		return map[string]any{
			"platform": "codex", "project": "bulk-project", "session_id": "bulk-session", "event_type": "decision", "content": "valid first event",
		}
	}
	withField := func(key string, value any) map[string]any {
		event := validEvent()
		event[key] = value
		return event
	}
	type invalidCase struct {
		name  string
		event any
	}
	cases := []invalidCase{
		{"null event", nil},
		{"string event", "invalid"},
		{"array event", []any{}},
		{"empty event", map[string]any{}},
		{"null payload", withField("payload", nil)},
		{"string payload", withField("payload", "invalid")},
		{"array payload", withField("payload", []any{})},
		{"boolean payload", withField("payload", true)},
		{"number payload", withField("payload", float64(1))},
		{"project NUL", withField("project", "project\x00other")},
	}
	for _, key := range []string{"platform", "project", "session_id", "event_type"} {
		missing := validEvent()
		delete(missing, key)
		cases = append(cases,
			invalidCase{key + " missing", missing},
			invalidCase{key + " null", withField(key, nil)},
			invalidCase{key + " number", withField(key, float64(42))},
			invalidCase{key + " empty", withField(key, "")},
			invalidCase{key + " whitespace", withField(key, " \t\n")},
		)
	}
	for _, key := range []string{"title", "content"} {
		cases = append(cases,
			invalidCase{key + " null", withField(key, nil)},
			invalidCase{key + " number", withField(key, float64(42))},
		)
	}
	for _, key := range []string{"tags", "privacy_tags"} {
		cases = append(cases,
			invalidCase{key + " null", withField(key, nil)},
			invalidCase{key + " string", withField(key, "invalid")},
			invalidCase{key + " object", withField(key, map[string]any{})},
			invalidCase{key + " mixed", withField(key, []any{"valid", float64(42)})},
		)
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var mu sync.Mutex
			writes := 0
			setupSharedMemServer(t, defaultMemHandler(func(w http.ResponseWriter, r *http.Request) {
				mu.Lock()
				writes++
				mu.Unlock()
				writeJSON(w, map[string]any{"ok": true})
			}))
			result := handleMemoryToolInner(context.Background(), "harness_mem_bulk_add", map[string]any{
				"events": []any{validEvent(), tc.event},
			})
			if !result.IsError {
				t.Fatalf("malformed batch accepted: %+v", result)
			}
			mu.Lock()
			defer mu.Unlock()
			if writes != 0 {
				t.Errorf("validation allowed %d partial writes", writes)
			}
		})
	}
}
