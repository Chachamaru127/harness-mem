import { useEffect, useMemo, useState } from "react";
import type { SessionListItem, SessionThreadItem } from "../lib/types";

interface SessionPanelProps {
  includePrivate: boolean;
  selectedProject: string;
  metricsItem: Record<string, unknown> | null;
  onResume: (payload: Record<string, unknown>) => Promise<Array<Record<string, unknown>>>;
  onSessionsList: (payload: Record<string, unknown>) => Promise<Array<Record<string, unknown>>>;
  onSessionThread: (payload: Record<string, unknown>) => Promise<Array<Record<string, unknown>>>;
}

export function SessionPanel(props: SessionPanelProps) {
  const { includePrivate, selectedProject, metricsItem, onResume, onSessionsList, onSessionThread } = props;
  const [project, setProject] = useState(selectedProject === "__all__" ? "" : selectedProject);
  const [sessionId, setSessionId] = useState("");
  const [limit, setLimit] = useState(5);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [sessions, setSessions] = useState<SessionListItem[]>([]);
  const [threadItems, setThreadItems] = useState<SessionThreadItem[]>([]);

  useEffect(() => {
    if (selectedProject !== "__all__") {
      setProject(selectedProject);
    }
  }, [selectedProject]);

  const metricsText = useMemo(() => {
    if (!metricsItem) {
      return "metrics unavailable";
    }
    return JSON.stringify(metricsItem, null, 2);
  }, [metricsItem]);

  const metricsSummary = useMemo(() => {
    if (!metricsItem) {
      return "observations: - / vectors: - / retry_queue: -";
    }
    const coverage = (metricsItem.coverage || {}) as Record<string, unknown>;
    const retry = (metricsItem.retry_queue || {}) as Record<string, unknown>;
    return `observations: ${String(coverage.observations ?? "-")} / vectors: ${String(coverage.mem_vectors ?? "-")} / retry_queue: ${String(retry.count ?? "-")}`;
  }, [metricsItem]);

  const run = async () => {
    if (!project.trim()) {
      setError("project is required for resume pack");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const result = await onResume({
        project,
        session_id: sessionId || undefined,
        limit,
        include_private: includePrivate,
      });
      setItems(result);
    } catch (errorInput) {
      setError(errorInput instanceof Error ? errorInput.message : String(errorInput));
    } finally {
      setLoading(false);
    }
  };

  const loadSessions = async () => {
    setLoading(true);
    setError("");
    try {
      const result = await onSessionsList({
        project: project || undefined,
        include_private: includePrivate,
        limit: 100,
      });
      const filtered = (result as unknown as SessionListItem[]).filter(
        (session) => (session.platform || "").toLowerCase() !== "antigravity"
      );
      setSessions(filtered);
    } catch (errorInput) {
      setError(errorInput instanceof Error ? errorInput.message : String(errorInput));
      setSessions([]);
    } finally {
      setLoading(false);
    }
  };

  const loadThread = async (targetSessionId: string) => {
    setLoading(true);
    setError("");
    try {
      const result = await onSessionThread({
        session_id: targetSessionId,
        project: project || undefined,
        include_private: includePrivate,
        limit: 500,
      });
      setSessionId(targetSessionId);
      setThreadItems(result as unknown as SessionThreadItem[]);
    } catch (errorInput) {
      setError(errorInput instanceof Error ? errorInput.message : String(errorInput));
      setThreadItems([]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="panel-block">
      <form
        className="row"
        onSubmit={(event) => {
          event.preventDefault();
          void run();
        }}
      >
        <label htmlFor="session-project" className="sr-only">Project</label>
        <input
          id="session-project"
          aria-label="Project"
          value={project}
          placeholder="project"
          onChange={(event) => setProject(event.target.value)}
        />
        <label htmlFor="session-id" className="sr-only">Session id</label>
        <input
          id="session-id"
          aria-label="Session id (optional)"
          value={sessionId}
          placeholder="session_id (optional)"
          onChange={(event) => setSessionId(event.target.value)}
        />
        <label htmlFor="session-limit" className="sr-only">Resume pack limit</label>
        <input
          id="session-limit"
          aria-label="Resume pack limit"
          type="number"
          value={limit}
          min={1}
          max={20}
          onChange={(event) => setLimit(Math.max(1, Math.min(20, Number(event.target.value || 5))))}
        />
        <button type="submit">
          resume pack
        </button>
        <button
          type="button"
          onClick={() => {
            void loadSessions();
          }}
        >
          sessions
        </button>
      </form>

      <section className="session-metrics">
        <h3>Metrics</h3>
        <p className="muted">{metricsSummary}</p>
        <pre>{metricsText}</pre>
      </section>

      {loading ? <div className="loading" aria-live="polite">Loading session data...</div> : null}
      {error ? <div className="error" role="alert">{error}</div> : null}

      <section className="session-list">
        <h3>Session List</h3>
        {sessions.length === 0 ? <p className="muted">No sessions loaded.</p> : null}
        {sessions.map((session) => (
          <article key={session.session_id} className="feed-card compact">
            <h3>{session.session_id}</h3>
            <p>{session.summary ? String(session.summary).slice(0, 240) : "no summary"}</p>
            <div className="card-meta">
              <span>{session.project}</span>
              <span>{session.platform}</span>
              <span>{session.last_event_at || session.updated_at || "-"}</span>
            </div>
            <div className="card-meta">
              <span>
                obs:{session.counts?.observations ?? 0} / tool:{session.counts?.tools ?? 0} / prompt:{session.counts?.prompts ?? 0}
              </span>
            </div>
            <div className="card-actions">
              <button type="button" onClick={() => void loadThread(session.session_id)}>thread</button>
            </div>
          </article>
        ))}
      </section>

      <section className="session-thread">
        <h3>Session Thread</h3>
        {threadItems.length === 0 ? <p className="muted">Select a session to view its timeline.</p> : null}
        {threadItems.map((item) => (
          <article key={item.id} className="feed-card compact">
            <div className="card-top">
              <span className="card-type">{item.event_type}</span>
              <span className="card-time">{item.created_at || "-"}</span>
            </div>
            <h3>{item.step}. {item.title || item.id}</h3>
            <p>{item.content || ""}</p>
          </article>
        ))}
      </section>

      <div className="feed-list">
        {items.map((item) => (
          <article key={String(item.id || item.session_id || JSON.stringify(item))} className="feed-card compact">
            <h3>{String(item.title || item.session_id || "session item")}</h3>
            <p>{String(item.content || item.summary || "")}</p>
            <div className="card-meta">
              <span>{String(item.project || "-")}</span>
              <span>{String(item.session_id || "-")}</span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
