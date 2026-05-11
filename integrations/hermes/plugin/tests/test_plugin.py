"""TDD tests for harness_mem_hermes_bridge plugin.

These tests pin down the contract the Hermes plugin must honor when forwarding
session lifecycle events to harness-mem. The plugin must:

1. Register exactly two hooks: `on_session_start` and `on_session_end`.
2. Convert Hermes hook arguments into harness-mem `EventEnvelope` payloads
   with `platform="hermes"` and a stable `event_type` string.
3. Call `HarnessMemClient.finalize_session` only when the session completed
   cleanly (not interrupted).
4. Resolve `HARNESS_MEM_URL`, `HARNESS_MEM_TOKEN`, and `HARNESS_MEM_PROJECT_KEY`
   from environment variables, with sensible defaults.
5. Tolerate forward-compatible kwargs from future Hermes versions.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest

from harness_mem_hermes_bridge import plugin


@pytest.fixture(autouse=True)
def _reset_client_between_tests():
    plugin._reset_client_for_testing()
    yield
    plugin._reset_client_for_testing()


# ---------------------------------------------------------------------------
# register(ctx)
# ---------------------------------------------------------------------------


class TestRegister:
    def test_registers_on_session_start_and_end(self):
        ctx = MagicMock()
        plugin.register(ctx)

        registered_names = [call.args[0] for call in ctx.register_hook.call_args_list]
        assert "on_session_start" in registered_names
        assert "on_session_end" in registered_names

    def test_registers_callable_bindings(self):
        ctx = MagicMock()
        plugin.register(ctx)

        bindings = {call.args[0]: call.args[1] for call in ctx.register_hook.call_args_list}
        assert bindings["on_session_start"] is plugin.on_session_start
        assert bindings["on_session_end"] is plugin.on_session_end


# ---------------------------------------------------------------------------
# on_session_start
# ---------------------------------------------------------------------------


class TestOnSessionStart:
    @patch("harness_mem_hermes_bridge.plugin.HarnessMemClient")
    def test_records_session_start_event(self, mock_client_cls):
        mock_client = MagicMock()
        mock_client_cls.return_value = mock_client

        plugin.on_session_start("sess-001", "claude-sonnet-4.6", "cli")

        mock_client.record_event.assert_called_once()
        event = mock_client.record_event.call_args.args[0]
        assert event["platform"] == "hermes"
        assert event["event_type"] == "session_start"
        assert event["session_id"] == "sess-001"
        assert event["metadata"]["hermes_model"] == "claude-sonnet-4.6"
        assert event["metadata"]["hermes_platform"] == "cli"

    @patch("harness_mem_hermes_bridge.plugin.HarnessMemClient")
    def test_accepts_keyword_arguments(self, mock_client_cls):
        mock_client = MagicMock()
        mock_client_cls.return_value = mock_client

        plugin.on_session_start(
            session_id="sess-kw",
            model="claude-sonnet-4.6",
            platform="telegram",
        )

        event = mock_client.record_event.call_args.args[0]
        assert event["session_id"] == "sess-kw"
        assert event["metadata"]["hermes_platform"] == "telegram"

    @patch("harness_mem_hermes_bridge.plugin.HarnessMemClient")
    def test_ignores_future_kwargs(self, mock_client_cls):
        """Forward-compat: Hermes may add new fields without breaking the bridge."""
        mock_client = MagicMock()
        mock_client_cls.return_value = mock_client

        plugin.on_session_start(
            "sess-future",
            "m",
            "cli",
            future_arg="something",
            another_arg=42,
        )

        mock_client.record_event.assert_called_once()


# ---------------------------------------------------------------------------
# on_session_end
# ---------------------------------------------------------------------------


class TestOnSessionEnd:
    @patch("harness_mem_hermes_bridge.plugin.HarnessMemClient")
    def test_records_session_end_event(self, mock_client_cls):
        mock_client = MagicMock()
        mock_client_cls.return_value = mock_client

        plugin.on_session_end(
            "sess-end",
            True,   # completed
            False,  # interrupted
            "claude-sonnet-4.6",
            "cli",
        )

        # First call must be record_event with event_type=session_end.
        first_call = mock_client.record_event.call_args.args[0]
        assert first_call["event_type"] == "session_end"
        assert first_call["session_id"] == "sess-end"
        assert first_call["metadata"]["completed"] is True
        assert first_call["metadata"]["interrupted"] is False
        assert first_call["metadata"]["hermes_model"] == "claude-sonnet-4.6"
        assert first_call["metadata"]["hermes_platform"] == "cli"

    @patch("harness_mem_hermes_bridge.plugin.HarnessMemClient")
    def test_finalizes_session_when_completed_cleanly(self, mock_client_cls):
        mock_client = MagicMock()
        mock_client_cls.return_value = mock_client

        plugin.on_session_end(
            "sess-clean",
            completed=True,
            interrupted=False,
            model="m",
            platform="cli",
        )

        mock_client.finalize_session.assert_called_once()
        kwargs = mock_client.finalize_session.call_args.kwargs
        assert kwargs["session_id"] == "sess-clean"
        assert kwargs["platform"] == "hermes"

    @patch("harness_mem_hermes_bridge.plugin.HarnessMemClient")
    def test_does_not_finalize_when_interrupted(self, mock_client_cls):
        mock_client = MagicMock()
        mock_client_cls.return_value = mock_client

        plugin.on_session_end(
            "sess-stop",
            completed=False,
            interrupted=True,
            model="m",
            platform="cli",
        )

        mock_client.record_event.assert_called_once()
        mock_client.finalize_session.assert_not_called()

    @patch("harness_mem_hermes_bridge.plugin.HarnessMemClient")
    def test_does_not_finalize_when_not_completed(self, mock_client_cls):
        """`completed=False, interrupted=False` should also skip finalize."""
        mock_client = MagicMock()
        mock_client_cls.return_value = mock_client

        plugin.on_session_end(
            "sess-aborted",
            completed=False,
            interrupted=False,
            model="m",
            platform="cli",
        )

        mock_client.finalize_session.assert_not_called()


# ---------------------------------------------------------------------------
# Environment variable resolution
# ---------------------------------------------------------------------------


class TestEnvConfiguration:
    @patch.dict("os.environ", {"HARNESS_MEM_PROJECT_KEY": "my-project"}, clear=False)
    @patch("harness_mem_hermes_bridge.plugin.HarnessMemClient")
    def test_finalize_uses_project_key_from_env(self, mock_client_cls):
        mock_client = MagicMock()
        mock_client_cls.return_value = mock_client

        plugin.on_session_end(
            "sess", completed=True, interrupted=False, model="m", platform="cli",
        )

        kwargs = mock_client.finalize_session.call_args.kwargs
        assert kwargs["project"] == "my-project"

    @patch.dict("os.environ", {}, clear=True)
    @patch("harness_mem_hermes_bridge.plugin.HarnessMemClient")
    def test_finalize_defaults_project_when_env_missing(self, mock_client_cls):
        mock_client = MagicMock()
        mock_client_cls.return_value = mock_client

        plugin.on_session_end(
            "sess", completed=True, interrupted=False, model="m", platform="cli",
        )

        kwargs = mock_client.finalize_session.call_args.kwargs
        assert kwargs["project"] == "default"

    @patch.dict("os.environ", {"HARNESS_MEM_URL": "http://memory.local:9999"}, clear=False)
    @patch("harness_mem_hermes_bridge.plugin.HarnessMemClient")
    def test_client_constructed_with_url_from_env(self, mock_client_cls):
        mock_client_cls.return_value = MagicMock()

        plugin.on_session_start("sess", "m", "cli")

        mock_client_cls.assert_called_once()
        ctor_kwargs = mock_client_cls.call_args.kwargs
        assert ctor_kwargs["base_url"] == "http://memory.local:9999"

    @patch.dict("os.environ", {"HARNESS_MEM_TOKEN": "secret-token"}, clear=False)
    @patch("harness_mem_hermes_bridge.plugin.HarnessMemClient")
    def test_client_constructed_with_token_from_env(self, mock_client_cls):
        mock_client_cls.return_value = MagicMock()

        plugin.on_session_start("sess", "m", "cli")

        ctor_kwargs = mock_client_cls.call_args.kwargs
        assert ctor_kwargs["token"] == "secret-token"

    @patch.dict("os.environ", {}, clear=True)
    @patch("harness_mem_hermes_bridge.plugin.HarnessMemClient")
    def test_client_constructed_with_default_url_when_env_missing(self, mock_client_cls):
        mock_client_cls.return_value = MagicMock()

        plugin.on_session_start("sess", "m", "cli")

        ctor_kwargs = mock_client_cls.call_args.kwargs
        assert ctor_kwargs["base_url"] == "http://127.0.0.1:37888"
        assert ctor_kwargs["token"] is None


# ---------------------------------------------------------------------------
# Client singleton behavior
# ---------------------------------------------------------------------------


class TestClientSingleton:
    @patch("harness_mem_hermes_bridge.plugin.HarnessMemClient")
    def test_client_is_lazily_constructed_once(self, mock_client_cls):
        mock_client_cls.return_value = MagicMock()

        plugin.on_session_start("a", "m", "cli")
        plugin.on_session_start("b", "m", "cli")
        plugin.on_session_end("c", completed=True, interrupted=False, model="m", platform="cli")

        # HarnessMemClient should be constructed exactly once across all calls.
        assert mock_client_cls.call_count == 1
