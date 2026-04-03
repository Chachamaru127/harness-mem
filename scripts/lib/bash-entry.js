const { spawnSync } = require("child_process");
const path = require("path");
const fs = require("fs");

function effectivePlatform(env = process.env) {
  return env.HARNESS_MEM_FORCE_PLATFORM || process.platform;
}

function windowsUnsupportedMessage(commandName) {
  return [
    `[harness-mem][error] \`${commandName}\` requires bash, which was not found on this system.`,
    "Reason: the current setup and hook wiring depend on POSIX shell scripts.",
    "",
    "Recommended solutions:",
    "  1. Install Git for Windows (https://gitforwindows.org/) — it includes Git Bash",
    "  2. Run harness-mem from Git Bash terminal",
    "  3. Use WSL2 (e.g. Ubuntu) and run the same command there",
    "",
    "If Git Bash is already installed, ensure 'bash' is available in your PATH.",
  ].join("\n");
}

/**
 * Find a usable bash binary on Windows.
 * Returns the path to bash.exe if found, or null if not available.
 */
function findWindowsBash() {
  // Check if bash is already on PATH (e.g. running inside Git Bash or MSYS2)
  const pathCheck = spawnSync("bash", ["--version"], {
    stdio: "pipe",
    timeout: 5000,
  });
  if (!pathCheck.error && pathCheck.status === 0) {
    return "bash";
  }

  // Search well-known Git Bash / MSYS2 locations
  const candidates = [
    "C:\\Program Files\\Git\\bin\\bash.exe",
    "C:\\Program Files (x86)\\Git\\bin\\bash.exe",
    `${process.env.PROGRAMFILES || ""}\\Git\\bin\\bash.exe`,
    `${process.env["PROGRAMFILES(X86)"] || ""}\\Git\\bin\\bash.exe`,
    "C:\\msys64\\usr\\bin\\bash.exe",
    "C:\\msys32\\usr\\bin\\bash.exe",
  ];

  for (const candidate of candidates) {
    if (candidate && fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function runBashEntry({ commandName, scriptRelativePath, args = process.argv.slice(2), env = process.env, cwd = process.cwd() }) {
  const platform = effectivePlatform(env);
  let bashPath = "bash";

  if (platform === "win32") {
    const found = findWindowsBash();
    if (!found) {
      console.error(windowsUnsupportedMessage(commandName));
      return 1;
    }
    bashPath = found;
    // Note: do NOT set MSYS_NO_PATHCONV here — the harness-mem scripts call
    // Windows-native binaries (jq, curl, etc.) that rely on MSYS automatic
    // path conversion from /c/Users/... to C:\Users\...
  }

  const scriptPath = path.resolve(__dirname, "..", scriptRelativePath);
  const result = spawnSync(bashPath, [scriptPath, ...args], {
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
  runBashEntry,
  windowsUnsupportedMessage,
};
