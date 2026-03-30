#!/usr/bin/env node
/**
 * Cross-platform bash script runner for Claude plugin hooks.
 * Mirrors the proven harness implementation so hooks.json can keep
 * referencing repo-local shell scripts portably.
 */

const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const isWindows = process.platform === "win32";

function toMsysPath(input) {
  if (!input) return input;
  let converted = input.replace(/\\/g, "/");
  const driveMatch = converted.match(/^([A-Za-z]):\//);
  if (driveMatch) {
    converted = `/${driveMatch[1].toLowerCase()}${converted.slice(2)}`;
  }
  return converted;
}

function findBash() {
  if (!isWindows) {
    return "bash";
  }

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
  return "bash";
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
  const env = { ...process.env };
  let bashScriptPath = scriptPath;
  if (isWindows) {
    bashScriptPath = toMsysPath(scriptPath);
    env.MSYS_NO_PATHCONV = "1";
    env.MSYS2_ARG_CONV_EXCL = "*";
    if (env.CLAUDE_PLUGIN_ROOT) {
      env.CLAUDE_PLUGIN_ROOT = toMsysPath(env.CLAUDE_PLUGIN_ROOT);
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
