"""Hermes plugin: forward session lifecycle events to harness-mem.

Hooks registered:
    on_session_start(session_id, model, platform, **kwargs)
    on_session_end(session_id, completed, interrupted, model, platform, **kwargs)

Environment variables:
    HARNESS_MEM_URL          Daemon base URL (default: http://127.0.0.1:37888)
    HARNESS_MEM_TOKEN        Bearer token forwarded as x-harness-mem-token header
    HARNESS_MEM_PROJECT_KEY  Project namespace used by finalize_session (default: "default")
"""

from __future__ import annotations

import os
from typing import Any, Optional

from harness_mem import HarnessMemClient

_PLATFORM = "hermes"
_DEFAULT_BASE_URL = "http://127.0.0.1:37888"
_DEFAULT_PROJECT = "default"

_client: Optional[HarnessMemClient] = None


def _get_client() -> HarnessMemClient:
    global _client
    if _client is None:
        _client = HarnessMemClient(
            base_url=os.environ.get("HARNESS_MEM_URL", _DEFAULT_BASE_URL),
            token=os.environ.get("HARNESS_MEM_TOKEN"),
        )
    return _client


def _reset_client_for_testing() -> None:
    """Reset the lazily-constructed client. Used by the test suite."""
    global _client
    _client = None


def _project_key() -> str:
    return os.environ.get("HARNESS_MEM_PROJECT_KEY", _DEFAULT_PROJECT)


def on_session_start(session_id, model, platform, **_kwargs: Any) -> None:
    _get_client().record_event({
        "platform": _PLATFORM,
        "event_type": "session_start",
        "session_id": session_id,
        "metadata": {
            "hermes_model": model,
            "hermes_platform": platform,
        },
    })


def on_session_end(
    session_id,
    completed,
    interrupted,
    model,
    platform,
    **_kwargs: Any,
) -> None:
    client = _get_client()
    client.record_event({
        "platform": _PLATFORM,
        "event_type": "session_end",
        "session_id": session_id,
        "metadata": {
            "completed": completed,
            "interrupted": interrupted,
            "hermes_model": model,
            "hermes_platform": platform,
        },
    })
    if completed and not interrupted:
        client.finalize_session(
            session_id=session_id,
            platform=_PLATFORM,
            project=_project_key(),
        )


def register(ctx: Any) -> None:
    """Hermes plugin entry point. Called once by Hermes at plugin load."""
    ctx.register_hook("on_session_start", on_session_start)
    ctx.register_hook("on_session_end", on_session_end)
