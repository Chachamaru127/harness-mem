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

describe("tau3 runner conversation metrics", () => {
  test("suppresses recall on the first turn and until retail lookup starts", () => {
    const result = runPythonJson(`
import importlib.util
import json
import pathlib
import sys
import types

runner_path = pathlib.Path(${JSON.stringify(RUNNER_PATH)})
spec = importlib.util.spec_from_file_location("tau3_runner", runner_path)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)

first_gate = module.determine_recall_gate([], domain="retail")

lookup_pending_messages = [
    types.SimpleNamespace(role="user", content="I need to exchange two items.", tool_calls=None),
    types.SimpleNamespace(role="assistant", content="Sure, I can help with that.", tool_calls=None),
]
lookup_pending_gate = module.determine_recall_gate(lookup_pending_messages, domain="retail")

lookup_complete_messages = [
    *lookup_pending_messages,
    types.SimpleNamespace(
        role="assistant",
        content=None,
        tool_calls=[types.SimpleNamespace(name="get_order_details")],
    ),
    types.SimpleNamespace(role="tool", content="ok", tool_messages=None),
]
lookup_complete_gate = module.determine_recall_gate(lookup_complete_messages, domain="retail")

print(json.dumps({
    "first_gate": first_gate,
    "lookup_pending_gate": lookup_pending_gate,
    "lookup_complete_gate": lookup_complete_gate,
}))
    `);

    expect(result.first_gate).toEqual([false, "wait_for_first_turn"]);
    expect(result.lookup_pending_gate).toEqual([false, "wait_for_identity_or_lookup"]);
    expect(result.lookup_complete_gate).toEqual([true, ""]);
  });

  test("adds retail-specific confirmation guidance to recall blocks", () => {
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

payload = module.render_recall_block(
    [{"title": "Prior task note", "content": "Customer already chose a compatible thermostat."}],
    max_chars=120,
    domain="retail",
)
print(json.dumps({"payload": payload}))
    `);

    expect(result.payload).toContain("Retail rule: do not treat recall as proof");
    expect(result.payload).toContain("After lookup, reuse the customer's stated yes/no or item choice");
    expect(result.payload).toContain("Ask for at most one final confirmation");
  });

  test("summarizes confirmation and clarification pressure from visible turns", () => {
    const result = runPythonJson(`
import importlib.util
import json
import pathlib
import sys
import types

runner_path = pathlib.Path(${JSON.stringify(RUNNER_PATH)})
spec = importlib.util.spec_from_file_location("tau3_runner", runner_path)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)

messages = [
    types.SimpleNamespace(role="user", content="I need to exchange two items.", tool_calls=None),
    types.SimpleNamespace(
        role="assistant",
        content="I found your order. Would you like me to exchange the keyboard and thermostat now?",
        tool_calls=None,
    ),
    types.SimpleNamespace(
        role="assistant",
        content=None,
        tool_calls=[types.SimpleNamespace(name="get_order_details"), types.SimpleNamespace(name="get_product_details")],
    ),
    types.SimpleNamespace(
        role="tool",
        tool_messages=[types.SimpleNamespace(content="ok"), types.SimpleNamespace(content="ok")],
    ),
    types.SimpleNamespace(role="user", content="Yes, please go ahead.", tool_calls=None),
    types.SimpleNamespace(
        role="assistant",
        content="Which thermostat compatibility do you want?",
        tool_calls=None,
    ),
    types.SimpleNamespace(role="assistant", content="All set — your exchange is submitted.", tool_calls=None),
]

print(json.dumps(module.summarize_conversation_metrics(messages)))
    `);

    expect(result.total_turn_count).toBe(5);
    expect(result.user_turn_count).toBe(2);
    expect(result.assistant_turn_count).toBe(3);
    expect(result.assistant_question_turn_count).toBe(2);
    expect(result.assistant_confirmation_turn_count).toBe(1);
    expect(result.assistant_clarification_turn_count).toBe(1);
    expect(result.tool_call_count).toBe(2);
    expect(result.tool_result_count).toBe(2);
    expect(result.assistant_confirmation_pressure).toBeCloseTo(1 / 3, 5);
    expect(result.assistant_clarification_pressure).toBeCloseTo(1 / 3, 5);
  });

  test("aggregates per-task conversation metrics for results.json", () => {
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

payload = module.aggregate_conversation_metrics([
    {
        "total_turn_count": 6,
        "user_turn_count": 3,
        "assistant_turn_count": 3,
        "assistant_question_turn_count": 2,
        "assistant_confirmation_turn_count": 1,
        "assistant_clarification_turn_count": 1,
        "tool_call_count": 4,
        "tool_result_count": 4,
        "assistant_question_pressure": 2 / 3,
        "assistant_confirmation_pressure": 1 / 3,
        "assistant_clarification_pressure": 1 / 3,
    },
    {
        "total_turn_count": 4,
        "user_turn_count": 2,
        "assistant_turn_count": 2,
        "assistant_question_turn_count": 0,
        "assistant_confirmation_turn_count": 0,
        "assistant_clarification_turn_count": 0,
        "tool_call_count": 3,
        "tool_result_count": 3,
        "assistant_question_pressure": 0.0,
        "assistant_confirmation_pressure": 0.0,
        "assistant_clarification_pressure": 0.0,
    },
])
print(json.dumps(payload))
    `);

    expect(result.run_count).toBe(2);
    expect(result.totals.total_turn_count).toBe(10);
    expect(result.totals.assistant_confirmation_turn_count).toBe(1);
    expect(result.averages.avg_total_turn_count).toBe(5);
    expect(result.averages.avg_tool_call_count).toBe(3.5);
    expect(result.averages.avg_assistant_confirmation_pressure).toBeCloseTo(1 / 6, 5);
    expect(result.rates.assistant_question_pressure).toBeCloseTo(0.4, 5);
    expect(result.rates.assistant_confirmation_pressure).toBeCloseTo(0.2, 5);
    expect(result.rates.assistant_clarification_pressure).toBeCloseTo(0.2, 5);
  });
});
