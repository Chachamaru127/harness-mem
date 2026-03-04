import { useCallback, useState } from "react";
import { fetchSessionReplay, fetchSessionsList } from "../lib/api";
import { getUiCopy } from "../lib/i18n";
import type { ReplayEvent, UiLanguage } from "../lib/types";

interface SessionReplayPanelProps {
  language: UiLanguage;
  project?: string;
  includePrivate?: boolean;
}

interface SessionOption {
  session_id: string;
  platform: string;
  project: string;
  updated_at?: string;
}

function formatTimestamp(ts: string, language: UiLanguage): string {
  try {
    const date = new Date(ts);
    return date.toLocaleString(language === "ja" ? "ja-JP" : undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return ts;
  }
}

function formatElapsed(startTs: string, currentTs: string): string {
  const start = new Date(startTs).getTime();
  const current = new Date(currentTs).getTime();
  const diff = current - start;
  if (Number.isNaN(diff) || diff < 0) return "";
  if (diff < 1000) return `${diff}ms`;
  if (diff < 60000) return `${(diff / 1000).toFixed(1)}s`;
  return `${Math.floor(diff / 60000)}m ${Math.floor((diff % 60000) / 1000)}s`;
}

function eventTypeIcon(eventType: string): string {
  if (eventType === "user_prompt") return "\u25B6";       // ▶
  if (eventType === "assistant_message") return "\u25C0";  // ◀
  if (eventType === "tool_use") return "\u2699";           // ⚙
  if (eventType === "checkpoint") return "\u2714";         // ✔
  return "\u25CF";                                          // ●
}

function eventTypeClass(eventType: string): string {
  if (eventType === "user_prompt") return "replay-event replay-prompt";
  if (eventType === "assistant_message") return "replay-event replay-response";
  if (eventType === "tool_use") return "replay-event replay-tool";
  if (eventType === "checkpoint") return "replay-event replay-checkpoint";
  return "replay-event replay-other";
}

function extractContent(payload: Record<string, unknown>): string {
  if (typeof payload.prompt === "string") return payload.prompt;
  if (typeof payload.content === "string") return payload.content;
  if (typeof payload.tool_name === "string") return `Tool: ${payload.tool_name}`;
  if (typeof payload.last_agent_message === "string") return payload.last_agent_message;
  return "";
}

function extractMeta(payload: Record<string, unknown>): { tokens?: string; cost?: string; model?: string } {
  const usage = payload.usage as Record<string, unknown> | undefined;
  const cost = payload.cost as Record<string, unknown> | undefined;
  const result: { tokens?: string; cost?: string; model?: string } = {};

  if (usage) {
    const input = Number(usage.input_tokens || 0);
    const output = Number(usage.output_tokens || 0);
    if (input + output > 0) {
      result.tokens = `${input}/${output}`;
    }
  }
  if (cost && typeof cost.total_cost === "number" && cost.total_cost > 0) {
    result.cost = `$${(cost.total_cost as number).toFixed(4)}`;
  }
  if (typeof payload.model === "string") {
    result.model = payload.model;
  }
  return result;
}

export function SessionReplayPanel({ language, project, includePrivate }: SessionReplayPanelProps) {
  const copy = getUiCopy(language);
  const [sessionId, setSessionId] = useState("");
  const [sessions, setSessions] = useState<SessionOption[]>([]);
  const [events, setEvents] = useState<ReplayEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [sessionsLoaded, setSessionsLoaded] = useState(false);
  const [activeStep, setActiveStep] = useState<number | null>(null);

  const loadSessions = useCallback(async () => {
    try {
      const response = await fetchSessionsList({
        project: project === "__all__" ? undefined : project,
        limit: 50,
        includePrivate,
      });
      if (response.ok && Array.isArray(response.items)) {
        setSessions(
          response.items.map((item) => ({
            session_id: String((item as Record<string, unknown>).session_id || ""),
            platform: String((item as Record<string, unknown>).platform || ""),
            project: String((item as Record<string, unknown>).project || ""),
            updated_at: typeof (item as Record<string, unknown>).updated_at === "string"
              ? (item as Record<string, unknown>).updated_at as string
              : undefined,
          }))
        );
      }
      setSessionsLoaded(true);
    } catch {
      // ignore - sessions list is optional
      setSessionsLoaded(true);
    }
  }, [project, includePrivate]);

  const loadReplay = useCallback(async (targetSessionId: string) => {
    if (!targetSessionId.trim()) return;
    setLoading(true);
    setError("");
    setEvents([]);
    setActiveStep(null);
    try {
      const response = await fetchSessionReplay({ sessionId: targetSessionId.trim() });
      if (response.ok) {
        setEvents(response.items);
      } else {
        setError(response.error || "Failed to load replay");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  // Load sessions on first render
  if (!sessionsLoaded) {
    void loadSessions();
  }

  const firstTs = events.length > 0 ? events[0].ts : "";

  return (
    <div className="replay-panel">
      <div className="replay-header">
        <div>
          <h2 className="panel-title">{copy.replay.title}</h2>
          <p className="panel-subtitle">{copy.replay.subtitle}</p>
        </div>
      </div>

      {/* Session Selector */}
      <div className="replay-selector">
        <div className="replay-input-row">
          <input
            type="text"
            className="replay-session-input"
            value={sessionId}
            onChange={(e) => setSessionId(e.target.value)}
            placeholder={copy.replay.sessionIdPlaceholder}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                void loadReplay(sessionId);
              }
            }}
          />
          <button
            type="button"
            className="replay-load-btn"
            onClick={() => void loadReplay(sessionId)}
            disabled={loading || !sessionId.trim()}
          >
            {copy.replay.loadSession}
          </button>
        </div>

        {/* Recent sessions */}
        {sessions.length > 0 && (
          <div className="replay-sessions-list">
            {sessions.map((s) => (
              <button
                key={s.session_id}
                type="button"
                className={`replay-session-chip ${sessionId === s.session_id ? "active" : ""}`}
                onClick={() => {
                  setSessionId(s.session_id);
                  void loadReplay(s.session_id);
                }}
              >
                <span className="replay-chip-platform">{s.platform}</span>
                <span className="replay-chip-id">{s.session_id.slice(0, 12)}...</span>
                {s.updated_at && (
                  <span className="replay-chip-time">{formatTimestamp(s.updated_at, language)}</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Error */}
      {error && <p className="replay-error">{error}</p>}

      {/* Loading */}
      {loading && <p className="replay-loading">{copy.loading}</p>}

      {/* Event count */}
      {events.length > 0 && (
        <p className="replay-count">{events.length} {copy.replay.eventCount}</p>
      )}

      {/* No data */}
      {!loading && !error && events.length === 0 && sessionId && (
        <p className="replay-empty">{copy.replay.noEvents}</p>
      )}

      {/* Timeline */}
      {events.length > 0 && (
        <div className="replay-timeline">
          {events.map((event, index) => {
            const meta = extractMeta(event.payload);
            const content = extractContent(event.payload);
            const isExpanded = activeStep === index;

            return (
              <div key={event.event_id || index} className={eventTypeClass(event.event_type)}>
                <button
                  type="button"
                  className="replay-event-header"
                  onClick={() => setActiveStep(isExpanded ? null : index)}
                  aria-expanded={isExpanded}
                >
                  <span className="replay-event-icon">{eventTypeIcon(event.event_type)}</span>
                  <span className="replay-event-type">{event.event_type}</span>
                  <span className="replay-event-time">{formatTimestamp(event.ts, language)}</span>
                  {firstTs && (
                    <span className="replay-event-elapsed">+{formatElapsed(firstTs, event.ts)}</span>
                  )}
                  {meta.model && <span className="replay-event-model">{meta.model}</span>}
                  {meta.tokens && (
                    <span className="replay-event-tokens">{meta.tokens} {copy.replay.tokens}</span>
                  )}
                  {meta.cost && (
                    <span className="replay-event-cost">{meta.cost}</span>
                  )}
                </button>
                {isExpanded && content && (
                  <div className="replay-event-body">
                    <pre className="replay-event-content">{content}</pre>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
