import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const DEFAULT_ENV_CANDIDATES = [
  process.env.INTERNAL_BENCH_ENV_FILE,
  join(process.cwd(), ".env"),
  join(homedir(), "LocalWork/Code/CC-harness/harness-mem/.env"),
].filter((value): value is string => Boolean(value?.trim()));

/**
 * Load KEY=VALUE pairs into process.env without logging values.
 * When an explicit env file list is passed, its values take precedence over
 * pre-existing process.env so a stale exported key cannot shadow the file.
 */
export function loadBenchmarkEnvFiles(
  paths: string[] = DEFAULT_ENV_CANDIDATES,
  options: { override?: boolean } = {},
): string[] {
  const override = options.override ?? false;
  const loaded: string[] = [];
  for (const filePath of paths) {
    if (!existsSync(filePath)) continue;
    const text = readFileSync(filePath, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const index = trimmed.indexOf("=");
      if (index <= 0) continue;
      const key = trimmed.slice(0, index).trim();
      let value = trimmed.slice(index + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (override || !(key in process.env) || process.env[key] === "") {
        process.env[key] = value;
      }
    }
    loaded.push(filePath);
  }
  return loaded;
}
