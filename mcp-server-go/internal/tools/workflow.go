// Workflow tools — 3 tools for Plan/Work/Review cycle.
// Port of mcp-server/src/tools/workflow.ts
package tools

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/mark3labs/mcp-go/mcp"

	"github.com/Chachamaru127/harness-mem/mcp-server-go/internal/types"
	"github.com/Chachamaru127/harness-mem/mcp-server-go/internal/util"
)

type reviewPerspective struct {
	Name  string
	Emoji string
	Focus string
}

var reviewPerspectives = []reviewPerspective{
	{"Security", "🔒", "vulnerabilities, auth, injection"},
	{"Performance", "⚡", "bottlenecks, memory, complexity"},
	{"Accessibility", "♿", "WCAG, screen readers, keyboard"},
	{"Maintainability", "🧹", "readability, coupling, DRY"},
	{"Testing", "🧪", "coverage, edge cases, mocking"},
	{"Error Handling", "⚠️", "exceptions, validation, recovery"},
	{"Documentation", "📚", "comments, README, API docs"},
	{"Best Practices", "✨", "patterns, conventions, idioms"},
}

func WorkflowToolDefs() []ToolDef {
	return []ToolDef{
		{wfToolPlan, func(_ context.Context, args map[string]any) types.ToolResult { return handlePlan(args) }},
		{wfToolWork, func(_ context.Context, args map[string]any) types.ToolResult { return handleWork(args) }},
		{wfToolReview, func(_ context.Context, args map[string]any) types.ToolResult { return handleReview(args) }},
	}
}

var wfToolPlan = mcp.NewTool("harness_workflow_plan",
	mcp.WithDescription("Create an implementation plan for a task. Generates structured tasks in Plans.md"),
	mcp.WithString("task", mcp.Required(), mcp.Description("Description of what you want to build or implement")),
	mcp.WithString("mode", mcp.Description("Planning mode: quick (minimal) or detailed (comprehensive)"), mcp.Enum("quick", "detailed")),
)

var wfToolWork = mcp.NewTool("harness_workflow_work",
	mcp.WithDescription("Execute tasks from Plans.md. Implements tasks marked as cc:TODO"),
	mcp.WithNumber("parallel", mcp.Description("Number of parallel workers (1-5)")),
	mcp.WithBoolean("full", mcp.Description("Run full cycle: implement -> self-review -> fix -> commit")),
	mcp.WithString("taskId", mcp.Description("Specific task ID to work on (optional)")),
)

var wfToolReview = mcp.NewTool("harness_workflow_review",
	mcp.WithDescription("Run multi-perspective code review. 8 expert reviewers analyze your code in parallel"),
	mcp.WithArray("files", mcp.Items(map[string]any{"type": "string"}), mcp.Description("Specific files to review (optional, defaults to recent changes)")),
	mcp.WithArray("focus", mcp.Items(map[string]any{"type": "string"}), mcp.Description("Review focus areas: security, performance, accessibility, etc.")),
	mcp.WithBoolean("ci", mcp.Description("CI mode: output machine-readable results")),
)

func handlePlan(args map[string]any) types.ToolResult {
	task := argString(args, "task")
	if task == "" {
		return types.ErrorText("Error: task description is required")
	}
	mode := argString(args, "mode")
	if mode == "" {
		mode = "quick"
	}

	template := fmt.Sprintf(`
## Plan: %s

### Tasks

- [ ] **Task 1**: Analyze requirements <!-- cc:TODO -->
- [ ] **Task 2**: Implement core functionality <!-- cc:TODO -->
- [ ] **Task 3**: Add tests <!-- cc:TODO -->
- [ ] **Task 4**: Documentation <!-- cc:TODO -->

### Notes

- Created via MCP: harness_workflow_plan
- Mode: %s
- Created at: %s

---

Next Step: Use harness_workflow_work to start implementation
`, task, mode, time.Now().UTC().Format(time.RFC3339))

	plansPath := filepath.Join(util.GetProjectRoot(), "Plans.md")
	existing := "# Plans\n\n"
	if data, err := os.ReadFile(plansPath); err == nil {
		existing = string(data)
	}
	_ = os.WriteFile(plansPath, []byte(existing+template), 0o644)

	return types.SuccessText(fmt.Sprintf(`Plan created for: "%s"

Tasks added to Plans.md:
- Task 1: Analyze requirements
- Task 2: Implement core functionality
- Task 3: Add tests
- Task 4: Documentation

Run harness_workflow_work to start implementation`, task))
}

func handleWork(args map[string]any) types.ToolResult {
	plansPath := filepath.Join(util.GetProjectRoot(), "Plans.md")
	data, err := os.ReadFile(plansPath)
	if err != nil {
		return types.SuccessText("Plans.md not found. Use harness_workflow_plan to create a plan first.")
	}

	content := string(data)
	todoCount := len(reTODO.FindAllString(content, -1))
	wipCount := len(reWIP.FindAllString(content, -1))

	if todoCount == 0 && wipCount == 0 {
		return types.SuccessText("No pending tasks in Plans.md. All done!")
	}

	parallel := 1
	if n, ok := argInt(args, "parallel"); ok && n > 0 {
		parallel = n
	}
	full := argBool(args, "full", false)
	taskID := argString(args, "taskId")

	workMode := "implementation only"
	if full {
		workMode = "full cycle (implement -> review -> fix -> commit)"
	}
	parallelInfo := "sequentially"
	if parallel > 1 {
		parallelInfo = fmt.Sprintf("with %d parallel workers", parallel)
	}

	targetInfo := "Will process next available task"
	if taskID != "" {
		targetInfo = fmt.Sprintf("Targeting task: %s", taskID)
	}

	return types.SuccessText(fmt.Sprintf(`Work Mode: %s %s

Task Status:
- TODO: %d
- WIP: %d

%s

To execute, the AI client should:
1. Read Plans.md to find cc:TODO tasks
2. Mark task as cc:WIP
3. Implement the task
4. Mark as cc:DONE

This tool provides work instructions. The actual implementation
should be performed by the AI client using its native capabilities.`, workMode, parallelInfo, todoCount, wipCount, targetInfo))
}

func handleReview(args map[string]any) types.ToolResult {
	files := argStringArray(args, "files")
	focus := argStringArray(args, "focus")
	ci := argBool(args, "ci", false)

	// Get files to review
	if len(files) == 0 {
		files = getRecentChanges()
	}

	if len(files) == 0 {
		return types.SuccessText("No files to review. Specify files or make some changes first.")
	}

	activePerps := reviewPerspectives
	if len(focus) > 0 {
		var filtered []reviewPerspective
		for _, p := range reviewPerspectives {
			for _, f := range focus {
				if strings.Contains(strings.ToLower(p.Name), strings.ToLower(f)) {
					filtered = append(filtered, p)
					break
				}
			}
		}
		if len(filtered) > 0 {
			activePerps = filtered
		}
	}

	if ci {
		names := make([]string, len(activePerps))
		for i, p := range activePerps {
			names[i] = p.Name
		}
		data, _ := json.Marshal(map[string]any{
			"files":        files,
			"perspectives": names,
			"status":       "pending",
		})
		return types.SuccessText(string(data))
	}

	var fileList strings.Builder
	for _, f := range files {
		fileList.WriteString(fmt.Sprintf("- %s\n", f))
	}

	var perspList strings.Builder
	for _, p := range activePerps {
		perspList.WriteString(fmt.Sprintf("%s **%s**: Check for %s\n", p.Emoji, p.Name, p.Focus))
	}

	return types.SuccessText(fmt.Sprintf(`**Harness Code Review**

Files to review (%d):
%s
Review Perspectives (%d):
%s
This tool provides review instructions. The actual review
should be performed by the AI client using its native capabilities.`, len(files), fileList.String(), len(activePerps), perspList.String()))
}

var reGitDiff = regexp.MustCompile(`\S+`)

func getRecentChanges() []string {
	cmd := exec.Command("git", "diff", "--name-only", "HEAD~1")
	cmd.Dir = util.GetProjectRoot()
	out, err := cmd.Output()
	if err != nil {
		return nil
	}
	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	var result []string
	for _, l := range lines {
		if l = strings.TrimSpace(l); l != "" {
			result = append(result, l)
		}
	}
	return result
}
