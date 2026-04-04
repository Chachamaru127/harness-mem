const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const WINDOWS_PATH_FLAGS = new Set(["--project", "--source", "--dest-dir"]);

function effectivePlatform(env = process.env) {
  return env.HARNESS_MEM_FORCE_PLATFORM || process.platform;
}

function windowsUnsupportedMessage(commandName) {
  return [
    `[harness-mem][error] \`${commandName}\` requires bash, which was not found on this system.`,
    "Reason: the current setup and hook wiring still depend on POSIX shell scripts.",
    "Native exception: `harness-mem mcp-config --write --client claude,codex` is available for MCP-only config updates on Windows.",
    "",
    "Recommended solutions:",
    "  1. Install Git for Windows (https://gitforwindows.org/) — it includes Git Bash",
    "  2. Run harness-mem from Git Bash terminal",
    "  3. Use WSL2 (for example Ubuntu) and run the same command there",
    "",
    "If Git Bash is already installed, ensure `bash` is available in your PATH or installed under the default Git for Windows location.",
  ].join("\n");
}

function isWindowsAbsolutePath(value) {
  return typeof value === "string" && /^[A-Za-z]:[\\/]/.test(value);
}

function toPosixWindowsPath(value) {
  if (!isWindowsAbsolutePath(value)) {
    return value;
  }

  const driveLetter = value[0].toLowerCase();
  const remainder = value.slice(2).replace(/\\/g, "/");
  return `/${driveLetter}${remainder.startsWith("/") ? remainder : `/${remainder}`}`;
}

function normalizeWindowsCliArg(arg) {
  return isWindowsAbsolutePath(arg) ? toPosixWindowsPath(arg) : arg;
}

function normalizeWindowsCliArgs(args) {
  const normalized = [];
  let expectsPathValue = false;

  for (const arg of args) {
    if (expectsPathValue) {
      normalized.push(normalizeWindowsCliArg(arg));
      expectsPathValue = false;
      continue;
    }

    const matchedFlag = [...WINDOWS_PATH_FLAGS].find((flag) =>
      arg.startsWith(`${flag}=`)
    );
    if (matchedFlag) {
      normalized.push(
        `${matchedFlag}=${normalizeWindowsCliArg(arg.slice(matchedFlag.length + 1))}`
      );
      continue;
    }

    normalized.push(arg);
    expectsPathValue = WINDOWS_PATH_FLAGS.has(arg);
  }

  return normalized;
}

function readSpawnOutput(result) {
  return [result.stdout, result.stderr]
    .filter(Boolean)
    .map((chunk) => chunk.toString())
    .join("\n");
}

function looksLikeWindowsGitBash(versionOutput) {
  return /(msys|mingw|cygwin|git for windows)/i.test(versionOutput);
}

function findWindowsBash({
  env = process.env,
  spawnImpl = spawnSync,
  existsSyncImpl = fs.existsSync,
} = {}) {
  const candidates = [
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
    `${env.PROGRAMFILES || ""}\\Git\\bin\\bash.exe`,
    `${env["PROGRAMFILES(X86)"] || ""}\\Git\\bin\\bash.exe`,
    "C:\\msys64\\usr\\bin\\bash.exe",
    "C:\\msys32\\usr\\bin\\bash.exe",
  ];

  for (const candidate of [...new Set(candidates)].filter(Boolean)) {
    if (existsSyncImpl(candidate)) {
      return candidate;
    }
  }

  const pathCheck = spawnImpl("bash", ["--version"], {
    stdio: "pipe",
    timeout: 5000,
    env,
  });
  if (
    !pathCheck.error &&
    pathCheck.status === 0 &&
    looksLikeWindowsGitBash(readSpawnOutput(pathCheck))
  ) {
    return "bash";
  }

  return null;
}

function runBashEntry({ commandName, scriptRelativePath, args = process.argv.slice(2), env = process.env, cwd = process.cwd() }) {
  const platform = effectivePlatform(env);
  let bashPath = "bash";

  if (platform === "win32") {
    const found = findWindowsBash({ env });
    if (!found) {
      console.error(windowsUnsupportedMessage(commandName));
      return 1;
    }
    bashPath = found;
  }

  const scriptPath = path.resolve(__dirname, "..", scriptRelativePath);
  const normalizedScriptPath =
    platform === "win32" ? toPosixWindowsPath(scriptPath) : scriptPath;
  const normalizedArgs = platform === "win32" ? normalizeWindowsCliArgs(args) : args;

  const result = spawnSync(bashPath, [normalizedScriptPath, ...normalizedArgs], {
    stdio: "inherit",
    env,
    cwd,
  });

  if (result.error) {
    console.error(`[harness-mem][error] Failed to start bash for \`${commandName}\`: ${result.error.message}`);
    return 1;
  }

  if (typeof result.status === "number") {
    return result.status;
  }

  return 1;
}

module.exports = {
  effectivePlatform,
  findWindowsBash,
  isWindowsAbsolutePath,
  looksLikeWindowsGitBash,
  normalizeWindowsCliArg,
  normalizeWindowsCliArgs,
  toPosixWindowsPath,
  runBashEntry,
  windowsUnsupportedMessage,
};
