package types

import (
	"encoding/json"
	"strings"
	"testing"
)

// TestCreateJsonToolResult_Basic: content[0].text holds JSON, structuredContent
// matches the payload, and _meta contains maxResultSizeChars=500000.
func TestCreateJsonToolResult_Basic(t *testing.T) {
	payload := map[string]any{"key": "value", "count": 42}
	result := CreateJsonToolResult(payload, JsonToolResultOptions{})

	// content must have exactly one block of type "text".
	if len(result.Content) != 1 {
		t.Fatalf("want 1 content block, got %d", len(result.Content))
	}
	if result.Content[0].Type != "text" {
		t.Errorf("content[0].type: want %q, got %q", "text", result.Content[0].Type)
	}

	// content[0].text must be valid JSON.
	text := result.Content[0].Text
	var parsed map[string]any
	if err := json.Unmarshal([]byte(text), &parsed); err != nil {
		t.Errorf("content[0].text is not valid JSON: %v — text was: %q", err, text)
	}

	// structuredContent should reflect the payload.
	if result.StructuredContent == nil {
		t.Error("structuredContent should not be nil")
	}

	// _meta must have anthropic/maxResultSizeChars = DefaultMaxResultSizeChars (500000).
	if result.Meta == nil {
		t.Fatal("_meta should not be nil")
	}
	raw, ok := result.Meta["anthropic/maxResultSizeChars"]
	if !ok {
		t.Fatal("_meta missing key anthropic/maxResultSizeChars")
	}
	// The value is stored as int; cast to int for comparison.
	var size int
	switch v := raw.(type) {
	case int:
		size = v
	case float64:
		size = int(v)
	default:
		t.Fatalf("unexpected type for maxResultSizeChars: %T", raw)
	}
	if size != DefaultMaxResultSizeChars {
		t.Errorf("maxResultSizeChars: want %d, got %d", DefaultMaxResultSizeChars, size)
	}
}

// TestCreateJsonToolResult_Citations: Citations field is preserved.
func TestCreateJsonToolResult_Citations(t *testing.T) {
	citations := []string{"source-a", "source-b"}
	result := CreateJsonToolResult("data", JsonToolResultOptions{
		Citations: citations,
	})

	if result.Citations == nil {
		t.Fatal("_citations should not be nil when provided")
	}

	// Round-trip through JSON to compare the slice values.
	b, err := json.Marshal(result.Citations)
	if err != nil {
		t.Fatalf("failed to marshal citations: %v", err)
	}
	var got []string
	if err := json.Unmarshal(b, &got); err != nil {
		t.Fatalf("failed to unmarshal citations back: %v", err)
	}
	if len(got) != len(citations) {
		t.Fatalf("citations length: want %d, got %d", len(citations), len(got))
	}
	for i := range citations {
		if got[i] != citations[i] {
			t.Errorf("citations[%d]: want %q, got %q", i, citations[i], got[i])
		}
	}
}

// TestErrorText: isError=true and content carries the error message.
func TestErrorText(t *testing.T) {
	msg := "something went wrong"
	result := ErrorText(msg)

	if !result.IsError {
		t.Error("isError should be true")
	}
	if len(result.Content) != 1 {
		t.Fatalf("want 1 content block, got %d", len(result.Content))
	}
	if !strings.Contains(result.Content[0].Text, msg) {
		t.Errorf("content[0].text should contain %q, got %q", msg, result.Content[0].Text)
	}
}
