"""harness_mem.crewai_memory のユニットテスト。"""
from __future__ import annotations

import unittest
from typing import Any, Dict, List, Optional
from unittest.mock import MagicMock, call


def _make_client(items: List[Dict[str, Any]] = None) -> MagicMock:
    """search / record_event をモックした HarnessMemClient を返す。"""
    client = MagicMock()
    client.search.return_value = {
        "ok": True,
        "items": items if items is not None else [],
        "meta": {},
    }
    client.record_event.return_value = {"ok": True, "items": []}
    return client


class TestHarnessMemCrewAIMemorySearch(unittest.TestCase):
    """search() メソッドのテスト。"""

    def setUp(self) -> None:
        from harness_mem.crewai_memory import HarnessMemCrewAIMemory
        self.cls = HarnessMemCrewAIMemory

    def test_search_returns_list(self) -> None:
        """search() がリストを返すこと。"""
        client = _make_client()
        mem = self.cls(client)
        result = mem.search("TypeScript")
        self.assertIsInstance(result, list)

    def test_search_maps_items_correctly(self) -> None:
        """search() が観察アイテムを CrewAI 形式に変換すること。"""
        items = [
            {
                "id": "obs-1",
                "content": "TypeScript を採用した",
                "title": "技術選定",
                "observation_type": "decision",
                "score": 0.95,
                "created_at": "2026-01-01T00:00:00Z",
            }
        ]
        client = _make_client(items)
        mem = self.cls(client)
        result = mem.search("TypeScript")

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["content"], "TypeScript を採用した")
        self.assertEqual(result[0]["metadata"]["title"], "技術選定")
        self.assertEqual(result[0]["metadata"]["type"], "decision")
        self.assertEqual(result[0]["metadata"]["score"], 0.95)

    def test_search_passes_limit_to_client(self) -> None:
        """search() が limit を client.search に渡すこと。"""
        client = _make_client()
        mem = self.cls(client, max_results=3)
        mem.search("query")

        client.search.assert_called_once()
        kwargs = client.search.call_args.kwargs
        self.assertEqual(kwargs["limit"], 3)

    def test_search_kwargs_limit_overrides_default(self) -> None:
        """search(limit=N) が max_results を上書きすること。"""
        client = _make_client()
        mem = self.cls(client, max_results=5)
        mem.search("query", limit=2)

        kwargs = client.search.call_args.kwargs
        self.assertEqual(kwargs["limit"], 2)

    def test_search_passes_project(self) -> None:
        """project オプションが client.search に渡されること。"""
        client = _make_client()
        mem = self.cls(client, project="my-project")
        mem.search("query")

        kwargs = client.search.call_args.kwargs
        self.assertEqual(kwargs["project"], "my-project")

    def test_search_returns_empty_list_when_no_results(self) -> None:
        """検索結果が空の場合、空リストを返すこと。"""
        client = _make_client([])
        mem = self.cls(client)
        result = mem.search("unknown")
        self.assertEqual(result, [])

    def test_search_handles_missing_optional_fields(self) -> None:
        """観察アイテムに省略可能フィールドが欠けていても処理できること。"""
        items = [{"id": "obs-2", "content": "最小限のアイテム"}]
        client = _make_client(items)
        mem = self.cls(client)
        result = mem.search("test")

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["content"], "最小限のアイテム")
        self.assertEqual(result[0]["metadata"]["title"], "")
        self.assertEqual(result[0]["metadata"]["type"], "context")
        self.assertEqual(result[0]["metadata"]["score"], 0)


class TestHarnessMemCrewAIMemorySave(unittest.TestCase):
    """save() メソッドのテスト。"""

    def setUp(self) -> None:
        from harness_mem.crewai_memory import HarnessMemCrewAIMemory
        self.cls = HarnessMemCrewAIMemory

    def test_save_calls_record_event(self) -> None:
        """save() が client.record_event を呼ぶこと。"""
        client = _make_client()
        mem = self.cls(client)
        mem.save("重要な判断を記録")
        client.record_event.assert_called_once()

    def test_save_uses_content_as_title_when_no_metadata(self) -> None:
        """metadata がない場合、content の先頭80文字をタイトルに使うこと。"""
        client = _make_client()
        mem = self.cls(client)
        mem.save("テストコンテンツ")

        event = client.record_event.call_args.args[0]
        self.assertEqual(event["title"], "テストコンテンツ")
        self.assertEqual(event["content"], "テストコンテンツ")

    def test_save_uses_metadata_title(self) -> None:
        """metadata に title がある場合それを使うこと。"""
        client = _make_client()
        mem = self.cls(client)
        mem.save("内容", metadata={"title": "カスタムタイトル"})

        event = client.record_event.call_args.args[0]
        self.assertEqual(event["title"], "カスタムタイトル")

    def test_save_passes_tags_from_metadata(self) -> None:
        """metadata.tags が event に渡されること。"""
        client = _make_client()
        mem = self.cls(client)
        mem.save("内容", metadata={"tags": ["phase5", "important"]})

        event = client.record_event.call_args.args[0]
        self.assertEqual(event["tags"], ["phase5", "important"])

    def test_save_includes_project_in_event(self) -> None:
        """project オプションが event に含まれること。"""
        client = _make_client()
        mem = self.cls(client, project="harness-mem")
        mem.save("内容")

        event = client.record_event.call_args.args[0]
        self.assertEqual(event["project"], "harness-mem")

    def test_save_no_project_in_event_when_not_set(self) -> None:
        """project が未設定の場合、event に project キーがないこと。"""
        client = _make_client()
        mem = self.cls(client)
        mem.save("内容")

        event = client.record_event.call_args.args[0]
        self.assertNotIn("project", event)

    def test_save_event_type_is_checkpoint(self) -> None:
        """event_type が 'checkpoint' であること。"""
        client = _make_client()
        mem = self.cls(client)
        mem.save("内容")

        event = client.record_event.call_args.args[0]
        self.assertEqual(event["event_type"], "checkpoint")


class TestHarnessMemCrewAIMemoryReset(unittest.TestCase):
    """reset() メソッドのテスト。"""

    def setUp(self) -> None:
        from harness_mem.crewai_memory import HarnessMemCrewAIMemory
        self.cls = HarnessMemCrewAIMemory

    def test_reset_is_noop(self) -> None:
        """reset() が何も呼ばずに正常終了すること。"""
        client = _make_client()
        mem = self.cls(client)
        # 例外なく完了することを確認
        mem.reset()
        # record_event も search も呼ばれていない
        client.record_event.assert_not_called()
        client.search.assert_not_called()

    def test_reset_returns_none(self) -> None:
        """reset() が None を返すこと。"""
        client = _make_client()
        mem = self.cls(client)
        result = mem.reset()
        self.assertIsNone(result)


if __name__ == "__main__":
    unittest.main()
