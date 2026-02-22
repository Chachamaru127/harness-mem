from __future__ import annotations

import json
import unittest
from io import BytesIO
from unittest.mock import patch
from urllib.error import HTTPError

from harness_mem.client import HarnessMemClient
from harness_mem.errors import HarnessMemAPIError


class _FakeResponse:
    def __init__(self, payload: dict) -> None:
        self._raw = json.dumps(payload).encode("utf-8")

    def read(self) -> bytes:
        return self._raw

    def __enter__(self) -> "_FakeResponse":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        return None


class HarnessMemClientUnitTest(unittest.TestCase):
    def test_record_checkpoint_sends_tags_and_privacy_tags(self) -> None:
        client = HarnessMemClient(base_url="http://example.local")
        with patch("harness_mem.client.urlopen", return_value=_FakeResponse({"ok": True, "items": []})) as mocked:
            client.record_checkpoint(
                session_id="session-1",
                title="checkpoint",
                content="content",
                tags=["phase5"],
                privacy_tags=["private"],
            )

        request = mocked.call_args.args[0]
        payload = json.loads(request.data.decode("utf-8"))
        self.assertEqual(payload["tags"], ["phase5"])
        self.assertEqual(payload["privacy_tags"], ["private"])

    def test_get_observations_accepts_single_id_string(self) -> None:
        client = HarnessMemClient(base_url="http://example.local")
        with patch("harness_mem.client.urlopen", return_value=_FakeResponse({"ok": True, "items": []})) as mocked:
            client.get_observations(ids="obs-1", include_private=True)

        request = mocked.call_args.args[0]
        payload = json.loads(request.data.decode("utf-8"))
        self.assertEqual(payload["ids"], ["obs-1"])
        self.assertTrue(payload["include_private"])

    def test_api_error_uses_message_field_when_present(self) -> None:
        client = HarnessMemClient(base_url="http://example.local")
        body = BytesIO(b'{"message":"bad request payload"}')
        http_error = HTTPError(
            url="http://example.local/v1/search",
            code=400,
            msg="Bad Request",
            hdrs=None,
            fp=body,
        )

        with patch("harness_mem.client.urlopen", side_effect=http_error):
            with self.assertRaises(HarnessMemAPIError) as ctx:
                client.search(query="x")

        self.assertEqual(ctx.exception.status_code, 400)
        self.assertEqual(ctx.exception.message, "bad request payload")


if __name__ == "__main__":
    unittest.main()
