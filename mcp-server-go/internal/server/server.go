// Package server initializes and runs the MCP server over supported transports.
// Port of mcp-server/src/index.ts
package server

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"sort"
	"strings"

	"github.com/mark3labs/mcp-go/mcp"
	mcpserver "github.com/mark3labs/mcp-go/server"

	"github.com/Chachamaru127/harness-mem/mcp-server-go/internal/tools"
)

const (
	serverName                    = "harness-mcp-server"
	serverVersion                 = "1.0.0"
	transportStdio                = "stdio"
	transportStreamableHTTP       = "streamable_http"
	defaultStreamableHTTPAddr     = "127.0.0.1:37889"
	defaultStreamableHTTPEndpoint = "/mcp"
)

// TransportConfig describes how this MCP frontend should serve requests.
type TransportConfig struct {
	Transport string
	Addr      string
	Endpoint  string
}

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

// RunFromEnv runs the configured MCP transport.
// The default remains stdio; Streamable HTTP is opt-in via
// HARNESS_MEM_MCP_TRANSPORT=http or streamable_http.
func RunFromEnv(stderr io.Writer) error {
	cfg, err := ResolveTransportConfigFromEnv()
	if err != nil {
		return err
	}
	return runTransport(cfg, transportRunner{
		stderr:            stderr,
		runStdio:          RunStdio,
		runStreamableHTTP: RunStreamableHTTP,
	})
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
	if strings.TrimSpace(addr) == "" {
		addr = defaultStreamableHTTPAddr
	}
	if err := NewStreamableHTTPServer().Start(addr); err != nil {
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return fmt.Errorf("streamable http MCP gateway failed to listen on %s (already in use or cannot bind): %w", addr, err)
	}
	return nil
}

// NewStreamableHTTPServer creates a Streamable HTTP transport around the same
// configured MCP server used by stdio.
func NewStreamableHTTPServer(opts ...mcpserver.StreamableHTTPOption) *mcpserver.StreamableHTTPServer {
	opts = append([]mcpserver.StreamableHTTPOption{mcpserver.WithEndpointPath(defaultStreamableHTTPEndpoint)}, opts...)
	return mcpserver.NewStreamableHTTPServer(newStreamableHTTPMCPServer(), opts...)
}

// ResolveTransportConfigFromEnv returns the active MCP transport configuration.
func ResolveTransportConfigFromEnv() (TransportConfig, error) {
	transport, err := normalizeTransport(os.Getenv("HARNESS_MEM_MCP_TRANSPORT"))
	if err != nil {
		return TransportConfig{}, err
	}

	addr := strings.TrimSpace(os.Getenv("HARNESS_MEM_MCP_ADDR"))
	if addr == "" {
		addr = defaultStreamableHTTPAddr
	}

	return TransportConfig{
		Transport: transport,
		Addr:      addr,
		Endpoint:  defaultStreamableHTTPEndpoint,
	}, nil
}

func normalizeTransport(raw string) (string, error) {
	normalized := strings.ToLower(strings.TrimSpace(raw))
	switch normalized {
	case "", transportStdio:
		return transportStdio, nil
	case "http", transportStreamableHTTP:
		return transportStreamableHTTP, nil
	default:
		return "", fmt.Errorf("unsupported HARNESS_MEM_MCP_TRANSPORT %q (expected stdio, http, or streamable_http)", raw)
	}
}

type transportRunner struct {
	stderr            io.Writer
	runStdio          func() error
	runStreamableHTTP func(addr string) error
}

func runTransport(cfg TransportConfig, runner transportRunner) error {
	if runner.stderr == nil {
		runner.stderr = io.Discard
	}
	if cfg.Endpoint == "" {
		cfg.Endpoint = defaultStreamableHTTPEndpoint
	}
	if cfg.Addr == "" {
		cfg.Addr = defaultStreamableHTTPAddr
	}

	switch cfg.Transport {
	case transportStdio:
		return runner.runStdio()
	case transportStreamableHTTP:
		fmt.Fprintf(runner.stderr, "Harness MCP Server transport=streamable_http endpoint=%s\n", streamableHTTPEndpointURL(cfg.Addr, cfg.Endpoint))
		return runner.runStreamableHTTP(cfg.Addr)
	default:
		return fmt.Errorf("unsupported MCP transport %q", cfg.Transport)
	}
}

func streamableHTTPEndpointURL(addr, endpoint string) string {
	if strings.HasPrefix(addr, ":") {
		return "http://127.0.0.1" + addr + endpoint
	}
	return "http://" + addr + endpoint
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
