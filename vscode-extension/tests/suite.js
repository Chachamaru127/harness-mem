/**
 * Test suite runner for vscode-extension
 * Delegates to bun test for TypeScript tests.
 */
const { execSync } = require("child_process");

try {
  execSync("bun test tests/client.test.ts", { stdio: "inherit", cwd: __dirname + "/.." });
} catch (e) {
  process.exit(1);
}
