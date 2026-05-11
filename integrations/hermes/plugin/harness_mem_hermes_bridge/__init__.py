"""harness-mem ↔ Hermes Agent bridge plugin.

This package implements a Hermes plugin that registers session lifecycle hooks
(`on_session_start`, `on_session_end`) and forwards events to a harness-mem
daemon over HTTP via the official `harness-mem` Python SDK.

Plugin entry point: `harness_mem_hermes_bridge.plugin.register`
"""

from . import plugin

__all__ = ["plugin"]
