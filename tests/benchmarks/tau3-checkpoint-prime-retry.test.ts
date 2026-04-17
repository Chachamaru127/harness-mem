import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const ROOT = process.cwd();
const RUNNER_PATH = join(ROOT, "scripts", "bench-tau3-runner.py");

function runPythonJson(code: string) {
  const proc = spawnSync("python3", ["-c", code], {
    cwd: ROOT,
    encoding: "utf8",
  });

  if (proc.status !== 0) {
    throw new Error(proc.stderr || proc.stdout || "python3 execution failed");
  }

  return JSON.parse(proc.stdout);
}

describe("tau3 runner checkpoint prime-retry", () => {
  test("first call succeeds — no retry, retry_count=0, warning=None", () => {
    const result = runPythonJson(`
import importlib.util
import json
import pathlib
import sys

runner_path = pathlib.Path(${JSON.stringify(RUNNER_PATH)})
spec = importlib.util.spec_from_file_location("tau3_runner", runner_path)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)

calls = []

def mock_run_client(command, payload, *, env):
    calls.append({"command": command, "payload": payload})
    return {"ok": True, "id": "checkpoint-abc"}

original = module.run_client
module.run_client = mock_run_client

try:
    saved, warning, retry_count = module.write_checkpoint_with_prime_retry(
        {"content": "test"},
        env={},
        max_attempts=1,
        sleep_sec=0.0,
        sleep_fn=lambda s: None,
    )
finally:
    module.run_client = original

print(json.dumps({
    "saved": saved,
    "warning": warning,
    "retry_count": retry_count,
    "call_count": len(calls),
}))
    `);

    expect(result.saved).toBe(true);
    expect(result.warning).toBeNull();
    expect(result.retry_count).toBe(0);
    expect(result.call_count).toBe(1);
  });

  test("first call prime_required, second call succeeds — retry_count=1, warning=None", () => {
    const result = runPythonJson(`
import importlib.util
import json
import pathlib
import sys

runner_path = pathlib.Path(${JSON.stringify(RUNNER_PATH)})
spec = importlib.util.spec_from_file_location("tau3_runner", runner_path)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)

call_count = [0]

def mock_run_client(command, payload, *, env):
    call_count[0] += 1
    if call_count[0] == 1:
        return {"ok": False, "error": "write embedding is unavailable: local ONNX model multilingual-e5 requires async prime before sync embed"}
    return {"ok": True, "id": "checkpoint-abc"}

original = module.run_client
module.run_client = mock_run_client

try:
    saved, warning, retry_count = module.write_checkpoint_with_prime_retry(
        {"content": "test"},
        env={},
        max_attempts=1,
        sleep_sec=0.0,
        sleep_fn=lambda s: None,
    )
finally:
    module.run_client = original

print(json.dumps({
    "saved": saved,
    "warning": warning,
    "retry_count": retry_count,
    "call_count": call_count[0],
}))
    `);

    expect(result.saved).toBe(true);
    expect(result.warning).toBeNull();
    expect(result.retry_count).toBe(1);
    expect(result.call_count).toBe(2);
  });

  test("both calls prime_required — soft success, retry_count=1, warning preserved", () => {
    const result = runPythonJson(`
import importlib.util
import json
import pathlib
import sys

runner_path = pathlib.Path(${JSON.stringify(RUNNER_PATH)})
spec = importlib.util.spec_from_file_location("tau3_runner", runner_path)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)

prime_error = "write embedding is unavailable: local ONNX model multilingual-e5 requires async prime before sync embed"
call_count = [0]

def mock_run_client(command, payload, *, env):
    call_count[0] += 1
    return {"ok": False, "error": prime_error}

original = module.run_client
module.run_client = mock_run_client

try:
    saved, warning, retry_count = module.write_checkpoint_with_prime_retry(
        {"content": "test"},
        env={},
        max_attempts=1,
        sleep_sec=0.0,
        sleep_fn=lambda s: None,
    )
finally:
    module.run_client = original

print(json.dumps({
    "saved": saved,
    "warning": warning,
    "retry_count": retry_count,
    "call_count": call_count[0],
    "prime_error": prime_error,
}))
    `);

    expect(result.saved).toBe(true);
    expect(result.warning).toBe(result.prime_error);
    expect(result.retry_count).toBe(1);
    expect(result.call_count).toBe(2);
  });

  test("first call non-prime error — saved=False, warning=null, retry_count=0, no retry", () => {
    const result = runPythonJson(`
import importlib.util
import json
import pathlib
import sys

runner_path = pathlib.Path(${JSON.stringify(RUNNER_PATH)})
spec = importlib.util.spec_from_file_location("tau3_runner", runner_path)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)

call_count = [0]

def mock_run_client(command, payload, *, env):
    call_count[0] += 1
    return {"ok": False, "error": "schema validation failed"}

original = module.run_client
module.run_client = mock_run_client

try:
    saved, warning, retry_count = module.write_checkpoint_with_prime_retry(
        {"content": "test"},
        env={},
        max_attempts=1,
        sleep_sec=0.0,
        sleep_fn=lambda s: None,
    )
finally:
    module.run_client = original

print(json.dumps({
    "saved": saved,
    "warning": warning,
    "retry_count": retry_count,
    "call_count": call_count[0],
}))
    `);

    expect(result.saved).toBe(false);
    expect(result.warning).toBeNull();
    expect(result.retry_count).toBe(0);
    expect(result.call_count).toBe(1);
  });
});
