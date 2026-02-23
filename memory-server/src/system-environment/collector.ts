import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_STATE_DIR = "~/.harness-mem";

const SECRET_KEY_PATTERN = /(api[_-]?key|token|secret|password|authorization)/i;
const SECRET_VALUE_PATTERNS: Array<[RegExp, string]> = [
  [/\b(?:sk|rk|pk)[_-][A-Za-z0-9._-]{12,}\b/g, "[REDACTED_SECRET]"],
  [/\b(?:bearer\s+)?[A-Za-z0-9._-]{24,}\b/gi, "[REDACTED_SECRET]"],
];

export type EnvironmentStatus = "ok" | "warning" | "missing";

export interface EnvironmentServerItem {
  id: string;
  name: string;
  description: string;
  status: EnvironmentStatus;
  last_checked_at: string;
  pid: number | null;
  port: number | null;
  protocol: string | null;
  bind_address: string | null;
  process_name: string | null;
  message: string | null;
  details?: Record<string, unknown>;
}

export interface EnvironmentItem {
  id: string;
  name: string;
  description: string;
  status: EnvironmentStatus;
  last_checked_at: string;
  installed: boolean | null;
  version: string | null;
  message: string | null;
  details?: Record<string, unknown>;
}

export interface EnvironmentSummary {
  total: number;
  ok: number;
  warning: number;
  missing: number;
  servers: number;
  languages: number;
  cli_tools: number;
  ai_tools: number;
}

export interface EnvironmentErrorItem {
  section: string;
  message: string;
}

export interface EnvironmentSnapshot {
  snapshot_id: string;
  generated_at: string;
  summary: EnvironmentSummary;
  servers: EnvironmentServerItem[];
  languages: EnvironmentItem[];
  cli_tools: EnvironmentItem[];
  ai_tools: EnvironmentItem[];
  errors: EnvironmentErrorItem[];
}

export interface EnvironmentCollectorInput {
  state_dir?: string;
  mem_host: string;
  mem_port: number;
  ui_port: number;
  health_item: Record<string, unknown>;
  managed_backend?: Record<string, unknown> | null;
}

interface CommandResult {
  ok: boolean;
  exit_code: number;
  stdout: string;
  stderr: string;
}

interface ListenerInfo {
  pid: number | null;
  process_name: string | null;
  bind_address: string | null;
}

interface StatusCount {
  total: number;
  ok: number;
  warning: number;
  missing: number;
}

interface ToolDescriptor {
  id: string;
  name: string;
  description: string;
  command: string;
  version_command?: string[];
  details?: Record<string, unknown>;
}

function nowIso(): string {
  return new Date().toISOString();
}

function resolveHomePath(inputPath: string): string {
  if (inputPath.startsWith("~")) {
    const homeDir = process.env.HOME || process.env.USERPROFILE || ".";
    return `${homeDir}${inputPath.slice(1)}`;
  }
  return inputPath;
}

function toRecord(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function toStringOrNull(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toNumberOrNull(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.trunc(parsed);
    }
  }
  return null;
}

function firstLine(value: string): string | null {
  const line = value.split(/\r?\n/)[0]?.trim() || "";
  if (!line) {
    return null;
  }
  return line.slice(0, 240);
}

function runCommand(cmd: string[]): CommandResult {
  try {
    const result = Bun.spawnSync({
      cmd,
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    });
    return {
      ok: result.exitCode === 0,
      exit_code: result.exitCode ?? 1,
      stdout: Buffer.from(result.stdout).toString("utf8").trim(),
      stderr: Buffer.from(result.stderr).toString("utf8").trim(),
    };
  } catch (errorInput) {
    const message = errorInput instanceof Error ? errorInput.message : String(errorInput);
    return {
      ok: false,
      exit_code: 1,
      stdout: "",
      stderr: message,
    };
  }
}

function maskSecretString(value: string): string {
  let masked = value;
  for (const [pattern, replacement] of SECRET_VALUE_PATTERNS) {
    masked = masked.replace(pattern, replacement);
  }
  return masked;
}

function sanitizeString(value: string, keyPath: string[], homeDir: string): string {
  const key = keyPath[keyPath.length - 1] || "";
  if (SECRET_KEY_PATTERN.test(key)) {
    return "[REDACTED_SECRET]";
  }

  let sanitized = maskSecretString(value);
  if (homeDir && sanitized.includes(homeDir)) {
    sanitized = sanitized.split(homeDir).join("~");
  }
  return sanitized;
}

function sanitizeValue(value: unknown, keyPath: string[], homeDir: string): unknown {
  if (typeof value === "string") {
    return sanitizeString(value, keyPath, homeDir);
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => sanitizeValue(entry, [...keyPath, String(index)], homeDir));
  }
  if (typeof value === "object" && value !== null) {
    const source = value as Record<string, unknown>;
    const next: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(source)) {
      next[key] = sanitizeValue(entry, [...keyPath, key], homeDir);
    }
    return next;
  }
  return value;
}

function readJsonFile(path: string): { value: Record<string, unknown> | null; error: string | null } {
  if (!existsSync(path)) {
    return { value: null, error: `not found: ${path}` };
  }
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { value: null, error: `invalid json object: ${path}` };
    }
    return { value: parsed as Record<string, unknown>, error: null };
  } catch (errorInput) {
    const message = errorInput instanceof Error ? errorInput.message : String(errorInput);
    return { value: null, error: `${path}: ${message}` };
  }
}

function detectTool(descriptor: ToolDescriptor, generatedAt: string): EnvironmentItem {
  const where = runCommand(["which", descriptor.command]);
  if (!where.ok || !where.stdout) {
    return {
      id: descriptor.id,
      name: descriptor.name,
      description: descriptor.description,
      status: "missing",
      last_checked_at: generatedAt,
      installed: false,
      version: null,
      message: `${descriptor.command} is not installed`,
      details: {
        command: descriptor.command,
      },
    };
  }

  let version: string | null = null;
  let status: EnvironmentStatus = "ok";
  let message: string | null = null;

  if (descriptor.version_command && descriptor.version_command.length > 0) {
    const versionResult = runCommand(descriptor.version_command);
    if (versionResult.ok) {
      version = firstLine(versionResult.stdout);
    } else {
      status = "warning";
      message = firstLine(versionResult.stderr) || "version check failed";
    }
  }

  return {
    id: descriptor.id,
    name: descriptor.name,
    description: descriptor.description,
    status,
    last_checked_at: generatedAt,
    installed: true,
    version,
    message,
    details: {
      command: descriptor.command,
      path: where.stdout,
      ...(descriptor.details || {}),
    },
  };
}

function collectListenersByPort(errors: EnvironmentErrorItem[]): Map<number, ListenerInfo> {
  const result = runCommand(["lsof", "-nP", "-iTCP", "-sTCP:LISTEN"]);
  if (!result.ok) {
    errors.push({
      section: "servers",
      message: firstLine(result.stderr) || "failed to execute lsof",
    });
    return new Map<number, ListenerInfo>();
  }

  const listeners = new Map<number, ListenerInfo>();
  const lines = result.stdout.split(/\r?\n/).filter((line) => line.trim().length > 0);
  for (const line of lines.slice(1)) {
    const addressMatch = line.match(/TCP\s+(.+?)\s+\(LISTEN\)$/);
    if (!addressMatch) {
      continue;
    }
    const address = addressMatch[1];
    const portMatch = address.match(/:(\d+)$/);
    if (!portMatch) {
      continue;
    }
    const port = Number(portMatch[1]);
    if (!Number.isFinite(port)) {
      continue;
    }

    const columns = line.trim().split(/\s+/);
    const processName = columns[0] || null;
    const pid = toNumberOrNull(columns[1]);
    const bindAddress = address.replace(/:\d+$/, "");

    if (!listeners.has(port)) {
      listeners.set(port, {
        pid,
        process_name: processName,
        bind_address: bindAddress || null,
      });
    }
  }

  return listeners;
}

function statusFromHint(hint: string | null, installed: boolean): EnvironmentStatus {
  if (!installed) {
    return "missing";
  }
  if (hint === "up_to_date" || hint === "ok") {
    return "ok";
  }
  return "warning";
}

function statusCount(items: Array<{ status: EnvironmentStatus }>): StatusCount {
  const count: StatusCount = {
    total: items.length,
    ok: 0,
    warning: 0,
    missing: 0,
  };
  for (const item of items) {
    if (item.status === "ok") {
      count.ok += 1;
      continue;
    }
    if (item.status === "warning") {
      count.warning += 1;
      continue;
    }
    count.missing += 1;
  }
  return count;
}

function nestedString(record: Record<string, unknown>, path: readonly string[]): string | null {
  let cursor: unknown = record;
  for (const key of path) {
    if (typeof cursor !== "object" || cursor === null || Array.isArray(cursor)) {
      return null;
    }
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return toStringOrNull(cursor);
}

function collectServerEntries(
  input: EnvironmentCollectorInput,
  generatedAt: string,
  listenersByPort: Map<number, ListenerInfo>
): EnvironmentServerItem[] {
  const healthStatusRaw = toStringOrNull(input.health_item.status)?.toLowerCase();
  const daemonStatus: EnvironmentStatus = healthStatusRaw === "ok" ? "ok" : "warning";
  const daemonListener = listenersByPort.get(input.mem_port);
  const daemonPid = toNumberOrNull(input.health_item.pid) ?? daemonListener?.pid ?? null;
  const daemonHost = toStringOrNull(input.health_item.host) || input.mem_host;
  const daemonPort = toNumberOrNull(input.health_item.port) ?? input.mem_port;

  const servers: EnvironmentServerItem[] = [
    {
      id: "harness-memd",
      name: "Harness Memory Daemon",
      description: "メモリ検索・保存 API を提供する中核サーバーです。",
      status: daemonStatus,
      last_checked_at: generatedAt,
      pid: daemonPid,
      port: daemonPort,
      protocol: "http",
      bind_address: daemonHost,
      process_name: daemonListener?.process_name || "bun",
      message: daemonStatus === "ok" ? null : "health endpoint returned a non-ok status",
    },
  ];

  const uiListener = listenersByPort.get(input.ui_port);
  const uiProbe = runCommand([
    "curl",
    "--silent",
    "--show-error",
    "--max-time",
    "1",
    `http://${input.mem_host}:${input.ui_port}/api/context`,
  ]);
  let uiStatus: EnvironmentStatus = "missing";
  let uiMessage: string | null = null;

  if (uiProbe.ok && uiProbe.stdout) {
    try {
      const parsed = JSON.parse(uiProbe.stdout) as unknown;
      const parsedRecord = toRecord(parsed);
      uiStatus = parsedRecord.ok === true ? "ok" : "warning";
      if (uiStatus !== "ok") {
        uiMessage = "UI context endpoint responded but returned non-ok payload";
      }
    } catch {
      uiStatus = "warning";
      uiMessage = "UI endpoint returned non-json response";
    }
  } else if (uiListener) {
    uiStatus = "warning";
    uiMessage = "UI process is listening but /api/context is unreachable";
  } else {
    uiStatus = "missing";
    uiMessage = "UI process is not running";
  }

  servers.push({
    id: "harness-mem-ui",
    name: "Harness Memory UI",
    description: "ブラウザで状態を確認する管理画面サーバーです。",
    status: uiStatus,
    last_checked_at: generatedAt,
    pid: uiListener?.pid ?? null,
    port: input.ui_port,
    protocol: "http",
    bind_address: uiListener?.bind_address || input.mem_host,
    process_name: uiListener?.process_name || "bun",
    message: uiMessage,
  });

  if (input.managed_backend) {
    const managed = toRecord(input.managed_backend);
    const endpoint = toStringOrNull(managed.endpoint) || toStringOrNull(managed.base_url) || null;
    const connected = managed.connected === true || managed.status === "connected";
    let bindAddress: string | null = null;
    let port: number | null = null;
    if (endpoint) {
      try {
        const parsed = new URL(endpoint);
        bindAddress = parsed.hostname || null;
        port = parsed.port ? Number(parsed.port) : parsed.protocol === "https:" ? 443 : 80;
      } catch {
        bindAddress = endpoint;
      }
    }

    servers.push({
      id: "managed-backend",
      name: "Managed Backend",
      description: "クラウド同期を使う場合の外部バックエンド接続です。",
      status: connected ? "ok" : "warning",
      last_checked_at: generatedAt,
      pid: null,
      port,
      protocol: endpoint?.startsWith("https://") ? "https" : endpoint?.startsWith("http://") ? "http" : null,
      bind_address: bindAddress,
      process_name: null,
      message: connected ? null : "managed backend is configured but not connected",
      details: {
        endpoint,
      },
    });
  }

  return servers;
}

function collectLanguageEntries(generatedAt: string): EnvironmentItem[] {
  const npmVersion = detectTool({
    id: "npm-for-node",
    name: "npm",
    description: "Node.js のパッケージ管理",
    command: "npm",
    version_command: ["npm", "--version"],
  }, generatedAt).version;

  const pipVersion = detectTool({
    id: "pip-for-python",
    name: "pip",
    description: "Python のパッケージ管理",
    command: "pip3",
    version_command: ["pip3", "--version"],
  }, generatedAt).version;

  const cargoVersion = detectTool({
    id: "cargo-for-rust",
    name: "cargo",
    description: "Rust のパッケージ管理",
    command: "cargo",
    version_command: ["cargo", "--version"],
  }, generatedAt).version;

  return [
    detectTool(
      {
        id: "node",
        name: "Node.js",
        description: "JavaScript/TypeScript 実行環境です。",
        command: "node",
        version_command: ["node", "--version"],
        details: { library_hint: npmVersion ? `npm ${npmVersion}` : "npm not detected" },
      },
      generatedAt
    ),
    detectTool(
      {
        id: "bun",
        name: "Bun",
        description: "高速 JavaScript ランタイム兼ツールチェーンです。",
        command: "bun",
        version_command: ["bun", "--version"],
      },
      generatedAt
    ),
    detectTool(
      {
        id: "python3",
        name: "Python",
        description: "スクリプト実行と自動化で使われる言語です。",
        command: "python3",
        version_command: ["python3", "--version"],
        details: { library_hint: pipVersion ? `pip ${pipVersion}` : "pip not detected" },
      },
      generatedAt
    ),
    detectTool(
      {
        id: "go",
        name: "Go",
        description: "高速なコンパイル言語です。",
        command: "go",
        version_command: ["go", "version"],
      },
      generatedAt
    ),
    detectTool(
      {
        id: "rust",
        name: "Rust",
        description: "安全性重視のシステム言語です。",
        command: "rustc",
        version_command: ["rustc", "--version"],
        details: { library_hint: cargoVersion ? cargoVersion : "cargo not detected" },
      },
      generatedAt
    ),
  ];
}

function collectCliEntries(generatedAt: string): EnvironmentItem[] {
  const descriptors: ToolDescriptor[] = [
    {
      id: "harness-mem",
      name: "harness-mem",
      description: "セットアップ/診断を行う統合 CLI です。",
      command: "harness-mem",
    },
    {
      id: "harness-memd",
      name: "harness-memd",
      description: "daemon の起動/停止を行う管理 CLI です。",
      command: "harness-memd",
    },
    {
      id: "git",
      name: "git",
      description: "ソースコード履歴を管理する CLI です。",
      command: "git",
      version_command: ["git", "--version"],
    },
    {
      id: "jq",
      name: "jq",
      description: "JSON を整形・抽出する CLI です。",
      command: "jq",
      version_command: ["jq", "--version"],
    },
    {
      id: "rg",
      name: "ripgrep (rg)",
      description: "高速テキスト検索 CLI です。",
      command: "rg",
      version_command: ["rg", "--version"],
    },
    {
      id: "curl",
      name: "curl",
      description: "HTTP API の疎通確認に使う CLI です。",
      command: "curl",
      version_command: ["curl", "--version"],
    },
    {
      id: "gh",
      name: "GitHub CLI",
      description: "GitHub 操作を行う CLI です。",
      command: "gh",
      version_command: ["gh", "--version"],
    },
    {
      id: "docker",
      name: "Docker",
      description: "コンテナ実行環境 CLI です。",
      command: "docker",
      version_command: ["docker", "--version"],
    },
    {
      id: "sqlite3",
      name: "sqlite3",
      description: "SQLite データベース操作 CLI です。",
      command: "sqlite3",
      version_command: ["sqlite3", "--version"],
    },
  ];

  return descriptors.map((descriptor) => detectTool(descriptor, generatedAt));
}

function collectAiToolEntries(
  versionsSnapshot: Record<string, unknown> | null,
  doctorSnapshot: Record<string, unknown> | null,
  generatedAt: string,
  errors: EnvironmentErrorItem[]
): EnvironmentItem[] {
  const items: EnvironmentItem[] = [];

  if (versionsSnapshot) {
    const local = toRecord(versionsSnapshot.local);
    const status = toRecord(versionsSnapshot.status);
    const upstream = toRecord(versionsSnapshot.upstream);

    const mappings = [
      {
        id: "codex",
        name: "Codex CLI",
        local_key: "codex",
        status_key: "codex",
        latest_path: ["codex", "latest_stable"],
        description: "OpenAI Codex 実装エージェントです。",
      },
      {
        id: "claude_code",
        name: "Claude Code",
        local_key: "claude_code",
        status_key: "claude_code",
        latest_path: ["claude_code", "latest_stable"],
        description: "Claude Code 実装エージェントです。",
      },
      {
        id: "opencode",
        name: "OpenCode",
        local_key: "opencode",
        status_key: "opencode",
        latest_path: ["opencode", "latest_stable"],
        description: "OpenCode 実装エージェントです。",
      },
      {
        id: "cursor",
        name: "Cursor",
        local_key: "cursor",
        status_key: "cursor",
        latest_path: ["cursor", "latest_entry_date"],
        description: "Cursor 開発環境です。",
      },
      {
        id: "antigravity",
        name: "Antigravity",
        local_key: "antigravity",
        status_key: "antigravity",
        latest_path: ["antigravity", "latest_stable"],
        description: "Antigravity 連携環境です。",
      },
    ] as const;

    for (const mapping of mappings) {
      const localInfo = toRecord(local[mapping.local_key]);
      const installedRaw = toStringOrNull(localInfo.installed);
      const installed = Boolean(installedRaw);
      const hint = toStringOrNull(status[mapping.status_key]);
      const latest = nestedString(upstream, mapping.latest_path);
      const rowStatus = statusFromHint(hint, installed);
      const message =
        !installedRaw
          ? `${mapping.name} is not detected`
          : latest && hint && hint !== "up_to_date"
            ? `local is ${hint}; upstream hint: ${latest}`
            : hint && hint !== "up_to_date"
              ? `local status: ${hint}`
              : null;

      items.push({
        id: mapping.id,
        name: mapping.name,
        description: mapping.description,
        status: rowStatus,
        last_checked_at: generatedAt,
        installed,
        version: installedRaw,
        message,
      });
    }
  } else {
    errors.push({
      section: "ai_tools",
      message: "versions snapshot is unavailable",
    });
    items.push({
      id: "version-snapshot",
      name: "Version Snapshot",
      description: "AI ツールの local/upstream 追跡情報です。",
      status: "missing",
      last_checked_at: generatedAt,
      installed: false,
      version: null,
      message: "tool-versions.json is missing",
    });
  }

  if (doctorSnapshot) {
    const checks = Array.isArray(doctorSnapshot.checks) ? doctorSnapshot.checks : [];
    const checkMap = new Map<string, Record<string, unknown>>();
    for (const check of checks) {
      const row = toRecord(check);
      const name = toStringOrNull(row.name);
      if (name) {
        checkMap.set(name, row);
      }
    }

    const mappings = [
      { id: "mcp-codex", check: "codex_wiring", name: "Codex MCP Wiring" },
      { id: "mcp-cursor", check: "cursor_wiring", name: "Cursor MCP Wiring" },
      { id: "mcp-opencode", check: "opencode_wiring", name: "OpenCode Wiring" },
      { id: "mcp-claude", check: "claude_wiring", name: "Claude Wiring" },
      { id: "mcp-antigravity", check: "antigravity_wiring", name: "Antigravity Wiring" },
    ] as const;

    for (const mapping of mappings) {
      const row = checkMap.get(mapping.check);
      const statusHint = toStringOrNull(row?.status) || "missing";
      const ok = statusHint.startsWith("ok");
      items.push({
        id: mapping.id,
        name: mapping.name,
        description: "doctor チェックで配線状態を確認した結果です。",
        status: row ? (ok ? "ok" : "warning") : "missing",
        last_checked_at: generatedAt,
        installed: row ? true : false,
        version: statusHint,
        message: toStringOrNull(row?.fix),
      });
    }
  } else {
    errors.push({
      section: "ai_tools",
      message: "doctor snapshot is unavailable",
    });
    items.push({
      id: "doctor-snapshot",
      name: "Doctor Snapshot",
      description: "配線チェック（doctor）の直近結果です。",
      status: "missing",
      last_checked_at: generatedAt,
      installed: false,
      version: null,
      message: "doctor-last.json is missing",
    });
  }

  return items;
}

export function collectEnvironmentSnapshot(input: EnvironmentCollectorInput): EnvironmentSnapshot {
  const generatedAt = nowIso();
  const stateDir = resolveHomePath((input.state_dir || process.env.HARNESS_MEM_HOME || DEFAULT_STATE_DIR).trim());
  const versionsPath = join(stateDir, "versions", "tool-versions.json");
  const doctorPath = join(stateDir, "runtime", "doctor-last.json");
  const homeDir = resolveHomePath("~");
  const errors: EnvironmentErrorItem[] = [];

  const listenersByPort = collectListenersByPort(errors);

  const versionsPayload = readJsonFile(versionsPath);
  if (versionsPayload.error) {
    errors.push({ section: "ai_tools", message: versionsPayload.error });
  }

  const doctorPayload = readJsonFile(doctorPath);
  if (doctorPayload.error) {
    errors.push({ section: "ai_tools", message: doctorPayload.error });
  }

  const servers = collectServerEntries(input, generatedAt, listenersByPort);
  const languages = collectLanguageEntries(generatedAt);
  const cliTools = collectCliEntries(generatedAt);
  const aiTools = collectAiToolEntries(versionsPayload.value, doctorPayload.value, generatedAt, errors);

  const serverCount = statusCount(servers);
  const languageCount = statusCount(languages);
  const cliCount = statusCount(cliTools);
  const aiCount = statusCount(aiTools);

  const summary: EnvironmentSummary = {
    total: serverCount.total + languageCount.total + cliCount.total + aiCount.total,
    ok: serverCount.ok + languageCount.ok + cliCount.ok + aiCount.ok,
    warning: serverCount.warning + languageCount.warning + cliCount.warning + aiCount.warning,
    missing: serverCount.missing + languageCount.missing + cliCount.missing + aiCount.missing,
    servers: serverCount.total,
    languages: languageCount.total,
    cli_tools: cliCount.total,
    ai_tools: aiCount.total,
  };

  const rawSnapshot = {
    generated_at: generatedAt,
    summary,
    servers,
    languages,
    cli_tools: cliTools,
    ai_tools: aiTools,
    errors,
  };

  const snapshotHash = createHash("sha1").update(JSON.stringify(rawSnapshot)).digest("hex").slice(0, 12);
  const snapshot: EnvironmentSnapshot = {
    snapshot_id: `env_${snapshotHash}`,
    generated_at: generatedAt,
    summary,
    servers,
    languages,
    cli_tools: cliTools,
    ai_tools: aiTools,
    errors,
  };

  return sanitizeValue(snapshot, [], homeDir) as EnvironmentSnapshot;
}
