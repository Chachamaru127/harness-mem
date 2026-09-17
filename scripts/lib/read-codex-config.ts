// Parse keys in the supplied TOML file (including quoted table names) without executing config.
const config = Bun.TOML.parse(await Bun.file(process.argv[2]).text()) as Record<string, any>;
console.log(JSON.stringify({
  harness: config.mcp_servers?.harness ?? config.mcp_servers?.["harness-mem"] ?? null,
  features: config.features ?? {},
}));
