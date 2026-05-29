#!/usr/bin/env python3
"""Irreversible PII masking for real-data benchmark pipeline.

Uses Presidio when installed; falls back to regex-only masking for CI/minimal env.
Mapping tables are never persisted (in-memory only, discarded after each run).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

# ---------------------------------------------------------------------------
# Regex fallback (always available)
# ---------------------------------------------------------------------------

EMAIL_RE = re.compile(r"\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b", re.I)
PHONE_RE = re.compile(r"\b(?:\+?\d{1,3}[-.\s]?)?(?:\(?\d{2,4}\)?[-.\s]?)?\d{3,4}[-.\s]?\d{3,4}\b")
API_KEY_RE = re.compile(r"\b(?:sk|rk|pk)-[A-Za-z0-9]{8,}\b|\bxox[baprs]-[A-Za-z0-9-]{8,}\b", re.I)
ABS_PATH_RE = re.compile(r"/Users/[A-Za-z0-9._\-\[\]]+(?:/[A-Za-z0-9._\-\[\]]+)*")
SECRET_RE = re.compile(
    r"\b(?:api[-_ ]?key|token|secret|password|bearer)\s*[:=]\s*[^\s,;]+",
    re.I,
)
HEX_SECRET_RE = re.compile(r"\b[0-9a-f]{32,}\b", re.I)

# Japanese person-name heuristic (Kanji/Katakana 2-4 chars + optional suffix)
JA_NAME_RE = re.compile(r"(?:[一-龯ぁ-んァ-ン]{2,4})(?:さん|様|氏|くん|ちゃん)?")


@dataclass
class MaskCounters:
    person: int = 0
    email: int = 0
    phone: int = 0
    api_key: int = 0
    path: int = 0
    secret: int = 0

    def next_token(self, kind: str) -> str:
        if kind == "PERSON":
            self.person += 1
            return f"[PERSON_{self.person}]"
        if kind == "EMAIL":
            self.email += 1
            return f"[EMAIL_{self.email}]"
        if kind == "PHONE":
            self.phone += 1
            return f"[PHONE_{self.phone}]"
        if kind == "API_KEY":
            self.api_key += 1
            return f"[API_KEY_{self.api_key}]"
        if kind == "PATH":
            self.path += 1
            return f"[PATH_{self.path}]"
        if kind == "SECRET":
            self.secret += 1
            return f"[SECRET_{self.secret}]"
        return "[REDACTED]"


class IrreversibleMasker:
    """Mask PII with consistent token replacement. No mapping persistence."""

    def __init__(self) -> None:
        self._entity_map: Dict[str, str] = {}
        self._counters = MaskCounters()
        self._presidio_available = False
        self._analyzer = None
        self._anonymizer = None
        try:
            from presidio_analyzer import AnalyzerEngine  # type: ignore
            from presidio_anonymizer import AnonymizerEngine  # type: ignore
            from presidio_anonymizer.entities import OperatorConfig  # type: ignore

            self._analyzer = AnalyzerEngine()
            self._anonymizer = AnonymizerEngine()
            self._OperatorConfig = OperatorConfig
            self._presidio_available = True
        except ImportError:
            pass

    def _consistent_token(self, kind: str, value: str) -> str:
        key = f"{kind}:{value.lower()}"
        if key not in self._entity_map:
            self._entity_map[key] = self._counters.next_token(kind)
        return self._entity_map[key]

    def _regex_mask(self, text: str) -> str:
        def sub_re(pattern: re.Pattern[str], kind: str, s: str) -> str:
            def repl(m: re.Match[str]) -> str:
                return self._consistent_token(kind, m.group(0))

            return pattern.sub(repl, s)

        out = text
        # Replace /Users/... paths including partial paths after Presidio person tokenization
        out = re.sub(r"/Users/(?:[A-Za-z0-9._\-\[\]]+/)*[A-Za-z0-9._\-\[\]]+", lambda m: self._consistent_token("PATH", m.group(0)), out)
        out = sub_re(ABS_PATH_RE, "PATH", out)
        out = sub_re(API_KEY_RE, "API_KEY", out)
        out = sub_re(SECRET_RE, "SECRET", out)
        out = sub_re(HEX_SECRET_RE, "SECRET", out)
        out = sub_re(EMAIL_RE, "EMAIL", out)
        out = sub_re(PHONE_RE, "PHONE", out)
        # JA names: only when surrounded by context suggesting a name
        for m in JA_NAME_RE.finditer(out):
            span = m.group(0)
            if span.endswith(("さん", "様", "氏", "くん", "ちゃん")):
                token = self._consistent_token("PERSON", span)
                out = out.replace(span, token, 1)
        return out

    def mask(self, text: str, language: str = "ja") -> str:
        if not text:
            return text

        if self._presidio_available and self._analyzer and self._anonymizer:
            try:
                results = self._analyzer.analyze(
                    text=text,
                    language="en" if language == "en" else "en",
                    entities=[
                        "PERSON",
                        "EMAIL_ADDRESS",
                        "PHONE_NUMBER",
                        "CREDIT_CARD",
                        "IP_ADDRESS",
                        "URL",
                        "US_SSN",
                    ],
                )
                operators = {}
                for r in results:
                    entity = r.entity_type
                    kind = {
                        "PERSON": "PERSON",
                        "EMAIL_ADDRESS": "EMAIL",
                        "PHONE_NUMBER": "PHONE",
                    }.get(entity, "SECRET")
                    slice_text = text[r.start : r.end]
                    token = self._consistent_token(kind, slice_text)
                    operators[r.entity_type] = self._OperatorConfig(
                        "replace", {"new_value": token}
                    )
                if results:
                    anonymized = self._anonymizer.anonymize(
                        text=text,
                        analyzer_results=results,
                        operators=operators,
                    )
                    text = anonymized.text
            except Exception:
                pass

        return self._regex_mask(text)

    def discard_mapping(self) -> None:
        """Explicitly destroy in-memory entity map (irreversibility)."""
        self._entity_map.clear()


def mask_text(text: str, language: str = "ja") -> str:
    masker = IrreversibleMasker()
    result = masker.mask(text, language)
    masker.discard_mapping()
    return result


def scan_for_leaks(text: str) -> List[str]:
    """Return list of leak patterns found (empty = clean)."""
    leaks: List[str] = []
    if EMAIL_RE.search(text):
        leaks.append("email")
    if API_KEY_RE.search(text):
        leaks.append("api_key")
    if ABS_PATH_RE.search(text):
        leaks.append("absolute_path")
    if SECRET_RE.search(text):
        leaks.append("secret")
    return leaks
