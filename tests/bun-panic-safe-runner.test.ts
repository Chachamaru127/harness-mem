import { describe, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const SAFE_RUNNER = resolve(import.meta.dir, "../scripts/run-bun-test-safe.sh");

describe("bun panic safe runner", () => {
  test("treats known Bun post-pass panic as runtime noise", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "harness-mem-bun-safe-"));

    try {
      const fakeBun = join(tmp, "bun");
      writeFileSync(
        fakeBun,
        `#!/usr/bin/env bash
echo "bun test v1.3.10 (30e609e0)"
echo ""
echo "tests/example.test.ts:"
echo "(pass) example > works"
echo ""
echo " 1 pass"
echo " 0 fail"
echo "panic(main thread): A C++ exception occurred"
echo "oh no: Bun has crashed. This indicates a bug in Bun, not your code."
exit 133
`
      );
      chmodSync(fakeBun, 0o755);

      const proc = Bun.spawn(["bash", SAFE_RUNNER, "tests/example.test.ts"], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PATH: `${tmp}:${process.env.PATH ?? ""}`,
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;
      const stderr = await new Response(proc.stderr).text();

      expect(exitCode).toBe(0);
      expect(stderr).toContain("known Bun runtime noise");
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("does not hide a real failing summary even if panic text is present", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "harness-mem-bun-safe-"));

    try {
      const fakeBun = join(tmp, "bun");
      writeFileSync(
        fakeBun,
        `#!/usr/bin/env bash
echo "bun test v1.3.10 (30e609e0)"
echo ""
echo "tests/example.test.ts:"
echo "(fail) example > breaks"
echo ""
echo " 0 pass"
echo " 1 fail"
echo "panic(main thread): A C++ exception occurred"
echo "oh no: Bun has crashed. This indicates a bug in Bun, not your code."
exit 133
`
      );
      chmodSync(fakeBun, 0o755);

      const proc = Bun.spawn(["bash", SAFE_RUNNER, "tests/example.test.ts"], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          PATH: `${tmp}:${process.env.PATH ?? ""}`,
        },
        stdout: "pipe",
        stderr: "pipe",
      });

      const exitCode = await proc.exited;

      expect(exitCode).toBe(133);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
