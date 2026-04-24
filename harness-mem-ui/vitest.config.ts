import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    root: resolve(__dirname),
    environment: "jsdom",
    globals: true,
    include: ["tests/ui/**/*.vitest.ts", "tests/ui/**/*.vitest.tsx"],
  },
});
