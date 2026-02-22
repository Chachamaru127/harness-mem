from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Optional


class HarnessMemError(Exception):
    """Base SDK error."""


@dataclass
class HarnessMemTransportError(HarnessMemError):
    message: str

    def __str__(self) -> str:  # pragma: no cover
        return self.message


@dataclass
class HarnessMemAPIError(HarnessMemError):
    status_code: int
    message: str
    response_body: Optional[Dict[str, Any]] = None

    def __str__(self) -> str:  # pragma: no cover
        return f"HarnessMemAPIError(status={self.status_code}, message={self.message})"
