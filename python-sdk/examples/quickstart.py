#!/usr/bin/env python3
from __future__ import annotations

import os
import sys
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from harness_mem.client import HarnessMemClient


def main() -> None:
    client = HarnessMemClient(base_url=os.getenv("HARNESS_MEM_BASE_URL", "http://127.0.0.1:37888"))
    session_id = f"python-quickstart-{uuid.uuid4().hex[:8]}"
    project = "python-quickstart"

    health = client.health()
    print("health ok:", health.get("ok"))

    checkpoint = client.record_checkpoint(
        session_id=session_id,
        title="quickstart-checkpoint",
        content="quickstart event from python sdk",
        platform="codex",
        project=project,
        tags=["quickstart"],
        privacy_tags=[],
    )
    print("checkpoint ok:", checkpoint.get("ok"))

    search = client.search(query="quickstart event", project=project, limit=5, include_private=True)
    print("search hits:", len(search.get("items", [])))

    if search.get("items"):
        observation_id = search["items"][0]["id"]
        timeline = client.timeline(observation_id, before=1, after=1, include_private=True)
        print("timeline items:", len(timeline.get("items", [])))

        details = client.get_observations(ids=observation_id, include_private=True, compact=False)
        print("details items:", len(details.get("items", [])))

    finalized = client.finalize_session(
        session_id=session_id,
        platform="codex",
        project=project,
        summary_mode="standard",
    )
    summary = ""
    if finalized.get("items"):
        summary = finalized["items"][0].get("summary", "")
    print("finalize ok:", finalized.get("ok"), "summary preview:", summary[:80])


if __name__ == "__main__":
    main()
