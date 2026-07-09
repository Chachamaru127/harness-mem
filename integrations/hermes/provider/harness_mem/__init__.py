"""harness-mem Hermes MemoryProvider plugin.

MemoryProvider integration for harness-mem, a local-first cross-tool coding
memory runtime shared across Claude Code, Codex, Cursor, OpenCode, and Hermes.

This provider is intentionally thin: it does not perform LLM extraction inside
Hermes. It forwards Hermes turns to the harness-mem daemon; the daemon's shared
consolidation pipeline performs heuristic / local-LLM / opt-in cloud extraction.
"""

from __future__ import annotations

import json
import logging
import os
import threading
from typing import Any, Dict, List, Optional
from urllib import request
from urllib.error import HTTPError, URLError

try:  # Hermes runtime
    from agent.memory_provider import MemoryProvider
except Exception:  # Test/import fallback outside Hermes
    from abc import ABC

    class MemoryProvider(ABC):  # type: ignore[no-redef]
        """Minimal standalone fallback used when importing outside Hermes."""

        pass

try:
    from tools.registry import tool_error
except Exception:
    def tool_error(message: str) -> str:
        return json.dumps({"ok": False, "error": message})

logger = logging.getLogger(__name__)

_DEFAULT_BASE_URL = "http://127.0.0.1:37888"
_DEFAULT_PROJECT = "default"
_DEFAULT_TIMEOUT_SEC = 8.0
_MIN_QUERY_LEN = 3


SEARCH_SCHEMA = {
    "name": "harness_mem_search",
    "description": "Search harness-mem local-first cross-tool coding memory for relevant context.",
    "parameters": {
        "type": "object",
        "properties": {
            "query": {"type": "string", "description": "What to search for."},
            "limit": {"type": "integer", "description": "Maximum result count.", "default": 5},
        },
        "required": ["query"],
    },
}

RECORD_SCHEMA = {
    "name": "harness_mem_record",
    "description": "Record an important project memory/checkpoint in harness-mem.",
    "parameters": {
        "type": "object",
        "properties": {
            "title": {"type": "string", "description": "Short title."},
            "content": {"type": "string", "description": "Memory content to record."},
            "tags": {"type": "array", "items": {"type": "string"}, "description": "Optional tags."},
        },
        "required": ["content"],
    },
}

STATUS_SCHEMA = {
    "name": "harness_mem_status",
    "description": "Check harness-mem daemon health/status.",
    "parameters": {"type": "object", "properties": {}, "required": []},
}


def _coerce_bool(value: Any, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        text = value.strip().lower()
        if text in {"1", "true", "yes", "on"}:
            return True
        if text in {"0", "false", "no", "off"}:
            return False
    return default


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def _compact_turn(user_content: str, assistant_content: str) -> str:
    user = (user_content or "").strip()
    assistant = (assistant_content or "").strip()
    return f"User: {user[:4000]}\nAssistant: {assistant[:4000]}".strip()


class HarnessMemMemoryProvider(MemoryProvider):
    """Hermes MemoryProvider that bridges completed turns into harness-mem."""

    def __init__(self) -> None:
        self._base_url = _env("HARNESS_MEM_URL", _DEFAULT_BASE_URL).rstrip("/")
        self._token = _env("HARNESS_MEM_TOKEN") or None
        self._project = _env("HARNESS_MEM_PROJECT_KEY", _DEFAULT_PROJECT) or _DEFAULT_PROJECT
        self._session_id = ""
        self._hermes_home = ""
        self._platform = ""
        self._sync_thread: Optional[threading.Thread] = None
        self._lock = threading.Lock()

    @property
    def name(self) -> str:
        return "harness_mem"

    def is_available(self) -> bool:
        """Local-only availability check; never probes the daemon."""
        return bool(self._base_url)

    def initialize(self, session_id: str, **kwargs: Any) -> None:
        self._base_url = _env("HARNESS_MEM_URL", _DEFAULT_BASE_URL).rstrip("/")
        self._token = _env("HARNESS_MEM_TOKEN") or None
        self._project = _env("HARNESS_MEM_PROJECT_KEY", _DEFAULT_PROJECT) or _DEFAULT_PROJECT
        self._session_id = session_id
        self._hermes_home = str(kwargs.get("hermes_home", "") or "")
        self._platform = str(kwargs.get("platform", "") or "")

    def system_prompt_block(self) -> str:
        return (
            "# harness-mem Memory\n"
            "Active local-first cross-tool coding memory. "
            "Use harness_mem_search for explicit recall and harness_mem_record for durable project checkpoints."
        )

    def get_tool_schemas(self) -> List[Dict[str, Any]]:
        return [SEARCH_SCHEMA, RECORD_SCHEMA, STATUS_SCHEMA]

    def handle_tool_call(self, tool_name: str, args: Dict[str, Any], **kwargs: Any) -> str:
        try:
            if tool_name == "harness_mem_search":
                return json.dumps(self._search(args))
            if tool_name == "harness_mem_record":
                return json.dumps(self._record(args))
            if tool_name == "harness_mem_status":
                return json.dumps(self._request_json("GET", "/health"))
            return tool_error(f"Unknown tool: {tool_name}")
        except Exception as exc:
            logger.debug("harness-mem tool call failed: %s", exc)
            return tool_error(str(exc))

    def prefetch(self, query: str, *, session_id: str = "") -> str:
        if not query or len(query.strip()) < _MIN_QUERY_LEN:
            return ""
        try:
            result = self._search({"query": query, "limit": 5, "session_id": session_id})
        except Exception as exc:
            logger.debug("harness-mem prefetch failed: %s", exc)
            return ""
        items = result.get("items") if isinstance(result, dict) else None
        if not isinstance(items, list) or not items:
            return ""
        lines = ["## harness-mem Context"]
        for item in items[:5]:
            if not isinstance(item, dict):
                continue
            obs_id = str(item.get("id", "")).strip()
            title = str(item.get("title", "Untitled")).strip() or "Untitled"
            content = str(item.get("content", "")).strip().replace("\n", " ")
            if len(content) > 500:
                content = content[:500] + "…"
            prefix = f"- [{obs_id}] {title}" if obs_id else f"- {title}"
            lines.append(f"{prefix}: {content}" if content else prefix)
        return "\n".join(lines).strip()

    def sync_turn(
        self,
        user_content: str,
        assistant_content: str,
        *,
        session_id: str = "",
        messages: Optional[List[Dict[str, Any]]] = None,
    ) -> None:
        compact = _compact_turn(user_content, assistant_content)
        if not compact:
            return
        effective_session = session_id or self._session_id

        def _sync() -> None:
            try:
                self._record_turn(effective_session, compact, user_content, assistant_content)
            except Exception as exc:
                logger.debug("harness-mem sync_turn failed: %s", exc)

        with self._lock:
            if self._sync_thread and self._sync_thread.is_alive():
                self._sync_thread.join(timeout=5.0)
            self._sync_thread = threading.Thread(target=_sync, daemon=True, name="harness-mem-sync")
            self._sync_thread.start()

    def on_session_end(self, messages: List[Dict[str, Any]]) -> None:
        if not _coerce_bool(os.environ.get("HARNESS_MEM_HERMES_CONSOLIDATE_ON_END"), False):
            return
        try:
            self._request_json(
                "POST",
                "/v1/admin/consolidation/run",
                {
                    "reason": "hermes_session_end",
                    "project": self._project,
                    "session_id": self._session_id,
                    "limit": 50,
                },
            )
        except Exception as exc:
            logger.debug("harness-mem session-end consolidation failed: %s", exc)

    def on_session_switch(self, new_session_id: str, **kwargs: Any) -> None:
        self._session_id = new_session_id

    def on_memory_write(
        self,
        action: str,
        target: str,
        content: str,
        metadata: Optional[Dict[str, Any]] = None,
    ) -> None:
        if action not in {"add", "replace"} or not content:
            return
        try:
            title = "Hermes memory write"
            self._record_checkpoint(title, f"[{target}] {content}", tags=["hermes", "memory_write"])
        except Exception as exc:
            logger.debug("harness-mem memory write mirror failed: %s", exc)

    def shutdown(self) -> None:
        if self._sync_thread and self._sync_thread.is_alive():
            self._sync_thread.join(timeout=10.0)

    def _search(self, args: Dict[str, Any]) -> Dict[str, Any]:
        query = str(args.get("query", "")).strip()
        if not query:
            raise ValueError("query is required")
        limit = args.get("limit", 5)
        payload = {
            "query": query[:5000],
            "project": self._project,
            "limit": int(limit) if isinstance(limit, (int, float, str)) and str(limit).isdigit() else 5,
            "include_private": False,
            "safe_mode": True,
        }
        return self._request_json("POST", "/v1/search", payload)

    def _record(self, args: Dict[str, Any]) -> Dict[str, Any]:
        content = str(args.get("content", "")).strip()
        if not content:
            raise ValueError("content is required")
        title = str(args.get("title", "Hermes memory")).strip() or "Hermes memory"
        raw_tags = args.get("tags", [])
        tags = [str(tag) for tag in raw_tags] if isinstance(raw_tags, list) else []
        return self._record_checkpoint(title, content, tags=tags or ["hermes", "manual"])

    def _record_checkpoint(self, title: str, content: str, *, tags: List[str]) -> Dict[str, Any]:
        payload = {
            "event": {
                "platform": "hermes",
                "project": self._project,
                "session_id": self._session_id,
                "event_type": "checkpoint",
                "title": title,
                "content": content,
                "payload": {"title": title, "content": content},
                "tags": tags,
                "metadata": {"source": "hermes_memory_provider"},
            }
        }
        return self._request_json("POST", "/v1/events/record", payload)

    def _record_turn(
        self,
        session_id: str,
        compact: str,
        user_content: str,
        assistant_content: str,
    ) -> Dict[str, Any]:
        payload = {
            "event": {
                "platform": "hermes",
                "project": self._project,
                "session_id": session_id,
                "event_type": "assistant_response",
                "title": "Hermes turn",
                "content": compact,
                "payload": {
                    "title": "Hermes turn",
                    "content": compact,
                    "user": (user_content or "")[:4000],
                    "assistant": (assistant_content or "")[:4000],
                },
                "tags": ["hermes", "turn"],
                "metadata": {"source": "hermes_memory_provider"},
            }
        }
        return self._request_json("POST", "/v1/events/record", payload)

    def _request_json(self, method: str, path: str, payload: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        url = f"{self._base_url}{path}"
        body = json.dumps(payload or {}).encode("utf-8") if method.upper() in {"POST", "PUT", "PATCH"} else None
        headers = {"content-type": "application/json"}
        if self._token:
            headers["X-harness-mem-token"] = self._token
        req = request.Request(url=url, data=body, headers=headers, method=method.upper())
        try:
            with request.urlopen(req, timeout=_DEFAULT_TIMEOUT_SEC) as response:
                raw = response.read().decode("utf-8")
        except HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise RuntimeError(f"harness-mem HTTP {exc.code}: {detail}") from exc
        except (URLError, OSError) as exc:
            raise RuntimeError(f"harness-mem request failed: {exc}") from exc
        if not raw:
            return {}
        parsed = json.loads(raw)
        if not isinstance(parsed, dict):
            raise RuntimeError("harness-mem response is not a JSON object")
        return parsed


def register(ctx: Any) -> None:
    """Register harness-mem as a Hermes memory provider plugin."""
    ctx.register_memory_provider(HarnessMemMemoryProvider())
