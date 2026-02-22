from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Dict, List, Optional
from urllib.request import Request, urlopen


def _request(
    base_url: str,
    method: str,
    path: str,
    payload: Optional[Dict[str, Any]] = None,
    token: Optional[str] = None,
) -> Dict[str, Any]:
    body = json.dumps(payload or {}).encode("utf-8") if method.upper() == "POST" else None
    headers = {"content-type": "application/json"}
    if token:
        headers["x-harness-mem-token"] = token
        headers["authorization"] = f"Bearer {token}"
    request = Request(
        url=f"{base_url}{path}",
        data=body,
        headers=headers,
        method=method.upper(),
    )
    with urlopen(request, timeout=8) as response:
        raw = response.read().decode("utf-8")
        return json.loads(raw) if raw else {}


@dataclass
class HarnessMemLangChainRetriever:
    base_url: str = "http://127.0.0.1:37888"
    project: str = "default"
    include_private: bool = False
    token: Optional[str] = None

    def invoke(self, query: str, limit: int = 5) -> List[Dict[str, Any]]:
        response = _request(
            self.base_url,
            "POST",
            "/v1/search",
            {
                "query": query,
                "project": self.project,
                "limit": limit,
                "include_private": self.include_private,
            },
            self.token,
        )
        return response.get("items", [])

    def get_relevant_documents(self, query: str) -> List[Dict[str, Any]]:
        return self.invoke(query)


@dataclass
class HarnessMemLangChainChatMemory:
    base_url: str = "http://127.0.0.1:37888"
    project: str = "default"
    session_id: str = "langchain-session"
    include_private: bool = False
    token: Optional[str] = None

    def load_memory_variables(self, inputs: Dict[str, Any]) -> Dict[str, Any]:
        response = _request(
            self.base_url,
            "POST",
            "/v1/resume-pack",
            {
                "project": self.project,
                "session_id": self.session_id,
                "limit": 5,
                "include_private": self.include_private,
            },
            self.token,
        )
        lines: List[str] = []
        for item in response.get("items", []):
            title = str(item.get("title") or item.get("type") or "memory")
            content = str(item.get("content") or item.get("summary") or "")
            lines.append(f"{title}: {content}".strip())
        return {"history": "\n".join(lines)}

    def save_context(self, inputs: Dict[str, Any], outputs: Dict[str, Any]) -> None:
        title = str(inputs.get("input") or "langchain-input")
        content = str(outputs.get("output") or "")
        _request(
            self.base_url,
            "POST",
            "/v1/checkpoints/record",
            {
                "platform": "codex",
                "project": self.project,
                "session_id": self.session_id,
                "title": title[:120],
                "content": content[:4000],
                "tags": ["langchain"],
                "privacy_tags": [],
            },
            self.token,
        )

    def clear(self) -> None:
        _request(
            self.base_url,
            "POST",
            "/v1/sessions/finalize",
            {
                "platform": "codex",
                "project": self.project,
                "session_id": self.session_id,
                "summary_mode": "short",
            },
            self.token,
        )
