"""CrewAI Memory integration for harness-mem."""
from __future__ import annotations

from typing import Any, Dict, List, Optional


class HarnessMemCrewAIMemory:
    """
    CrewAI の Memory インターフェースに準拠した harness-mem ラッパー。

    Usage::

        from harness_mem import HarnessMemClient
        from harness_mem.crewai_memory import HarnessMemCrewAIMemory

        client = HarnessMemClient()
        memory = HarnessMemCrewAIMemory(client, project="my-project")
        # crew = Crew(memory=memory)
    """

    def __init__(
        self,
        client: Any,
        project: Optional[str] = None,
        max_results: int = 5,
    ) -> None:
        self.client = client
        self.project = project
        self.max_results = max_results

    def search(self, query: str, **kwargs: Any) -> List[Dict[str, Any]]:
        """
        CrewAI の memory.search() に準拠。

        :param query: 検索クエリ文字列
        :param kwargs: limit など追加パラメータ
        :returns: CrewAI が期待する形式の辞書リスト
        """
        limit: int = kwargs.get("limit", self.max_results)
        response = self.client.search(
            query=query,
            limit=limit,
            project=self.project,
        )
        items: List[Any] = response.get("items", []) if isinstance(response, dict) else []
        return [
            {
                "content": r.get("content", ""),
                "metadata": {
                    "title": r.get("title", ""),
                    "type": r.get("observation_type", "context"),
                    "score": r.get("score", 0),
                    "created_at": r.get("created_at", ""),
                },
            }
            for r in items
            if isinstance(r, dict)
        ]

    def save(self, content: str, metadata: Optional[Dict[str, Any]] = None) -> None:
        """
        CrewAI の memory.save() に準拠。

        :param content: 保存するコンテンツ文字列
        :param metadata: タイトル・タグ等の追加メタデータ
        """
        meta = metadata or {}
        title: str = meta.get("title", content[:80]) if meta else content[:80]
        tags: List[str] = list(meta.get("tags", [])) if meta else []

        event: Dict[str, Any] = {
            "event_type": "checkpoint",
            "title": title,
            "content": content,
            "tags": tags,
        }
        if self.project:
            event["project"] = self.project

        self.client.record_event(event)

    def reset(self) -> None:
        """
        CrewAI の memory.reset() に準拠。

        harness-mem の記憶は永続的なため、このメソッドは noop。
        """
