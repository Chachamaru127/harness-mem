import { useState } from "react";
import type { FeedItem } from "../lib/types";
import type { UiLanguage } from "../lib/types";

interface SessionGroupProps {
  sessionId: string | undefined;
  platform: string | undefined;
  items: FeedItem[];
  language: UiLanguage;
  children: React.ReactNode;
}

function formatSessionLabel(sessionId: string | undefined, platform: string | undefined, count: number, language: UiLanguage): string {
  const platformLabel = platform ? capitalize(platform.trim()) : "Unknown";
  const sessionLabel = sessionId ? truncateSessionId(sessionId) : "-";
  if (language === "ja") {
    return `${platformLabel} セッション ${sessionLabel} — ${count}件`;
  }
  return `${platformLabel} session ${sessionLabel} — ${count} items`;
}

function capitalize(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function truncateSessionId(sessionId: string): string {
  if (sessionId.length <= 12) return sessionId;
  return `${sessionId.slice(0, 8)}…`;
}

export function SessionGroup({ sessionId, platform, items, language, children }: SessionGroupProps) {
  const [expanded, setExpanded] = useState(false);
  const count = items.length;
  const label = formatSessionLabel(sessionId, platform, count, language);
  const headerId = `session-group-header-${sessionId ?? "unknown"}`;
  const panelId = `session-group-panel-${sessionId ?? "unknown"}`;

  return (
    <div className="session-group">
      <button
        type="button"
        id={headerId}
        className={`session-group-header${expanded ? " expanded" : ""}`}
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setExpanded((prev) => !prev)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setExpanded((prev) => !prev);
          }
        }}
      >
        <span className="session-group-toggle" aria-hidden="true">
          {expanded ? "▼" : "▶"}
        </span>
        <span className="session-group-label">{label}</span>
      </button>
      {expanded ? (
        <div
          id={panelId}
          role="region"
          aria-labelledby={headerId}
          className="session-group-items"
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}
