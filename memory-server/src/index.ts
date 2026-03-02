import { HarnessMemCore, getConfig } from "./core/harness-mem-core";
import { checkRemoteBindSafety, startHarnessMemServer } from "./server";

const config = getConfig();

// リモートバインド安全チェック: 127.0.0.1/localhost 以外でトークン未設定はエラー終了
const remoteBindError = checkRemoteBindSafety(config.bindHost);
if (remoteBindError) {
  console.error(remoteBindError);
  process.exit(1);
}

const isRemote = config.bindHost !== "127.0.0.1" && config.bindHost !== "localhost";
if (isRemote) {
  console.error(`[harness-memd] リモートモードで起動 host=${config.bindHost}:${config.bindPort} (Bearer Token 認証有効)`);
}

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
