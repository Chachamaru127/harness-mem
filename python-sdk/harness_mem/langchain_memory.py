"""
NEXT-009: LangChain Memory 互換レイヤー（Python）

HarnessMemLangChainMemory は LangChain の BaseMemory と同等のインターフェースを実装し、
harness-mem をバックエンドに使った長期記憶を提供する。

LangChain BaseMemory 相当インターフェース:
- memory_variables: List[str]              — どの変数名を返すか
- save_context(inputs, outputs)           — 入力・出力をメモリに保存
- load_memory_variables(inputs) -> dict   — クエリに関連するメモリを取得
- clear()                                  — メモリをクリア（no-op）
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Sequence

from .client import HarnessMemClient


def _default_format_history(items: Sequence[Dict[str, Any]]) -> str:
    """デフォルトの履歴フォーマット: コンテンツを改行区切りで結合する。"""
    return "\n---\n".join(
        item.get("content", "") for item in items if item.get("content")
    )


@dataclass
class HarnessMemLangChainMemory:
    """
    LangChain の BaseMemory と互換性のある harness-mem メモリ実装。

    Example::

        from harness_mem import HarnessMemLangChainMemory

        memory = HarnessMemLangChainMemory(
            project="my-project",
            session_id="session-123",
        )
        # LangChain チェーンに渡す
        # chain = LLMChain(llm=llm, prompt=prompt, memory=memory)
    """

    project: str
    session_id: str
    base_url: str = "http://127.0.0.1:37888"
    token: Optional[str] = None
    timeout_sec: float = 8.0
    memory_key: str = "history"
    search_limit: int = 5
    format_history: Callable[[Sequence[Dict[str, Any]]], str] = field(
        default_factory=lambda: _default_format_history
    )

    def __post_init__(self) -> None:
        self._client = HarnessMemClient(
            base_url=self.base_url,
            timeout_sec=self.timeout_sec,
            token=self.token,
        )

    @property
    def memory_variables(self) -> List[str]:
        """LangChain BaseMemory.memory_variables: 返す変数名のリスト。"""
        return [self.memory_key]

    def save_context(
        self,
        inputs: Dict[str, Any],
        outputs: Dict[str, Any],
    ) -> None:
        """
        LangChain BaseMemory.save_context: 入出力ペアをメモリに保存する。
        input の内容と output の内容を結合してハーネスメムに記録する。
        """
        input_text = "\n".join(str(v) for v in inputs.values() if v)
        output_text = "\n".join(str(v) for v in outputs.values() if v)

        if not input_text and not output_text:
            return

        parts = []
        if input_text:
            parts.append(f"Human: {input_text}")
        if output_text:
            parts.append(f"AI: {output_text}")
        content = "\n".join(parts)

        self._client.record_checkpoint(
            session_id=self.session_id,
            title=input_text[:120] or "conversation turn",
            content=content,
            project=self.project,
        )

    def load_memory_variables(self, inputs: Dict[str, Any]) -> Dict[str, str]:
        """
        LangChain BaseMemory.load_memory_variables: クエリに関連するメモリを返す。
        inputs に含まれるテキストで harness-mem を検索し、関連する記憶を history 変数として返す。
        """
        query = " ".join(str(v) for v in inputs.values() if v).strip()

        if not query:
            return {self.memory_key: ""}

        try:
            response = self._client.search(
                query=query,
                project=self.project,
                limit=self.search_limit,
            )
            items = response.get("items", [])
            if not items:
                return {self.memory_key: ""}
            history = self.format_history(items)
            return {self.memory_key: history}
        except Exception:
            return {self.memory_key: ""}

    def clear(self) -> None:
        """
        LangChain BaseMemory.clear: メモリをクリアする。
        harness-mem はサーバー側で永続管理するため、クライアント側では no-op とする。
        """
        # no-op: harness-mem はサーバー側で管理される
