import { getUiCopy } from "../lib/i18n";
import type { UiLanguage } from "../lib/types";

export const ROUTECLI_DASHBOARD_URL = "http://127.0.0.1:8765/";

interface EnvironmentPanelProps {
  language: UiLanguage;
}

export function EnvironmentPanel(props: EnvironmentPanelProps) {
  const copy = getUiCopy(props.language).environment;
  return (
    <section className="environment-panel" aria-label={copy.title}>
      <h2>{copy.title}</h2>
      <p>{copy.body}</p>
      <p>
        <a href={ROUTECLI_DASHBOARD_URL} target="_blank" rel="noreferrer">
          {copy.linkLabel}
        </a>
      </p>
      <p>{copy.versionsHint}</p>
    </section>
  );
}
