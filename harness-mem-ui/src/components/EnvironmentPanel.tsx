import { getUiCopy } from "../lib/i18n";
import type {
  EnvironmentItem,
  EnvironmentServerItem,
  EnvironmentSnapshot,
  EnvironmentStatus,
  UiLanguage,
} from "../lib/types";

interface EnvironmentPanelProps {
  snapshot: EnvironmentSnapshot | null;
  loading: boolean;
  error: string;
  language: UiLanguage;
  onRefresh: () => void;
}

function formatTimestamp(value: string | undefined, language: UiLanguage): string {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString(language === "ja" ? "ja-JP" : undefined);
}

function statusClass(status: EnvironmentStatus): string {
  if (status === "ok") {
    return "env-status ok";
  }
  if (status === "warning") {
    return "env-status warning";
  }
  return "env-status missing";
}

function statusLabel(status: EnvironmentStatus, language: UiLanguage): string {
  const copy = getUiCopy(language);
  if (status === "ok") {
    return copy.environment.status.ok;
  }
  if (status === "warning") {
    return copy.environment.status.warning;
  }
  return copy.environment.status.missing;
}

function renderInstalled(value: boolean | null, language: UiLanguage): string {
  if (value === true) {
    return language === "ja" ? "はい" : "yes";
  }
  if (value === false) {
    return language === "ja" ? "いいえ" : "no";
  }
  return "-";
}

function GenericItemCard(props: { item: EnvironmentItem; language: UiLanguage }) {
  const { item, language } = props;
  const copy = getUiCopy(language);

  return (
    <article className="env-card" key={item.id}>
      <div className="env-card-top">
        <h4>{item.name}</h4>
        <span className={statusClass(item.status)}>{statusLabel(item.status, language)}</span>
      </div>
      <p className="env-card-description">{item.description}</p>
      <div className="env-meta-grid">
        <span>
          <strong>{copy.environment.fieldLabels.version}:</strong> {item.version || "-"}
        </span>
        <span>
          <strong>{copy.environment.fieldLabels.installed}:</strong> {renderInstalled(item.installed, language)}
        </span>
        <span>
          <strong>{copy.environment.generatedAt}:</strong> {formatTimestamp(item.last_checked_at, language)}
        </span>
      </div>
      {item.message ? (
        <p className="env-note">
          <strong>{copy.environment.fieldLabels.message}:</strong> {item.message}
        </p>
      ) : null}
    </article>
  );
}

function ServerItemCard(props: { item: EnvironmentServerItem; language: UiLanguage }) {
  const { item, language } = props;
  const copy = getUiCopy(language);

  return (
    <article className="env-card" key={item.id}>
      <div className="env-card-top">
        <h4>{item.name}</h4>
        <span className={statusClass(item.status)}>{statusLabel(item.status, language)}</span>
      </div>
      <p className="env-card-description">{item.description}</p>
      <div className="env-meta-grid">
        <span>
          <strong>{copy.environment.fieldLabels.pid}:</strong> {item.pid ?? "-"}
        </span>
        <span>
          <strong>{copy.environment.fieldLabels.port}:</strong> {item.port ?? "-"}
        </span>
        <span>
          <strong>{copy.environment.fieldLabels.bind}:</strong> {item.bind_address || "-"}
        </span>
        <span>
          <strong>{copy.environment.fieldLabels.protocol}:</strong> {item.protocol || "-"}
        </span>
        <span>
          <strong>{copy.environment.fieldLabels.process}:</strong> {item.process_name || "-"}
        </span>
        <span>
          <strong>{copy.environment.generatedAt}:</strong> {formatTimestamp(item.last_checked_at, language)}
        </span>
      </div>
      {item.message ? (
        <p className="env-note">
          <strong>{copy.environment.fieldLabels.message}:</strong> {item.message}
        </p>
      ) : null}
    </article>
  );
}

export function EnvironmentPanel(props: EnvironmentPanelProps) {
  const { snapshot, loading, error, language, onRefresh } = props;
  const copy = getUiCopy(language);

  return (
    <section className="environment-panel">
      <div className="env-header">
        <div>
          <h2>{copy.environment.title}</h2>
          <p>{copy.environment.subtitle}</p>
        </div>
        <button type="button" onClick={onRefresh}>
          {copy.environment.refresh}
        </button>
      </div>

      {loading ? (
        <div className="loading" aria-live="polite">
          {copy.loading}
        </div>
      ) : null}
      {error ? (
        <div className="error" role="alert">
          {error}
        </div>
      ) : null}

      {!snapshot && !loading ? <div className="empty">{copy.environment.noData}</div> : null}

      {snapshot ? (
        <>
          <div className="env-stamp">
            <span>
              {copy.environment.generatedAt}: {formatTimestamp(snapshot.generated_at, language)}
            </span>
            <span>
              {copy.environment.snapshotId}: {snapshot.snapshot_id}
            </span>
          </div>

          <section className="env-summary">
            <h3>{copy.environment.summaryTitle}</h3>
            <div className="env-summary-grid">
              <article className="env-summary-card">
                <strong>{copy.environment.sections.servers.title}</strong>
                <span>{snapshot.summary.servers}</span>
              </article>
              <article className="env-summary-card">
                <strong>{copy.environment.sections.languages.title}</strong>
                <span>{snapshot.summary.languages}</span>
              </article>
              <article className="env-summary-card">
                <strong>{copy.environment.sections.cli.title}</strong>
                <span>{snapshot.summary.cli_tools}</span>
              </article>
              <article className="env-summary-card">
                <strong>{copy.environment.sections.ai.title}</strong>
                <span>{snapshot.summary.ai_tools}</span>
              </article>
            </div>
          </section>

          {snapshot.errors.length > 0 ? (
            <section className="env-errors">
              <h3>{copy.environment.errorsTitle}</h3>
              <ul>
                {snapshot.errors.map((entry, index) => (
                  <li key={`${entry.section}-${index}`}>
                    [{entry.section}] {entry.message}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="env-section">
            <h3>{copy.environment.sections.servers.title}</h3>
            <p className="env-section-description">{copy.environment.sections.servers.description}</p>
            {snapshot.servers.length === 0 ? (
              <p className="muted">{copy.environment.sections.servers.empty}</p>
            ) : (
              <div className="env-card-grid">
                {snapshot.servers.map((item) => (
                  <ServerItemCard item={item} language={language} key={item.id} />
                ))}
              </div>
            )}
          </section>

          <section className="env-section">
            <h3>{copy.environment.sections.languages.title}</h3>
            <p className="env-section-description">{copy.environment.sections.languages.description}</p>
            {snapshot.languages.length === 0 ? (
              <p className="muted">{copy.environment.sections.languages.empty}</p>
            ) : (
              <div className="env-card-grid">
                {snapshot.languages.map((item) => (
                  <GenericItemCard item={item} language={language} key={item.id} />
                ))}
              </div>
            )}
          </section>

          <section className="env-section">
            <h3>{copy.environment.sections.cli.title}</h3>
            <p className="env-section-description">{copy.environment.sections.cli.description}</p>
            {snapshot.cli_tools.length === 0 ? (
              <p className="muted">{copy.environment.sections.cli.empty}</p>
            ) : (
              <div className="env-card-grid">
                {snapshot.cli_tools.map((item) => (
                  <GenericItemCard item={item} language={language} key={item.id} />
                ))}
              </div>
            )}
          </section>

          <section className="env-section">
            <h3>{copy.environment.sections.ai.title}</h3>
            <p className="env-section-description">{copy.environment.sections.ai.description}</p>
            {snapshot.ai_tools.length === 0 ? (
              <p className="muted">{copy.environment.sections.ai.empty}</p>
            ) : (
              <div className="env-card-grid">
                {snapshot.ai_tools.map((item) => (
                  <GenericItemCard item={item} language={language} key={item.id} />
                ))}
              </div>
            )}
          </section>

          <section className="env-faq">
            <h3>{copy.environment.faqTitle}</h3>
            <div className="env-faq-list">
              {copy.environment.faq.map((entry) => (
                <article key={entry.question} className="env-faq-item">
                  <h4>{entry.question}</h4>
                  <p>{entry.answer}</p>
                </article>
              ))}
            </div>
          </section>
        </>
      ) : null}
    </section>
  );
}
