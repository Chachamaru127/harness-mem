// Package server initializes and runs the MCP server over stdio.
// Port of mcp-server/src/index.ts
package server

import (
	"context"
	"fmt"
	"os"
	"strings"

	"github.com/mark3labs/mcp-go/mcp"
	mcpserver "github.com/mark3labs/mcp-go/server"

	"github.com/Chachamaru127/harness-mem/mcp-server-go/internal/tools"
)

// Run creates the MCP server, registers all tools, and serves over stdio.
func Run() error {
	s := mcpserver.NewMCPServer(
		"harness-mcp-server",
		"1.0.0",
		mcpserver.WithToolCapabilities(true),
	)

	// Register all 46 tools
	registerTools(s)

	// Serve over stdio
	return mcpserver.ServeStdio(s)
}

// registerTools registers tool definitions and handlers on the server.
// §81-C01: obeys HARNESS_MEM_TOOLS=core|all to narrow the exposed set.
// Unrecognized / missing values fall back to "all" (backward compatible).
func registerTools(s *mcpserver.MCPServer) {
	vis := tools.ResolveVisibility(strings.TrimSpace(os.Getenv("HARNESS_MEM_TOOLS")))
	defs := tools.FilterByVisibility(tools.AllTools(), vis)
	for _, def := range defs {
		s.AddTool(def.Tool, makeHandler(def.Handler))
	}
}

// makeHandler wraps our internal handler signature into the mcp-go expected signature.
func makeHandler(fn tools.HandlerFunc) mcpserver.ToolHandlerFunc {
	return func(ctx context.Context, req mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		// Extract arguments using the SDK helper
		args := req.GetArguments()

		result := fn(ctx, args)

		// Convert our ToolResult to mcp-go CallToolResult
		mcpResult := &mcp.CallToolResult{
			IsError: result.IsError,
		}

		for _, block := range result.Content {
			mcpResult.Content = append(mcpResult.Content, mcp.TextContent{
				Type: "text",
				Text: block.Text,
			})
		}

		// Attach metadata if present
		if result.Meta != nil {
			mcpResult.Meta = mcp.NewMetaFromMap(result.Meta)
		}

		return mcpResult, nil
	}
}

// PushMemoryNotification sends a proactive notification via MCP channels.
// Only active when HARNESS_MEM_ENABLE_CHANNELS=true.
// This is a no-op placeholder — mcp-go channel support TBD.
func PushMemoryNotification(message string) {
	// TODO: implement when mcp-go supports notifications/message
	_ = message
	_ = fmt.Sprintf // suppress unused import if needed
}
