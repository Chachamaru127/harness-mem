import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const SCRIPT = resolve(ROOT, "scripts/harness-memd");
const OBSERVATION_STORE = resolve(ROOT, "memory-server/src/core/observation-store.ts");
const CORE = resolve(ROOT, "memory-server/src/core/harness-mem-core.ts");
const SCHEMA = resolve(ROOT, "memory-server/src/db/schema.ts");
const SEARCH_CHILD = resolve(ROOT, "memory-server/src/tools/search-child.ts");
const SEARCH_WORKER = resolve(ROOT, "memory-server/src/tools/search-worker.ts");
const CHECKPOINT_CHILD = resolve(ROOT, "memory-server/src/tools/checkpoint-child.ts");
const MATERIALIZE_CHILD = resolve(ROOT, "memory-server/src/tools/materialize-observation-child.ts");
const EVENT_CHILD = resolve(ROOT, "memory-server/src/tools/event-child.ts");
const RETRY_CHILD = resolve(ROOT, "memory-server/src/tools/retry-child.ts");
const PROJECTS_STATS_CHILD = resolve(ROOT, "memory-server/src/tools/projects-stats-child.ts");
const RECALL_PROJECTION_REFRESH_CHILD = resolve(ROOT, "memory-server/src/tools/recall-projection-refresh-child.ts");
const LOCAL_ONNX = resolve(ROOT, "memory-server/src/embedding/local-onnx.ts");
const UI_SERVER = resolve(ROOT, "harness-mem-ui/src/server.ts");

function randomPort(base = 41000, span = 2000): number {
  return base + Math.floor(Math.random() * span);
}

function makeEnv(tmpHome: string, daemonPort: number, uiPort?: number): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HARNESS_MEM_HOME: tmpHome,
    HARNESS_MEM_DB_PATH: join(tmpHome, "harness-mem.db"),
    HARNESS_MEM_HOST: "127.0.0.1",
    HARNESS_MEM_PORT: String(daemonPort),
    HARNESS_MEM_CODEX_PROJECT_ROOT: ROOT,
    HARNESS_MEM_ENABLE_OPENCODE_INGEST: "false",
    HARNESS_MEM_ENABLE_CURSOR_INGEST: "false",
    HARNESS_MEM_ENABLE_ANTIGRAVITY_INGEST: "false",
    HARNESS_MEM_DISABLE_LAUNCHCTL_DELEGATION: "true",
    HARNESS_MEM_HEALTH_PROBE_TIMEOUT_SEC: "0.2",
    HARNESS_MEM_START_TIMEOUT_SEC: "1",
  };
  if (typeof uiPort === "number") {
    env.HARNESS_MEM_UI_PORT = String(uiPort);
  }
  return env;
}

async function runHarnessMemd(
  args: string[],
  env: NodeJS.ProcessEnv
): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["bash", SCRIPT, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env,
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const code = await proc.exited;
  return { code, stdout, stderr };
}

async function waitUntil(fn: () => Promise<boolean>, timeoutMs = 10_000, intervalMs = 100): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await fn()) {
      return;
    }
    await Bun.sleep(intervalMs);
  }
  throw new Error(`timed out after ${timeoutMs}ms`);
}

describe("harness-memd guardrails", () => {
  test("restart uses launchctl kickstart when daemon is LaunchAgent-managed", () => {
    const script = readFileSync(SCRIPT, "utf8");

    expect(script).toContain('DAEMON_LAUNCHD_LABEL="${HARNESS_MEM_DAEMON_LAUNCHD_LABEL:-com.harness-mem.daemon}"');
    expect(script).toContain('UI_LAUNCHD_LABEL="${HARNESS_MEM_UI_LAUNCHD_LABEL:-com.harness-mem.ui}"');
    expect(script).toContain('if is_launchctl_job_loaded "$DAEMON_LAUNCHD_LABEL"; then');
    expect(script).toContain("launchd will invoke this script's start path");
    expect(script).toContain("release_lock");
    expect(script).toContain("trap - EXIT");
    expect(script).toContain('kickstart_launchctl_job "$DAEMON_LAUNCHD_LABEL"');
    expect(script).toContain('log "harness-memd restarted via launchctl');
  });

  test("start delegates to launchctl when daemon is LaunchAgent-managed", () => {
    const script = readFileSync(SCRIPT, "utf8");

    expect(script).toContain("Spawning a detached daemon here makes launchd think the job");
    expect(script).toContain('if should_delegate_daemon_start_to_launchctl && is_launchctl_job_loaded "$DAEMON_LAUNCHD_LABEL"; then');
    expect(script).toContain("HARNESS_MEM_DISABLE_LAUNCHCTL_DELEGATION");
    expect(script).toContain('warn "Refusing to spawn detached daemon under LaunchAgent management"');
    expect(script).toContain('log "harness-memd started via launchctl');
  });

  test("offline maintenance stop bootouts launchd and waits for DB handles", () => {
    const script = readFileSync(SCRIPT, "utf8");

    expect(script).toContain("offline-stop");
    expect(script).toContain("offline-start");
    expect(script).toContain("bootout_launchctl_job");
    expect(script).toContain("bootstrap_launchctl_job");
    expect(script).toContain("offline_stop_daemon");
    expect(script).toContain("offline_start_daemon");
    expect(script).toContain("runtime_pid=\"$(discover_daemon_pid_from_port || true)\"");
    expect(script).toContain("wait_for_db_handles_closed");
    expect(script).toContain('lsof -nP -t "$DB_PATH" "${DB_PATH}-wal" "${DB_PATH}-shm"');
    expect(script).toContain("harness-memd offline maintenance stop complete");
    expect(script).toContain("harness-memd offline maintenance start complete");
  });

  test("safe lexical scan uses indexed recency order instead of rowid scan", () => {
    const store = readFileSync(OBSERVATION_STORE, "utf8");
    const schema = readFileSync(SCHEMA, "utf8");

    expect(store).toContain("ORDER BY o.created_at DESC, o.id DESC LIMIT ?");
    expect(store).not.toContain("ORDER BY o.rowid DESC LIMIT ?");
    expect(schema).toContain("idx_mem_obs_project_archived_created");
    expect(schema).toContain("ON mem_observations(project, archived_at, created_at DESC, id)");
  });

  test("admin metrics avoids observation-vector join coverage scan", () => {
    const core = readFileSync(CORE, "utf8");

    expect(core).toContain("current_model_vector_rows");
    expect(core).toContain("model >= 'adaptive:' AND model < 'adaptive;'");
    expect(core).not.toContain("JOIN mem_vectors v ON v.observation_id = o.id");
  });

  test("normal vector search can run off the daemon main thread", () => {
    const core = readFileSync(CORE, "utf8");
    const child = readFileSync(SEARCH_CHILD, "utf8");
    const worker = readFileSync(SEARCH_WORKER, "utf8");

    expect(core).toContain("shouldRunSearchOutOfProcess(request");
    expect(core).toContain("HARNESS_MEM_SEARCH_OFFLOAD");
    expect(core).toContain("HARNESS_MEM_SEARCH_CHILD_PROCESS");
    expect(core).toContain("HARNESS_MEM_SEARCH_WORKER_PROCESS");
    expect(core).toContain("shouldUsePersistentSearchWorker");
    expect(core).toContain("runSearchOutOfProcess(request)");
    expect(core).toContain("runSearchWithPersistentWorker(request)");
    expect(core).toContain("searchWithSafeFallback");
    expect(core).toContain("fallback = await this.runSearchWithOneShotChild(safeRequest)");
    expect(core).not.toContain("const fallback = this.search({");
    expect(core).toContain("HARNESS_MEM_SEARCH_CHILD_TIMEOUT_MS || DEFAULT_SEARCH_CHILD_TIMEOUT_MS");
    expect(core).toContain("if (request.safe_mode === true) return true;");
    expect(core).not.toContain("request.safe_mode === true || request.vector_search === false");
    expect(core).toContain("child_latency_ms");
    expect(child).toContain("backgroundWorkersEnabled: false");
    expect(child).toContain('await core.primeEmbedding(request.query || "", "query")');
    expect(child).toContain("const response = core.search(request)");
    expect(worker).toContain("Persistent worker for normal search");
    expect(worker).toContain("createInterface({ input: process.stdin");
    expect(worker).toContain("backgroundWorkersEnabled: false");
    expect(worker).toContain('type: "ready"');
    expect(worker).toContain('type: "warmup"');
    expect(worker).toContain('fallback: "safe_lexical"');
    expect(worker).toContain("warmup_pending");
    expect(worker).toContain("safe_mode: true");
  });

  test("persistent search worker is warm, bounded, and restartable", () => {
    const core = readFileSync(CORE, "utf8");
    const worker = readFileSync(SEARCH_WORKER, "utf8");

    expect(core).toContain("DEFAULT_SEARCH_WORKER_TIMEOUT_MS = 3_000");
    expect(core).toContain("DEFAULT_SEARCH_WORKER_STARTUP_TIMEOUT_MS = 20_000");
    expect(core).toContain("DEFAULT_SEARCH_WORKER_QUEUE_MAX = 2");
    expect(core).toContain("DEFAULT_SEARCH_CHILD_QUEUE_MAX = 1");
    expect(core).toContain("HARNESS_MEM_SEARCH_WORKER_TIMEOUT_MS");
    expect(core).toContain("HARNESS_MEM_SEARCH_WORKER_STARTUP_TIMEOUT_MS");
    expect(core).toContain("HARNESS_MEM_SEARCH_WORKER_QUEUE_MAX");
    expect(core).toContain("HARNESS_MEM_SEARCH_CHILD_QUEUE_MAX");
    expect(core).toContain("SearchOffloadQueueFullError");
    expect(core).toContain("SearchOffloadUnavailableError");
    expect(core).toContain("isSearchOffloadQueueFull(error)");
    expect(core).toContain("isSearchOffloadUnavailable(error)");
    expect(core).toContain('new SearchOffloadUnavailableError("search worker", "warming")');
    expect(core).toContain("error.message.includes(\"search worker request timed out\")");
    expect(core).toContain("response = await this.searchWithSafeFallback");
    expect(core).toContain('fallback: "none"');
    expect(core).toContain('mode: "persistent_worker"');
    expect(core).toContain("worker_ready_at_start");
    expect(core).toContain("worker_warmup_ms");
    expect(core).toContain("search worker request timed out");
    expect(worker).toContain("HARNESS_MEM_TEST_SEARCH_WORKER_DELAY_MS");
    expect(core).toContain('proc.kill("SIGKILL")');
    expect(worker).toContain("HARNESS_MEM_SEARCH_WORKER_PRIME_TEXT");
    expect(worker).toContain("harness mem search worker warmup");
    expect(worker).toContain('await core.primeEmbedding(request.query || "", "query")');
    expect(worker).toContain("void warmWorker(core).then");
    expect(worker).toContain("isEmbeddingReady(core)");
    expect(worker).toContain("const response = core.search(effectiveRequest)");
  });

  test("local ONNX model load is lazy and sync warnings do not leak text", () => {
    const localOnnx = readFileSync(LOCAL_ONNX, "utf8");

    expect(localOnnx).toContain("lazy initialization pending");
    expect(localOnnx).toContain("function ensureInitialized()");
    expect(localOnnx).toContain("await ensureInitialized()");
    expect(localOnnx).not.toContain("const initPromise: Promise<void> = (async ()");
    expect(localOnnx).not.toContain("void primeInternal(normalizedText");
    expect(localOnnx).not.toContain("cacheKey.slice(0");
    expect(localOnnx).toContain('mode=${prefix === queryPrefix ? "query" : "passage"}, chars=${normalizedText.length}');
  });

  test("safe fallback failure returns a bounded 503 instead of a fake success", () => {
    const core = readFileSync(CORE, "utf8");

    expect(core).toContain('error_code: "search_fallback_failed"');
    expect(core).toContain("http_status: 503");
    expect(core).toContain('fallback: fallbackFailed ? "none" : fallbackMode === "in_process" ? "in_process_degraded" : "safe_lexical"');
    expect(core).toContain("fallback_mode: fallbackMode");
    expect(core).toContain("safe lexical fallback also failed");
  });

  test("readiness endpoint stays lightweight and never uses full health counts", () => {
    const server = readFileSync(resolve(ROOT, "memory-server/src/server.ts"), "utf8");
    const core = readFileSync(CORE, "utf8");

    expect(server).toContain("core.health({ includeCounts: parseBoolean(url.searchParams.get(\"include_counts\"), false) })");
    expect(server).toContain('url.pathname === "/health/ready"');
    expect(server).toContain("const readiness = core.readiness()");
    expect(server).not.toContain('url.pathname === "/health/ready") {\n          return jsonResponse(core.health()');

    expect(core).toContain("health(options: { includeCounts?: boolean } = {})");
    expect(core).toContain("counts_status: includeCounts ? \"exact\" : \"omitted\"");
    const readinessStart = core.indexOf("readiness(): ApiResponse");
    const metricsStart = core.indexOf("metrics(): ApiResponse");
    expect(readinessStart).toBeGreaterThan(0);
    expect(metricsStart).toBeGreaterThan(readinessStart);
    const readinessBody = core.slice(readinessStart, metricsStart);
    expect(readinessBody).not.toContain("SELECT COUNT(*)");
    expect(readinessBody).not.toContain("statSync(dbPath)");
  });

  test("checkpoint record uses bounded queued writes and defers inline embeddings", () => {
    const server = readFileSync(resolve(ROOT, "memory-server/src/server.ts"), "utf8");
    const core = readFileSync(CORE, "utf8");
    const recorder = readFileSync(resolve(ROOT, "memory-server/src/core/event-recorder.ts"), "utf8");
    const child = readFileSync(CHECKPOINT_CHILD, "utf8");
    const materializeChild = readFileSync(MATERIALIZE_CHILD, "utf8");

    expect(server).toContain("await core.recordCheckpointQueued(req)");
    expect(server).toContain("write queue full, retry later");
    expect(server).not.toContain("return jsonResponse(core.recordCheckpoint(req))");
    expect(core).toContain("DEFAULT_CHECKPOINT_CHILD_TIMEOUT_MS = 8_000");
    expect(core).toContain("DEFAULT_CHECKPOINT_CHILD_QUEUE_MAX = 1");
    expect(core).toContain("DEFAULT_MATERIALIZE_CHILD_TIMEOUT_MS = 30_000");
    expect(core).toContain("DEFAULT_MATERIALIZE_CHILD_QUEUE_MAX = 1");
    expect(core).toContain("HARNESS_MEM_CHECKPOINT_CHILD_TIMEOUT_MS");
    expect(core).toContain("HARNESS_MEM_CHECKPOINT_CHILD_QUEUE_MAX");
    expect(core).toContain("HARNESS_MEM_MATERIALIZE_CHILD_TIMEOUT_MS");
    expect(core).toContain("HARNESS_MEM_MATERIALIZE_CHILD_QUEUE_MAX");
    expect(core).toContain("HARNESS_MEM_CHECKPOINT_OFFLOAD");
    expect(core).toContain("HARNESS_MEM_CHECKPOINT_CHILD_PROCESS");
    expect(core).toContain("HARNESS_MEM_OBSERVATION_MATERIALIZE_CHILD");
    expect(core).toContain("shouldRunCheckpointOutOfProcess");
    expect(core).toContain("buildCheckpointChildCommand");
    expect(core).toContain("buildMaterializeObservationChildCommand");
    expect(core).toContain("runCheckpointOutOfProcess(request)");
    expect(core).toContain("scheduleObservationMaterialization(firstResponseObservationId(response))");
    expect(core).toContain("materializeObservationDerivedData(observationId: string)");
    expect(core).toContain('HARNESS_MEM_EMBEDDING_PROVIDER: "fallback"');
    expect(core).toContain("async recordCheckpointQueued(request: RecordCheckpointRequest)");
    expect(core).toContain("buildCheckpointEvent(request)");
    expect(core).toContain("deferEmbedding: true");
    expect(core).toContain("if (options.deferEmbedding !== true)");
    expect(recorder).toContain("deferEmbedding?: boolean");
    expect(recorder).toContain('embedding_write_status: "deferred"');
    expect(recorder).toContain("if (!deferEmbedding)");
    expect(recorder).toContain("materializeObservationDerivedData(observationId: string)");
    expect(recorder).toContain("this.upsertVector(observationId, embeddingSource, createdAt)");
    expect(recorder).toContain("this.insertNuggets(observationId, content, createdAt)");
    expect(recorder).toContain("HARNESS_MEM_TEST_WRITE_QUEUE_DELAY_MS");
    expect(child).toContain("One-shot child process for checkpoint writes");
    expect(child).toContain("backgroundWorkersEnabled: false");
    expect(child).toContain("await core.recordCheckpointQueued(request)");
    expect(materializeChild).toContain("One-shot child process for deferred observation derived data");
    expect(materializeChild).toContain("core.materializeObservationDerivedData(request.observation_id)");
    expect(materializeChild).toContain("backgroundWorkersEnabled: false");
  });

  test("event record offloads embedding and writes away from daemon main thread", () => {
    const server = readFileSync(resolve(ROOT, "memory-server/src/server.ts"), "utf8");
    const core = readFileSync(CORE, "utf8");
    const child = readFileSync(EVENT_CHILD, "utf8");

    expect(server).toContain("await core.recordEventQueued(event)");
    expect(server).toContain("typeof result.meta.http_status === \"number\"");
    expect(core).toContain("DEFAULT_EVENT_CHILD_TIMEOUT_MS = 8_000");
    expect(core).toContain("DEFAULT_EVENT_CHILD_QUEUE_MAX = 1");
    expect(core).toContain("HARNESS_MEM_EVENT_CHILD_TIMEOUT_MS");
    expect(core).toContain("HARNESS_MEM_EVENT_CHILD_QUEUE_MAX");
    expect(core).toContain("HARNESS_MEM_EVENT_OFFLOAD");
    expect(core).toContain("HARNESS_MEM_EVENT_CHILD_PROCESS");
    expect(core).toContain("shouldRunEventOutOfProcess");
    expect(core).toContain("buildEventChildCommand");
    expect(core).toContain("runEventOutOfProcess(event)");
    expect(core).toContain('HARNESS_MEM_EMBEDDING_PROVIDER: "fallback"');
    expect(core).toContain('error_code: "event_offload_failed"');
    expect(core).toContain("http_status: 503");
    expect(child).toContain("One-shot child process for event writes");
    expect(child).toContain("backgroundWorkersEnabled: false");
    expect(child).toContain("await core.recordEventQueued(event)");
    expect(child).toContain("HARNESS_MEM_TEST_EVENT_CHILD_DELAY_MS");
  });

  test("retry queue ticks offload away from daemon main thread", () => {
    const core = readFileSync(CORE, "utf8");
    const child = readFileSync(RETRY_CHILD, "utf8");

    expect(core).toContain("DEFAULT_RETRY_CHILD_TIMEOUT_MS = 30_000");
    expect(core).toContain("DEFAULT_RETRY_CHILD_QUEUE_MAX = 1");
    expect(core).toContain("HARNESS_MEM_RETRY_CHILD_TIMEOUT_MS");
    expect(core).toContain("HARNESS_MEM_RETRY_CHILD_QUEUE_MAX");
    expect(core).toContain("HARNESS_MEM_RETRY_OFFLOAD");
    expect(core).toContain("HARNESS_MEM_RETRY_CHILD_PROCESS");
    expect(core).toContain("shouldRunRetryQueueOutOfProcess");
    expect(core).toContain("buildRetryChildCommand");
    expect(core).toContain("runRetryQueueOutOfProcess(false)");
    expect(core).toContain("processRetryQueueNow");
    expect(core).toContain("retry queue child failed");
    expect(core).toContain("DEFAULT_RUNTIME_WARNING_TTL_MS");
    expect(core).toContain("pushRuntimeWarning(");
    expect(core).toContain("currentRuntimeWarnings()");
    expect(core).toContain("const lightweightChild =");
    expect(core).toContain("HARNESS_MEM_EVENT_CHILD_PROCESS");
    expect(core).toContain("HARNESS_MEM_RETRY_CHILD_PROCESS");
    expect(core).toContain("HARNESS_MEM_PROJECTS_STATS_CHILD_PROCESS");
    expect(core).toContain("if (!lightweightChild)");
    expect(child).toContain("One-shot child process for retry queue ticks");
    expect(child).toContain("backgroundWorkersEnabled: false");
    expect(child).toContain("core.processRetryQueueNow");
  });

  test("project stats offloads aggregate work away from daemon main thread", () => {
    const server = readFileSync(resolve(ROOT, "memory-server/src/server.ts"), "utf8");
    const core = readFileSync(CORE, "utf8");
    const child = readFileSync(PROJECTS_STATS_CHILD, "utf8");
    const projectsStatsRoute = server.slice(
      server.indexOf('url.pathname === "/v1/projects/stats"'),
      server.indexOf('url.pathname === "/v1/stream"')
    );

    expect(server).toContain("await core.projectsStatsQueued({");
    expect(server).not.toContain("return jsonResponse(\n          core.projectsStats({");
    expect(projectsStatsRoute).not.toContain('core.expandProjectSelection(projectFilter, "observations")');
    expect(core).toContain("DEFAULT_PROJECTS_STATS_CHILD_TIMEOUT_MS = 8_000");
    expect(core).toContain("DEFAULT_PROJECTS_STATS_CHILD_QUEUE_MAX = 1");
    expect(core).toContain("HARNESS_MEM_PROJECTS_STATS_CHILD_TIMEOUT_MS");
    expect(core).toContain("HARNESS_MEM_PROJECTS_STATS_CHILD_QUEUE_MAX");
    expect(core).toContain("HARNESS_MEM_PROJECTS_STATS_OFFLOAD");
    expect(core).toContain("HARNESS_MEM_PROJECTS_STATS_CHILD_PROCESS");
    expect(core).toContain("shouldRunProjectsStatsOutOfProcess");
    expect(core).toContain("buildProjectsStatsChildCommand");
    expect(core).toContain("runProjectsStatsOutOfProcess(request)");
    expect(core).toContain('import { spawn as spawnChildProcess } from "node:child_process"');
    expect(core).toContain("const proc = spawnChildProcess(childCommand[0], childCommand.slice(1)");
    expect(core).toContain('error_code: "projects_stats_offload_queue_full"');
    expect(core).toContain('error_code: "projects_stats_offload_failed"');
    expect(core).toContain("http_status: 503");
    expect(child).toContain("One-shot child process for project stats");
    expect(child).toContain("backgroundWorkersEnabled: false");
    expect(child).toContain('core.expandProjectSelection(request.project, "observations")');
    expect(child).toContain("core.projectsStats(childRequest)");
    expect(child).toContain("HARNESS_MEM_TEST_PROJECTS_STATS_CHILD_DELAY_MS");
  });

  test("recall projection stale refresh is bounded and off-main", () => {
    const core = readFileSync(CORE, "utf8");
    const child = readFileSync(RECALL_PROJECTION_REFRESH_CHILD, "utf8");

    expect(core).toContain("DEFAULT_RECALL_PROJECTION_REFRESH_CHILD_TIMEOUT_MS = 30_000");
    expect(core).toContain("DEFAULT_RECALL_PROJECTION_REFRESH_CHILD_QUEUE_MAX = 1");
    expect(core).toContain("DEFAULT_RECALL_PROJECTION_REFRESH_DEBOUNCE_MS = 1_000");
    expect(core).toContain("HARNESS_MEM_RECALL_PROJECTION_AUTO_REFRESH");
    expect(core).toContain("HARNESS_MEM_RECALL_PROJECTION_REFRESH_CHILD_TIMEOUT_MS");
    expect(core).toContain("HARNESS_MEM_RECALL_PROJECTION_REFRESH_CHILD_QUEUE_MAX");
    expect(core).toContain("HARNESS_MEM_RECALL_PROJECTION_REFRESH_DEBOUNCE_MS");
    expect(core).toContain("HARNESS_MEM_RECALL_PROJECTION_REFRESH_CHILD");
    expect(core).toContain("buildRecallProjectionRefreshChildCommand");
    expect(core).toContain("scheduleRecallProjectionAutoRefresh");
    expect(core).toContain("runRecallProjectionRefreshOutOfProcess(request, keyHash)");
    expect(core).toContain('recall_projection_auto_refresh = autoRefresh');
    expect(core).toContain("this.repeatRecallCache.clear()");
    expect(core).toContain('harness.operation": "auto_refresh"');
    expect(core).toContain("const childCommand = buildRecallProjectionRefreshChildCommand(scriptPath)");
    expect(core).toContain("const proc = spawnChildProcess(childCommand[0], childCommand.slice(1)");
    expect(core).toContain("this.recallProjectionRefreshTimers.clear()");
    expect(child).toContain("One-shot child process for recall projection refresh");
    expect(child).toContain("backgroundWorkersEnabled: false");
    expect(child).toContain("core.refreshRecallProjection(request)");
  });

  test("offload child payloads use stdin instead of process argv", () => {
    const core = readFileSync(CORE, "utf8");
    const searchChild = readFileSync(SEARCH_CHILD, "utf8");
    const checkpointChild = readFileSync(CHECKPOINT_CHILD, "utf8");
    const eventChild = readFileSync(EVENT_CHILD, "utf8");
    const retryChild = readFileSync(RETRY_CHILD, "utf8");
    const projectsStatsChild = readFileSync(PROJECTS_STATS_CHILD, "utf8");
    const recallProjectionRefreshChild = readFileSync(RECALL_PROJECTION_REFRESH_CHILD, "utf8");

    expect(core).toContain("writeJsonToChildStdin");
    expect(core).toContain("stdin: \"pipe\"");
    expect(core).toContain("cmd: buildSearchChildCommand(scriptPath)");
    expect(core).toContain("cmd: buildCheckpointChildCommand(scriptPath)");
    expect(core).toContain("cmd: buildEventChildCommand(scriptPath)");
    expect(core).toContain("cmd: buildRetryChildCommand(scriptPath)");
    expect(core).toContain("const childCommand = buildProjectsStatsChildCommand(scriptPath)");
    expect(core).toContain("const childCommand = buildRecallProjectionRefreshChildCommand(scriptPath)");
    expect(core).not.toContain("buildSearchChildCommand(scriptPath, request)");
    expect(core).not.toContain("buildCheckpointChildCommand(scriptPath, request)");
    expect(core).not.toContain("[process.execPath, \"run\", scriptPath, JSON.stringify(request)]");
    expect(searchChild).toContain("for await (const chunk of process.stdin)");
    expect(checkpointChild).toContain("for await (const chunk of process.stdin)");
    expect(eventChild).toContain("for await (const chunk of process.stdin)");
    expect(retryChild).toContain("for await (const chunk of process.stdin)");
    expect(projectsStatsChild).toContain("for await (const chunk of process.stdin)");
    expect(recallProjectionRefreshChild).toContain("for await (const chunk of process.stdin)");
    expect(searchChild).not.toContain("process.argv[2]");
    expect(checkpointChild).not.toContain("process.argv[2]");
    expect(eventChild).not.toContain("process.argv[2]");
    expect(retryChild).not.toContain("process.argv[2]");
    expect(projectsStatsChild).not.toContain("process.argv[2]");
    expect(recallProjectionRefreshChild).not.toContain("process.argv[2]");
  });

  test("normal sqlite-vec search is bounded by k and query-variant caps", () => {
    const store = readFileSync(OBSERVATION_STORE, "utf8");

    expect(store).toContain("const DEFAULT_SQLITE_VEC_K_MAX = 240");
    expect(store).toContain("const DEFAULT_SQLITE_VEC_VARIANT_MAX = 1");
    expect(store).toContain("HARNESS_MEM_SQLITE_VEC_K_MAX ?? DEFAULT_SQLITE_VEC_K_MAX");
    expect(store).toContain("HARNESS_MEM_SQLITE_VEC_VARIANT_MAX ?? DEFAULT_SQLITE_VEC_VARIANT_MAX");
    expect(store).toContain("sqlite-vec variant cap");
    expect(store).not.toContain("HARNESS_MEM_SQLITE_VEC_K_MAX ?? 1200");
  });

  test("vector migration warning avoids per-search observation-vector join scan", () => {
    const store = readFileSync(OBSERVATION_STORE, "utf8");

    expect(store).toContain("VECTOR_MIGRATION_PROGRESS_CACHE_TTL_MS");
    expect(store).toContain("(SELECT COUNT(*) FROM mem_observations o WHERE 1=1");
    expect(store).toContain("(SELECT COUNT(*) FROM mem_vectors WHERE model = ?) AS current_count");
    expect(store).not.toContain("COUNT(DISTINCT CASE WHEN v.model = ? THEN o.id END)");
  });

  test("log rotation size detection prefers GNU stat before BSD stat for Git Bash compatibility", () => {
    const script = readFileSync(SCRIPT, "utf8");

    expect(script).toContain('result="$(stat -c "%s" "$file" 2>/dev/null)"');
    expect(script).toContain('result="$(stat -f "%z" "$file" 2>/dev/null)"');
    expect(script).toContain('wc -c < "$file"');
  });

  test("status does not treat non-JSON health endpoint as healthy", async () => {
    const tmpHome = mkdtempSync(join(tmpdir(), "hmem-guard-status-"));
    const port = randomPort();
    const fake = Bun.serve({
      hostname: "127.0.0.1",
      port,
      fetch: () => new Response("ok", { status: 200 }),
    });

    try {
      const result = await runHarnessMemd(["status"], makeEnv(tmpHome, port));
      expect(result.code).toBe(1);
      expect(result.stdout).toContain("stopped");
    } finally {
      fake.stop(true);
      rmSync(tmpHome, { recursive: true, force: true });
    }
  });

  test("start fails fast when target port is occupied by another process", async () => {
    const tmpHome = mkdtempSync(join(tmpdir(), "hmem-guard-conflict-"));
    const port = randomPort();
    const fake = Bun.serve({
      hostname: "127.0.0.1",
      port,
      fetch: () => new Response("not-harness", { status: 200 }),
    });

    try {
      const result = await runHarnessMemd(["start"], makeEnv(tmpHome, port));
      expect(result.code).toBe(1);
      expect(result.stderr).toContain(`Port ${port} is already in use`);
      expect(existsSync(join(tmpHome, "daemon.pid"))).toBe(false);
    } finally {
      fake.stop(true);
      rmSync(tmpHome, { recursive: true, force: true });
    }
  }, 15_000);

  test("status rotates oversized logs using configured threshold", async () => {
    const tmpHome = mkdtempSync(join(tmpdir(), "hmem-guard-rotate-"));
    const daemonLog = join(tmpHome, "daemon.log");
    const uiLog = join(tmpHome, "harness-mem-ui.log");
    const big = "x".repeat(4096);
    writeFileSync(daemonLog, big);
    writeFileSync(uiLog, big);

    try {
      const env = makeEnv(tmpHome, randomPort(), randomPort());
      env.HARNESS_MEM_LOG_MAX_BYTES = "1024";
      env.HARNESS_MEM_LOG_ROTATE_KEEP = "2";

      const result = await runHarnessMemd(["status"], env);
      expect(result.code).toBe(1);

      expect(existsSync(`${daemonLog}.1`)).toBe(true);
      expect(existsSync(`${uiLog}.1`)).toBe(true);
      expect(statSync(daemonLog).size).toBeLessThan(1024);
      expect(statSync(uiLog).size).toBeLessThan(1024);
    } finally {
      rmSync(tmpHome, { recursive: true, force: true });
    }
  });

  test("status auto-syncs harness-mem-ui.pid from running UI listener", async () => {
    const tmpHome = mkdtempSync(join(tmpdir(), "hmem-guard-ui-pid-"));
    const daemonPort = randomPort();
    const uiPort = randomPort(45000, 1000);

    const uiProc = Bun.spawn([process.execPath, "run", UI_SERVER], {
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...process.env,
        HARNESS_MEM_HOST: "127.0.0.1",
        HARNESS_MEM_PORT: String(daemonPort),
        HARNESS_MEM_UI_PORT: String(uiPort),
      },
    });

    try {
      await waitUntil(async () => {
        try {
          const response = await fetch(`http://127.0.0.1:${uiPort}/api/context`);
          return response.ok;
        } catch {
          return false;
        }
      });

      const uiPidFile = join(tmpHome, "harness-mem-ui.pid");
      writeFileSync(uiPidFile, "999999");

      const result = await runHarnessMemd(["status"], makeEnv(tmpHome, daemonPort, uiPort));
      expect(result.code).toBe(1);

      const synced = readFileSync(uiPidFile, "utf8").trim();
      expect(synced).toBe(String(uiProc.pid));
    } finally {
      uiProc.kill();
      await uiProc.exited;
      rmSync(tmpHome, { recursive: true, force: true });
    }
  });
});
