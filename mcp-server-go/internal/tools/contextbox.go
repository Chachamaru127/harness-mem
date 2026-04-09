// Context Box tools — 4 HTTP proxy tools to the Context Box API.
// Port of mcp-server/src/tools/context-box.ts
package tools

import (
	"context"
	"fmt"
	"os"
	"strings"

	"github.com/mark3labs/mcp-go/mcp"

	"github.com/Chachamaru127/harness-mem/mcp-server-go/internal/proxy"
	"github.com/Chachamaru127/harness-mem/mcp-server-go/internal/types"
)

func ContextBoxToolDefs() []ToolDef {
	return []ToolDef{
		{cbToolRecall, func(ctx context.Context, args map[string]any) types.ToolResult { return handleCBRecall(args) }},
		{cbToolSearch, func(ctx context.Context, args map[string]any) types.ToolResult { return handleCBSearch(args) }},
		{cbToolTrace, func(ctx context.Context, args map[string]any) types.ToolResult { return handleCBTrace(args) }},
		{cbToolStatus, func(ctx context.Context, args map[string]any) types.ToolResult { return handleCBStatus(args) }},
	}
}

var cbToolRecall = mcp.NewTool("harness_cb_recall",
	mcp.WithDescription("Search the Context Box (business context DB) using TEMPR hybrid retrieval. Finds relevant context from LINE messages, meeting notes, customer data, emails, etc. Supports 4 search strategies: hybrid (best), hybrid-lite, bm25, graph."),
	mcp.WithString("query", mcp.Required(), mcp.Description("Natural language search query")),
	mcp.WithString("strategy", mcp.Description("Search strategy. 'hybrid' uses all 4 TEMPR channels (best quality). Default: 'hybrid'"), mcp.Enum("hybrid", "hybrid-lite", "bm25", "graph", "default")),
	mcp.WithNumber("limit", mcp.Description("Max results (1-50, default 10)")),
	mcp.WithString("workspace_id", mcp.Description("Workspace ID to scope the search (uses CONTEXT_BOX_WORKSPACE_ID env if omitted)")),
	mcp.WithString("source_type", mcp.Description("Filter by data source type"), mcp.Enum("line", "slack", "chatwork", "kintone", "email", "file", "meeting", "plaud", "omi", "fieldy")),
	mcp.WithString("group_id", mcp.Description("Filter by group ID (LINE group, Slack workspace, etc.)")),
	mcp.WithString("date_from", mcp.Description("Filter: earliest date (ISO 8601)")),
	mcp.WithString("date_to", mcp.Description("Filter: latest date (ISO 8601)")),
	mcp.WithString("customer", mcp.Description("Filter by customer name")),
	mcp.WithString("author", mcp.Description("Filter by author/speaker")),
)

var cbToolSearch = mcp.NewTool("harness_cb_search",
	mcp.WithDescription("Simplified search for the Context Box (Web UI API). Easier to use than cb_recall -- just provide a query and workspace. Returns text, score, sourceType, documentId, createdAt for each result."),
	mcp.WithString("query", mcp.Required(), mcp.Description("Search query")),
	mcp.WithString("workspace_id", mcp.Description("Workspace ID (uses CONTEXT_BOX_WORKSPACE_ID env if omitted)")),
	mcp.WithString("strategy", mcp.Description("Search strategy (default: 'hybrid-lite')"), mcp.Enum("hybrid", "hybrid-lite", "bm25", "graph", "default")),
	mcp.WithNumber("limit", mcp.Description("Max results (1-50, default 10)")),
)

var cbToolTrace = mcp.NewTool("harness_cb_trace",
	mcp.WithDescription("Retrieve the full raw text and source metadata for a specific document from the Context Box. Use this after recall/search to get the complete original content."),
	mcp.WithString("document_id", mcp.Required(), mcp.Description("Document ID (UUID) from recall/search results")),
)

var cbToolStatus = mcp.NewTool("harness_cb_status",
	mcp.WithDescription("Check the health and connectivity of the Context Box API. Returns server status, database availability, and feature flags."),
	mcp.WithBoolean("detailed", mcp.Description("If true, use /health/detailed endpoint for full diagnostics")),
)

func getDefaultWorkspaceID() string {
	return strings.TrimSpace(os.Getenv("CONTEXT_BOX_WORKSPACE_ID"))
}

func cbErrorResult(message string) types.ToolResult {
	return types.CreateJsonToolResult(
		map[string]any{"ok": false, "error": message},
		types.JsonToolResultOptions{IsError: true, Text: message},
	)
}

func cbSuccessResult(data any) types.ToolResult {
	return types.CreateJsonToolResult(data, types.JsonToolResultOptions{})
}

func handleCBRecall(args map[string]any) types.ToolResult {
	query := argString(args, "query")
	if query == "" {
		return cbErrorResult("query is required")
	}

	workspaceID := argString(args, "workspace_id")
	if workspaceID == "" {
		workspaceID = getDefaultWorkspaceID()
	}

	strategy := argString(args, "strategy")
	if strategy == "" {
		strategy = "hybrid"
	}
	limit := 10.0
	if n, ok := argNumber(args, "limit"); ok {
		limit = n
	}

	payload := map[string]any{
		"query":    query,
		"strategy": strategy,
		"limit":    limit,
	}
	if workspaceID != "" {
		payload["workspaceId"] = workspaceID
	}

	filters := map[string]any{}
	if v := argString(args, "group_id"); v != "" {
		filters["groupId"] = v
	}
	if v := argString(args, "source_type"); v != "" {
		filters["sourceType"] = v
	}
	if v := argString(args, "date_from"); v != "" {
		filters["dateFrom"] = v
	}
	if v := argString(args, "date_to"); v != "" {
		filters["dateTo"] = v
	}
	if v := argString(args, "customer"); v != "" {
		filters["customerId"] = v
	}
	if v := argString(args, "author"); v != "" {
		filters["author"] = v
	}
	if len(filters) > 0 {
		payload["filters"] = filters
	}

	resp, err := proxy.CallCBAPI("POST", "/context-bank/recall", payload)
	if err != nil {
		return cbErrorResult(fmt.Sprintf("Context Box error: %s", err.Error()))
	}
	return cbSuccessResult(resp.Body)
}

func handleCBSearch(args map[string]any) types.ToolResult {
	query := argString(args, "query")
	if query == "" {
		return cbErrorResult("query is required")
	}

	workspaceID := argString(args, "workspace_id")
	if workspaceID == "" {
		workspaceID = getDefaultWorkspaceID()
	}
	if workspaceID == "" {
		return cbErrorResult("workspace_id is required (set CONTEXT_BOX_WORKSPACE_ID env or pass workspace_id parameter)")
	}

	strategy := argString(args, "strategy")
	if strategy == "" {
		strategy = "hybrid-lite"
	}
	limit := 10.0
	if n, ok := argNumber(args, "limit"); ok {
		limit = n
	}

	resp, err := proxy.CallCBAPI("POST", "/api/search", map[string]any{
		"query":       query,
		"workspaceId": workspaceID,
		"strategy":    strategy,
		"limit":       limit,
	})
	if err != nil {
		return cbErrorResult(fmt.Sprintf("Context Box error: %s", err.Error()))
	}
	return cbSuccessResult(resp.Body)
}

func handleCBTrace(args map[string]any) types.ToolResult {
	docID := argString(args, "document_id")
	if docID == "" {
		return cbErrorResult("document_id is required")
	}

	resp, err := proxy.CallCBAPI("POST", "/context-bank/trace", map[string]any{"documentId": docID})
	if err != nil {
		return cbErrorResult(fmt.Sprintf("Context Box error: %s", err.Error()))
	}
	return cbSuccessResult(resp.Body)
}

func handleCBStatus(args map[string]any) types.ToolResult {
	detailed := argBool(args, "detailed", false)
	endpoint := "/health"
	if detailed {
		endpoint = "/health/detailed"
	}

	baseURL := proxy.GetCBBaseURL()
	resp, err := proxy.CallCBAPI("GET", endpoint, nil)
	if err != nil {
		return cbSuccessResult(map[string]any{
			"status": "unreachable",
			"url":    baseURL,
			"error":  err.Error(),
			"hint":   "Check CONTEXT_BOX_URL and ensure the VPS is running",
		})
	}

	result := map[string]any{"status": "connected", "url": baseURL}
	if resp.Body != nil {
		for k, v := range resp.Body {
			result[k] = v
		}
	}
	return cbSuccessResult(result)
}
