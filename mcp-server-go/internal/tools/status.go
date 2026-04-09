// Status tool — 1 tool for project status aggregation.
// Port of mcp-server/src/tools/status.ts
package tools

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/mark3labs/mcp-go/mcp"

	"github.com/Chachamaru127/harness-mem/mcp-server-go/internal/types"
	"github.com/Chachamaru127/harness-mem/mcp-server-go/internal/util"
)

var (
	reTODO = regexp.MustCompile(`cc:TODO`)
	reWIP  = regexp.MustCompile(`cc:WIP`)
	reDONE = regexp.MustCompile(`cc:DONE`)
)

var ssotFiles = []string{
	".claude/memory/decisions.md",
	".claude/memory/patterns.md",
	"AGENTS.md",
	"CLAUDE.md",
}

func StatusToolDefs() []ToolDef {
	return []ToolDef{
		{statusTool, func(_ context.Context, args map[string]any) types.ToolResult { return handleStatus(args) }},
	}
}

var statusTool = mcp.NewTool("harness_status",
	mcp.WithDescription("Get current project status including Plans.md progress, active sessions, and recent activity"),
	mcp.WithBoolean("verbose", mcp.Description("Include detailed information")),
)

func handleStatus(args map[string]any) types.ToolResult {
	verbose := argBool(args, "verbose", false)
	projectRoot := util.GetProjectRoot()

	var sb strings.Builder
	sb.WriteString("**Harness Status**\n\n")
	sb.WriteString(fmt.Sprintf("Project: %s\n", filepath.Base(projectRoot)))

	// Version
	versionFile := filepath.Join(projectRoot, ".claude-code-harness-version")
	if data, err := os.ReadFile(versionFile); err == nil {
		sb.WriteString(fmt.Sprintf("Harness: v%s\n", strings.TrimSpace(string(data))))
	}
	sb.WriteString("\n")

	// Plans status
	plansPath := filepath.Join(projectRoot, "Plans.md")
	if data, err := os.ReadFile(plansPath); err == nil {
		content := string(data)
		todo := len(reTODO.FindAllString(content, -1))
		wip := len(reWIP.FindAllString(content, -1))
		done := len(reDONE.FindAllString(content, -1))
		total := todo + wip + done
		progress := 0
		if total > 0 {
			progress = done * 100 / total
		}
		sb.WriteString("**Plans.md**\n")
		sb.WriteString(fmt.Sprintf("  TODO: %d\n  WIP: %d\n  Done: %d\n  Progress: %d%%\n\n", todo, wip, done, progress))
	} else {
		sb.WriteString("Plans.md: Not found\n\n")
	}

	// Sessions
	sessionCount := getActiveSessionCount()
	unreadCount := getUnreadMessageCount(projectRoot)
	sb.WriteString("**Sessions**\n")
	sb.WriteString(fmt.Sprintf("  Active: %d\n  Unread messages: %d\n\n", sessionCount, unreadCount))

	// Verbose
	if verbose {
		sb.WriteString(fmt.Sprintf("**Project Root**: %s\n\n**SSOT Files**:\n", projectRoot))
		for _, f := range ssotFiles {
			exists := "x"
			if _, err := os.Stat(filepath.Join(projectRoot, f)); err == nil {
				exists = "ok"
			}
			sb.WriteString(fmt.Sprintf("  [%s] %s\n", exists, f))
		}
		sb.WriteString("\n")
	}

	// Suggestion
	sb.WriteString("**Suggested Action**: ")
	if _, err := os.Stat(plansPath); os.IsNotExist(err) {
		sb.WriteString("Use harness_workflow_plan to create a plan")
	} else if data, err := os.ReadFile(plansPath); err == nil {
		content := string(data)
		todo := len(reTODO.FindAllString(content, -1))
		wip := len(reWIP.FindAllString(content, -1))
		if todo > 0 {
			sb.WriteString(fmt.Sprintf("Use harness_workflow_work to implement %d pending task(s)", todo))
		} else if wip > 0 {
			sb.WriteString(fmt.Sprintf("Continue working on %d in-progress task(s)", wip))
		} else {
			sb.WriteString("All tasks complete! Use harness_workflow_review to review changes")
		}
	}

	return types.SuccessText(sb.String())
}

func getActiveSessionCount() int {
	sessions := util.SafeReadJSON[map[string]Session](
		filepath.Join(util.GetProjectRoot(), util.ActiveSessionsFile),
		map[string]Session{},
	)
	now := float64(time.Now().Unix())
	count := 0
	for _, s := range sessions {
		if now-s.LastSeen < float64(util.StaleThresholdSeconds) {
			count++
		}
	}
	return count
}

func getUnreadMessageCount(projectRoot string) int {
	// Broadcast is markdown, not JSON — just count recent entries
	data, err := os.ReadFile(filepath.Join(projectRoot, util.BroadcastFile))
	if err != nil {
		return 0
	}
	cutoff := time.Now().Add(-1 * time.Hour)
	matches := broadcastRegex.FindAllStringSubmatch(string(data), -1)
	count := 0
	for _, m := range matches {
		t, err := time.Parse("2006-01-02T15:04:05Z", m[1])
		if err == nil && t.After(cutoff) {
			count++
		}
	}
	return count
}
