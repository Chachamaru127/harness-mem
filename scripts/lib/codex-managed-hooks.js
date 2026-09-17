// Identify only our commands, never an arbitrary script with a matching basename.
const fs = require("node:fs");
const path = require("node:path");

function nativePath(value, platform) {
  if (platform !== "win32") return value;
  // MSYS converts shell argv to C:/... but leaves paths inside hooks.json as /c/... .
  return value.replaceAll("\\", "/").replace(/^\/([a-z])(?=\/|$)/i, (_, drive) => `${drive.toUpperCase()}:`);
}

function managedHooks(config, currentRoot, platform = process.platform) {
  const handlers = { SessionStart: "codex-session-start", UserPromptSubmit: "codex-user-prompt", Stop: "codex-session-stop" };
  const currentNativeRoot = nativePath(currentRoot, platform);
  const identity = value => platform === "win32" ? path.win32.normalize(value).toLowerCase() : value;
  const result = {};
  for (const [event, handler] of Object.entries(handlers)) {
    result[event] = [];
    for (const group of config.hooks?.[event] ?? []) {
      for (const hook of group.hooks ?? []) {
        if (hook.type !== "command" || typeof hook.command !== "string") continue;
        // Accept precisely one script argument. Shell chains/extra args are user-owned.
        const match = /^bash (?:"([^"\n]+)"|'([^'\n]+)'|([^\s"';&|<>`$]+))$/.exec(hook.command);
        const script = match && (match[1] ?? match[2] ?? match[3]);
        if (!script) continue;
        const nativeScript = nativePath(script, platform);
        const absolute = nativeScript.startsWith("/") || (platform === "win32" && /^[a-z]:\//i.test(nativeScript));
        const suffix = `/scripts/hook-handlers/${handler}.sh`;
        if (!absolute || !nativeScript.endsWith(suffix)) continue;
        const root = nativeScript.slice(0, -suffix.length);
        let managed = identity(root) === identity(currentNativeRoot) || root.endsWith("/node_modules/@chachamaru127/harness-mem");
        if (!managed) {
          try {
            managed = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).name === "@chachamaru127/harness-mem";
          } catch { /* Unknown ownership: preserve it. */ }
        }
        // Keep the original command/path for JSON updates and Bash's file checks.
        if (managed) result[event].push({ command: hook.command, path: script });
      }
    }
  }
  return result;
}

module.exports = { managedHooks };
if (require.main === module) {
  const [file, currentRoot] = process.argv.slice(2);
  const config = JSON.parse(fs.readFileSync(file, "utf8"));
  console.log(JSON.stringify(managedHooks(config, currentRoot)));
}
