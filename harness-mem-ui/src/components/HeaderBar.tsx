import { getUiCopy } from "../lib/i18n";
import type { UiLanguage } from "../lib/types";

interface HeaderBarProps {
  connected: boolean;
  streamError: string;
  healthLabel: string;
  healthDegraded: boolean;
  onRefresh: () => void;
  onOpenSettings: () => void;
  language: UiLanguage;
}

export function HeaderBar(props: HeaderBarProps) {
  const { connected, streamError, healthLabel, healthDegraded, onRefresh, onOpenSettings, language } = props;
  const copy = getUiCopy(language);

  return (
    <header className="header">
      <div className="title-block">
        <h1>{copy.appTitle}</h1>
        <p>{copy.appSubtitle}</p>
      </div>

      <div className="status-row" role="status" aria-live="polite">
        <span className={`dot ${connected ? "ok" : "ng"}`} aria-hidden="true" />
        <span className="sr-only">{connected ? copy.streamConnected : copy.streamDisconnected}</span>
        <span className={`status-label ${healthDegraded ? "degraded" : ""}`}>{healthLabel}</span>
        {streamError ? <span className="stream-error">{streamError}</span> : null}
      </div>

      <div className="controls">
        <button type="button" className="ghost" onClick={onOpenSettings}>
          {copy.settingsButton}
        </button>
        <button type="button" onClick={onRefresh}>
          {copy.refreshButton}
        </button>
      </div>
    </header>
  );
}
