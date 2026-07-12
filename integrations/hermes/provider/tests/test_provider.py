"""TDD tests for the harness-mem Hermes MemoryProvider plugin.

These tests pin the Layer 2 Hermes MemoryProvider contract.  The provider is
separate from the legacy lifecycle-hook bridge under integrations/hermes/plugin.
"""

from __future__ import annotations

import io
import json
import sys
import time
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

# shutdown() must join an alive pending _sync_thread with this wall-clock cap (seconds).
SHUTDOWN_JOIN_TIMEOUT_SECONDS = 10.0


REPO_ROOT = Path(__file__).resolve().parents[4]
PROVIDER_INIT = REPO_ROOT / "integrations" / "hermes" / "provider" / "harness_mem" / "__init__.py"


def load_provider_module():
    import importlib.util

    spec = importlib.util.spec_from_file_location("harness_mem_hermes_provider_under_test", PROVIDER_INIT)
    module = importlib.util.module_from_spec(spec)
    assert spec is not None and spec.loader is not None
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


class FakeHTTPResponse:
    def __init__(self, payload: dict):
        self._payload = payload

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def read(self):
        return json.dumps(self._payload).encode("utf-8")


class URLopenerRecorder:
    def __init__(self, payload: dict | None = None):
        self.payload = payload or {"ok": True, "items": []}
        self.calls = []

    def __call__(self, request, timeout=0):
        body = json.loads((request.data or b"{}").decode("utf-8"))
        self.calls.append(
            {
                "url": request.full_url,
                "method": request.get_method(),
                "headers": dict(request.header_items()),
                "body": body,
                "timeout": timeout,
            }
        )
        return FakeHTTPResponse(self.payload)


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    for key in (
        "HARNESS_MEM_URL",
        "HARNESS_MEM_TOKEN",
        "HARNESS_MEM_PROJECT_KEY",
        "HARNESS_MEM_HERMES_CONSOLIDATE_ON_END",
    ):
        monkeypatch.delenv(key, raising=False)


class TestDiscovery:
    def test_init_file_contains_memory_provider_discovery_marker_in_first_8192_chars(self):
        source = PROVIDER_INIT.read_text(encoding="utf-8")[:8192]
        assert "MemoryProvider" in source or "register_memory_provider" in source


class TestRegistration:
    def test_register_registers_memory_provider_instance(self):
        module = load_provider_module()
        ctx = MagicMock()

        module.register(ctx)

        ctx.register_memory_provider.assert_called_once()
        provider = ctx.register_memory_provider.call_args.args[0]
        assert provider.name == "harness_mem"


class TestAvailability:
    def test_is_available_is_local_only_and_does_not_call_network(self, monkeypatch):
        module = load_provider_module()
        recorder = URLopenerRecorder()
        monkeypatch.setattr(module.request, "urlopen", recorder)

        provider = module.HarnessMemMemoryProvider()
        result = provider.is_available()

        assert isinstance(result, bool)
        assert recorder.calls == []


class TestSyncTurn:
    def test_sync_turn_returns_quickly_and_records_searchable_event(self, monkeypatch):
        module = load_provider_module()
        recorder = URLopenerRecorder({"ok": True, "items": [{"id": "obs-1"}]})
        monkeypatch.setattr(module.request, "urlopen", recorder)
        monkeypatch.setenv("HARNESS_MEM_PROJECT_KEY", "repo-project")
        monkeypatch.setenv("HARNESS_MEM_TOKEN", "test-token")

        provider = module.HarnessMemMemoryProvider()
        provider.initialize("sess-123", hermes_home="/tmp/hermes", platform="cli")

        started = time.perf_counter()
        provider.sync_turn("ユーザー入力", "アシスタント応答")
        elapsed = time.perf_counter() - started
        provider.shutdown()

        assert elapsed < 0.2
        assert len(recorder.calls) == 1
        call = recorder.calls[0]
        assert call["url"].endswith("/v1/events/record")
        assert call["method"] == "POST"
        assert call["headers"].get("X-harness-mem-token") == "test-token"
        event = call["body"]["event"]
        assert event["platform"] == "hermes"
        assert event["project"] == "repo-project"
        assert event["session_id"] == "sess-123"
        assert event["event_type"] == "assistant_response"
        assert event["payload"]["content"].strip()
        assert "ユーザー入力" in event["payload"]["content"]
        assert "アシスタント応答" in event["payload"]["content"]
        assert "hermes" in event["tags"]
        assert "turn" in event["tags"]


class TestPrefetch:
    def test_prefetch_searches_daemon_and_returns_compact_context(self, monkeypatch):
        module = load_provider_module()
        recorder = URLopenerRecorder(
            {
                "ok": True,
                "items": [
                    {"id": "obs-1", "title": "Decision", "content": "Use local-first memory."},
                    {"id": "obs-2", "title": "Pattern", "content": "Keep providers thin."},
                ],
            }
        )
        monkeypatch.setattr(module.request, "urlopen", recorder)
        monkeypatch.setenv("HARNESS_MEM_PROJECT_KEY", "repo-project")

        provider = module.HarnessMemMemoryProvider()
        provider.initialize("sess-123")

        context = provider.prefetch("local-first memory", session_id="sess-123")

        assert len(recorder.calls) == 1
        assert recorder.calls[0]["url"].endswith("/v1/search")
        assert recorder.calls[0]["body"]["query"] == "local-first memory"
        assert recorder.calls[0]["body"]["project"] == "repo-project"
        assert recorder.calls[0]["body"]["safe_mode"] is True
        assert "## harness-mem Context" in context
        assert "obs-1" in context
        assert "Decision" in context
        assert "Use local-first memory." in context


class TestOnSessionEnd:
    def test_on_session_end_skips_consolidation_by_default(self, monkeypatch):
        module = load_provider_module()
        recorder = URLopenerRecorder()
        monkeypatch.setattr(module.request, "urlopen", recorder)

        provider = module.HarnessMemMemoryProvider()
        provider.initialize("sess-123")
        provider.on_session_end([])

        assert recorder.calls == []

    def test_on_session_end_runs_consolidation_when_env_enabled(self, monkeypatch):
        module = load_provider_module()
        recorder = URLopenerRecorder({"ok": True, "items": []})
        monkeypatch.setattr(module.request, "urlopen", recorder)
        monkeypatch.setenv("HARNESS_MEM_HERMES_CONSOLIDATE_ON_END", "1")
        monkeypatch.setenv("HARNESS_MEM_PROJECT_KEY", "repo-project")

        provider = module.HarnessMemMemoryProvider()
        provider.initialize("sess-123")
        provider.on_session_end([{"role": "user", "content": "done"}])

        assert len(recorder.calls) == 1
        call = recorder.calls[0]
        assert call["url"].endswith("/v1/admin/consolidation/run")
        assert call["body"]["reason"] == "hermes_session_end"
        assert call["body"]["project"] == "repo-project"
        assert call["body"]["session_id"] == "sess-123"
        assert call["body"]["limit"] == 50


class TestShutdown:
    def test_shutdown_joins_alive_pending_sync_thread_with_10_second_timeout(self):
        """Regression: shutdown() waits up to SHUTDOWN_JOIN_TIMEOUT_SECONDS for _sync_thread."""
        module = load_provider_module()
        provider = module.HarnessMemMemoryProvider()

        class SpySyncThread:
            def __init__(self):
                self.join_calls: list[float | None] = []

            def is_alive(self) -> bool:
                return True

            def join(self, timeout: float | None = None) -> None:
                self.join_calls.append(timeout)

        spy_thread = SpySyncThread()
        provider._sync_thread = spy_thread

        provider.shutdown()

        assert spy_thread.join_calls == [SHUTDOWN_JOIN_TIMEOUT_SECONDS]
        assert spy_thread.join_calls[0] == 10.0, (
            "shutdown join timeout policy is 10.0 seconds for alive pending _sync_thread"
        )


class TestTools:
    def test_get_tool_schemas_exposes_minimal_search_record_status_tools(self):
        module = load_provider_module()
        provider = module.HarnessMemMemoryProvider()

        names = {schema["name"] for schema in provider.get_tool_schemas()}

        assert names == {"harness_mem_search", "harness_mem_record", "harness_mem_status"}

    def test_handle_status_tool_returns_json(self, monkeypatch):
        module = load_provider_module()
        recorder = URLopenerRecorder({"ok": True, "items": [{"status": "healthy"}]})
        monkeypatch.setattr(module.request, "urlopen", recorder)

        provider = module.HarnessMemMemoryProvider()
        result = json.loads(provider.handle_tool_call("harness_mem_status", {}))

        assert result["ok"] is True
        assert recorder.calls[0]["url"].endswith("/health")
