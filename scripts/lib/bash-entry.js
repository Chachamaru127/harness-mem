const { spawnSync } = require("child_process");
const path = require("path");

function effectivePlatform(env = process.env) {
  return env.HARNESS_MEM_FORCE_PLATFORM || process.platform;
}

function windowsUnsupportedMessage(commandName) {
  return [
    `[harness-mem][error] \`${commandName}\` does not support native Windows PowerShell / CMD yet.`,
    "Reason: the current setup and hook wiring still depend on POSIX shell scripts and Unix-style paths.",
    "Recommended path: run harness-mem inside WSL2 (for example Ubuntu) and execute the same command there.",
    "Current Windows status: Git Bash may let some shell scripts start, but native Windows wiring is not supported or verified.",
  ].join("\n");
}

function runBashEntry({ commandName, scriptRelativePath, args = process.argv.slice(2), env = process.env, cwd = process.cwd() }) {
  const platform = effectivePlatform(env);
  if (platform === "win32") {
    console.error(windowsUnsupportedMessage(commandName));
    return 1;
  }

  const scriptPath = path.resolve(__dirname, "..", scriptRelativePath);
  const result = spawnSync("bash", [scriptPath, ...args], {
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
  runBashEntry,
  windowsUnsupportedMessage,
};
