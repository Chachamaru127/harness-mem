// Package tools defines all MCP tool registrations and handlers.
package tools

import (
	"context"

	"github.com/mark3labs/mcp-go/mcp"

	"github.com/Chachamaru127/harness-mem/mcp-server-go/internal/types"
)

// HandlerFunc is the signature for all tool handlers.
type HandlerFunc func(ctx context.Context, args map[string]any) types.ToolResult

// ToolDef pairs an MCP tool definition with its handler.
type ToolDef struct {
	Tool    mcp.Tool
	Handler HandlerFunc
}

// AllTools returns all 46 tool definitions with their handlers.
func AllTools() []ToolDef {
	var all []ToolDef
	all = append(all, MemoryToolDefs()...)
	all = append(all, ContextBoxToolDefs()...)
	all = append(all, SessionToolDefs()...)
	all = append(all, WorkflowToolDefs()...)
	all = append(all, StatusToolDefs()...)
	all = append(all, CodeIntelToolDefs()...)
	return all
}

// ---------------------------------------------------------------------------
// S81-C01: Tool visibility tiering
// ---------------------------------------------------------------------------

// Visibility controls how many tools are exposed over MCP.
// Value matches the contents of HARNESS_MEM_TOOLS.
type Visibility string

const (
	VisibilityAll  Visibility = "all"
	VisibilityCore Visibility = "core"
)

// coreToolNames is the 7-tool core set defined in §81-C01 DoD.
//
//   - harness_mem_search
//   - harness_mem_timeline
//   - harness_mem_get_observations
//   - harness_mem_sessions_list
//   - harness_mem_record_checkpoint
//   - harness_mem_resume_pack
//   - harness_mem_health
var coreToolNames = map[string]struct{}{
	"harness_mem_search":            {},
	"harness_mem_timeline":          {},
	"harness_mem_get_observations":  {},
	"harness_mem_sessions_list":     {},
	"harness_mem_record_checkpoint": {},
	"harness_mem_resume_pack":       {},
	"harness_mem_health":            {},
}

// CoreToolNames returns a copy of the core-set tool names. Tests and docs use
// this to verify parity without mutating internal state.
func CoreToolNames() []string {
	names := make([]string, 0, len(coreToolNames))
	for n := range coreToolNames {
		names = append(names, n)
	}
	return names
}

// ResolveVisibility parses `HARNESS_MEM_TOOLS` (or any raw string) into a
// Visibility value. Unknown / empty / malformed inputs fall back to
// VisibilityAll, preserving backward compatibility for existing installs.
func ResolveVisibility(raw string) Visibility {
	switch raw {
	case "core", "CORE", "Core":
		return VisibilityCore
	case "all", "ALL", "All", "":
		return VisibilityAll
	default:
		// Unknown value: behave as "all" so a typo never silently drops tools.
		return VisibilityAll
	}
}

// FilterByVisibility returns the subset of ToolDef matching the requested
// visibility. VisibilityAll returns the input unchanged; VisibilityCore
// returns only tools whose Name is in coreToolNames.
func FilterByVisibility(defs []ToolDef, vis Visibility) []ToolDef {
	if vis == VisibilityAll {
		return defs
	}
	out := make([]ToolDef, 0, len(coreToolNames))
	for _, d := range defs {
		if _, ok := coreToolNames[d.Tool.Name]; ok {
			out = append(out, d)
		}
	}
	return out
}

// ---- Argument extraction helpers (port of toStringOrUndefined etc.) ----

func argString(args map[string]any, key string) string {
	if v, ok := args[key]; ok {
		if s, ok := v.(string); ok {
			return s
		}
	}
	return ""
}

func argNumber(args map[string]any, key string) (float64, bool) {
	if v, ok := args[key]; ok {
		if n, ok := v.(float64); ok {
			return n, true
		}
	}
	return 0, false
}

func argInt(args map[string]any, key string) (int, bool) {
	if n, ok := argNumber(args, key); ok {
		return int(n), true
	}
	return 0, false
}

func argBool(args map[string]any, key string, fallback bool) bool {
	if v, ok := args[key]; ok {
		if b, ok := v.(bool); ok {
			return b
		}
	}
	return fallback
}

func argStringArray(args map[string]any, key string) []string {
	if v, ok := args[key]; ok {
		if arr, ok := v.([]any); ok {
			result := make([]string, 0, len(arr))
			for _, item := range arr {
				if s, ok := item.(string); ok {
					result = append(result, s)
				}
			}
			return result
		}
	}
	return nil
}

func argObject(args map[string]any, key string) map[string]any {
	if v, ok := args[key]; ok {
		if m, ok := v.(map[string]any); ok {
			return m
		}
	}
	return nil
}
