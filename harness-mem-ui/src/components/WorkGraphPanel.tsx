import { useEffect, useMemo, useState } from "react";
import { fetchWorkQuery } from "../lib/api";
import type { WorkProvenance, WorkQueryItem, WorkQueryMode, WorkReason } from "../lib/types";

interface WorkGraphPanelProps {
  project?: string;
}

interface WorkGraphState {
  next: WorkQueryItem[];
  ready: WorkQueryItem[];
  blocked: WorkQueryItem[];
}

const EMPTY_STATE: WorkGraphState = {
  next: [],
  ready: [],
  blocked: [],
};

function reasonLabel(reason: WorkReason): string {
  if (reason.relatedWorkId) {
    return `${reason.code}: ${reason.relatedWorkId}`;
  }
  if (reason.lease?.agentId) {
    return `${reason.code}: ${reason.lease.agentId}`;
  }
  return reason.message || reason.code;
}

function provenanceCount(provenance?: WorkProvenance): number {
  return (provenance?.links?.length ?? 0) + (provenance?.events?.length ?? 0);
}

function WorkItemCard({ item, tone }: { item: WorkQueryItem; tone: "next" | "ready" | "blocked" | "claimed" }) {
  const reasons = item.reasons ?? [];
  const provenance = item.provenance ?? { links: [], events: [] };
  return (
    <article className={`workgraph-card ${tone}`} data-work-id={item.work_id}>
      <div className="workgraph-card-top">
        <div>
          <div className="workgraph-id">{item.work_id}</div>
          <h3>{item.title || item.work_id}</h3>
        </div>
        <div className="workgraph-badges">
          {typeof item.score === "number" ? <span>score {item.score}</span> : null}
          {item.status ? <span>{item.status}</span> : null}
          {item.assignee ? <span>{item.assignee}</span> : null}
        </div>
      </div>

      {reasons.length > 0 ? (
        <div className="workgraph-reasons" aria-label={`Reasons for ${item.work_id}`}>
          <strong>{tone === "next" ? "Injection reason" : "Reasons"}</strong>
          <ul>
            {reasons.slice(0, 4).map((reason, index) => (
              <li key={`${reason.code}-${index}`}>{reasonLabel(reason)}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="workgraph-provenance" aria-label={`Provenance for ${item.work_id}`}>
        <strong>Provenance</strong>
        {provenanceCount(provenance) === 0 ? (
          <span className="workgraph-muted">no evidence links yet</span>
        ) : (
          <div className="workgraph-chips">
            {provenance.links.slice(0, 3).map((link) => (
              <span key={`${link.target_type}-${link.target_id}-${link.relation}`}>
                {link.relation}:{link.target_type}
              </span>
            ))}
            {provenance.events.slice(0, 3).map((event, index) => (
              <span key={`${event.event_type}-${event.created_at ?? index}`}>
                event:{event.event_type}
              </span>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}

async function loadMode(project: string, mode: WorkQueryMode): Promise<WorkQueryItem[]> {
  const response = await fetchWorkQuery({ project, mode, limit: mode === "next" ? 3 : 25 });
  return response.ok ? response.items : [];
}

export function WorkGraphPanel({ project }: WorkGraphPanelProps) {
  const [state, setState] = useState<WorkGraphState>(EMPTY_STATE);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!project) {
      setState(EMPTY_STATE);
      setLoading(false);
      setError("");
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError("");
    void (async () => {
      try {
        const [next, ready, blocked] = await Promise.all([
          loadMode(project, "next"),
          loadMode(project, "ready"),
          loadMode(project, "blocked"),
        ]);
        if (!cancelled) {
          setState({ next, ready, blocked });
        }
      } catch (errorInput) {
        if (!cancelled) {
          const message = errorInput instanceof Error ? errorInput.message : String(errorInput);
          setError(message);
          setState(EMPTY_STATE);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [project]);

  const claimed = useMemo(
    () => state.blocked.filter((item) => item.assignee || (item.reasons ?? []).some((reason) => reason.code === "leased")),
    [state.blocked]
  );

  if (!project) {
    return (
      <section className="workgraph-panel" aria-label="WorkGraph">
        <div className="workgraph-empty">WorkGraph disabled for all-project view.</div>
      </section>
    );
  }

  return (
    <section className="workgraph-panel" aria-label="WorkGraph">
      <div className="workgraph-header">
        <div>
          <h2>WorkGraph</h2>
          <p>{project}</p>
        </div>
        <span className={`workgraph-status ${error ? "error" : "ok"}`}>
          {loading ? "loading" : error ? "unavailable" : "ready"}
        </span>
      </div>

      {error ? <div className="workgraph-error">WorkGraph disabled or unavailable: {error}</div> : null}

      <div className="workgraph-grid">
        <section className="workgraph-section" aria-label="Next work">
          <h3>Next</h3>
          {state.next.length === 0 ? (
            <div className="workgraph-empty">{loading ? "Loading next work..." : "No next work"}</div>
          ) : (
            state.next.map((item) => <WorkItemCard key={`next-${item.work_id}`} item={item} tone="next" />)
          )}
        </section>

        <section className="workgraph-section" aria-label="Ready work">
          <h3>Ready</h3>
          {state.ready.length === 0 ? (
            <div className="workgraph-empty">{loading ? "Loading ready work..." : "No ready work"}</div>
          ) : (
            state.ready.map((item) => <WorkItemCard key={`ready-${item.work_id}`} item={item} tone="ready" />)
          )}
        </section>

        <section className="workgraph-section" aria-label="Blocked work">
          <h3>Blocked</h3>
          {state.blocked.length === 0 ? (
            <div className="workgraph-empty">{loading ? "Loading blocked work..." : "No blocked work"}</div>
          ) : (
            state.blocked.map((item) => <WorkItemCard key={`blocked-${item.work_id}`} item={item} tone="blocked" />)
          )}
        </section>

        <section className="workgraph-section" aria-label="Claimed work">
          <h3>Claimed</h3>
          {claimed.length === 0 ? (
            <div className="workgraph-empty">{loading ? "Loading claimed work..." : "No claimed work"}</div>
          ) : (
            claimed.map((item) => <WorkItemCard key={`claimed-${item.work_id}`} item={item} tone="claimed" />)
          )}
        </section>
      </div>
    </section>
  );
}
