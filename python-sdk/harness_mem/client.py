from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Dict, Iterable, List, Optional, Sequence, Union, cast
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from .errors import HarnessMemAPIError, HarnessMemTransportError
from .types import (
    ApiResponse,
    AuditLogResponse,
    ConsolidationStatusResponse,
    EventEnvelope,
    FinalizeSessionResponse,
    GetObservationsResponse,
    HealthResponse,
    JsonDict,
    OptionalJsonDict,
    ResumePackResponse,
    SearchResponse,
    TimelineResponse,
    WriteResponse,
)


@dataclass
class HarnessMemClient:
    base_url: str = "http://127.0.0.1:37888"
    timeout_sec: float = 8.0
    token: Optional[str] = None

    def _headers(self) -> Dict[str, str]:
        headers = {"content-type": "application/json"}
        if self.token:
            headers["x-harness-mem-token"] = self.token
        return headers

    def _request(
        self,
        method: str,
        path: str,
        payload: OptionalJsonDict = None,
        query: Optional[Dict[str, Any]] = None,
    ) -> ApiResponse:
        query_str = f"?{urlencode({k: v for k, v in (query or {}).items() if v is not None})}" if query else ""
        body = json.dumps(payload or {}).encode("utf-8") if method.upper() in {"POST", "PUT", "PATCH"} else None
        req = Request(
            url=f"{self.base_url}{path}{query_str}",
            data=body,
            headers=self._headers(),
            method=method.upper(),
        )

        try:
            with urlopen(req, timeout=self.timeout_sec) as response:
                raw = response.read().decode("utf-8")
                parsed = json.loads(raw) if raw else {}
        except HTTPError as exc:
            try:
                body_json = json.loads(exc.read().decode("utf-8"))
            except Exception:
                body_json = None
            message = self._extract_error_message(body_json, str(exc))
            raise HarnessMemAPIError(status_code=exc.code, message=str(message), response_body=body_json)
        except (URLError, OSError) as exc:
            raise HarnessMemTransportError(message=str(exc))
        except json.JSONDecodeError as exc:
            raise HarnessMemTransportError(message=f"Invalid JSON response: {exc}")

        if not isinstance(parsed, dict):
            raise HarnessMemTransportError(message="API response is not a JSON object")

        if parsed.get("ok") is False:
            raise HarnessMemAPIError(
                status_code=200,
                message=self._extract_error_message(parsed, "harness-mem API returned ok=false"),
                response_body=parsed,
            )

        return parsed  # type: ignore[return-value]

    @staticmethod
    def _extract_error_message(payload: Any, fallback: str) -> str:
        if isinstance(payload, dict):
            for key in ("error", "message", "detail"):
                value = payload.get(key)
                if isinstance(value, str) and value.strip():
                    return value
        return fallback

    @staticmethod
    def _normalize_ids(ids: Union[Iterable[str], str]) -> List[str]:
        if isinstance(ids, str):
            candidates = [ids]
        else:
            candidates = list(ids)
        normalized = [candidate for candidate in candidates if isinstance(candidate, str) and candidate.strip()]
        if not normalized:
            raise ValueError("ids must contain at least one non-empty observation id")
        return normalized

    def health(self) -> HealthResponse:
        return cast(HealthResponse, self._request("GET", "/health"))

    def search(
        self,
        *,
        query: str,
        project: Optional[str] = None,
        limit: Optional[int] = None,
        include_private: bool = False,
        debug: bool = False,
    ) -> SearchResponse:
        payload: JsonDict = {
            "query": query,
            "project": project,
            "limit": limit,
            "include_private": include_private,
            "debug": debug,
        }
        return cast(SearchResponse, self._request("POST", "/v1/search", payload))

    def timeline(
        self, observation_id: str, *, before: int = 5, after: int = 5, include_private: bool = False
    ) -> TimelineResponse:
        return cast(
            TimelineResponse,
            self._request(
            "POST",
            "/v1/timeline",
            {
                "id": observation_id,
                "before": before,
                "after": after,
                "include_private": include_private,
            },
            ),
        )

    def get_observations(
        self, *, ids: Union[Iterable[str], str], include_private: bool = False, compact: bool = True
    ) -> GetObservationsResponse:
        normalized_ids = self._normalize_ids(ids)
        return cast(
            GetObservationsResponse,
            self._request(
            "POST",
            "/v1/observations/get",
            {
                "ids": normalized_ids,
                "include_private": include_private,
                "compact": compact,
            },
            ),
        )

    def record_event(self, event: EventEnvelope) -> WriteResponse:
        return cast(WriteResponse, self._request("POST", "/v1/events/record", {"event": event}))

    def record_checkpoint(
        self,
        *,
        session_id: str,
        title: str,
        content: str,
        platform: Optional[str] = None,
        project: Optional[str] = None,
        tags: Optional[Sequence[str]] = None,
        privacy_tags: Optional[Sequence[str]] = None,
    ) -> WriteResponse:
        return cast(
            WriteResponse,
            self._request(
            "POST",
            "/v1/checkpoints/record",
            {
                "platform": platform,
                "project": project,
                "session_id": session_id,
                "title": title,
                "content": content,
                "tags": list(tags or []),
                "privacy_tags": list(privacy_tags or []),
            },
            ),
        )

    def finalize_session(
        self,
        *,
        session_id: str,
        platform: Optional[str] = None,
        project: Optional[str] = None,
        summary_mode: str = "standard",
    ) -> FinalizeSessionResponse:
        return cast(
            FinalizeSessionResponse,
            self._request(
            "POST",
            "/v1/sessions/finalize",
            {
                "platform": platform,
                "project": project,
                "session_id": session_id,
                "summary_mode": summary_mode,
            },
            ),
        )

    def resume_pack(
        self,
        *,
        project: str,
        session_id: Optional[str] = None,
        limit: Optional[int] = None,
        include_private: bool = False,
    ) -> ResumePackResponse:
        return cast(
            ResumePackResponse,
            self._request(
            "POST",
            "/v1/resume-pack",
            {
                "project": project,
                "session_id": session_id,
                "limit": limit,
                "include_private": include_private,
            },
            ),
        )

    def run_consolidation(
        self,
        *,
        reason: str = "python-sdk",
        project: Optional[str] = None,
        session_id: Optional[str] = None,
        limit: Optional[int] = None,
    ) -> WriteResponse:
        return cast(
            WriteResponse,
            self._request(
            "POST",
            "/v1/admin/consolidation/run",
            {
                "reason": reason,
                "project": project,
                "session_id": session_id,
                "limit": limit,
            },
            ),
        )

    def consolidation_status(self) -> ConsolidationStatusResponse:
        return cast(ConsolidationStatusResponse, self._request("GET", "/v1/admin/consolidation/status"))

    def audit_log(self, *, limit: int = 50, action: Optional[str] = None, target_type: Optional[str] = None) -> AuditLogResponse:
        return cast(
            AuditLogResponse,
            self._request(
            "GET",
            "/v1/admin/audit-log",
            query={"limit": limit, "action": action, "target_type": target_type},
            ),
        )
