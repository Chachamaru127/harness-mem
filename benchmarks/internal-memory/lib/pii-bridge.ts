import { spawnSync } from "node:child_process";
import { join } from "node:path";

const PII_DIR = join(import.meta.dir, "..", "pii");

export function maskTextViaPython(text: string, language: "ja" | "en" | "mixed" = "ja"): string {
  const lang = language === "en" ? "en" : "ja";
  const script = `
import json, sys
sys.path.insert(0, ${JSON.stringify(PII_DIR)})
from mask import mask_text
print(json.dumps(mask_text(sys.stdin.read(), ${JSON.stringify(lang)})))
`;
  const result = spawnSync("python3", ["-c", script], {
    input: text,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0) {
    throw new Error(`PII mask failed: ${result.stderr || result.stdout}`);
  }
  return JSON.parse(result.stdout.trim()) as string;
}

export function scanForPiiLeaks(text: string): string[] {
  const script = `
import json, sys
sys.path.insert(0, ${JSON.stringify(PII_DIR)})
from mask import scan_for_leaks
print(json.dumps(scan_for_leaks(sys.stdin.read())))
`;
  const result = spawnSync("python3", ["-c", script], {
    input: text,
    encoding: "utf8",
  });
  if (result.status !== 0) return ["scan_error"];
  return JSON.parse(result.stdout.trim()) as string[];
}
