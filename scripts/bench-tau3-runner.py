#!/usr/bin/env python3
"""
Local τ³-bench custom runner for harness-mem memory on/off comparisons.

This runner keeps the official tau2 task/domain machinery, but swaps the
agent factory so "on" mode can inject contextual recall from harness-mem.
It runs tasks sequentially so prior task notes can be recorded and reused.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Iterable


REPO_ROOT = Path(__file__).resolve().parents[1]
CLIENT_SCRIPT = REPO_ROOT / "scripts" / "harness-mem-client.sh"
DAEMON_SCRIPT = REPO_ROOT / "scripts" / "harness-memd"

CONFIRMATION_PATTERNS = (
    re.compile(r"\bplease confirm\b", re.IGNORECASE),
    re.compile(r"\bjust to confirm\b", re.IGNORECASE),
    re.compile(r"\bconfirm(?:ing|ation)?\b", re.IGNORECASE),
    re.compile(r"\bwould you like me to\b", re.IGNORECASE),
    re.compile(r"\bdo you want me to\b", re.IGNORECASE),
    re.compile(r"^\s*should I\b", re.IGNORECASE),
    re.compile(r"^\s*can I go ahead\b", re.IGNORECASE),
    re.compile(r"^\s*shall I\b", re.IGNORECASE),
    re.compile(r"\bbefore I (?:submit|place|process|complete|exchange|change|cancel)\b", re.IGNORECASE),
)

CLARIFICATION_PATTERNS = (
    re.compile(r"\bcould you clarify\b", re.IGNORECASE),
    re.compile(r"\bcan you clarify\b", re.IGNORECASE),
    re.compile(r"\bwhat(?:'s| is)\b", re.IGNORECASE),
    re.compile(r"\bwhich\b", re.IGNORECASE),
    re.compile(r"\bdo you mean\b", re.IGNORECASE),
    re.compile(r"\bcould you share\b", re.IGNORECASE),
    re.compile(r"\bplease provide\b", re.IGNORECASE),
    re.compile(r"\bmay I have\b", re.IGNORECASE),
    re.compile(r"\bwhat kind of\b", re.IGNORECASE),
)

QUESTION_LEAD_PATTERNS = (
    re.compile(r"^(can|could|would|do|did|is|are|when|where|which|what|who|how)\b", re.IGNORECASE),
)

RECALL_IDENTITY_PATTERNS: tuple[tuple[re.Pattern[str], str], ...] = (
    # user_id like user_jane_smith_1024 — at least two underscore-joined segments after "user_"
    (re.compile(r"\buser_[a-z0-9]+(?:_[a-z0-9]+)+\b", re.IGNORECASE), "user_[REDACTED]"),
    # Labeled name fields: "Name: ..." / "Customer name = ..."
    (
        re.compile(
            r"\b(?:full[ _-]?name|customer[ _-]?name|name)\s*[:=]\s*[^\n,;]+",
            re.IGNORECASE,
        ),
        "name: [REDACTED]",
    ),
    # Labeled address fields
    (
        re.compile(
            r"\b(?:shipping[ _-]?address|billing[ _-]?address|street[ _-]?address|address|street)\s*[:=]\s*[^\n,;]+",
            re.IGNORECASE,
        ),
        "address: [REDACTED]",
    ),
    # Standalone 5-digit zip with optional ZIP+4 (does not match longer digit runs because of word boundary)
    (re.compile(r"\b\d{5}(?:-\d{4})?\b"), "[REDACTED_ZIP]"),
)


def _coerce_bool(value: Any) -> bool:
    """Interpret config / env string-ish values as booleans."""
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return False


def scrub_recall_identity(text: Any) -> tuple[str, int]:
    """Mask user identity tokens in recall payload text.

    Returns ``(scrubbed_text, replacement_count)``. Non-string or empty input
    returns ``("", 0)``.
    """
    if not isinstance(text, str) or not text:
        return "", 0
    scrubbed = text
    total = 0
    for pattern, replacement in RECALL_IDENTITY_PATTERNS:
        scrubbed, count = pattern.subn(replacement, scrubbed)
        total += count
    return scrubbed, total


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run τ³-bench tasks sequentially with harness-mem injection control."
    )
    parser.add_argument("--tau3-repo-path", required=True, help="Path to local tau2-bench checkout")
    parser.add_argument("--domain", required=True, help="tau2 domain name")
    parser.add_argument("--task-split-name", default="base", help="tau2 task split name")
    parser.add_argument("--num-tasks", type=int, default=5, help="Number of tasks to run")
    parser.add_argument("--num-trials", type=int, default=1, help="Number of trials per task")
    parser.add_argument("--mode", choices=("off", "on"), required=True, help="Benchmark mode")
    parser.add_argument("--save-to", required=True, help="Relative run directory name under tau2 data/simulations")
    parser.add_argument("--agent-llm", default="gpt-5-mini", help="Agent model name")
    parser.add_argument(
        "--user-llm",
        default="gemini/gemini-2.5-flash-lite",
        help="User simulator model name",
    )
    parser.add_argument(
        "--agent-llm-args",
        default='{"temperature": 0.0}',
        help="JSON dict of agent LLM args",
    )
    parser.add_argument(
        "--user-llm-args",
        default='{"temperature": 0.0}',
        help="JSON dict of user LLM args",
    )
    parser.add_argument("--max-steps", type=int, default=200, help="Max steps per task")
    parser.add_argument("--max-errors", type=int, default=10, help="Max consecutive tool errors")
    parser.add_argument("--seed", type=int, default=300, help="Base seed")
    parser.add_argument("--log-level", default="ERROR", help="tau2 log level")
    parser.add_argument(
        "--harness-mem-home",
        default="",
        help="Optional isolated HARNESS_MEM_HOME. Defaults under the run output directory.",
    )
    parser.add_argument(
        "--harness-mem-port",
        type=int,
        default=0,
        help="Optional dedicated harness-mem API port. Defaults to a stable per-run port.",
    )
    parser.add_argument(
        "--harness-mem-ui-port",
        type=int,
        default=0,
        help="Optional dedicated harness-mem UI port. Defaults to API port + 100.",
    )
    parser.add_argument(
        "--scrub-recall-identity",
        action="store_true",
        default=False,
        help=(
            "Mask user identity tokens (user_id / labeled name / labeled address / 5-digit zip) "
            "in recall payload before injection. Reduces confirmation pressure caused by identity-driven re-lookups."
        ),
    )
    return parser.parse_args()


def bootstrap_tau2(repo_path: Path) -> None:
    src_path = repo_path / "src"
    if not src_path.exists():
        raise FileNotFoundError(f"tau2 src path not found: {src_path}")
    if str(src_path) not in sys.path:
        sys.path.insert(0, str(src_path))


def parse_json_arg(raw: str, *, arg_name: str) -> dict[str, Any]:
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise SystemExit(f"{arg_name} must be valid JSON: {exc}") from exc
    if not isinstance(parsed, dict):
        raise SystemExit(f"{arg_name} must decode to a JSON object")
    return parsed


def ensure_client_exists() -> None:
    if not CLIENT_SCRIPT.exists():
        raise FileNotFoundError(f"harness-mem client script not found: {CLIENT_SCRIPT}")
    if not DAEMON_SCRIPT.exists():
        raise FileNotFoundError(f"harness-mem daemon script not found: {DAEMON_SCRIPT}")


def compact_text(value: str, *, limit: int) -> str:
    collapsed = " ".join((value or "").split()).strip()
    if len(collapsed) <= limit:
        return collapsed
    return collapsed[: max(limit - 1, 0)].rstrip() + "…"


def render_recall_block(items: list[dict[str, Any]], *, max_chars: int, domain: str = "") -> str:
    normalized_domain = (domain or "").strip().lower()
    lines: list[str] = [
        "## Contextual Recall",
        "Reference only. Use these notes only if they clearly help the current request.",
        "Do not repeat them verbatim, do not restart the workflow from scratch, and do not add extra confirmation steps because of them.",
        "If the user already gave the required details or a clear yes/no, continue to the next needed lookup or tool call.",
    ]
    if normalized_domain == "retail":
        lines.extend(
            [
                "Retail rule: do not treat recall as proof that the active order, customer, or identity is already verified.",
                "Before the order or account is found, focus on the next lookup or verification step instead of the recall note.",
                "After lookup, reuse the customer's stated yes/no or item choice unless a required field is still missing.",
                "Ask for at most one final confirmation before an irreversible exchange, return, cancellation, or refund.",
            ]
        )
    for item in items:
        title = str(item.get("title") or "").strip()
        content = compact_text(str(item.get("content") or ""), limit=max_chars)
        parts = [part for part in (title, content) if part]
        if parts:
            lines.append("- " + " — ".join(parts))
    minimum_line_count = 8 if normalized_domain == "retail" else 4
    if len(lines) <= minimum_line_count:
        return ""
    return "\n".join(lines)


def run_client(command: str, payload: dict[str, Any], *, env: dict[str, str]) -> dict[str, Any]:
    ensure_client_exists()
    proc = subprocess.run(
        [str(CLIENT_SCRIPT), command],
        input=json.dumps(payload),
        text=True,
        capture_output=True,
        env=env,
        cwd=str(REPO_ROOT),
        check=False,
    )
    stdout = (proc.stdout or "").strip()
    if not stdout:
        return {"ok": False, "error": proc.stderr.strip() or f"{command} returned no output"}
    try:
        return json.loads(stdout)
    except json.JSONDecodeError:
        return {"ok": False, "error": stdout}


def extract_assistant_brief(sim_run: Any) -> str:
    messages = list(getattr(sim_run, "messages", None) or [])
    final_text = ""
    tool_names: list[str] = []
    for message in messages:
        role = getattr(message, "role", "")
        if role == "assistant":
            content = getattr(message, "content", None)
            if isinstance(content, str) and content.strip():
                final_text = content.strip()
            tool_calls = getattr(message, "tool_calls", None) or []
            for tool_call in tool_calls:
                name = getattr(tool_call, "name", None)
                if isinstance(name, str) and name not in tool_names:
                    tool_names.append(name)

    brief_text = final_text
    if brief_text:
        try:
            parsed = json.loads(brief_text)
        except json.JSONDecodeError:
            parsed = None
        if isinstance(parsed, dict):
            summary_candidate = parsed.get("summary") or parsed.get("message") or ""
            if isinstance(summary_candidate, str) and summary_candidate.strip():
                brief_text = summary_candidate.strip()
            elif "action_details" in parsed:
                brief_text = "Prepared a confirmation-ready action summary."

    summary_lines = []
    if brief_text:
        summary_lines.append(f"Agent note: {compact_text(brief_text, limit=220)}")
    if tool_names:
        summary_lines.append(f"Tools used: {', '.join(tool_names[:8])}")
    reward_info = getattr(sim_run, "reward_info", None)
    reward_value = getattr(reward_info, "reward", None) if reward_info is not None else None
    if isinstance(reward_value, (int, float)):
        summary_lines.append(f"Reward: {reward_value:.3f}")
    return "\n".join(summary_lines).strip()


def make_checkpoint_content(task: Any, sim_run: Any) -> str:
    task_scenario = " ".join(str(getattr(task, "user_scenario", "")).split())
    task_preview = compact_text(task_scenario, limit=220)
    summary_lines = [
        f"Task ID: {getattr(task, 'id', 'unknown')}",
        f"Customer scenario: {task_preview}" if task_preview else "",
        extract_assistant_brief(sim_run),
    ]
    return "\n".join(line for line in summary_lines if line).strip()


@dataclass
class TaskResultRow:
    task_id: str
    trial: int
    seed: int
    reward: float | None
    duration_sec: float | None
    agent_cost: float | None
    user_cost: float | None
    checkpoint_saved: bool
    checkpoint_warning: str | None
    contextual_recall_used: bool
    recall_item_count: int
    conversation_metrics: dict[str, Any]
    output_dir: str


@dataclass
class ConversationMetrics:
    total_turn_count: int = 0
    user_turn_count: int = 0
    assistant_turn_count: int = 0
    assistant_question_turn_count: int = 0
    assistant_confirmation_turn_count: int = 0
    assistant_clarification_turn_count: int = 0
    tool_call_count: int = 0
    tool_result_count: int = 0
    assistant_question_pressure: float = 0.0
    assistant_confirmation_pressure: float = 0.0
    assistant_clarification_pressure: float = 0.0


def _clean_text_content(message: Any) -> str:
    content = getattr(message, "content", None)
    if not isinstance(content, str):
        return ""
    return " ".join(content.split()).strip()


def _tool_call_count(message: Any) -> int:
    tool_calls = getattr(message, "tool_calls", None)
    if isinstance(tool_calls, list):
        return len(tool_calls)
    return 0


def _tool_result_count(message: Any) -> int:
    tool_messages = getattr(message, "tool_messages", None)
    if isinstance(tool_messages, list):
        return len(tool_messages)
    role = str(getattr(message, "role", "") or "").strip().lower()
    if role == "tool":
        return 1
    return 0


def _count_user_turns(messages: Iterable[Any] | None) -> int:
    if not messages:
        return 0
    count = 0
    for message in messages:
        role = str(getattr(message, "role", "") or "").strip().lower()
        if role == "user" and _clean_text_content(message):
            count += 1
    return count


def _conversation_has_tool_history(messages: Iterable[Any] | None) -> bool:
    if not messages:
        return False
    for message in messages:
        if _tool_call_count(message) > 0 or _tool_result_count(message) > 0:
            return True
    return False


def determine_recall_gate(messages: Iterable[Any] | None, *, domain: str) -> tuple[bool, str]:
    """
    Decide whether contextual recall should be injected for the next user turn.

    For this benchmark, the first visible user turn should not get recall. Retail
    conversations also wait until some lookup / verification tool activity exists,
    so memory does not short-circuit identity/order resolution.
    """
    visible_user_turns = _count_user_turns(messages)
    if visible_user_turns == 0:
        return False, "wait_for_first_turn"

    if (domain or "").strip().lower() == "retail" and not _conversation_has_tool_history(messages):
        return False, "wait_for_identity_or_lookup"

    return True, ""


def _matches_any(text: str, patterns: tuple[re.Pattern[str], ...]) -> bool:
    return any(pattern.search(text) for pattern in patterns)


def _is_question_like(text: str) -> bool:
    if not text:
        return False
    if "?" in text:
        return True
    if _matches_any(text, QUESTION_LEAD_PATTERNS):
        return True
    return _matches_any(text, CONFIRMATION_PATTERNS + CLARIFICATION_PATTERNS)


def summarize_conversation_metrics(messages: Iterable[Any] | None) -> dict[str, Any]:
    metrics = ConversationMetrics()
    if not messages:
        return asdict(metrics)

    for message in messages:
        metrics.tool_call_count += _tool_call_count(message)
        metrics.tool_result_count += _tool_result_count(message)

        role = str(getattr(message, "role", "") or "").strip().lower()
        text = _clean_text_content(message)
        if not text:
            continue

        if role == "user":
            metrics.user_turn_count += 1
            continue

        if role != "assistant":
            continue

        metrics.assistant_turn_count += 1
        if _is_question_like(text):
            metrics.assistant_question_turn_count += 1
        if _matches_any(text, CONFIRMATION_PATTERNS):
            metrics.assistant_confirmation_turn_count += 1
        if _matches_any(text, CLARIFICATION_PATTERNS):
            metrics.assistant_clarification_turn_count += 1

    metrics.total_turn_count = metrics.user_turn_count + metrics.assistant_turn_count
    if metrics.assistant_turn_count > 0:
        metrics.assistant_question_pressure = (
            metrics.assistant_question_turn_count / metrics.assistant_turn_count
        )
        metrics.assistant_confirmation_pressure = (
            metrics.assistant_confirmation_turn_count / metrics.assistant_turn_count
        )
        metrics.assistant_clarification_pressure = (
            metrics.assistant_clarification_turn_count / metrics.assistant_turn_count
        )

    return asdict(metrics)


def aggregate_conversation_metrics(rows: Iterable[dict[str, Any]]) -> dict[str, Any]:
    items = list(rows)
    count_fields = (
        "total_turn_count",
        "user_turn_count",
        "assistant_turn_count",
        "assistant_question_turn_count",
        "assistant_confirmation_turn_count",
        "assistant_clarification_turn_count",
        "tool_call_count",
        "tool_result_count",
    )
    pressure_fields = (
        "assistant_question_pressure",
        "assistant_confirmation_pressure",
        "assistant_clarification_pressure",
    )

    totals = {
        field: sum(int(item.get(field, 0) or 0) for item in items)
        for field in count_fields
    }
    run_count = len(items)
    averages = {
        f"avg_{field}": (totals[field] / run_count if run_count else 0.0)
        for field in count_fields
    }
    for field in pressure_fields:
        averages[f"avg_{field}"] = (
            sum(float(item.get(field, 0) or 0) for item in items) / run_count if run_count else 0.0
        )

    assistant_turn_total = totals["assistant_turn_count"]
    rates = {
        "assistant_question_pressure": (
            totals["assistant_question_turn_count"] / assistant_turn_total
            if assistant_turn_total
            else 0.0
        ),
        "assistant_confirmation_pressure": (
            totals["assistant_confirmation_turn_count"] / assistant_turn_total
            if assistant_turn_total
            else 0.0
        ),
        "assistant_clarification_pressure": (
            totals["assistant_clarification_turn_count"] / assistant_turn_total
            if assistant_turn_total
            else 0.0
        ),
    }

    return {
        "run_count": run_count,
        "totals": totals,
        "averages": averages,
        "rates": rates,
    }


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def derive_stable_port(label: str, *, base: int, span: int) -> int:
    digest = hashlib.sha256(label.encode("utf-8")).hexdigest()
    return base + (int(digest[:8], 16) % span)


def register_harness_mem_agent(registry: Any) -> str:
    from tau2.agent.llm_agent import LLMAgent
    from tau2.data_model.message import MultiToolMessage, SystemMessage, UserMessage
    from tau2.utils.llm_utils import generate

    agent_name = "harness_mem_llm_agent"
    if registry.get_agent_factory(agent_name) is not None:
        return agent_name

    class HarnessMemTau3Agent(LLMAgent):
        def __init__(self, tools, domain_policy, llm, llm_args=None):
            config = dict(llm_args or {})
            self.benchmark_mode = str(
                config.pop("harness_mem_bench_mode", os.environ.get("HARNESS_MEM_BENCH_MODE", "off"))
            ).strip()
            self.harness_mem_home = str(config.pop("harness_mem_home", os.environ.get("HARNESS_MEM_HOME", ""))).strip()
            self.project_root = str(
                config.pop("harness_mem_project_root", os.environ.get("HARNESS_MEM_PROJECT_ROOT", ""))
            ).strip()
            self.project_name = str(
                config.pop("harness_mem_project_name", Path(self.project_root or ".").name)
            ).strip()
            self.domain_name = str(config.pop("harness_mem_domain", os.environ.get("HARNESS_MEM_DOMAIN", ""))).strip()
            self.session_id = str(config.pop("harness_mem_session_id", "tau3-session")).strip()
            self.max_recall_items = int(config.pop("harness_mem_max_recall_items", 1) or 1)
            self.max_recall_chars = int(config.pop("harness_mem_max_recall_chars", 120) or 120)
            self.client_timeout_sec = str(config.pop("harness_mem_client_timeout_sec", "8"))
            self.metrics_path = str(config.pop("harness_mem_metrics_path", "")).strip()
            scrub_flag = config.pop(
                "harness_mem_scrub_recall_identity",
                os.environ.get("HARNESS_MEM_SCRUB_RECALL_IDENTITY", ""),
            )
            self.scrub_recall_identity_enabled = _coerce_bool(scrub_flag)
            self._seen_recall_ids: set[str] = set()
            self._seen_recall_signatures: set[str] = set()
            self._last_recall_count = 0
            self._last_recall_skip_reason = ""
            self._scrub_replacements_total = 0
            self._last_scrub_replacements = 0
            super().__init__(tools=tools, domain_policy=domain_policy, llm=llm, llm_args=config)

        def _write_metrics(self) -> None:
            if not self.metrics_path:
                return
            metrics_file = Path(self.metrics_path)
            metrics_file.parent.mkdir(parents=True, exist_ok=True)
            metrics_file.write_text(
                json.dumps(
                    {
                        "session_id": self.session_id,
                        "benchmark_mode": self.benchmark_mode,
                        "seen_recall_ids": sorted(self._seen_recall_ids),
                        "seen_recall_count": len(self._seen_recall_ids),
                        "last_recall_count": self._last_recall_count,
                        "last_recall_skip_reason": self._last_recall_skip_reason,
                        "scrub_recall_identity_enabled": self.scrub_recall_identity_enabled,
                        "scrub_recall_identity_replacements_total": self._scrub_replacements_total,
                        "scrub_recall_identity_replacements_last": self._last_scrub_replacements,
                    },
                    indent=2,
                )
                + "\n",
                encoding="utf-8",
            )

        def _search_memory(self, prompt: str, state: Any) -> str:
            self._last_recall_count = 0
            self._last_recall_skip_reason = ""
            self._last_scrub_replacements = 0
            if self.benchmark_mode != "on":
                self._write_metrics()
                return ""
            query = " ".join((prompt or "").split()).strip()
            if not query:
                self._write_metrics()
                return ""

            recall_allowed, skip_reason = determine_recall_gate(
                getattr(state, "messages", None),
                domain=self.domain_name,
            )
            if not recall_allowed:
                self._last_recall_skip_reason = skip_reason
                self._write_metrics()
                return ""

            env = os.environ.copy()
            env["HARNESS_MEM_CLIENT_TIMEOUT_SEC"] = self.client_timeout_sec
            if self.harness_mem_home:
                env["HARNESS_MEM_HOME"] = self.harness_mem_home
            if self.project_root:
                env["HARNESS_MEM_PROJECT_ROOT"] = self.project_root
                env["HARNESS_MEM_CODEX_PROJECT_ROOT"] = self.project_root

            response = run_client(
                "search",
                {
                    "project": self.project_name,
                    "query": query[:400],
                    "limit": self.max_recall_items,
                    "include_private": False,
                    "strict_project": True,
                },
                env=env,
            )
            if response.get("ok") is False:
                self._write_metrics()
                return ""

            filtered: list[dict[str, Any]] = []
            scrub_count = 0
            for item in response.get("items", []) or []:
                item_id = str(item.get("id") or "").strip()
                title = str(item.get("title") or "").strip()
                content = compact_text(str(item.get("content") or ""), limit=self.max_recall_chars)
                if self.scrub_recall_identity_enabled:
                    title, title_subs = scrub_recall_identity(title)
                    content, content_subs = scrub_recall_identity(content)
                    scrub_count += title_subs + content_subs
                signature = " | ".join(part for part in (title, content) if part)
                if item_id and item_id in self._seen_recall_ids:
                    continue
                if signature and signature in self._seen_recall_signatures:
                    continue
                if item_id:
                    self._seen_recall_ids.add(item_id)
                if signature:
                    self._seen_recall_signatures.add(signature)
                # Pass scrubbed text into render_recall_block by mutating the
                # item dict — render_recall_block re-reads title/content.
                if self.scrub_recall_identity_enabled:
                    item = dict(item)
                    item["title"] = title
                    item["content"] = content
                filtered.append(item)
            self._last_recall_count = len(filtered)
            self._last_scrub_replacements = scrub_count
            self._scrub_replacements_total += scrub_count
            self._write_metrics()
            return render_recall_block(
                filtered,
                max_chars=self.max_recall_chars,
                domain=self.domain_name,
            )

        def _generate_next_message(self, message, state):
            if isinstance(message, UserMessage) and getattr(message, "is_audio", False):
                raise ValueError("User message cannot be audio. Use VoiceLLMAgent instead.")

            recall_block = ""
            if isinstance(message, UserMessage):
                recall_block = self._search_memory(getattr(message, "content", "") or "", state)

            if isinstance(message, MultiToolMessage):
                state.messages.extend(message.tool_messages)
            else:
                state.messages.append(message)

            messages = list(state.system_messages)
            if recall_block:
                messages.append(SystemMessage(role="system", content=recall_block))
            messages.extend(state.messages)
            assistant_message = generate(
                model=self.llm,
                tools=self.tools,
                messages=messages,
                call_name="agent_response",
                **self.llm_args,
            )
            return assistant_message

    def create_harness_mem_agent(tools, domain_policy, **kwargs):
        return HarnessMemTau3Agent(
            tools=tools,
            domain_policy=domain_policy,
            llm=kwargs.get("llm"),
            llm_args=kwargs.get("llm_args"),
        )

    registry.register_agent_factory(create_harness_mem_agent, agent_name)
    return agent_name


def main() -> int:
    args = parse_args()
    tau3_repo_path = Path(args.tau3_repo_path).expanduser().resolve()
    bootstrap_tau2(tau3_repo_path)

    from tau2.data_model.simulation import TextRunConfig
    from tau2.registry import registry
    from tau2.run import load_tasks, run_single_task

    agent_llm_args = parse_json_arg(args.agent_llm_args, arg_name="--agent-llm-args")
    user_llm_args = parse_json_arg(args.user_llm_args, arg_name="--user-llm-args")

    task_list = load_tasks(task_set_name=args.domain, task_split_name=args.task_split_name)
    if not task_list:
        raise SystemExit(f"No tasks found for domain={args.domain} split={args.task_split_name}")
    selected_tasks = task_list[: args.num_tasks]

    simulations_root = tau3_repo_path / "data" / "simulations"
    output_dir = simulations_root / args.save_to
    output_dir.mkdir(parents=True, exist_ok=True)

    benchmark_home = (
        Path(args.harness_mem_home).expanduser().resolve()
        if args.harness_mem_home
        else (output_dir / ".harness-mem-home").resolve()
    )
    benchmark_home.mkdir(parents=True, exist_ok=True)

    benchmark_project_root = (output_dir / f"project-{args.domain}-{args.mode}").resolve()
    benchmark_project_root.mkdir(parents=True, exist_ok=True)
    benchmark_project_name = benchmark_project_root.name

    api_port = args.harness_mem_port or derive_stable_port(args.save_to, base=38800, span=500)
    ui_port = args.harness_mem_ui_port or (api_port + 100)

    env = os.environ.copy()
    env["HARNESS_MEM_HOME"] = str(benchmark_home)
    env["HARNESS_MEM_PROJECT_ROOT"] = str(benchmark_project_root)
    env["HARNESS_MEM_CODEX_PROJECT_ROOT"] = str(benchmark_project_root)
    env["HARNESS_MEM_PORT"] = str(api_port)
    env["HARNESS_MEM_UI_PORT"] = str(ui_port)

    custom_agent_name = register_harness_mem_agent(registry)

    rows: list[TaskResultRow] = []
    total_agent_cost = 0.0
    total_user_cost = 0.0
    contextual_recall_total = 0

    try:
        if args.mode == "on":
            subprocess.run(
                [str(DAEMON_SCRIPT), "start", "--quiet"],
                cwd=str(REPO_ROOT),
                env=env,
                check=False,
                capture_output=True,
                text=True,
            )
            health = run_client("health", {}, env=env)
            if health.get("ok") is False:
                raise SystemExit(f"harness-mem health check failed: {health}")

        for trial in range(1, args.num_trials + 1):
            for index, task in enumerate(selected_tasks):
                seed = args.seed + ((trial - 1) * len(selected_tasks)) + index
                session_id = f"tau3-{args.domain}-{args.mode}-trial{trial}-{task.id}"
                task_output_dir = output_dir / "tasks" / f"trial-{trial}" / task.id
                task_output_dir.mkdir(parents=True, exist_ok=True)

                llm_args_agent = {
                    **agent_llm_args,
                    "harness_mem_bench_mode": args.mode,
                    "harness_mem_home": str(benchmark_home),
                    "harness_mem_project_root": str(benchmark_project_root),
                    "harness_mem_project_name": benchmark_project_name,
                    "harness_mem_domain": args.domain,
                    "harness_mem_session_id": session_id,
                    "harness_mem_metrics_path": str(task_output_dir / "agent-metrics.json"),
                    "harness_mem_scrub_recall_identity": bool(args.scrub_recall_identity),
                }

                config = TextRunConfig(
                    domain=args.domain,
                    agent=custom_agent_name,
                    user="user_simulator",
                    llm_agent=args.agent_llm,
                    llm_args_agent=llm_args_agent,
                    llm_user=args.user_llm,
                    llm_args_user=user_llm_args,
                    num_trials=1,
                    max_steps=args.max_steps,
                    max_errors=args.max_errors,
                    max_concurrency=1,
                    seed=seed,
                    log_level=args.log_level,
                    task_split_name=args.task_split_name,
                    num_tasks=1,
                    auto_review=False,
                    verbose_logs=False,
                )

                sim_run = run_single_task(config, task, seed=seed, save_dir=task_output_dir)

                reward_value = None
                reward_info = getattr(sim_run, "reward_info", None)
                if reward_info is not None:
                    reward_value = getattr(reward_info, "reward", None)
                agent_cost = float(getattr(sim_run, "agent_cost", 0.0) or 0.0)
                user_cost = float(getattr(sim_run, "user_cost", 0.0) or 0.0)
                total_agent_cost += agent_cost
                total_user_cost += user_cost

                checkpoint_saved = False
                checkpoint_warning: str | None = None
                contextual_recall_used = False
                recall_item_count = 0
                conversation_metrics = summarize_conversation_metrics(
                    getattr(sim_run, "messages", None)
                )

                if args.mode == "on":
                    summary_content = make_checkpoint_content(task, sim_run)
                    checkpoint_response = run_client(
                        "record-checkpoint",
                        {
                            "platform": "codex",
                            "project": benchmark_project_name,
                            "session_id": session_id,
                            "title": f"tau3 task {task.id}",
                            "content": summary_content,
                            "tags": ["tau3_benchmark", args.domain, "task_summary"],
                            "privacy_tags": [],
                        },
                        env=env,
                    )
                    checkpoint_saved = checkpoint_response.get("ok") is not False
                    checkpoint_error = str(checkpoint_response.get("error") or "").strip()
                    if (not checkpoint_saved) and "write embedding is unavailable" in checkpoint_error:
                        checkpoint_saved = True
                        checkpoint_warning = checkpoint_error

                metrics_path = task_output_dir / "agent-metrics.json"
                if metrics_path.exists():
                    try:
                        metrics_payload = json.loads(metrics_path.read_text(encoding="utf-8"))
                    except json.JSONDecodeError:
                        metrics_payload = {}
                    seen_recall_count = len(metrics_payload.get("seen_recall_ids", []) or [])
                    recall_item_count = max(
                        int(metrics_payload.get("last_recall_count", 0) or 0),
                        seen_recall_count,
                    )
                    contextual_recall_used = recall_item_count > 0
                    contextual_recall_total += recall_item_count

                task_payload = {
                    "task_id": task.id,
                    "trial": trial,
                    "seed": seed,
                    "reward": reward_value,
                    "duration_sec": getattr(sim_run, "duration", None),
                    "agent_cost": agent_cost,
                    "user_cost": user_cost,
                    "termination_reason": str(getattr(sim_run, "termination_reason", "")),
                    "checkpoint_saved": checkpoint_saved,
                    "checkpoint_warning": checkpoint_warning,
                    "contextual_recall_used": contextual_recall_used,
                    "recall_item_count": recall_item_count,
                    "conversation_metrics": conversation_metrics,
                    "summary": make_checkpoint_content(task, sim_run),
                }
                write_json(task_output_dir / "summary.json", task_payload)

                rows.append(
                    TaskResultRow(
                        task_id=task.id,
                        trial=trial,
                        seed=seed,
                        reward=reward_value if isinstance(reward_value, (int, float)) else None,
                        duration_sec=float(getattr(sim_run, "duration", 0.0) or 0.0),
                        agent_cost=agent_cost,
                        user_cost=user_cost,
                        checkpoint_saved=checkpoint_saved,
                        checkpoint_warning=checkpoint_warning,
                        contextual_recall_used=contextual_recall_used,
                        recall_item_count=recall_item_count,
                        conversation_metrics=conversation_metrics,
                        output_dir=str(task_output_dir),
                    )
                )
    finally:
        if args.mode == "on":
            subprocess.run(
                [str(DAEMON_SCRIPT), "stop", "--quiet"],
                cwd=str(REPO_ROOT),
                env=env,
                check=False,
                capture_output=True,
                text=True,
            )

    pass_count = sum(1 for row in rows if isinstance(row.reward, (int, float)) and row.reward >= 0.999)
    report = {
        "ok": True,
        "generated_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "mode": args.mode,
        "domain": args.domain,
        "task_split_name": args.task_split_name,
        "num_tasks": args.num_tasks,
        "num_trials": args.num_trials,
        "agent_llm": args.agent_llm,
        "user_llm": args.user_llm,
        "output_dir": str(output_dir),
        "benchmark_home": str(benchmark_home),
        "benchmark_project": benchmark_project_name,
        "benchmark_port": api_port,
        "benchmark_ui_port": ui_port,
        "pass_count": pass_count,
        "total_runs": len(rows),
        "pass_rate": (pass_count / len(rows)) if rows else 0.0,
        "total_agent_cost": total_agent_cost,
        "total_user_cost": total_user_cost,
        "total_cost": total_agent_cost + total_user_cost,
        "contextual_recall_item_total": contextual_recall_total,
        "scrub_recall_identity_enabled": bool(args.scrub_recall_identity),
        "conversation_efficiency": aggregate_conversation_metrics(
            [row.conversation_metrics for row in rows]
        ),
        "rows": [asdict(row) for row in rows],
    }
    write_json(output_dir / "results.json", report)
    print(json.dumps(report, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
