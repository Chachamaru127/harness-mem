// Harness MCP Server (Go)
//
// Drop-in replacement for the TypeScript MCP server.
// Communicates with the TypeScript memory server via HTTP proxy.
//
// Usage:
//
//	./harness-mcp-server
//	(launched by Claude Code as MCP subprocess via stdio)
package main

import (
	"fmt"
	"os"

	"github.com/Chachamaru127/harness-mem/mcp-server-go/internal/auth"
	"github.com/Chachamaru127/harness-mem/mcp-server-go/internal/server"
)

func main() {
	// Inject auth identity into environment
	identity := auth.InjectFromEnvironment(nil)
	fmt.Fprintf(os.Stderr, "Harness MCP Server started (user_id=%s, team_id=%s)\n",
		identity.UserID, identity.TeamID)

	if err := server.RunFromEnv(os.Stderr); err != nil {
		fmt.Fprintf(os.Stderr, "Fatal error: %v\n", err)
		os.Exit(1)
	}
}
