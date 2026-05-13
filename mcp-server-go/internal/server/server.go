// Package server initializes and runs the MCP server over supported transports.
// Port of mcp-server/src/index.ts
package server

import (
	"context"
	"os"
	"sort"
	"strings"

	"github.com/mark3labs/mcp-go/mcp"
	mcpserver "github.com/mark3labs/mcp-go/server"

	"github.com/Chachamaru127/harness-mem/mcp-server-go/internal/tools"
)

const (
	serverName    = "harness-mcp-server"
	serverVersion = "1.0.0"
)

// NewServer creates a configured MCP server with the currently enabled tool set.
func NewServer() *mcpserver.MCPServer {
	s := mcpserver.NewMCPServer(
		serverName,
		serverVersion,
		mcpserver.WithToolCapabilities(true),
	)

	registerTools(s)
	return s
}

// Run creates the default stdio server. It remains as a backward-compatible
// wrapper because existing MCP clients launch this binary over stdio.
func Run() error {
	return RunStdio()
}

// RunStdio serves a configured MCP server over stdio.
func RunStdio() error {
	return mcpserver.ServeStdio(newStdioMCPServer())
}

// NewStdioServer creates a stdio transport around the configured MCP server.
func NewStdioServer() *mcpserver.StdioServer {
	return mcpserver.NewStdioServer(newStdioMCPServer())
}

// RunStreamableHTTP serves a configured MCP server over Streamable HTTP.
func RunStreamableHTTP(addr string) error {
	return NewStreamableHTTPServer().Start(addr)
}

// NewStreamableHTTPServer creates a Streamable HTTP transport around the same
// configured MCP server used by stdio.
func NewStreamableHTTPServer(opts ...mcpserver.StreamableHTTPOption) *mcpserver.StreamableHTTPServer {
	return mcpserver.NewStreamableHTTPServer(newStreamableHTTPMCPServer(), opts...)
}

func newStdioMCPServer() *mcpserver.MCPServer {
	return NewServer()
}

func newStreamableHTTPMCPServer() *mcpserver.MCPServer {
	return NewServer()
}

// registerTools registers tool definitions and handlers on the server.
// §81-C01: obeys HARNESS_MEM_TOOLS=core|all to narrow the exposed set.
// Unrecognized / missing values fall back to "all" (backward compatible).
func registerTools(s *mcpserver.MCPServer) {
	for _, def := range registeredToolDefs() {
		s.AddTool(def.Tool, makeHandler(def.Handler))
	}
}

func registeredToolDefs() []tools.ToolDef {
	vis := tools.ResolveVisibility(strings.TrimSpace(os.Getenv("HARNESS_MEM_TOOLS")))
	return tools.FilterByVisibility(tools.AllTools(), vis)
}

func registeredToolNames() []string {
	defs := registeredToolDefs()
	names := make([]string, 0, len(defs))
	for _, def := range defs {
		names = append(names, def.Tool.Name)
	}
	sort.Strings(names)
	return names
}

func serverToolNames(s *mcpserver.MCPServer) []string {
	registered := s.ListTools()
	names := make([]string, 0, len(registered))
	for name := range registered {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
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
}
