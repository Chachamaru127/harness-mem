// Exact passage routing counts may read a large corpus. Keep them off the HTTP loop.
import { HarnessMemCore, getConfig } from "../core/harness-mem-core";
const core = new HarnessMemCore({ ...getConfig(), backgroundWorkersEnabled: false });
try {
  process.stdout.write(`${JSON.stringify(core.getVectorCoverage())}\n`);
} finally {
  await core.shutdown("vector-coverage-child");
}
