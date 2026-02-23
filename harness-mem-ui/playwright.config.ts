import { defineConfig } from "@playwright/test";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const cwd = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:37911",
    headless: true,
  },
  webServer: {
    command: "HARNESS_MEM_UI_PORT=37911 bun run dev",
    cwd,
    port: 37911,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
