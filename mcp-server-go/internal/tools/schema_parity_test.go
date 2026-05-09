package tools

// TestSchemaParity verifies that all Go tool definitions match the TS snapshot.
// This is the most critical test for the Go migration — any schema drift
// will break Claude Code / Codex clients.

import (
	"encoding/json"
	"fmt"
	"os"
	"reflect"
	"sort"
	"testing"
)

// snapshotTool represents a single entry in expected_tools.json.
type snapshotTool struct {
	Name        string         `json:"name"`
	Description string         `json:"description"`
	InputSchema map[string]any `json:"inputSchema"`
}

// schemaKeys extracts sorted property keys from an inputSchema map.
func schemaKeys(schema map[string]any) []string {
	props, ok := schema["properties"]
	if !ok {
		return []string{}
	}
	pm, ok := props.(map[string]any)
	if !ok {
		return []string{}
	}
	keys := make([]string, 0, len(pm))
	for k := range pm {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}

// schemaRequired extracts and sorts the required array from an inputSchema map.
func schemaRequired(schema map[string]any) []string {
	raw, ok := schema["required"]
	if !ok {
		return []string{}
	}
	switch v := raw.(type) {
	case []string:
		out := make([]string, len(v))
		copy(out, v)
		sort.Strings(out)
		return out
	case []any:
		out := make([]string, 0, len(v))
		for _, item := range v {
			if s, ok := item.(string); ok {
				out = append(out, s)
			}
		}
		sort.Strings(out)
		return out
	}
	return []string{}
}

// equalStringSlices returns true if two sorted string slices are identical.
func equalStringSlices(a, b []string) bool {
	if len(a) != len(b) {
		return false
	}
	for i := range a {
		if a[i] != b[i] {
			return false
		}
	}
	return true
}

// normalizeJSON round-trips a value through JSON to canonicalize types
// (so int vs float64, []string vs []any, etc., compare equal).
func normalizeJSON(v any) any {
	if v == nil {
		return nil
	}
	data, err := json.Marshal(v)
	if err != nil {
		return v
	}
	var out any
	if err := json.Unmarshal(data, &out); err != nil {
		return v
	}
	return out
}

// mustJSONIndent renders any value as indented JSON for error messages.
func mustJSONIndent(v any) string {
	b, err := json.MarshalIndent(v, "  ", "  ")
	if err != nil {
		return fmt.Sprintf("%v", v)
	}
	return string(b)
}

func TestSchemaParity(t *testing.T) {
	// --- Load snapshot ---
	snapshotPath := "../../testdata/expected_tools.json"
	data, err := os.ReadFile(snapshotPath)
	if err != nil {
		t.Fatalf("failed to read snapshot %s: %v", snapshotPath, err)
	}

	var snapshot []snapshotTool
	if err := json.Unmarshal(data, &snapshot); err != nil {
		t.Fatalf("failed to parse snapshot JSON: %v", err)
	}

	// Build a name → snapshot entry map for O(1) lookup.
	snapByName := make(map[string]snapshotTool, len(snapshot))
	for _, s := range snapshot {
		snapByName[s.Name] = s
	}

	// --- Build actual tools ---
	actualDefs := AllTools()

	// Sort actual by name to match snapshot ordering and get deterministic output.
	sort.Slice(actualDefs, func(i, j int) bool {
		return actualDefs[i].Tool.Name < actualDefs[j].Tool.Name
	})

	// --- Count check ---
	// 46 baseline + 6 S81-A02/A03 coordination primitives (lease_*, signal_*)
	// + 1 S81-C03 citation trace (harness_mem_verify)
	// + 1 S109-003 inject observability (harness_mem_observability).
	const wantCount = 54
	if len(snapshot) != wantCount {
		t.Errorf("snapshot count: got %d, want %d", len(snapshot), wantCount)
	}
	if len(actualDefs) != wantCount {
		t.Errorf("AllTools() count: got %d, want %d", len(actualDefs), wantCount)
	}
	// If counts differ, individual comparisons below will surface the missing/extra tools.

	// --- Per-tool parity check ---
	// Track which snapshot names we've matched, to catch extras in snapshot.
	matched := make(map[string]bool, len(actualDefs))

	for _, td := range actualDefs {
		tool := td.Tool
		name := tool.Name
		matched[name] = true

		snap, ok := snapByName[name]
		if !ok {
			t.Errorf("tool %q exists in Go but NOT in snapshot", name)
			continue
		}

		// --- Description ---
		if tool.Description != snap.Description {
			t.Errorf("tool %q description mismatch:\n  got:  %q\n  want: %q",
				name, tool.Description, snap.Description)
		}

		// --- Marshal actual tool to extract inputSchema as a generic map ---
		toolJSON, err := json.Marshal(tool)
		if err != nil {
			t.Errorf("tool %q: failed to marshal: %v", name, err)
			continue
		}
		var toolMap map[string]any
		if err := json.Unmarshal(toolJSON, &toolMap); err != nil {
			t.Errorf("tool %q: failed to unmarshal marshaled JSON: %v", name, err)
			continue
		}

		actualSchema, _ := toolMap["inputSchema"].(map[string]any)
		if actualSchema == nil {
			t.Errorf("tool %q: inputSchema is nil or wrong type in marshaled JSON", name)
			continue
		}

		// --- Properties keys ---
		actualKeys := schemaKeys(actualSchema)
		snapKeys := schemaKeys(snap.InputSchema)
		if !equalStringSlices(actualKeys, snapKeys) {
			t.Errorf("tool %q: inputSchema.properties keys mismatch:\n  got:  %v\n  want: %v",
				name, actualKeys, snapKeys)
		}

		// --- Required fields ---
		actualRequired := schemaRequired(actualSchema)
		snapRequired := schemaRequired(snap.InputSchema)
		if !equalStringSlices(actualRequired, snapRequired) {
			t.Errorf("tool %q: inputSchema.required mismatch:\n  got:  %v\n  want: %v",
				name, actualRequired, snapRequired)
			continue
		}

		// --- Deep compare each property (type, enum, description, items, nested) ---
		actualProps, _ := actualSchema["properties"].(map[string]any)
		snapProps, _ := snap.InputSchema["properties"].(map[string]any)
		for _, propName := range actualKeys {
			actualProp := normalizeJSON(actualProps[propName])
			snapProp := normalizeJSON(snapProps[propName])
			if !reflect.DeepEqual(actualProp, snapProp) {
				t.Errorf("tool %q property %q deep schema mismatch:\n  got:  %s\n  want: %s",
					name, propName, mustJSONIndent(actualProp), mustJSONIndent(snapProp))
			}
		}

		// --- Compare top-level schema fields beyond properties/required ---
		// (e.g. additionalProperties, type, $schema, etc.)
		for _, key := range []string{"type", "additionalProperties"} {
			actualVal, hasActual := actualSchema[key]
			snapVal, hasSnap := snap.InputSchema[key]
			if hasActual != hasSnap {
				t.Errorf("tool %q: schema key %q presence mismatch (actual=%v, snapshot=%v)",
					name, key, hasActual, hasSnap)
				continue
			}
			if hasActual && !reflect.DeepEqual(normalizeJSON(actualVal), normalizeJSON(snapVal)) {
				t.Errorf("tool %q: schema key %q value mismatch:\n  got:  %v\n  want: %v",
					name, key, actualVal, snapVal)
			}
		}
	}

	// Check for tools in snapshot that are missing from Go.
	for _, snap := range snapshot {
		if !matched[snap.Name] {
			t.Errorf("tool %q exists in snapshot but NOT in Go AllTools()", snap.Name)
		}
	}
}
