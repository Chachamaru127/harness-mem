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

describe("tau3 runner recall identity scrub", () => {
  test("masks user_id, name, address, and zip tokens", () => {
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

cases = {
    "user_id": module.scrub_recall_identity("Customer user_jane_smith_1024 called again."),
    "labeled_name": module.scrub_recall_identity("Name: Jane Smith chose clicky switches."),
    "labeled_address": module.scrub_recall_identity("Address: 123 Main St, Springfield has pending exchange."),
    "zip": module.scrub_recall_identity("Zip 12345 verified."),
    "zip_plus_four": module.scrub_recall_identity("Delivered to 94103-1234 yesterday."),
    "mixed": module.scrub_recall_identity("user_bob_jones_42 at zip 90210 approved exchange."),
}

print(json.dumps({k: {"text": v[0], "count": v[1]} for k, v in cases.items()}))
    `);

    expect(result.user_id.text).not.toContain("user_jane_smith_1024");
    expect(result.user_id.text).toContain("REDACTED");
    expect(result.user_id.count).toBeGreaterThanOrEqual(1);

    expect(result.labeled_name.text).not.toContain("Jane Smith");
    expect(result.labeled_name.text).toContain("REDACTED");

    expect(result.labeled_address.text).not.toContain("123 Main St");
    expect(result.labeled_address.text).toContain("REDACTED");

    expect(result.zip.text).not.toContain("12345");
    expect(result.zip.text).toContain("REDACTED");

    expect(result.zip_plus_four.text).not.toContain("94103-1234");
    expect(result.zip_plus_four.text).toContain("REDACTED");

    expect(result.mixed.count).toBeGreaterThanOrEqual(2);
    expect(result.mixed.text).not.toContain("user_bob_jones_42");
    expect(result.mixed.text).not.toContain("90210");
  });

  test("leaves non-identity content intact and reports zero replacements", () => {
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

scrubbed, count = module.scrub_recall_identity(
    "Customer chose clicky switches. Order #W2378156. Product 1151293680 exchanged."
)
print(json.dumps({"text": scrubbed, "count": count}))
    `);

    expect(result.text).toContain("#W2378156");
    expect(result.text).toContain("1151293680");
    expect(result.text).toContain("clicky switches");
    expect(result.count).toBe(0);
  });

  test("empty or non-string input returns empty string and zero count", () => {
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

empty = module.scrub_recall_identity("")
none = module.scrub_recall_identity(None)
print(json.dumps({"empty": empty, "none": none}))
    `);

    expect(result.empty).toEqual(["", 0]);
    expect(result.none).toEqual(["", 0]);
  });

  test("CLI exposes --scrub-recall-identity flag (default false)", () => {
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

required = [
    "--tau3-repo-path", "/tmp/x",
    "--domain", "retail",
    "--mode", "off",
    "--save-to", "out",
]

sys.argv = ["bench-tau3-runner.py", *required]
default_args = module.parse_args()

sys.argv = ["bench-tau3-runner.py", *required, "--scrub-recall-identity"]
enabled_args = module.parse_args()

print(json.dumps({
    "default": default_args.scrub_recall_identity,
    "enabled": enabled_args.scrub_recall_identity,
}))
    `);

    expect(result.default).toBe(false);
    expect(result.enabled).toBe(true);
  });

  test("_coerce_bool reads truthy strings, ints, and bools", () => {
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

cases = {
    "true_str": module._coerce_bool("true"),
    "yes_str": module._coerce_bool("YES"),
    "one_str": module._coerce_bool("1"),
    "off_str": module._coerce_bool("off"),
    "empty_str": module._coerce_bool(""),
    "true_bool": module._coerce_bool(True),
    "false_bool": module._coerce_bool(False),
    "int_one": module._coerce_bool(1),
    "int_zero": module._coerce_bool(0),
    "none": module._coerce_bool(None),
}
print(json.dumps(cases))
    `);

    expect(result.true_str).toBe(true);
    expect(result.yes_str).toBe(true);
    expect(result.one_str).toBe(true);
    expect(result.off_str).toBe(false);
    expect(result.empty_str).toBe(false);
    expect(result.true_bool).toBe(true);
    expect(result.false_bool).toBe(false);
    expect(result.int_one).toBe(true);
    expect(result.int_zero).toBe(false);
    expect(result.none).toBe(false);
  });

  test("render_recall_block produces an identity-free block when items are pre-scrubbed", () => {
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

raw_items = [
    {"title": "Task 0 note", "content": "user_jane_smith_1024 at 94103 approved keyboard exchange."},
    {"title": "Name: Jane Smith", "content": "Address: 742 Evergreen Terrace pending."},
]
scrubbed_items = []
total = 0
for item in raw_items:
    title, title_count = module.scrub_recall_identity(item["title"])
    content, content_count = module.scrub_recall_identity(item["content"])
    scrubbed_items.append({"title": title, "content": content})
    total += title_count + content_count

block = module.render_recall_block(scrubbed_items, max_chars=200, domain="retail")
print(json.dumps({"block": block, "total": total}))
    `);

    expect(result.total).toBeGreaterThanOrEqual(4);
    expect(result.block).not.toContain("user_jane_smith_1024");
    expect(result.block).not.toContain("Jane Smith");
    expect(result.block).not.toContain("742 Evergreen Terrace");
    expect(result.block).not.toContain("94103");
    expect(result.block).toContain("Retail rule");
  });
});
