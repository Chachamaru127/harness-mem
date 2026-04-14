// visibility_test.go — S80-C01 unit tests for tool visibility tiering.
package tools

import (
	"sort"
	"testing"
)

func TestResolveVisibility_EmptyDefaultsToAll(t *testing.T) {
	if got := ResolveVisibility(""); got != VisibilityAll {
		t.Errorf("empty → %q; want %q", got, VisibilityAll)
	}
}

func TestResolveVisibility_CoreCaseVariants(t *testing.T) {
	for _, raw := range []string{"core", "CORE", "Core"} {
		if got := ResolveVisibility(raw); got != VisibilityCore {
			t.Errorf("%q → %q; want %q", raw, got, VisibilityCore)
		}
	}
}

func TestResolveVisibility_UnknownFallsBackToAll(t *testing.T) {
	for _, raw := range []string{"minimal", "xxx", "7"} {
		if got := ResolveVisibility(raw); got != VisibilityAll {
			t.Errorf("unknown %q → %q; want %q (backward compat)", raw, got, VisibilityAll)
		}
	}
}

func TestFilterByVisibility_CoreYieldsExactlySeven(t *testing.T) {
	all := AllTools()
	filtered := FilterByVisibility(all, VisibilityCore)
	if len(filtered) != 7 {
		t.Errorf("core filter: got %d tools, want 7", len(filtered))
	}

	got := make([]string, 0, len(filtered))
	for _, d := range filtered {
		got = append(got, d.Tool.Name)
	}
	sort.Strings(got)

	expected := []string{
		"harness_mem_get_observations",
		"harness_mem_health",
		"harness_mem_record_checkpoint",
		"harness_mem_resume_pack",
		"harness_mem_search",
		"harness_mem_sessions_list",
		"harness_mem_timeline",
	}
	for i, name := range expected {
		if i >= len(got) || got[i] != name {
			t.Errorf("core set mismatch: got=%v want=%v", got, expected)
			return
		}
	}
}

func TestFilterByVisibility_AllReturnsFullSet(t *testing.T) {
	all := AllTools()
	filtered := FilterByVisibility(all, VisibilityAll)
	if len(filtered) != len(all) {
		t.Errorf("all filter: got %d tools, want %d", len(filtered), len(all))
	}
}

func TestFilterByVisibility_CoreIsStrictSubsetOfAll(t *testing.T) {
	all := AllTools()
	allNames := make(map[string]struct{}, len(all))
	for _, d := range all {
		allNames[d.Tool.Name] = struct{}{}
	}
	for _, d := range FilterByVisibility(all, VisibilityCore) {
		if _, ok := allNames[d.Tool.Name]; !ok {
			t.Errorf("core tool %q not found in AllTools()", d.Tool.Name)
		}
	}
}

func TestCoreToolNames_ReturnsSeven(t *testing.T) {
	names := CoreToolNames()
	if len(names) != 7 {
		t.Errorf("CoreToolNames: got %d, want 7", len(names))
	}
}
