import json
import os
import subprocess
import tempfile
import time
import unittest
from pathlib import Path

from harness_mem.client import HarnessMemClient
from harness_mem.errors import HarnessMemAPIError, HarnessMemTransportError


ROOT = Path(__file__).resolve().parents[2]


class HarnessMemClientIntegrationTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp_home = tempfile.TemporaryDirectory(prefix="harness-mem-python-sdk-")
        self.port = 38991
        env = os.environ.copy()
        env.update(
            {
                "HARNESS_MEM_HOME": self.tmp_home.name,
                "HARNESS_MEM_DB_PATH": str(Path(self.tmp_home.name) / "harness-mem.db"),
                "HARNESS_MEM_HOST": "127.0.0.1",
                "HARNESS_MEM_PORT": str(self.port),
                "HARNESS_MEM_CODEX_PROJECT_ROOT": str(ROOT),
                "HARNESS_MEM_ENABLE_OPENCODE_INGEST": "false",
                "HARNESS_MEM_ENABLE_CURSOR_INGEST": "false",
                "HARNESS_MEM_ENABLE_ANTIGRAVITY_INGEST": "false",
            }
        )
        self.env = env
        subprocess.run([str(ROOT / "scripts" / "harness-memd"), "start", "--quiet"], check=True, env=self.env)
        self.client = HarnessMemClient(base_url=f"http://127.0.0.1:{self.port}")
        self._wait_until_healthy()

    def tearDown(self) -> None:
        subprocess.run([str(ROOT / "scripts" / "harness-memd"), "stop", "--quiet"], check=False, env=self.env)
        self.tmp_home.cleanup()

    def _wait_until_healthy(self) -> None:
        deadline = time.time() + 10
        while time.time() < deadline:
            try:
                response = self.client.health()
                if response.get("ok"):
                    return
            except Exception:
                pass
            time.sleep(0.2)
        self.fail("harness-memd did not become healthy in time")

    def test_error_types(self) -> None:
        self.assertTrue(issubclass(HarnessMemAPIError, Exception))
        self.assertTrue(issubclass(HarnessMemTransportError, Exception))

    def test_sync_client_search_timeline_get_observations(self) -> None:
        payload = {
            "event": {
                "event_id": "python-sdk-1",
                "platform": "codex",
                "project": "python-sdk",
                "session_id": "python-sdk-session",
                "event_type": "user_prompt",
                "payload": {"content": "python sdk integration test"},
                "tags": ["python-sdk"],
                "privacy_tags": [],
            }
        }
        self.client.record_event(payload["event"])

        search = self.client.search(query="python sdk integration", project="python-sdk", limit=5)
        self.assertTrue(search["ok"])
        obs_id = search["items"][0]["id"]

        timeline = self.client.timeline(obs_id, before=1, after=1, include_private=True)
        self.assertTrue(timeline["ok"])

        details = self.client.get_observations(ids=[obs_id], include_private=True, compact=False)
        self.assertTrue(details["ok"])
        self.assertIn("token_estimate", details["meta"])

    def test_checkpoint_and_finalize(self) -> None:
        checkpoint = self.client.record_checkpoint(
            session_id="python-sdk-session-2",
            title="Phase5 checkpoint",
            content="python sdk checkpoint content",
            platform="codex",
            project="python-sdk",
            tags=["phase5", "python-sdk"],
            privacy_tags=["private"],
        )
        self.assertTrue(checkpoint["ok"])

        search = self.client.search(
            query="checkpoint content",
            project="python-sdk",
            limit=3,
            include_private=True,
        )
        self.assertTrue(search["ok"])
        self.assertGreaterEqual(len(search["items"]), 1)

        finalize = self.client.finalize_session(
            session_id="python-sdk-session-2",
            platform="codex",
            project="python-sdk",
            summary_mode="standard",
        )
        self.assertTrue(finalize["ok"])
        self.assertEqual(finalize["items"][0]["session_id"], "python-sdk-session-2")


if __name__ == "__main__":
    unittest.main()
