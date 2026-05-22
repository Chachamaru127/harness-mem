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
	"context"
	"fmt"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/Chachamaru127/harness-mem/mcp-server-go/internal/auth"
	"github.com/Chachamaru127/harness-mem/mcp-server-go/internal/server"
	"github.com/Chachamaru127/harness-mem/mcp-server-go/internal/telemetry"
)

func main() {
	// Inject auth identity into environment
	identity := auth.InjectFromEnvironment(nil)
	fmt.Fprintf(os.Stderr, "Harness MCP Server started (user_id=%s, team_id=%s)\n",
		identity.UserID, identity.TeamID)

	tel := telemetry.InitFromEnv("harness-mem-mcp-gateway", "1.0.0")
	defer func() {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = tel.Shutdown(ctx, "process-exit")
	}()
	signals := make(chan os.Signal, 1)
	signal.Notify(signals, os.Interrupt, syscall.SIGTERM)
	go func() {
		sig := <-signals
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := tel.Shutdown(ctx, sig.String()); err != nil {
			fmt.Fprintf(os.Stderr, "telemetry flush failed: %v\n", err)
		}
		os.Exit(0)
	}()

	if err := server.RunFromEnv(os.Stderr); err != nil {
		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = tel.Shutdown(ctx, "fatal-error")
		fmt.Fprintf(os.Stderr, "Fatal error: %v\n", err)
		os.Exit(1)
	}
}
