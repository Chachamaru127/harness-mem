import { HarnessMemCore, getConfig } from "./core/harness-mem-core";
import { checkRemoteBindSafety, startHarnessMemServer } from "./server";
import { shutdownTelemetry } from "./telemetry/otel";

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

// §155-A02: HARNESS_MEM_EMBEDDING_EAGER=1 で起動時に embedding model を同期 load する。
// lazy mode (既定) では初回 search query 時に model load が走り、その間 daemon が
// 重い consolidation と被ると SQLITE_BUSY + warm-up で long-tail のハングを起こす経路を踏みやすい。
// eager mode では起動時に load を済ませるので、以降の search は確実に応答できる。
if (process.env.HARNESS_MEM_EMBEDDING_EAGER === "1") {
  const eagerStartedAt = Date.now();
  console.error(`[harness-memd] eager embedding warm-up start (HARNESS_MEM_EMBEDDING_EAGER=1)`);
  try {
    await core.primeEmbedding("__eager_warmup__", "passage");
    await core.primeEmbedding("__eager_warmup__", "query");
    const elapsed = Date.now() - eagerStartedAt;
    console.error(`[harness-memd] eager embedding warm-up complete in ${elapsed}ms`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[harness-memd] eager embedding warm-up failed (continuing with lazy): ${message}`);
  }
}

let shuttingDown = false;
const gracefulShutdown = async (signal: string): Promise<void> => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.error(`[harness-memd] received ${signal}, draining queue and shutting down`);
  server.stop(true);
  try {
    core.shutdown(signal);
  } finally {
    const telemetry = await shutdownTelemetry(signal);
    if (telemetry.exporter.last_flush_ok === false) {
      console.error(`[harness-memd] telemetry flush failed: ${telemetry.exporter.last_flush_error}`);
    }
    process.exit(0);
  }
};

process.on("SIGINT", () => { void gracefulShutdown("SIGINT"); });
process.on("SIGTERM", () => { void gracefulShutdown("SIGTERM"); });
