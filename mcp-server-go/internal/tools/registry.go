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
