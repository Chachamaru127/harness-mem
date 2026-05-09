// Memory tools — 25 HTTP proxy tools to harness-memd.
// Port of mcp-server/src/tools/memory.ts
package tools

import (
	"context"
	"fmt"
	"math"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/Chachamaru127/harness-mem/mcp-server-go/internal/pii"
	"github.com/Chachamaru127/harness-mem/mcp-server-go/internal/proxy"
	"github.com/Chachamaru127/harness-mem/mcp-server-go/internal/types"
	"github.com/Chachamaru127/harness-mem/mcp-server-go/internal/util"
)

// selfTrackSkip lists tools that should not trigger self-tracking to avoid recursion.
var selfTrackSkip = map[string]bool{
	"harness_mem_health":            true,
	"harness_mem_record_event":      true,
	"harness_mem_record_checkpoint": true,
	"harness_mem_finalize_session":  true,
	"harness_mem_bulk_add":          true,
	// S81-A02/A03: coordination primitives are high-frequency and should
	// not trigger recursive tool-use recording.
	"harness_mem_lease_acquire": true,
	"harness_mem_lease_release": true,
	"harness_mem_lease_renew":   true,
	"harness_mem_signal_send":   true,
	"harness_mem_signal_read":   true,
	"harness_mem_signal_ack":    true,
	// S81-C03 (Codex round 10 P2): verify is a read-only audit walk.
	// Self-tracking would emit before/after tool_use events and turn
	// every provenance lookup into an action observation, polluting
	// the very store the caller is inspecting.
	"harness_mem_verify": true,
}

// MemoryToolDefs returns all memory tool definitions (25 core + 6 coordination primitives).
func MemoryToolDefs() []ToolDef {
	return []ToolDef{
		{memToolResumePack, handleMemTool("harness_mem_resume_pack")},
		{memToolSearch, handleMemTool("harness_mem_search")},
		{memToolTimeline, handleMemTool("harness_mem_timeline")},
		{memToolGetObservations, handleMemTool("harness_mem_get_observations")},
		{memToolSessionsList, handleMemTool("harness_mem_sessions_list")},
		{memToolSessionThread, handleMemTool("harness_mem_session_thread")},
		{memToolSearchFacets, handleMemTool("harness_mem_search_facets")},
		{memToolRecordCheckpoint, handleMemTool("harness_mem_record_checkpoint")},
		{memToolFinalizeSession, handleMemTool("harness_mem_finalize_session")},
		{memToolRecordEvent, handleMemTool("harness_mem_record_event")},
		{memToolHealth, handleMemTool("harness_mem_health")},
		{memToolDeleteObservation, handleMemTool("harness_mem_delete_observation")},
		{memToolAdminImportClaudeMem, handleMemTool("harness_mem_admin_import_claude_mem")},
		{memToolAdminImportStatus, handleMemTool("harness_mem_admin_import_status")},
		{memToolAdminVerifyImport, handleMemTool("harness_mem_admin_verify_import")},
		{memToolAdminReindexVectors, handleMemTool("harness_mem_admin_reindex_vectors")},
		{memToolAdminMetrics, handleMemTool("harness_mem_admin_metrics")},
		{memToolAdminConsolidationRun, handleMemTool("harness_mem_admin_consolidation_run")},
		{memToolAdminConsolidationStatus, handleMemTool("harness_mem_admin_consolidation_status")},
		{memToolAdminAuditLog, handleMemTool("harness_mem_admin_audit_log")},
		// §S109-003: inject observability.
		{memToolObservability, handleMemTool("harness_mem_observability")},
		{memToolAddRelation, handleMemTool("harness_mem_add_relation")},
		{memToolBulkAdd, handleMemTool("harness_mem_bulk_add")},
		{memToolBulkDelete, handleMemTool("harness_mem_bulk_delete")},
		{memToolExport, handleMemTool("harness_mem_export")},
		{memToolCompress, handleMemTool("harness_mem_compress")},
		{memToolStats, handleMemTool("harness_mem_stats")},
		{memToolIngest, handleMemTool("harness_mem_ingest")},
		{memToolGraph, handleMemTool("harness_mem_graph")},
		{memToolShareToTeam, handleMemTool("harness_mem_share_to_team")},
		// S81-A02: Lease primitives.
		{memToolLeaseAcquire, handleMemTool("harness_mem_lease_acquire")},
		{memToolLeaseRelease, handleMemTool("harness_mem_lease_release")},
		{memToolLeaseRenew, handleMemTool("harness_mem_lease_renew")},
		// S81-A03: Signal primitives.
		{memToolSignalSend, handleMemTool("harness_mem_signal_send")},
		{memToolSignalRead, handleMemTool("harness_mem_signal_read")},
		{memToolSignalAck, handleMemTool("harness_mem_signal_ack")},
		// S81-C03: Citation trace.
		{memToolVerify, handleMemTool("harness_mem_verify")},
	}
}

// handleMemTool wraps the inner handler with tool-use event tracking.
func handleMemTool(name string) HandlerFunc {
	return func(ctx context.Context, args map[string]any) types.ToolResult {
		platform := getMCPPlatform()
		shouldTrack := platform != "" && !selfTrackSkip[name]
		start := time.Now()

		if shouldTrack {
			go recordToolUseEvent(name, "before", platform, nil)
		}

		result := handleMemoryToolInner(ctx, name, args)

		if shouldTrack {
			dur := time.Since(start).Milliseconds()
			go recordToolUseEvent(name, "after", platform, map[string]any{
				"success":     !result.IsError,
				"duration_ms": dur,
			})
		}

		return result
	}
}

func getMCPPlatform() string {
	return strings.TrimSpace(os.Getenv("HARNESS_MEM_MCP_PLATFORM"))
}

// recordToolUseEvent fires a best-effort event to the memory server.
func recordToolUseEvent(toolName, phase, platform string, extra map[string]any) {
	payload := map[string]any{
		"tool_name": toolName,
		"phase":     phase,
		"source":    "mcp_server_hook_supplement",
	}
	for k, v := range extra {
		payload[k] = v
	}

	cwd, _ := os.Getwd()
	project := os.Getenv("HARNESS_MEM_OPENCODE_PROJECT_ROOT")
	if project == "" {
		project = cwd
	}

	body := map[string]any{
		"event": map[string]any{
			"platform":   platform,
			"project":    project,
			"session_id": fmt.Sprintf("mcp-%s-%d", platform, os.Getpid()),
			"event_type": "tool_use",
			"ts":         time.Now().UTC().Format(time.RFC3339),
			"payload":    payload,
			"tags":       []string{platform + "_mcp_tool_use", "tool.execute." + phase},
		},
	}

	// Fire and forget
	_, _ = proxy.CallMemoryAPI("POST", "/v1/events/record", body)
}

// ---- Success / Error result helpers ----

func successResult(resp *proxy.APIResponse, withCitations bool) types.ToolResult {
	if resp == nil || resp.Body == nil {
		return types.CreateJsonToolResult(map[string]any{"ok": true}, types.JsonToolResultOptions{})
	}

	var citations any
	if withCitations {
		if items, ok := resp.Body["items"].([]any); ok && len(items) > 0 {
			cits := make([]map[string]any, 0, len(items))
			for _, item := range items {
				if m, ok := item.(map[string]any); ok {
					cits = append(cits, map[string]any{
						"id":         m["id"],
						"source":     firstNonNil(m["platform"], m["source"], "harness-mem"),
						"session_id": m["session_id"],
						"timestamp":  firstNonNil(m["created_at"], m["timestamp"]),
						"type":       firstNonNil(m["type"], m["event_type"], "observation"),
					})
				}
			}
			if len(cits) > 0 {
				citations = cits
			}
		}
	}

	return types.CreateJsonToolResult(resp.Body, types.JsonToolResultOptions{Citations: citations})
}

func errorResult(message string) types.ToolResult {
	return types.CreateJsonToolResult(
		map[string]any{"ok": false, "error": message},
		types.JsonToolResultOptions{IsError: true, Text: message},
	)
}

func firstNonNil(vals ...any) any {
	for _, v := range vals {
		if v != nil {
			return v
		}
	}
	return nil
}

// ---- Consolidation shared handler ----

func runConsolidation(args map[string]any) types.ToolResult {
	payload := map[string]any{
		"reason":     argString(args, "reason"),
		"project":    argString(args, "project"),
		"session_id": argString(args, "session_id"),
		"limit":      optNum(args, "limit"),
	}
	// S81-B02: pass through the forget_policy sub-object when supplied.
	if fp, ok := args["forget_policy"].(map[string]any); ok {
		payload["forget_policy"] = fp
	}
	// S81-B03: pass through the contradiction_scan sub-object when supplied.
	if cs, ok := args["contradiction_scan"].(map[string]any); ok {
		payload["contradiction_scan"] = cs
	}
	resp, err := proxy.CallMemoryAPI("POST", "/v1/admin/consolidation/run", payload)
	if err != nil {
		return classifyError(err)
	}
	return successResult(resp, false)
}

// ---- Import path validation ----

func validateImportSourcePath(sourceDBPath string) (string, string) {
	trimmed := strings.TrimSpace(sourceDBPath)
	if trimmed == "" {
		return "", "source_db_path is required"
	}
	if strings.Contains(trimmed, "\x00") {
		return "", "source_db_path contains invalid characters"
	}

	resolved, err := filepath.Abs(trimmed)
	if err != nil {
		return "", "failed to resolve source_db_path"
	}

	ext := strings.ToLower(filepath.Ext(resolved))
	if ext != ".db" && ext != ".sqlite" && ext != ".sqlite3" {
		return "", "source_db_path must use .db/.sqlite/.sqlite3 extension"
	}

	homeDir := os.Getenv("HOME")
	projectRoot := util.GetProjectRoot()
	homeOK := homeDir != "" && isWithinPath(homeDir, resolved)
	projectOK := isWithinPath(projectRoot, resolved)
	if !homeOK && !projectOK {
		return "", "source_db_path must be under HOME or project root"
	}

	if _, err := os.Stat(resolved); os.IsNotExist(err) {
		return "", fmt.Sprintf("source_db_path not found: %s", resolved)
	}

	return resolved, ""
}

func isWithinPath(root, target string) bool {
	rel, err := filepath.Rel(root, target)
	if err != nil {
		return false
	}
	return rel == "." || (!strings.HasPrefix(rel, "..") && !filepath.IsAbs(rel))
}

// ---- Error classification ----

var (
	reConnRefused = regexp.MustCompile(`(?i)ECONNREFUSED|health check failed|failed`)
	reTimeout     = regexp.MustCompile(`(?i)timeout|timed out`)
)

func classifyError(err error) types.ToolResult {
	msg := err.Error()
	kind := "request_failed"
	if reConnRefused.MatchString(msg) {
		kind = "daemon_unavailable"
	} else if reTimeout.MatchString(msg) {
		kind = "timeout"
	}
	return errorResult(fmt.Sprintf("Memory tool failed [%s]: %s", kind, msg))
}

// optNum returns the number value or nil for JSON serialization.
func optNum(args map[string]any, key string) any {
	if n, ok := argNumber(args, key); ok {
		return n
	}
	return nil
}

func optStr(args map[string]any, key string) any {
	if s := argString(args, key); s != "" {
		return s
	}
	return nil
}

// ---- Main dispatcher ----

func handleMemoryToolInner(_ context.Context, name string, args map[string]any) types.ToolResult {
	if err := proxy.EnsureDaemon(); err != nil {
		return classifyError(err)
	}

	switch name {
	case "harness_mem_resume_pack":
		project := argString(args, "project")
		if project == "" {
			return errorResult("project is required")
		}
		// §91-003: include_partial defaults to true (omit key when true to keep
		// backward-compat with older daemon versions that ignore unknown fields).
		includePartial := argBool(args, "include_partial", true)
		// §90-002: summary_only defaults to false for backward-compat.
		summaryOnly := argBool(args, "summary_only", false)
		resumePayload := map[string]any{
			"project":         project,
			"session_id":      optStr(args, "session_id"),
			"correlation_id":  optStr(args, "correlation_id"),
			"limit":           optNum(args, "limit"),
			"include_private": argBool(args, "include_private", false),
			"include_partial": includePartial,
			"summary_only":    summaryOnly,
		}
		resp, err := proxy.CallMemoryAPI("POST", "/v1/resume-pack", resumePayload)
		if err != nil {
			return classifyError(err)
		}
		return successResult(resp, false)

	case "harness_mem_search":
		query := argString(args, "query")
		if query == "" {
			return errorResult("query is required")
		}
		sortBy := argString(args, "sort_by")
		validSorts := map[string]bool{"relevance": true, "date_desc": true, "date_asc": true}
		var sortByVal any
		if validSorts[sortBy] {
			sortByVal = sortBy
		}
		resp, err := proxy.CallMemoryAPI("POST", "/v1/search", map[string]any{
			"query":           query,
			"project":         optStr(args, "project"),
			"session_id":      optStr(args, "session_id"),
			"since":           optStr(args, "since"),
			"until":           optStr(args, "until"),
			"limit":           optNum(args, "limit"),
			"include_private": argBool(args, "include_private", false),
			"sort_by":         sortByVal,
			// §89-001 (XR-002 P0): Forward observation_type to the REST layer.
			// Go MCP schema exposes this as a single string (mcp-go has no oneOf
			// helper); the REST handler also accepts string[] and the `type:xxx`
			// query-prefix form, both of which Go callers can reach indirectly.
			"observation_type": optStr(args, "observation_type"),
		})
		if err != nil {
			return classifyError(err)
		}
		return successResult(resp, true)

	case "harness_mem_timeline":
		id := argString(args, "id")
		if id == "" {
			return errorResult("id is required")
		}
		resp, err := proxy.CallMemoryAPI("POST", "/v1/timeline", map[string]any{
			"id":              id,
			"before":          optNum(args, "before"),
			"after":           optNum(args, "after"),
			"include_private": argBool(args, "include_private", false),
		})
		if err != nil {
			return classifyError(err)
		}
		return successResult(resp, false)

	case "harness_mem_get_observations":
		ids := argStringArray(args, "ids")
		if len(ids) == 0 {
			return errorResult("ids is required")
		}
		resp, err := proxy.CallMemoryAPI("POST", "/v1/observations/get", map[string]any{
			"ids":             ids,
			"include_private": argBool(args, "include_private", false),
			"compact":         argBool(args, "compact", true),
		})
		if err != nil {
			return classifyError(err)
		}
		return successResult(resp, false)

	// S81-C03: observation citation trace.
	case "harness_mem_verify":
		observationID := argString(args, "observation_id")
		if observationID == "" {
			return errorResult("observation_id is required")
		}
		// Codex round 13 P2: forward `include_archived` so operators
		// can inspect rows archived by forget_policy without having to
		// call the HTTP endpoint directly.
		resp, err := proxy.CallMemoryAPI("POST", "/v1/observations/verify", map[string]any{
			"observation_id":    observationID,
			"include_private":   argBool(args, "include_private", false),
			"include_archived":  argBool(args, "include_archived", false),
		})
		if err != nil {
			return classifyError(err)
		}
		return successResult(resp, false)

	case "harness_mem_sessions_list":
		q := url.Values{}
		if p := argString(args, "project"); p != "" {
			q.Set("project", p)
		}
		if n, ok := argInt(args, "limit"); ok {
			q.Set("limit", strconv.Itoa(n))
		}
		q.Set("include_private", strconv.FormatBool(argBool(args, "include_private", false)))
		resp, err := proxy.CallMemoryAPI("GET", "/v1/sessions/list?"+q.Encode(), nil)
		if err != nil {
			return classifyError(err)
		}
		return successResult(resp, false)

	case "harness_mem_session_thread":
		sessionID := argString(args, "session_id")
		if sessionID == "" {
			return errorResult("session_id is required")
		}
		q := url.Values{}
		q.Set("session_id", sessionID)
		if p := argString(args, "project"); p != "" {
			q.Set("project", p)
		}
		if n, ok := argInt(args, "limit"); ok {
			q.Set("limit", strconv.Itoa(n))
		}
		q.Set("include_private", strconv.FormatBool(argBool(args, "include_private", false)))
		resp, err := proxy.CallMemoryAPI("GET", "/v1/sessions/thread?"+q.Encode(), nil)
		if err != nil {
			return classifyError(err)
		}
		return successResult(resp, false)

	case "harness_mem_search_facets":
		q := url.Values{}
		if raw := argString(args, "query"); raw != "" {
			q.Set("query", raw)
		}
		if p := argString(args, "project"); p != "" {
			q.Set("project", p)
		}
		q.Set("include_private", strconv.FormatBool(argBool(args, "include_private", false)))
		resp, err := proxy.CallMemoryAPI("GET", "/v1/search/facets?"+q.Encode(), nil)
		if err != nil {
			return classifyError(err)
		}
		return successResult(resp, false)

	case "harness_mem_record_checkpoint":
		sessionID := argString(args, "session_id")
		title := argString(args, "title")
		rawContent := argString(args, "content")
		if sessionID == "" || title == "" || rawContent == "" {
			return errorResult("session_id, title, content are required")
		}
		content := rawContent
		if rules := pii.GetActiveRules(); rules != nil {
			content = pii.ApplyFilter(rawContent, rules)
		}
		resp, err := proxy.CallMemoryAPI("POST", "/v1/checkpoints/record", map[string]any{
			"platform":     optStr(args, "platform"),
			"project":      optStr(args, "project"),
			"session_id":   sessionID,
			"title":        title,
			"content":      content,
			"tags":         argStringArray(args, "tags"),
			"privacy_tags": argStringArray(args, "privacy_tags"),
		})
		if err != nil {
			return classifyError(err)
		}
		return successResult(resp, false)

	case "harness_mem_finalize_session":
		sessionID := argString(args, "session_id")
		if sessionID == "" {
			return errorResult("session_id is required")
		}
		resp, err := proxy.CallMemoryAPI("POST", "/v1/sessions/finalize", map[string]any{
			"platform":       optStr(args, "platform"),
			"project":        optStr(args, "project"),
			"session_id":     sessionID,
			"correlation_id": optStr(args, "correlation_id"),
			"summary_mode":   optStr(args, "summary_mode"),
			// §91-001: partial finalize — generate summary without closing session
			"partial": argBool(args, "partial", false),
			// persist detected skill as a reusable observation
			"persist_skill": argBool(args, "persist_skill", false),
		})
		if err != nil {
			return classifyError(err)
		}
		return successResult(resp, false)

	case "harness_mem_record_event":
		event := argObject(args, "event")
		if len(event) == 0 {
			return errorResult("event is required")
		}
		resp, err := proxy.CallMemoryAPI("POST", "/v1/events/record", map[string]any{"event": event})
		if err != nil {
			return classifyError(err)
		}
		return successResult(resp, false)

	case "harness_mem_health":
		resp, err := proxy.CallMemoryAPI("GET", "/health", nil)
		if err != nil {
			return classifyError(err)
		}
		return successResult(resp, false)

	case "harness_mem_delete_observation":
		obsID := argString(args, "observation_id")
		if obsID == "" {
			return errorResult("observation_id is required")
		}
		resp, err := proxy.CallMemoryAPI("DELETE", "/v1/observations/"+url.PathEscape(obsID), nil)
		if err != nil {
			return classifyError(err)
		}
		return successResult(resp, false)

	case "harness_mem_admin_import_claude_mem":
		sourceDB := argString(args, "source_db_path")
		if sourceDB == "" {
			return errorResult("source_db_path is required")
		}
		resolved, reason := validateImportSourcePath(sourceDB)
		if reason != "" {
			return errorResult(reason)
		}
		resp, err := proxy.CallMemoryAPI("POST", "/v1/admin/imports/claude-mem", map[string]any{
			"source_db_path": resolved,
			"project":        optStr(args, "project"),
			"dry_run":        argBool(args, "dry_run", false),
		})
		if err != nil {
			return classifyError(err)
		}
		return successResult(resp, false)

	case "harness_mem_admin_import_status":
		jobID := argString(args, "job_id")
		if jobID == "" {
			return errorResult("job_id is required")
		}
		resp, err := proxy.CallMemoryAPI("GET", "/v1/admin/imports/"+url.PathEscape(jobID), nil)
		if err != nil {
			return classifyError(err)
		}
		return successResult(resp, false)

	case "harness_mem_admin_verify_import":
		jobID := argString(args, "job_id")
		if jobID == "" {
			return errorResult("job_id is required")
		}
		resp, err := proxy.CallMemoryAPI("POST", "/v1/admin/imports/"+url.PathEscape(jobID)+"/verify", map[string]any{})
		if err != nil {
			return classifyError(err)
		}
		return successResult(resp, false)

	case "harness_mem_admin_reindex_vectors":
		resp, err := proxy.CallMemoryAPI("POST", "/v1/admin/reindex-vectors", map[string]any{
			"limit": optNum(args, "limit"),
		})
		if err != nil {
			return classifyError(err)
		}
		return successResult(resp, false)

	case "harness_mem_admin_metrics":
		resp, err := proxy.CallMemoryAPI("GET", "/v1/admin/metrics", nil)
		if err != nil {
			return classifyError(err)
		}
		return successResult(resp, false)

	case "harness_mem_admin_consolidation_run":
		return runConsolidation(args)

	case "harness_mem_admin_consolidation_status":
		resp, err := proxy.CallMemoryAPI("GET", "/v1/admin/consolidation/status", nil)
		if err != nil {
			return classifyError(err)
		}
		return successResult(resp, false)

	case "harness_mem_admin_audit_log":
		q := url.Values{}
		if n, ok := argInt(args, "limit"); ok {
			q.Set("limit", strconv.Itoa(n))
		}
		if a := argString(args, "action"); a != "" {
			q.Set("action", a)
		}
		if t := argString(args, "target_type"); t != "" {
			q.Set("target_type", t)
		}
		resp, err := proxy.CallMemoryAPI("GET", "/v1/admin/audit-log?"+q.Encode(), nil)
		if err != nil {
			return classifyError(err)
		}
		return successResult(resp, false)

	case "harness_mem_observability":
		// §S109-003: passthrough to /v1/admin/inject-observability.
		// The TS endpoint returns the raw aggregator JSON shape (not the
		// usual ApiResponse envelope), so we use successResult-with-raw
		// here to avoid wrapping it twice.
		sessionID := argString(args, "session_id")
		if sessionID == "" {
			return errorResult("session_id is required")
		}
		q := url.Values{}
		q.Set("session_id", sessionID)
		if n, ok := argInt(args, "since_ms"); ok {
			q.Set("since_ms", strconv.Itoa(n))
		}
		if n, ok := argInt(args, "until_ms"); ok {
			q.Set("until_ms", strconv.Itoa(n))
		}
		resp, err := proxy.CallMemoryAPI("GET", "/v1/admin/inject-observability?"+q.Encode(), nil)
		if err != nil {
			return classifyError(err)
		}
		return successResult(resp, false)

	case "harness_mem_add_relation":
		fromID := argString(args, "from_observation_id")
		toID := argString(args, "to_observation_id")
		relation := argString(args, "relation")
		if fromID == "" || toID == "" || relation == "" {
			return errorResult("from_observation_id, to_observation_id, relation are required")
		}
		resp, err := proxy.CallMemoryAPI("POST", "/v1/links/create", map[string]any{
			"from_observation_id": fromID,
			"to_observation_id":   toID,
			"relation":            relation,
			"weight":              optNum(args, "weight"),
		})
		if err != nil {
			return classifyError(err)
		}
		return successResult(resp, false)

	case "harness_mem_bulk_add":
		events, ok := args["events"].([]any)
		if !ok || len(events) == 0 {
			return errorResult("events is required and must not be empty")
		}
		var results []any
		for _, ev := range events {
			evMap, ok := ev.(map[string]any)
			if !ok {
				continue
			}
			resp, err := proxy.CallMemoryAPI("POST", "/v1/events/record", map[string]any{"event": evMap})
			if err != nil {
				results = append(results, map[string]any{"ok": false, "error": err.Error()})
			} else {
				results = append(results, resp.Body)
			}
		}
		combined := map[string]any{
			"ok":     true,
			"source": "core",
			"items":  results,
			"meta":   map[string]any{"count": len(results), "latency_ms": 0, "filters": map[string]any{}, "ranking": "bulk_add_v1"},
		}
		return types.CreateJsonToolResult(combined, types.JsonToolResultOptions{})

	case "harness_mem_bulk_delete":
		ids := argStringArray(args, "ids")
		if len(ids) == 0 {
			return errorResult("ids is required and must not be empty")
		}
		resp, err := proxy.CallMemoryAPI("POST", "/v1/observations/bulk-delete", map[string]any{"ids": ids})
		if err != nil {
			return classifyError(err)
		}
		return successResult(resp, false)

	case "harness_mem_export":
		q := url.Values{}
		if p := argString(args, "project"); p != "" {
			q.Set("project", p)
		}
		if n, ok := argInt(args, "limit"); ok {
			q.Set("limit", strconv.Itoa(n))
		}
		q.Set("include_private", strconv.FormatBool(argBool(args, "include_private", false)))
		resp, err := proxy.CallMemoryAPI("GET", "/v1/export?"+q.Encode(), nil)
		if err != nil {
			return classifyError(err)
		}
		return successResult(resp, false)

	case "harness_mem_compress":
		return runConsolidation(args)

	case "harness_mem_stats":
		q := url.Values{}
		q.Set("include_private", strconv.FormatBool(argBool(args, "include_private", false)))
		resp, err := proxy.CallMemoryAPI("GET", "/v1/projects/stats?"+q.Encode(), nil)
		if err != nil {
			return classifyError(err)
		}
		return successResult(resp, false)

	case "harness_mem_ingest":
		filePath := argString(args, "file_path")
		content := argString(args, "content")
		if filePath == "" || content == "" {
			return errorResult("file_path and content are required")
		}
		resp, err := proxy.CallMemoryAPI("POST", "/v1/ingest/document", map[string]any{
			"file_path":  filePath,
			"content":    content,
			"kind":       optStr(args, "kind"),
			"project":    optStr(args, "project"),
			"platform":   optStr(args, "platform"),
			"session_id": optStr(args, "session_id"),
			// §78-D01 temporal forgetting — optional TTL on the ingested document.
			"expires_at": optStr(args, "expires_at"),
		})
		if err != nil {
			return classifyError(err)
		}
		return successResult(resp, false)

	case "harness_mem_graph":
		obsID := argString(args, "observation_id")
		if obsID == "" {
			return errorResult("observation_id is required")
		}
		q := url.Values{}
		q.Set("observation_id", obsID)
		if r := argString(args, "relation"); r != "" {
			q.Set("relation", r)
		}
		if d, ok := argInt(args, "depth"); ok {
			clamped := int(math.Min(math.Max(float64(d), 1), 5))
			q.Set("depth", strconv.Itoa(clamped))
		}
		resp, err := proxy.CallMemoryAPI("GET", "/v1/graph/neighbors?"+q.Encode(), nil)
		if err != nil {
			return classifyError(err)
		}
		return successResult(resp, false)

	case "harness_mem_share_to_team":
		obsID := argString(args, "observation_id")
		teamID := argString(args, "team_id")
		if obsID == "" {
			return errorResult("observation_id is required")
		}
		if teamID == "" {
			return errorResult("team_id is required")
		}
		resp, err := proxy.CallMemoryAPI("POST", "/v1/observations/share", map[string]any{
			"observation_id": obsID,
			"team_id":        teamID,
		})
		if err != nil {
			return classifyError(err)
		}
		return successResult(resp, false)

	// S81-A02: Lease primitives for inter-agent coordination.
	case "harness_mem_lease_acquire":
		target := argString(args, "target")
		agentID := argString(args, "agent_id")
		if target == "" || agentID == "" {
			return errorResult("target and agent_id are required")
		}
		// S81-A02/A03 project scoping (Codex round 6/8/11):
		// - prefer explicit `project` (canonicalised if it looks like
		//   a path) → else resolve from explicit `cwd`
		// - neither set → REJECT with scope_required so two unrelated
		//   repos using a common target like `file:README.md` or a
		//   shared agent id can never collide on a null-project row.
		scope := resolveProjectScope(args)
		if scope == "" {
			return errorResult("scope_required: pass project or cwd to avoid cross-repo collisions on shared targets. If you really want a global lease, pass project=\"__global__\" explicitly.")
		}
		payload := map[string]any{"target": target, "agent_id": agentID, "project": scope}
		if n, ok := argNumber(args, "ttl_ms"); ok {
			payload["ttl_ms"] = n
		}
		if md, ok := args["metadata"].(map[string]any); ok {
			payload["metadata"] = md
		}
		resp, err := proxy.CallMemoryAPI("POST", "/v1/lease/acquire", payload)
		if err != nil {
			return classifyError(err)
		}
		return successResult(resp, false)

	case "harness_mem_lease_release":
		leaseID := argString(args, "lease_id")
		agentID := argString(args, "agent_id")
		if leaseID == "" || agentID == "" {
			return errorResult("lease_id and agent_id are required")
		}
		resp, err := proxy.CallMemoryAPI("POST", "/v1/lease/release", map[string]any{
			"lease_id": leaseID,
			"agent_id": agentID,
		})
		if err != nil {
			return classifyError(err)
		}
		return successResult(resp, false)

	case "harness_mem_lease_renew":
		leaseID := argString(args, "lease_id")
		agentID := argString(args, "agent_id")
		if leaseID == "" || agentID == "" {
			return errorResult("lease_id and agent_id are required")
		}
		payload := map[string]any{"lease_id": leaseID, "agent_id": agentID}
		if n, ok := argNumber(args, "ttl_ms"); ok {
			payload["ttl_ms"] = n
		}
		resp, err := proxy.CallMemoryAPI("POST", "/v1/lease/renew", payload)
		if err != nil {
			return classifyError(err)
		}
		return successResult(resp, false)

	// S81-A03: Signal primitives for inter-agent messaging.
	case "harness_mem_signal_send":
		from := argString(args, "from")
		content := argString(args, "content")
		if from == "" || content == "" {
			return errorResult("from and content are required")
		}
		// S81-A03 project scoping (Codex round 11 P1): same scope_required
		// semantics as lease_acquire. A signal with no scope becomes a
		// global broadcast addressable by anyone reusing `from`, which
		// leaks contents across repos. Reply-to is the only exception
		// because the store derives the project from the parent signal.
		replyTo := argString(args, "reply_to")
		scope := resolveProjectScope(args)
		if scope == "" && replyTo == "" {
			return errorResult("scope_required: pass project or cwd (or reply_to to inherit the parent's scope) so signals stay repo-isolated.")
		}
		payload := map[string]any{"from": from, "content": content}
		if v := argString(args, "to"); v != "" {
			payload["to"] = v
		}
		if v := argString(args, "thread_id"); v != "" {
			payload["thread_id"] = v
		}
		if replyTo != "" {
			payload["reply_to"] = replyTo
		}
		if scope != "" {
			payload["project"] = scope
		}
		if n, ok := argNumber(args, "expires_in_ms"); ok {
			payload["expires_in_ms"] = n
		}
		resp, err := proxy.CallMemoryAPI("POST", "/v1/signal/send", payload)
		if err != nil {
			return classifyError(err)
		}
		return successResult(resp, false)

	case "harness_mem_signal_read":
		agentID := argString(args, "agent_id")
		if agentID == "" {
			return errorResult("agent_id is required")
		}
		// S81-A03 project scoping — Codex round 13 P1:
		// `all_projects` is deliberately *not* accepted via the MCP
		// surface. The HTTP /v1/signal/read route validates the caller
		// is admin; MCP proxies typically front the daemon with a
		// shared admin/service token so the HTTP check cannot
		// distinguish between the proxy's identity and the end user.
		// Admin tooling that genuinely needs the cross-project view
		// must hit /v1/signal/read over HTTP directly with an admin
		// credential.
		scope := resolveProjectScope(args)
		if scope == "" {
			return errorResult("scope_required: pass project or cwd to read repo-scoped signals. The cross-project (admin) view is available only via the HTTP /v1/signal/read endpoint.")
		}
		payload := map[string]any{"agent_id": agentID, "project": scope}
		if v := argString(args, "thread_id"); v != "" {
			payload["thread_id"] = v
		}
		if v, ok := args["include_broadcast"].(bool); ok {
			payload["include_broadcast"] = v
		}
		if n, ok := argNumber(args, "limit"); ok {
			payload["limit"] = n
		}
		resp, err := proxy.CallMemoryAPI("POST", "/v1/signal/read", payload)
		if err != nil {
			return classifyError(err)
		}
		return successResult(resp, false)

	case "harness_mem_signal_ack":
		signalID := argString(args, "signal_id")
		agentID := argString(args, "agent_id")
		if signalID == "" || agentID == "" {
			return errorResult("signal_id and agent_id are required")
		}
		resp, err := proxy.CallMemoryAPI("POST", "/v1/signal/ack", map[string]any{
			"signal_id": signalID,
			"agent_id":  agentID,
		})
		if err != nil {
			return classifyError(err)
		}
		return successResult(resp, false)

	default:
		return errorResult(fmt.Sprintf("Unknown memory tool: %s", name))
	}
}
