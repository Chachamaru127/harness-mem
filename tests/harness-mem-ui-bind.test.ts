import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

const UI_SERVER = resolve(import.meta.dir, "..", "harness-mem-ui/src/server.ts");
const hasLsof = Bun.spawnSync(["which", "lsof"]).exitCode === 0;

async function listenAddresses(port: number): Promise<string[]> {
  for (let i = 0; i < 50; i += 1) {
    const out = Bun.spawnSync(["lsof", "-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fn"]).stdout.toString();
    const names = out.split("\n").filter((l) => l.startsWith("n")).map((l) => l.slice(1));
    if (names.length > 0) return names;
    await Bun.sleep(100);
  }
  return [];
}

async function listenWith(env: Record<string, string>): Promise<string[]> {
  const port = 46000 + Math.floor(Math.random() * 1000);
  const proc = Bun.spawn([process.execPath, "run", UI_SERVER], {
    stdout: "ignore",
    stderr: "ignore",
    env: { ...process.env, HARNESS_MEM_UI_HOST: "", ...env, HARNESS_MEM_UI_PORT: String(port) },
  });
  try {
    return await listenAddresses(port);
  } finally {
    proc.kill();
    await proc.exited;
  }
}

describe.skipIf(!hasLsof)("harness-mem UI listen address", () => {
  test("listens on loopback only by default", async () => {
    const names = await listenWith({});
    expect(names.length).toBeGreaterThan(0);
    for (const name of names) expect(name).toMatch(/^127\.0\.0\.1:\d+$/);
  });

  test("HARNESS_MEM_UI_HOST overrides the listen address", async () => {
    const names = await listenWith({ HARNESS_MEM_UI_HOST: "0.0.0.0" });
    expect(names.some((name) => name.startsWith("*:"))).toBe(true);
  });
});
