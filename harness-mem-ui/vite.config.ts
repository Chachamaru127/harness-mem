import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react() as any],
  root: resolve(__dirname, "src/app"),
  server: {
    host: "127.0.0.1",
    port: 37902,
  },
  build: {
    outDir: resolve(__dirname, "src/static-parity"),
    emptyOutDir: true,
  },
});
