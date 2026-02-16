import { HarnessMemCore, getConfig } from "./core/harness-mem-core";
import { startHarnessMemServer } from "./server";

const config = getConfig();
const core = new HarnessMemCore(config);
const server = startHarnessMemServer(core, config);

console.error(`[harness-memd] listening on http://${config.bindHost}:${config.bindPort}`);

const gracefulShutdown = (signal: string): void => {
  console.error(`[harness-memd] received ${signal}, draining queue and shutting down`);
  try {
    core.shutdown(signal);
  } finally {
    server.stop(true);
    process.exit(0);
  }
};

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
