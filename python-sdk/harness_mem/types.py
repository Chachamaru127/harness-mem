from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional, TypedDict


class TokenEstimateMeta(TypedDict, total=False):
    input_tokens: int
    output_tokens: int
    total_tokens: int
    strategy: str
    model: str


class ApiMeta(TypedDict, total=False):
    count: int
    latency_ms: int
    filters: Dict[str, Any]
    ranking: str
    token_estimate: TokenEstimateMeta
    warnings: List[str]


class ObservationItem(TypedDict, total=False):
    id: str
    event_id: str
    platform: str
    project: str
    session_id: str
    title: str
    content: str
    created_at: str
    updated_at: str
    tags: List[str]
    privacy_tags: List[str]
    similarity: float
    recency: float
    hybrid_score: float
    rerank_score: float


class SessionFinalizeItem(TypedDict, total=False):
    session_id: str
    summary_mode: str
    summary: str
    finalized_at: str


class AuditLogItem(TypedDict, total=False):
    id: int
    action: str
    target_type: str
    target_id: str
    details_json: str
    created_at: str


class ApiResponse(TypedDict, total=False):
    ok: bool
    source: Literal["core", "merged"]
    items: List[Dict[str, Any]]
    meta: ApiMeta
    error: str


class HealthResponse(ApiResponse, total=False):
    items: List[Dict[str, Any]]


class SearchResponse(ApiResponse, total=False):
    items: List[ObservationItem]


class TimelineResponse(ApiResponse, total=False):
    items: List[ObservationItem]


class GetObservationsResponse(ApiResponse, total=False):
    items: List[ObservationItem]


class WriteResponse(ApiResponse, total=False):
    items: List[ObservationItem]


class FinalizeSessionResponse(ApiResponse, total=False):
    items: List[SessionFinalizeItem]


class ResumePackResponse(ApiResponse, total=False):
    items: List[ObservationItem]


class ConsolidationStatusResponse(ApiResponse, total=False):
    items: List[Dict[str, Any]]


class AuditLogResponse(ApiResponse, total=False):
    items: List[AuditLogItem]


class EventEnvelope(TypedDict, total=False):
    event_id: str
    platform: str
    project: str
    session_id: str
    event_type: str
    payload: Dict[str, Any]
    tags: List[str]
    privacy_tags: List[str]
    ts: str


JsonDict = Dict[str, Any]
OptionalJsonDict = Optional[JsonDict]
