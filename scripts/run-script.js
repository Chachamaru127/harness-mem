#!/usr/bin/env node
/**
 * Cross-platform bash script runner for Claude plugin hooks.
 * Mirrors the proven harness implementation so hooks.json can keep
 * referencing repo-local shell scripts portably.
 */

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

function isWindowsAbsolutePath(value) {
  return typeof value === "string" && /^[A-Za-z]:[\\/]/.test(value);
}

function fallbackToPosixWindowsPath(value) {
  if (!isWindowsAbsolutePath(value)) {
    return value;
  }

  const driveLetter = value[0].toLowerCase();
  const remainder = value.slice(2).replace(/\\/g, "/");
  return `/${driveLetter}${remainder.startsWith("/") ? remainder : `/${remainder}`}`;
}

function fallbackWindowsUnsupportedMessage(commandName) {
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

let bashEntry = {
  findWindowsBash: () => {
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
  },
  toPosixWindowsPath: fallbackToPosixWindowsPath,
  windowsUnsupportedMessage: fallbackWindowsUnsupportedMessage,
};

try {
  bashEntry = require("./lib/bash-entry.js");
} catch {
  // Keep the hook runner usable in tests or older plugin copies that only place
  // run-script.js next to the shell scripts. Packaged installs include lib/.
}

const isWindows = process.platform === "win32";

function findBash() {
  if (!isWindows) {
    return "bash";
  }
  return bashEntry.findWindowsBash();
}

function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error("Usage: node run-script.js <script-name> [args...]");
    process.exit(1);
  }

  const scriptName = args[0];
  const scriptArgs = args.slice(1);
  const scriptsDir = __dirname;
  let scriptPath = path.join(scriptsDir, scriptName);
  if (!scriptPath.endsWith(".sh")) {
    scriptPath += ".sh";
  }
  if (!fs.existsSync(scriptPath)) {
    console.error(`Error: Script not found: ${scriptPath}`);
    process.exit(1);
  }

  const bashPath = findBash();
  if (isWindows && !bashPath) {
    console.error(bashEntry.windowsUnsupportedMessage(`harness-mem hook ${scriptName}`));
    process.exit(0);
  }

  const env = { ...process.env };
  let bashScriptPath = scriptPath;
  if (isWindows) {
    bashScriptPath = bashEntry.toPosixWindowsPath(scriptPath);
    env.MSYS_NO_PATHCONV = "1";
    env.MSYS2_ARG_CONV_EXCL = "*";
    if (env.CLAUDE_PLUGIN_ROOT) {
      env.CLAUDE_PLUGIN_ROOT = bashEntry.toPosixWindowsPath(env.CLAUDE_PLUGIN_ROOT);
    }
  }

  const child = spawn(bashPath, [bashScriptPath, ...scriptArgs], {
    env,
    stdio: "inherit",
    shell: false,
  });

  child.on("error", (error) => {
    console.error(`Failed to execute bash: ${error.message}`);
    process.exit(1);
  });

  child.on("exit", (code, signal) => {
    if (signal) {
      process.exit(1);
    }
    process.exit(code || 0);
  });
}

main();
