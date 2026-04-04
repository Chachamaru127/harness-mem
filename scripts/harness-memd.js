#!/usr/bin/env node

const { runBashEntry } = require("./lib/bash-entry");

process.exit(
  runBashEntry({
    commandName: "harness-memd",
    scriptRelativePath: "harness-memd",
  })
);
