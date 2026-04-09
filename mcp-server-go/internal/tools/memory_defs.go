// Memory tool MCP definitions — exact schema parity with TypeScript.
package tools

import "github.com/mark3labs/mcp-go/mcp"

var memToolResumePack = mcp.NewTool("harness_mem_resume_pack",
	mcp.WithDescription("Get cross-platform resume context pack for a project/session. Supports correlation_id to fetch context across all related sessions."),
	mcp.WithString("project", mcp.Required()),
	mcp.WithString("session_id"),
	mcp.WithString("correlation_id"),
	mcp.WithNumber("limit"),
	mcp.WithBoolean("include_private"),
)

var memToolSearch = mcp.NewTool("harness_mem_search",
	mcp.WithDescription("Step 1 of 3-layer workflow (search -> timeline -> get_observations). Returns candidate IDs with meta.token_estimate."),
	mcp.WithString("query", mcp.Required()),
	mcp.WithString("project"),
	mcp.WithString("session_id"),
	mcp.WithString("since"),
	mcp.WithString("until"),
	mcp.WithNumber("limit"),
	mcp.WithBoolean("include_private"),
	mcp.WithString("sort_by", mcp.Description("Sort order: relevance (default), date_desc (newest first), date_asc (oldest first)"), mcp.Enum("relevance", "date_desc", "date_asc")),
)

var memToolTimeline = mcp.NewTool("harness_mem_timeline",
	mcp.WithDescription("Step 2 of 3-layer workflow. Expands one observation into before/after context with meta.token_estimate."),
	mcp.WithString("id", mcp.Required()),
	mcp.WithNumber("before"),
	mcp.WithNumber("after"),
	mcp.WithBoolean("include_private"),
)

var memToolGetObservations = mcp.NewTool("harness_mem_get_observations",
	mcp.WithDescription("Step 3 of 3-layer workflow. Fetch full details only for filtered IDs. Returns meta.token_estimate and warnings for large batches."),
	mcp.WithArray("ids", mcp.Required(), mcp.Items(map[string]any{"type": "string"})),
	mcp.WithBoolean("include_private"),
	mcp.WithBoolean("compact"),
)

var memToolSessionsList = mcp.NewTool("harness_mem_sessions_list",
	mcp.WithDescription("List sessions with summary/count metadata for a project."),
	mcp.WithString("project"),
	mcp.WithNumber("limit"),
	mcp.WithBoolean("include_private"),
)

var memToolSessionThread = mcp.NewTool("harness_mem_session_thread",
	mcp.WithDescription("Get ordered thread events for a session."),
	mcp.WithString("session_id", mcp.Required()),
	mcp.WithString("project"),
	mcp.WithNumber("limit"),
	mcp.WithBoolean("include_private"),
)

var memToolSearchFacets = mcp.NewTool("harness_mem_search_facets",
	mcp.WithDescription("Get project/type/tag/time facets for a query."),
	mcp.WithString("query"),
	mcp.WithString("project"),
	mcp.WithBoolean("include_private"),
)

var memToolRecordCheckpoint = mcp.NewTool("harness_mem_record_checkpoint",
	mcp.WithDescription("Record a checkpoint observation for a session."),
	mcp.WithString("platform"),
	mcp.WithString("project"),
	mcp.WithString("session_id", mcp.Required()),
	mcp.WithString("title", mcp.Required()),
	mcp.WithString("content", mcp.Required()),
	mcp.WithArray("tags", mcp.Items(map[string]any{"type": "string"})),
	mcp.WithArray("privacy_tags", mcp.Items(map[string]any{"type": "string"})),
)

var memToolFinalizeSession = mcp.NewTool("harness_mem_finalize_session",
	mcp.WithDescription("Finalize session and generate summary."),
	mcp.WithString("platform"),
	mcp.WithString("project"),
	mcp.WithString("session_id", mcp.Required()),
	mcp.WithString("correlation_id"),
	mcp.WithString("summary_mode", mcp.Enum("standard", "short", "detailed")),
)

var memToolRecordEvent = mcp.NewTool("harness_mem_record_event",
	mcp.WithDescription("Record normalized event envelope (adapter-internal use)."),
	mcp.WithObject("event", mcp.Required()),
)

var memToolHealth = mcp.NewTool("harness_mem_health",
	mcp.WithDescription("Get unified harness memory daemon health."),
)

var memToolDeleteObservation = mcp.NewTool("harness_mem_delete_observation",
	mcp.WithDescription("Soft-delete (archive) a specific observation by ID. The observation is marked as deleted and excluded from search results."),
	mcp.WithString("observation_id", mcp.Required(), mcp.Description("The ID of the observation to delete")),
)

var memToolAdminImportClaudeMem = mcp.NewTool("harness_mem_admin_import_claude_mem",
	mcp.WithDescription("Run one-shot import from Claude-mem SQLite."),
	mcp.WithString("source_db_path", mcp.Required()),
	mcp.WithString("project"),
	mcp.WithBoolean("dry_run"),
)

var memToolAdminImportStatus = mcp.NewTool("harness_mem_admin_import_status",
	mcp.WithDescription("Get status/result for an import job."),
	mcp.WithString("job_id", mcp.Required()),
)

var memToolAdminVerifyImport = mcp.NewTool("harness_mem_admin_verify_import",
	mcp.WithDescription("Verify import job integrity/privacy checks."),
	mcp.WithString("job_id", mcp.Required()),
)

var memToolAdminReindexVectors = mcp.NewTool("harness_mem_admin_reindex_vectors",
	mcp.WithDescription("Rebuild vector index from stored observations."),
	mcp.WithNumber("limit"),
)

var memToolAdminMetrics = mcp.NewTool("harness_mem_admin_metrics",
	mcp.WithDescription("Get memory metrics and vector/fts coverage."),
)

var memToolAdminConsolidationRun = mcp.NewTool("harness_mem_admin_consolidation_run",
	mcp.WithDescription("Run consolidation worker (extract + dedupe) immediately."),
	mcp.WithString("reason"),
	mcp.WithString("project"),
	mcp.WithString("session_id"),
	mcp.WithNumber("limit"),
)

var memToolAdminConsolidationStatus = mcp.NewTool("harness_mem_admin_consolidation_status",
	mcp.WithDescription("Get consolidation queue/facts status."),
)

var memToolAdminAuditLog = mcp.NewTool("harness_mem_admin_audit_log",
	mcp.WithDescription("Get audit log entries for retrieval/admin actions."),
	mcp.WithNumber("limit"),
	mcp.WithString("action"),
	mcp.WithString("target_type"),
)

var memToolAddRelation = mcp.NewTool("harness_mem_add_relation",
	mcp.WithDescription("Add a directed relation (link) between two observations."),
	mcp.WithString("from_observation_id", mcp.Required(), mcp.Description("Source observation ID")),
	mcp.WithString("to_observation_id", mcp.Required(), mcp.Description("Target observation ID")),
	mcp.WithString("relation", mcp.Required(), mcp.Description("Relation type"), mcp.Enum("updates", "extends", "derives", "follows", "shared_entity")),
	mcp.WithNumber("weight", mcp.Description("Link weight (default: 1.0)")),
)

var memToolBulkAdd = mcp.NewTool("harness_mem_bulk_add",
	mcp.WithDescription("Record multiple observations in a single batch operation."),
	mcp.WithArray("events", mcp.Required(), mcp.Description("Array of events to record")),
)

var memToolBulkDelete = mcp.NewTool("harness_mem_bulk_delete",
	mcp.WithDescription("Soft-delete multiple observations by ID in a single batch operation."),
	mcp.WithArray("ids", mcp.Required(), mcp.Items(map[string]any{"type": "string"}), mcp.Description("Array of observation IDs to delete")),
)

var memToolExport = mcp.NewTool("harness_mem_export",
	mcp.WithDescription("Export observations as JSON for backup or analysis."),
	mcp.WithString("project", mcp.Description("Filter by project (optional)")),
	mcp.WithNumber("limit", mcp.Description("Maximum number of observations to export (default: 1000)")),
	mcp.WithBoolean("include_private", mcp.Description("Include deleted/private observations")),
)

var memToolCompress = mcp.NewTool("harness_mem_compress",
	mcp.WithDescription("Run consolidation (compress/dedupe) worker immediately to extract facts and reduce redundancy."),
	mcp.WithString("reason"),
	mcp.WithString("project"),
	mcp.WithString("session_id"),
	mcp.WithNumber("limit"),
)

var memToolStats = mcp.NewTool("harness_mem_stats",
	mcp.WithDescription("Get per-project memory statistics including observation counts and session summaries."),
	mcp.WithBoolean("include_private"),
)

var memToolIngest = mcp.NewTool("harness_mem_ingest",
	mcp.WithDescription("Ingest a document (knowledge file, ADR, decisions.md) into memory."),
	mcp.WithString("file_path", mcp.Required(), mcp.Description("Path identifier for the document")),
	mcp.WithString("content", mcp.Required(), mcp.Description("Text content of the document")),
	mcp.WithString("kind", mcp.Description("Document kind (auto-detected if omitted)"), mcp.Enum("decisions_md", "adr")),
	mcp.WithString("project"),
	mcp.WithString("platform"),
	mcp.WithString("session_id"),
)

var memToolGraph = mcp.NewTool("harness_mem_graph",
	mcp.WithDescription("Explore graph neighbors of an observation (linked observations by relation). Supports BFS traversal up to depth 5."),
	mcp.WithString("observation_id", mcp.Required(), mcp.Description("Source observation ID to explore neighbors from")),
	mcp.WithString("relation", mcp.Description("Filter by relation type"), mcp.Enum("updates", "extends", "derives", "follows", "shared_entity", "contradicts", "causes", "part_of")),
	mcp.WithNumber("depth", mcp.Description("BFS traversal depth (1-5, default 1)")),
)

var memToolShareToTeam = mcp.NewTool("harness_mem_share_to_team",
	mcp.WithDescription("Share a personal memory observation with your team. Sets team_id on the observation so team members can access it."),
	mcp.WithString("observation_id", mcp.Required(), mcp.Description("ID of the observation to share")),
	mcp.WithString("team_id", mcp.Required(), mcp.Description("Team ID to share with")),
)
