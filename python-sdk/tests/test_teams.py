"""TEAM-006: Python SDK Team API のユニットテスト"""

from __future__ import annotations

import json
import unittest
from unittest.mock import patch

from harness_mem.client import HarnessMemClient


class _FakeResponse:
    def __init__(self, payload: dict) -> None:
        self._raw = json.dumps(payload).encode("utf-8")

    def read(self) -> bytes:
        return self._raw

    def __enter__(self) -> "_FakeResponse":
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        return None


def _ok_response(items: list | None = None) -> dict:
    return {"ok": True, "source": "core", "items": items or [], "meta": {}}


class TeamAPITest(unittest.TestCase):
    def setUp(self) -> None:
        self.client = HarnessMemClient(base_url="http://example.local")

    def test_teams_create_sends_post_to_admin_teams(self) -> None:
        """teams_create() が POST /v1/admin/teams を呼び、name/description を送信する"""
        response_payload = _ok_response([
            {"team_id": "team_001", "name": "Engineering", "description": "Eng team"}
        ])
        with patch("harness_mem.client.urlopen", return_value=_FakeResponse(response_payload)) as mocked:
            result = self.client.teams_create(name="Engineering", description="Eng team")

        request = mocked.call_args.args[0]
        body = json.loads(request.data.decode("utf-8"))
        self.assertIn("/v1/admin/teams", request.full_url)
        self.assertEqual(request.method, "POST")
        self.assertEqual(body["name"], "Engineering")
        self.assertEqual(body["description"], "Eng team")
        self.assertTrue(result["ok"])
        self.assertEqual(result["items"][0]["team_id"], "team_001")

    def test_teams_list_sends_get_to_admin_teams(self) -> None:
        """teams_list() が GET /v1/admin/teams を呼ぶ"""
        response_payload = _ok_response([
            {"team_id": "team_001", "name": "Engineering"},
            {"team_id": "team_002", "name": "Design"},
        ])
        with patch("harness_mem.client.urlopen", return_value=_FakeResponse(response_payload)) as mocked:
            result = self.client.teams_list()

        request = mocked.call_args.args[0]
        self.assertIn("/v1/admin/teams", request.full_url)
        self.assertEqual(request.method, "GET")
        self.assertTrue(result["ok"])
        self.assertEqual(len(result["items"]), 2)

    def test_teams_get_sends_get_with_team_id(self) -> None:
        """teams_get() が GET /v1/admin/teams/:id を呼ぶ"""
        with patch("harness_mem.client.urlopen", return_value=_FakeResponse(_ok_response([{"team_id": "team_001"}]))) as mocked:
            self.client.teams_get("team_001")

        request = mocked.call_args.args[0]
        self.assertIn("/v1/admin/teams/team_001", request.full_url)
        self.assertEqual(request.method, "GET")

    def test_teams_update_sends_put_with_payload(self) -> None:
        """teams_update() が PUT /v1/admin/teams/:id を呼び、name を送信する"""
        with patch("harness_mem.client.urlopen", return_value=_FakeResponse(_ok_response())) as mocked:
            self.client.teams_update("team_001", name="Engineering Updated")

        request = mocked.call_args.args[0]
        body = json.loads(request.data.decode("utf-8"))
        self.assertIn("/v1/admin/teams/team_001", request.full_url)
        self.assertEqual(request.method, "PUT")
        self.assertEqual(body["name"], "Engineering Updated")

    def test_teams_delete_sends_delete(self) -> None:
        """teams_delete() が DELETE /v1/admin/teams/:id を呼ぶ"""
        with patch("harness_mem.client.urlopen", return_value=_FakeResponse(_ok_response())) as mocked:
            self.client.teams_delete("team_001")

        request = mocked.call_args.args[0]
        self.assertIn("/v1/admin/teams/team_001", request.full_url)
        self.assertEqual(request.method, "DELETE")

    def test_teams_add_member_sends_post_with_user_id_and_role(self) -> None:
        """teams_add_member() が POST /v1/admin/teams/:id/members を呼ぶ"""
        with patch("harness_mem.client.urlopen", return_value=_FakeResponse(_ok_response([
            {"team_id": "team_001", "user_id": "user_alice", "role": "member"}
        ]))) as mocked:
            result = self.client.teams_add_member("team_001", user_id="user_alice", role="member")

        request = mocked.call_args.args[0]
        body = json.loads(request.data.decode("utf-8"))
        self.assertIn("/v1/admin/teams/team_001/members", request.full_url)
        self.assertEqual(request.method, "POST")
        self.assertEqual(body["user_id"], "user_alice")
        self.assertEqual(body["role"], "member")
        self.assertEqual(result["items"][0]["user_id"], "user_alice")

    def test_teams_get_members_sends_get(self) -> None:
        """teams_get_members() が GET /v1/admin/teams/:id/members を呼ぶ"""
        with patch("harness_mem.client.urlopen", return_value=_FakeResponse(_ok_response([
            {"team_id": "team_001", "user_id": "user_alice", "role": "admin"},
        ]))) as mocked:
            result = self.client.teams_get_members("team_001")

        request = mocked.call_args.args[0]
        self.assertIn("/v1/admin/teams/team_001/members", request.full_url)
        self.assertEqual(request.method, "GET")
        self.assertEqual(len(result["items"]), 1)

    def test_teams_update_member_role_sends_patch(self) -> None:
        """teams_update_member_role() が PATCH /v1/admin/teams/:id/members/:userId を呼ぶ"""
        with patch("harness_mem.client.urlopen", return_value=_FakeResponse(_ok_response())) as mocked:
            self.client.teams_update_member_role("team_001", "user_bob", role="admin")

        request = mocked.call_args.args[0]
        body = json.loads(request.data.decode("utf-8"))
        self.assertIn("/v1/admin/teams/team_001/members/user_bob", request.full_url)
        self.assertEqual(request.method, "PATCH")
        self.assertEqual(body["role"], "admin")

    def test_teams_remove_member_sends_delete(self) -> None:
        """teams_remove_member() が DELETE /v1/admin/teams/:id/members/:userId を呼ぶ"""
        with patch("harness_mem.client.urlopen", return_value=_FakeResponse(_ok_response())) as mocked:
            self.client.teams_remove_member("team_001", "user_bob")

        request = mocked.call_args.args[0]
        self.assertIn("/v1/admin/teams/team_001/members/user_bob", request.full_url)
        self.assertEqual(request.method, "DELETE")

    def test_teams_update_sends_only_provided_fields(self) -> None:
        """teams_update() は指定されたフィールドのみを送信する（description なし）"""
        with patch("harness_mem.client.urlopen", return_value=_FakeResponse(_ok_response())) as mocked:
            self.client.teams_update("team_001", name="New Name")

        request = mocked.call_args.args[0]
        body = json.loads(request.data.decode("utf-8"))
        self.assertIn("name", body)
        self.assertNotIn("description", body)


if __name__ == "__main__":
    unittest.main()
