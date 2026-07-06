import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const SCRIPT = resolve(ROOT, "scripts/harness-mem");

async function runHarnessMem(
  args: string[],
  env: NodeJS.ProcessEnv,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const proc = Bun.spawn(["bash", SCRIPT, ...args], {
    stdout: "pipe",
    stderr: "pipe",
    env,
  });
  const stdout = await new Response(proc.stdout).text();
  const stderr = await new Response(proc.stderr).text();
  const code = await proc.exited;
  return { code, stdout, stderr };
}

function installFakeCurl(home: string, healthJson: string): string {
  const fakeBin = join(home, "bin");
  mkdirSync(fakeBin, { recursive: true });
  const fakeCurl = join(fakeBin, "curl");
  writeFileSync(
    fakeCurl,
    `#!/usr/bin/env bash
out=""
write=""
url=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) out="$2"; shift 2 ;;
    -w) write="$2"; shift 2 ;;
    http://*|https://*) url="$1"; shift ;;
    *) shift ;;
  esac
done
body='{}'
if [[ "$url" == *"/health"* ]]; then
  body="$HARNESS_MEM_FAKE_HEALTH_JSON"
elif [[ "$url" == *"/v1/lease/acquire"* ]]; then
  body='{"lease":{"leaseId":"doctor-test"}}'
fi
if [ -n "$out" ]; then
  printf '%s' "$body" > "$out"
else
  printf '%s' "$body"
fi
if [ -n "$write" ]; then
  printf '200'
fi
exit 0
`,
  );
  chmodSync(fakeCurl, 0o755);
  writeFileSync(join(home, "health.json"), healthJson);
  return fakeBin;
}

describe("harness-mem doctor embedding migration notice", () => {
  test("doctor JSON records embedding_model warning from health notice every run", async () => {
    const home = mkdtempSync(join(tmpdir(), "hmem-doctor-granite-notice-"));
    const healthJson = JSON.stringify({
      ok: true,
      items: [
        {
          db_path: join(home, "harness-mem.db"),
          embedding_migration_notice: {
            required: true,
            message: "Granite embedding migration recommended",
            fix_command: "harness-mem model pull granite-embedding-311m-r2 --yes",
          },
        },
      ],
    });
    const fakeBin = installFakeCurl(home, healthJson);

    try {
      const env = {
        ...process.env,
        HOME: home,
        HARNESS_MEM_HOME: home,
        HARNESS_MEM_FAKE_HEALTH_JSON: readFileSync(join(home, "health.json"), "utf8"),
        PATH: `${fakeBin}:${process.env.PATH ?? ""}`,
      };
      const first = await runHarnessMem(["doctor", "--json", "--read-only", "--skip-version-check"], env);
      const second = await runHarnessMem(["doctor", "--json", "--read-only", "--skip-version-check"], env);

      for (const result of [first, second]) {
        expect(result.code).toBe(0);
        const payload = JSON.parse(result.stdout) as { checks: Array<{ name: string; status: string; result: string; fix: string }> };
        const check = payload.checks.find((entry) => entry.name === "embedding_model");
        expect(check).toBeDefined();
        expect(check?.status).toBe("warn:granite_migration_available");
        expect(check?.result).toBe("warn");
        expect(check?.fix).toContain("granite-embedding-311m-r2");
      }
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
