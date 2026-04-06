/**
 * esbuild bundler config for harness MCP server.
 *
 * Produces a single self-contained dist/index.js that embeds all
 * npm dependencies so the plugin works immediately after git clone
 * — no `npm install` required at runtime.
 */
import { build } from "esbuild";

await build({
  entryPoints: ["src/index.ts"],
  bundle: true,
  platform: "node",
  target: "node18",
  format: "esm",
  outfile: "dist/index.js",
  // No banner needed — plugin.json invokes via `node dist/index.js`
  // Keep node built-ins external (they ship with Node)
  external: [],
  // Inline everything from node_modules
  packages: "bundle",
  sourcemap: true,
  minify: false, // keep readable for debugging
});

console.log("✓ MCP server bundled → dist/index.js");
