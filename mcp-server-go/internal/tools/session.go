// Session tools — 4 local file I/O tools for cross-session communication.
// Port of mcp-server/src/tools/session.ts
package tools

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/mark3labs/mcp-go/mcp"

	"github.com/Chachamaru127/harness-mem/mcp-server-go/internal/types"
	"github.com/Chachamaru127/harness-mem/mcp-server-go/internal/util"
)

// Session represents a registered client session.
type Session struct {
	ID       string  `json:"id"`
	Client   string  `json:"client"`
	LastSeen float64 `json:"lastSeen"`
	PID      string  `json:"pid,omitempty"`
}

// BroadcastMessage represents a message in broadcast.md.
type BroadcastMessage struct {
	Timestamp string `json:"timestamp"`
	SessionID string `json:"sessionId"`
	Client    string `json:"client"`
	Message   string `json:"message"`
}

// broadcastRegex parses Markdown broadcast entries.
var broadcastRegex = regexp.MustCompile(`(?ms)^## (\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z) \[([^\]]+)\]\n(.+?)(?:\n## |\n*$)`)

func SessionToolDefs() []ToolDef {
	return []ToolDef{
		{sessionToolList, func(_ context.Context, _ map[string]any) types.ToolResult { return handleListSessions() }},
		{sessionToolBroadcast, func(_ context.Context, args map[string]any) types.ToolResult { return handleBroadcast(args) }},
		{sessionToolInbox, func(_ context.Context, args map[string]any) types.ToolResult { return handleInbox(args) }},
		{sessionToolRegister, func(_ context.Context, args map[string]any) types.ToolResult { return handleRegister(args) }},
	}
}

var sessionToolList = mcp.NewTool("harness_session_list",
	mcp.WithDescription("List all active Harness sessions across different AI clients (Claude Code, Codex, etc.)"),
)

var sessionToolBroadcast = mcp.NewTool("harness_session_broadcast",
	mcp.WithDescription("Broadcast a message to all active sessions. Use this to notify other sessions about important changes (API modifications, schema updates, etc.)"),
	mcp.WithString("message", mcp.Required(), mcp.Description("The message to broadcast to all sessions")),
)

var sessionToolInbox = mcp.NewTool("harness_session_inbox",
	mcp.WithDescription("Check inbox for messages from other sessions. Returns unread messages since last check."),
	mcp.WithString("since", mcp.Description("ISO timestamp to get messages since (optional)")),
)

var sessionToolRegister = mcp.NewTool("harness_session_register",
	mcp.WithDescription("Register current session with the Harness MCP server. Call this when starting a new session."),
	mcp.WithString("client", mcp.Required(), mcp.Description("Client name (e.g., 'claude-code', 'codex', 'cursor')")),
	mcp.WithString("sessionId", mcp.Required(), mcp.Description("Unique session identifier")),
)

// ---- Helpers ----

func sessionsDir() string {
	return filepath.Join(util.GetProjectRoot(), util.SessionsDir)
}

func activeSessionsPath() string {
	return filepath.Join(util.GetProjectRoot(), util.ActiveSessionsFile)
}

func broadcastPath() string {
	return filepath.Join(util.GetProjectRoot(), util.BroadcastFile)
}

func loadSessions() map[string]Session {
	_ = util.EnsureDir(sessionsDir())
	return util.SafeReadJSON[map[string]Session](activeSessionsPath(), map[string]Session{})
}

func saveSessions(sessions map[string]Session) {
	_ = util.EnsureDir(sessionsDir())
	util.SafeWriteJSON(activeSessionsPath(), sessions)
}

func loadBroadcasts() []BroadcastMessage {
	_ = util.EnsureDir(sessionsDir())
	data, err := os.ReadFile(broadcastPath())
	if err != nil {
		return nil
	}
	content := string(data)
	matches := broadcastRegex.FindAllStringSubmatch(content, -1)
	msgs := make([]BroadcastMessage, 0, len(matches))
	for _, m := range matches {
		msgs = append(msgs, BroadcastMessage{
			Timestamp: m[1],
			SessionID: m[2],
			Client:    "cli",
			Message:   strings.TrimSpace(m[3]),
		})
	}
	return msgs
}

func appendBroadcast(msg BroadcastMessage) {
	_ = util.EnsureDir(sessionsDir())
	entry := fmt.Sprintf("## %s [%s]\n%s\n\n", msg.Timestamp, msg.SessionID, msg.Message)
	f, err := os.OpenFile(broadcastPath(), os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		fmt.Fprintf(os.Stderr, "[harness-mcp] Failed to append broadcast: %v\n", err)
		return
	}
	f.WriteString(entry)
	f.Close()

	// Deferred trim (goroutine replaces setImmediate)
	go func() {
		msgs := loadBroadcasts()
		if len(msgs) > util.MaxBroadcastMessages {
			trimmed := msgs[len(msgs)-util.MaxBroadcastMessages:]
			var sb strings.Builder
			for _, m := range trimmed {
				sb.WriteString(fmt.Sprintf("## %s [%s]\n%s\n\n", m.Timestamp, m.SessionID, m.Message))
			}
			_ = os.WriteFile(broadcastPath(), []byte(sb.String()), 0o644)
		}
	}()
}

// ---- Handlers ----

func handleListSessions() types.ToolResult {
	sessions := loadSessions()
	now := float64(time.Now().Unix())

	var lines []string
	for _, s := range sessions {
		if now-s.LastSeen < float64(util.StaleThresholdSeconds) {
			age := int(now - s.LastSeen)
			id := s.ID
			if len(id) > 12 {
				id = id[:12]
			}
			lines = append(lines, fmt.Sprintf("- %s (%s) - %s", id, s.Client, util.FormatTimeAgo(age)))
		}
	}

	text := "No active sessions found"
	if len(lines) > 0 {
		text = "Active Sessions:\n" + strings.Join(lines, "\n")
	}
	return types.SuccessText(text)
}

func handleBroadcast(args map[string]any) types.ToolResult {
	message := argString(args, "message")
	if message == "" {
		return types.ErrorText("Error: message is required")
	}

	ts := time.Now().UTC().Format("2006-01-02T15:04:05Z")
	sessionID := os.Getenv("HARNESS_SESSION_ID")
	if sessionID == "" {
		sessionID = "mcp-session"
	}

	appendBroadcast(BroadcastMessage{
		Timestamp: ts,
		SessionID: sessionID,
		Client:    envOrDefault("HARNESS_CLIENT", "mcp"),
		Message:   message,
	})

	return types.SuccessText(fmt.Sprintf("Broadcast sent: \"%s\"", message))
}

func handleInbox(args map[string]any) types.ToolResult {
	broadcasts := loadBroadcasts()

	var since time.Time
	if s := argString(args, "since"); s != "" {
		t, err := time.Parse(time.RFC3339, s)
		if err == nil {
			since = t
		}
	}
	if since.IsZero() {
		since = time.Now().Add(-1 * time.Hour)
	}

	var unread []BroadcastMessage
	for _, msg := range broadcasts {
		t, err := time.Parse("2006-01-02T15:04:05Z", msg.Timestamp)
		if err == nil && t.After(since) {
			unread = append(unread, msg)
		}
	}

	if len(unread) == 0 {
		return types.SuccessText("No new messages")
	}

	var lines []string
	for _, msg := range unread {
		t, _ := time.Parse("2006-01-02T15:04:05Z", msg.Timestamp)
		lines = append(lines, fmt.Sprintf("[%s] %s: %s", t.Format("15:04:05"), msg.Client, msg.Message))
	}

	return types.SuccessText(fmt.Sprintf("%d message(s):\n%s", len(unread), strings.Join(lines, "\n")))
}

func handleRegister(args map[string]any) types.ToolResult {
	client := argString(args, "client")
	sessionID := argString(args, "sessionId")

	if client == "" || sessionID == "" {
		return types.ErrorText("Error: client and sessionId are required")
	}
	if !util.IsValidID(sessionID) {
		return types.ErrorText("Error: sessionId must be alphanumeric with dashes/underscores (1-128 chars)")
	}
	if !util.IsValidID(client) {
		return types.ErrorText("Error: client must be alphanumeric with dashes/underscores (1-128 chars)")
	}

	sessions := loadSessions()
	sessions[sessionID] = Session{
		ID:       sessionID,
		Client:   client,
		LastSeen: float64(time.Now().Unix()),
		PID:      strconv.Itoa(os.Getpid()),
	}
	saveSessions(sessions)

	os.Setenv("HARNESS_SESSION_ID", sessionID)
	os.Setenv("HARNESS_CLIENT", client)

	return types.SuccessText(fmt.Sprintf("Session registered: %s (%s)", sessionID, client))
}

func envOrDefault(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}
