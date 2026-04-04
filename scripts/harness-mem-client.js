#!/usr/bin/env node

const { runBashEntry } = require("./lib/bash-entry");

process.exit(
  runBashEntry({
    commandName: "harness-mem-client",
    scriptRelativePath: "harness-mem-client.sh",
  })
);
