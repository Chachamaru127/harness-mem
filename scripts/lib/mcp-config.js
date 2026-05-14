const fs = require("fs");
const os = require("os");
const path = require("path");

const { effectivePlatform } = require("./bash-entry");

const BEGIN_CODEX_MCP = "# >>> harness-mem codex mcp";
const END_CODEX_MCP = "# <<< harness-mem codex mcp";
const BEGIN_HERMES_MCP = "# >>> harness-mem hermes mcp";
const END_HERMES_MCP = "# <<< harness-mem hermes mcp";
const DEFAULT_HTTP_ADDR = "127.0.0.1:37889";
const DEFAULT_HTTP_PATH = "/mcp";
const DEFAULT_TOKEN_ENV_VAR = "HARNESS_MEM_MCP_TOKEN";
const HERMES_SAFE_TOOLS = [
  "harness_mem_search",
  "harness_mem_timeline",
  "harness_mem_get_observations",
  "harness_mem_resume_pack",
  "harness_mem_record_checkpoint",
];

function getPathModule(platform) {
  return platform === "win32" ? path.win32 : path;
}

function resolveHarnessRoot(options = {}) {
  return options.harnessRoot || path.resolve(__dirname, "..", "..");
}

function resolveHomeDir(options = {}) {
  return options.homeDir || os.homedir();
}

function normalizeTransport(value) {
  const normalized = String(value || "stdio").trim().toLowerCase().replace(/-/g, "_");
  if (normalized === "http" || normalized === "streamable_http") {
    return "http";
  }
  if (normalized === "stdio") {
    return "stdio";
  }
  throw new Error(`Unsupported MCP transport: ${value}. Use stdio or http.`);
}

function ensureHttpPath(pathname) {
  const value = String(pathname || DEFAULT_HTTP_PATH).trim() || DEFAULT_HTTP_PATH;
  return value.startsWith("/") ? value : `/${value}`;
}

function resolveHttpEndpoint(options = {}) {
  const env = options.env || process.env;
  if (options.url || env.HARNESS_MEM_MCP_URL) {
    return options.url || env.HARNESS_MEM_MCP_URL;
  }
  const addr = options.addr || env.HARNESS_MEM_MCP_ADDR || DEFAULT_HTTP_ADDR;
  return `http://${addr}${ensureHttpPath(options.path || env.HARNESS_MEM_MCP_PATH)}`;
}

function resolveTokenEnvVar(options = {}) {
  const env = options.env || process.env;
  return options.tokenEnvVar || env.HARNESS_MEM_MCP_TOKEN_ENV_VAR || DEFAULT_TOKEN_ENV_VAR;
}

function buildAuthorizationHeader(tokenEnvVar) {
  return `Bearer \${${tokenEnvVar}}`;
}

function resolveServerSpec(options = {}) {
  const env = options.env || process.env;
  const transport = normalizeTransport(options.transport || "stdio");
  const platform = options.platform || effectivePlatform(env);
  const pathApi = getPathModule(platform);
  const homeDir = resolveHomeDir(options);
  const harnessRoot = resolveHarnessRoot(options);
  const dbPath =
    env.HARNESS_MEM_DB_PATH || pathApi.join(homeDir, ".harness-mem", "harness-mem.db");

  if (transport === "http") {
    const tokenEnvVar = resolveTokenEnvVar(options);
    return {
      transport: "http",
      url: resolveHttpEndpoint(options),
      bearerTokenEnvVar: tokenEnvVar,
      headers: {
        Authorization: buildAuthorizationHeader(tokenEnvVar),
      },
    };
  }

  // Use absolute paths — Claude Code CLI ignores `cwd` in MCP server config (v2.1.92+).
  // Relative args would resolve against the user's project directory, not harness root.
  const mcpEntry = pathApi.join(harnessRoot, "mcp-server", "dist", "index.js");
  const nodePath = pathApi.join(harnessRoot, "mcp-server", "node_modules");

  return {
    transport: "stdio",
    command: "node",
    args: [mcpEntry],
    env: {
      HARNESS_MEM_HOST: env.HARNESS_MEM_HOST || "127.0.0.1",
      HARNESS_MEM_PORT: env.HARNESS_MEM_PORT || "37888",
      HARNESS_MEM_DB_PATH: dbPath,
      NODE_PATH: nodePath,
    },
  };
}

function escapeTomlString(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function buildCodexManagedBlock(serverSpec) {
  if (serverSpec.transport === "http") {
    return [
      BEGIN_CODEX_MCP,
      "[mcp_servers.harness]",
      `url = "${escapeTomlString(serverSpec.url)}"`,
      `bearer_token_env_var = "${escapeTomlString(serverSpec.bearerTokenEnvVar)}"`,
      "enabled = true",
      END_CODEX_MCP,
      "",
    ].join("\n");
  }

  return [
    BEGIN_CODEX_MCP,
    "[mcp_servers.harness]",
    `command = "${escapeTomlString(serverSpec.command)}"`,
    `args = ["${escapeTomlString(serverSpec.args[0])}"]`,
    "enabled = true",
    "",
    "[mcp_servers.harness.env]",
    `HARNESS_MEM_HOST = "${escapeTomlString(serverSpec.env.HARNESS_MEM_HOST)}"`,
    `HARNESS_MEM_PORT = "${escapeTomlString(serverSpec.env.HARNESS_MEM_PORT)}"`,
    `HARNESS_MEM_DB_PATH = "${escapeTomlString(serverSpec.env.HARNESS_MEM_DB_PATH)}"`,
    `NODE_PATH = "${escapeTomlString(serverSpec.env.NODE_PATH)}"`,
    END_CODEX_MCP,
    "",
  ].join("\n");
}

function upsertManagedBlock(content, beginMarker, endMarker, block) {
  const start = content.indexOf(beginMarker);
  const end = content.indexOf(endMarker);

  if (start !== -1 && end !== -1 && end >= start) {
    const afterEnd = end + endMarker.length;
    const tail =
      content.slice(afterEnd, afterEnd + 1) === "\n"
        ? content.slice(afterEnd + 1)
        : content.slice(afterEnd);
    const head = content.slice(0, start).replace(/\s*$/, "");
    return `${head}\n\n${block}${tail ? tail.replace(/^\n*/, "") : ""}`.trimEnd() + "\n";
  }

  if (/\[mcp_servers\.harness\]/.test(content)) {
    return null;
  }

  const trimmed = content.trimEnd();
  if (!trimmed) {
    return `${block}`;
  }
  return `${trimmed}\n\n${block}`;
}

function ensureFileDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

function writeCodexConfig(options = {}) {
  const homeDir = resolveHomeDir(options);
  const filePath = options.filePath || path.join(homeDir, ".codex", "config.toml");
  const serverSpec = options.serverSpec || resolveServerSpec(options);

  ensureFileDir(filePath);

  const existing = fs.existsSync(filePath)
    ? fs.readFileSync(filePath, "utf8")
    : "# Codex MCP Config (generated by harness-mem)\n";
  const next = upsertManagedBlock(
    existing,
    BEGIN_CODEX_MCP,
    END_CODEX_MCP,
    buildCodexManagedBlock(serverSpec)
  );

  if (next === null) {
    return {
      client: "codex",
      status: "skipped",
      filePath,
      reason:
        "existing [mcp_servers.harness] section is unmanaged. Merge the printed snippet manually or rerun full setup.",
    };
  }

  fs.writeFileSync(filePath, next, "utf8");
  return { client: "codex", status: "updated", filePath };
}

function parseJsonFile(filePath, fallbackValue) {
  if (!fs.existsSync(filePath)) {
    return fallbackValue;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function resolveClaudeTargets(options = {}) {
  const homeDir = resolveHomeDir(options);
  const primary = path.join(homeDir, ".claude.json");
  const secondary = path.join(homeDir, ".claude", "settings.json");
  const targets = [];

  if (fs.existsSync(primary)) {
    targets.push(primary);
  }

  if (fs.existsSync(secondary)) {
    try {
      const parsed = parseJsonFile(secondary, {});
      if (parsed && typeof parsed === "object" && parsed.mcpServers) {
        targets.push(secondary);
      }
    } catch {
      // ignore malformed settings.json here; write step will report it
    }
  }

  if (targets.length === 0) {
    targets.push(primary);
  }

  return targets;
}

function writeClaudeConfig(options = {}) {
  const filePath = options.filePath;
  const serverSpec = options.serverSpec || resolveServerSpec(options);

  ensureFileDir(filePath);

  const parsed = parseJsonFile(filePath, { mcpServers: {} });
  parsed.mcpServers = parsed.mcpServers || {};

  if (serverSpec.transport === "http") {
    parsed.mcpServers.harness = {
      ...(parsed.mcpServers.harness || {}),
      type: "http",
      url: serverSpec.url,
      enabled: true,
      headers: {
        ...((parsed.mcpServers.harness && parsed.mcpServers.harness.headers) || {}),
        Authorization: serverSpec.headers.Authorization,
      },
    };
    delete parsed.mcpServers.harness.command;
    delete parsed.mcpServers.harness.args;
    delete parsed.mcpServers.harness.cwd;
    delete parsed.mcpServers.harness.env;
    fs.writeFileSync(filePath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
    return { client: "claude", status: "updated", filePath };
  }

  parsed.mcpServers.harness = {
    ...(parsed.mcpServers.harness || {}),
    command: serverSpec.command,
    args: serverSpec.args,
    enabled: true,
    env: {
      ...((parsed.mcpServers.harness && parsed.mcpServers.harness.env) || {}),
      ...serverSpec.env,
    },
  };
  // Remove legacy cwd field — Claude Code CLI ignores it, causing MODULE_NOT_FOUND
  delete parsed.mcpServers.harness.cwd;
  delete parsed.mcpServers.harness.type;
  delete parsed.mcpServers.harness.url;
  delete parsed.mcpServers.harness.headers;

  fs.writeFileSync(filePath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  return { client: "claude", status: "updated", filePath };
}

function escapeYamlDoubleQuoted(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function buildHermesManagedBlock(serverSpec) {
  const lines = [BEGIN_HERMES_MCP, "mcp_servers:", "  harness_mem:"];

  if (serverSpec.transport === "http") {
    lines.push(
      `    url: "${escapeYamlDoubleQuoted(serverSpec.url)}"`,
      "    headers:",
      `      Authorization: "${escapeYamlDoubleQuoted(serverSpec.headers.Authorization)}"`
    );
  } else {
    lines.push(
      `    command: "${escapeYamlDoubleQuoted(serverSpec.command)}"`,
      "    args:",
      ...serverSpec.args.map((arg) => `      - "${escapeYamlDoubleQuoted(arg)}"`),
      "    env:",
      ...Object.entries(serverSpec.env).map(
        ([key, value]) => `      ${key}: "${escapeYamlDoubleQuoted(value)}"`
      )
    );
  }

  lines.push("    tools:", "      include:");
  for (const tool of HERMES_SAFE_TOOLS) {
    lines.push(`        - ${tool}`);
  }
  lines.push("      prompts: false", "      resources: false", END_HERMES_MCP, "");
  return lines.join("\n");
}

function replaceManagedBlock(content, beginMarker, endMarker, block) {
  const start = content.indexOf(beginMarker);
  const end = content.indexOf(endMarker);
  if (start === -1 || end === -1 || end < start) {
    return null;
  }

  const afterEnd = end + endMarker.length;
  const tail =
    content.slice(afterEnd, afterEnd + 1) === "\n"
      ? content.slice(afterEnd + 1)
      : content.slice(afterEnd);
  const head = content.slice(0, start).replace(/\s*$/, "");
  return `${head}${head ? "\n\n" : ""}${block}${tail ? tail.replace(/^\n*/, "") : ""}`.trimEnd() + "\n";
}

function writeHermesConfig(options = {}) {
  const homeDir = resolveHomeDir(options);
  const filePath = options.filePath || path.join(homeDir, ".hermes", "config.yaml");
  const serverSpec = options.serverSpec || resolveServerSpec(options);
  const block = buildHermesManagedBlock(serverSpec);

  ensureFileDir(filePath);

  const existing = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
  const replaced = replaceManagedBlock(existing, BEGIN_HERMES_MCP, END_HERMES_MCP, block);
  if (replaced !== null) {
    fs.writeFileSync(filePath, replaced, "utf8");
    return { client: "hermes", status: "updated", filePath };
  }

  if (/^mcp_servers:\s*$/m.test(existing)) {
    return {
      client: "hermes",
      status: "skipped",
      filePath,
      reason:
        "existing mcp_servers section is unmanaged. Merge the printed harness_mem snippet manually.",
    };
  }

  const trimmed = existing.trimEnd();
  fs.writeFileSync(filePath, `${trimmed}${trimmed ? "\n\n" : ""}${block}`, "utf8");
  return { client: "hermes", status: "updated", filePath };
}

function parseCliArgs(argv) {
  const parsed = {
    write: false,
    clients: ["claude", "codex"],
    json: false,
    homeDir: undefined,
    transport: "stdio",
    url: undefined,
    addr: undefined,
    tokenEnvVar: undefined,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--write") {
      parsed.write = true;
      continue;
    }
    if (arg === "--json") {
      parsed.json = true;
      continue;
    }
    if (arg === "--client" || arg === "--clients") {
      const value = argv[i + 1] || "";
      parsed.clients = value
        .split(",")
        .map((entry) => entry.trim().toLowerCase())
        .filter(Boolean);
      i += 1;
      continue;
    }
    if (arg === "--home") {
      parsed.homeDir = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--transport" || arg === "--mcp-transport") {
      parsed.transport = argv[i + 1] || "";
      i += 1;
      continue;
    }
    if (arg === "--url") {
      parsed.url = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--addr") {
      parsed.addr = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--token-env-var" || arg === "--bearer-token-env-var") {
      parsed.tokenEnvVar = argv[i + 1];
      i += 1;
      continue;
    }
  }

  if (parsed.clients.includes("all")) {
    parsed.clients = ["claude", "codex"];
  }

  return parsed;
}

function buildPrintableSummary(results, serverSpec) {
  const codexSnippet = buildCodexManagedBlock(serverSpec).trimEnd();
  const claudeHarness =
    serverSpec.transport === "http"
      ? {
          type: "http",
          url: serverSpec.url,
          headers: serverSpec.headers,
        }
      : {
          command: serverSpec.command,
          args: serverSpec.args,
          enabled: true,
          env: serverSpec.env,
        };
  const claudeSnippet = JSON.stringify({ mcpServers: { harness: claudeHarness } }, null, 2);
  const hermesSnippet = buildHermesManagedBlock(serverSpec).trimEnd();

  const lines = [
    "harness-mem MCP config summary",
    "",
    `transport: ${serverSpec.transport}`,
  ];
  if (serverSpec.transport === "http") {
    lines.push(
      `url: ${serverSpec.url}`,
      `bearer_token_env_var: ${serverSpec.bearerTokenEnvVar}`
    );
  } else {
    lines.push(`command: ${serverSpec.command}`, `args[0]: ${serverSpec.args[0]}`);
  }
  lines.push("");

  for (const result of results) {
    if (result.status === "updated") {
      lines.push(`[ok] ${result.client}: ${result.filePath}`);
    } else if (result.status === "preview") {
      lines.push(`[preview] ${result.client}: ${result.filePath}`);
    } else {
      lines.push(`[skip] ${result.client}: ${result.filePath}`);
      lines.push(`reason: ${result.reason}`);
    }
  }

  lines.push(
    "",
    "Codex snippet:",
    codexSnippet,
    "",
    "Claude snippet:",
    claudeSnippet,
    "",
    "Hermes snippet:",
    hermesSnippet,
    ""
  );

  return lines.join("\n");
}

function runMcpConfigCli(options = {}) {
  const argv = options.argv || process.argv.slice(2);
  const env = options.env || process.env;
  const stdout = options.stdout || process.stdout;
  const stderr = options.stderr || process.stderr;
  const parsed = parseCliArgs(argv);
  const homeDir = parsed.homeDir || options.homeDir;
  const serverSpec = resolveServerSpec({
    env,
    homeDir,
    transport: parsed.transport,
    url: parsed.url,
    addr: parsed.addr,
    tokenEnvVar: parsed.tokenEnvVar,
    platform: options.platform || effectivePlatform(env),
    harnessRoot: options.harnessRoot,
  });

  try {
    const results = [];
    for (const client of parsed.clients) {
      if (client === "codex") {
        if (parsed.write) {
          results.push(writeCodexConfig({ homeDir, serverSpec }));
        } else {
          results.push({
            client: "codex",
            status: "preview",
            filePath: path.join(resolveHomeDir({ homeDir }), ".codex", "config.toml"),
          });
        }
        continue;
      }
      if (client === "claude") {
        for (const filePath of resolveClaudeTargets({ homeDir })) {
          if (parsed.write) {
            results.push(writeClaudeConfig({ filePath, serverSpec }));
          } else {
            results.push({
              client: "claude",
              status: "preview",
              filePath,
            });
          }
        }
        continue;
      }
      if (client === "hermes") {
        const filePath = path.join(resolveHomeDir({ homeDir }), ".hermes", "config.yaml");
        if (parsed.write) {
          results.push(writeHermesConfig({ homeDir, filePath, serverSpec }));
        } else {
          results.push({
            client: "hermes",
            status: "preview",
            filePath,
          });
        }
        continue;
      }
    }

    if (parsed.json) {
      stdout.write(`${JSON.stringify({ serverSpec, results }, null, 2)}\n`);
    } else {
      stdout.write(buildPrintableSummary(results, serverSpec));
      if (!parsed.write) {
        stdout.write(
          "Tip: rerun with --write to apply these snippets to the selected local client config files.\n"
        );
      }
    }
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`[harness-mem][error] Failed to prepare MCP config: ${message}\n`);
    return 1;
  }
}

module.exports = {
  BEGIN_CODEX_MCP,
  END_CODEX_MCP,
  BEGIN_HERMES_MCP,
  END_HERMES_MCP,
  buildCodexManagedBlock,
  buildHermesManagedBlock,
  parseCliArgs,
  resolveClaudeTargets,
  resolveServerSpec,
  runMcpConfigCli,
  upsertManagedBlock,
  writeClaudeConfig,
  writeCodexConfig,
  writeHermesConfig,
};

if (require.main === module) {
  process.exit(runMcpConfigCli());
}
