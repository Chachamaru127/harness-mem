#!/usr/bin/env node

const { runBashEntry } = require("./lib/bash-entry");
const { runMcpConfigCli } = require("./lib/mcp-config");

const args = process.argv.slice(2);

if (args[0] === "mcp-config") {
  process.exit(runMcpConfigCli({ argv: args.slice(1) }));
}

process.exit(
  runBashEntry({
    commandName: "harness-mem",
    scriptRelativePath: "harness-mem",
  })
);
