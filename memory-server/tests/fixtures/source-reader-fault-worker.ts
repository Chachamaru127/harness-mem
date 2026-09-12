// Real synchronous filesystem stalls, confined to a disposable test reader.
const fs = require("node:fs");
const descriptors = new Map<number, string>();
const sleep = new Int32Array(new SharedArrayBuffer(4));
const operations = ["existsSync", "statSync", "openSync", "readSync", "readFileSync", "opendirSync"];
for (const operation of operations) {
  const original = fs[operation];
  fs[operation] = (...args: unknown[]) => {
    const path = typeof args[0] === "number" ? descriptors.get(args[0]) : String(args[0]);
    if (path === process.env.READER_FAULT_PATH && operation === process.env.READER_FAULT_OPERATION) {
      Atomics.wait(sleep, 0, 0);
    }
    const result = original(...args);
    if (operation === "openSync") descriptors.set(result, path!);
    return result;
  };
}
await import("../../src/tools/source-reader-worker");
