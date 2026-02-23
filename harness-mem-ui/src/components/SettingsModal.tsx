import { useEffect, useMemo, useState } from "react";
import { getUiCopy } from "../lib/i18n";
import { buildProjectDisplayNameMap, getProjectDisplayName } from "../lib/project-label";
import type { FeedItem, ProjectsStatsItem, UiPlatformFilter, UiSettings } from "../lib/types";

interface SettingsModalProps {
  open: boolean;
  settings: UiSettings;
  projects: ProjectsStatsItem[];
  previewItem: FeedItem | null;
  onClose: () => void;
  onSave: (next: UiSettings) => void;
}

interface PlatformOption {
  id: UiPlatformFilter;
  label: string;
}

function platformOptions(allLabel: string): PlatformOption[] {
  return [
    { id: "__all__", label: allLabel },
    { id: "claude", label: "Claude" },
    { id: "codex", label: "Codex" },
    { id: "opencode", label: "OpenCode" },
    { id: "cursor", label: "Cursor" },
  ];
}

function clampPageSize(input: number): number {
  if (!Number.isFinite(input)) {
    return 40;
  }
  return Math.max(10, Math.min(100, Math.trunc(input)));
}

function formatPreviewDate(value: string | undefined, language: UiSettings["language"]): string {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString(language === "ja" ? "ja-JP" : undefined);
}

export function SettingsModal(props: SettingsModalProps) {
  const { open, settings, projects, previewItem, onClose, onSave } = props;
  const [draft, setDraft] = useState<UiSettings>(settings);

  useEffect(() => {
    if (open) {
      setDraft(settings);
    }
  }, [open, settings]);

  useEffect(() => {
    if (!open) {
      return;
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  const projectOptions = useMemo(() => {
    const values = new Set<string>(["__all__", ...projects.map((project) => project.project), draft.selectedProject]);
    return Array.from(values);
  }, [projects, draft.selectedProject]);
  const projectLabelMap = useMemo(
    () => buildProjectDisplayNameMap(projectOptions.filter((project) => project !== "__all__")),
    [projectOptions]
  );

  if (!open) {
    return null;
  }

  const copy = getUiCopy(draft.language);
  const options = platformOptions(copy.previewAllProjects);
  const previewTitle = previewItem?.title || copy.previewEmptyTitle;
  const previewContent = previewItem?.content || copy.previewEmptyContent;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-label={copy.settingsTitle}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="settings-modal-header">
          <div className="settings-modal-title">
            <h2>{copy.settingsTitle}</h2>
            <p>{copy.settingsSubtitle}</p>
          </div>
          <div className="settings-modal-actions">
            <label htmlFor="settings-project-preview">
              {copy.previewFor}
              <select
                id="settings-project-preview"
                aria-label={copy.previewProjectAria}
                value={draft.selectedProject}
                onChange={(event) => setDraft((prev) => ({ ...prev, selectedProject: event.target.value }))}
              >
                {projectOptions.map((project) => (
                  <option key={project} value={project}>
                    {project === "__all__" ? copy.previewAllProjects : getProjectDisplayName(project, projectLabelMap)}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="icon-close" onClick={onClose} aria-label={copy.closeSettingsAria}>
              ×
            </button>
          </div>
        </header>

        <div className="settings-modal-body">
          <section className="preview-pane">
            <div className="preview-shell">
              <div className="preview-shell-header">
                <span className="preview-dot red" />
                <span className="preview-dot yellow" />
                <span className="preview-dot green" />
              </div>
              <div className="preview-shell-body">
                <p className="preview-title">
                  [
                  {draft.selectedProject === "__all__"
                    ? copy.previewAllProjects
                    : getProjectDisplayName(draft.selectedProject, projectLabelMap)}
                  ] {copy.previewLatestContext}
                </p>
                <h3>{previewTitle}</h3>
                <p>{previewContent}</p>
                <p className="preview-meta">{formatPreviewDate(previewItem?.created_at, draft.language)}</p>
              </div>
            </div>
          </section>

          <section className="settings-column">
            <div className="settings-card">
              <h3>{copy.loadingSection}</h3>
              <p className="section-help">{copy.loadingHelp}</p>
              <label>
                {copy.observations}
                <input
                  type="number"
                  min={10}
                  max={100}
                  step={5}
                  value={draft.pageSize}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    setDraft((prev) => ({ ...prev, pageSize: clampPageSize(value) }));
                  }}
                />
              </label>
            </div>

            <div className="settings-card">
              <h3>{copy.filtersSection}</h3>
              <p className="section-help">{copy.filtersHelp}</p>
              <div className="platform-group" role="group" aria-label={copy.platformFilterAria}>
                {options.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    className={draft.platformFilter === option.id ? "active" : ""}
                    onClick={() => setDraft((prev) => ({ ...prev, platformFilter: option.id }))}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
              <label className="switch-row">
                <span>
                  {copy.includePrivate}
                  <small>{copy.includePrivateHelp}</small>
                </span>
                <input
                  type="checkbox"
                  checked={draft.includePrivate}
                  onChange={(event) => setDraft((prev) => ({ ...prev, includePrivate: event.target.checked }))}
                />
              </label>
            </div>

            <div className="settings-card">
              <h3>{copy.displaySection}</h3>
              <p className="section-help">{copy.displayHelp}</p>
              <label>
                {copy.designPreset}
                <small>{copy.designPresetHelp}</small>
                <select
                  aria-label={copy.designPreset}
                  value={draft.designPreset}
                  onChange={(event) =>
                    setDraft((prev) => ({ ...prev, designPreset: event.target.value as UiSettings["designPreset"] }))
                  }
                >
                  <option value="bento">{copy.designPresetBento}</option>
                  <option value="liquid">{copy.designPresetLiquid}</option>
                  <option value="night">{copy.designPresetNight}</option>
                </select>
              </label>
              <label>
                {copy.language}
                <select
                  aria-label={copy.language}
                  value={draft.language}
                  onChange={(event) => setDraft((prev) => ({ ...prev, language: event.target.value as UiSettings["language"] }))}
                >
                  <option value="en">{copy.languageEnglish}</option>
                  <option value="ja">{copy.languageJapanese}</option>
                </select>
              </label>
              <label>
                {copy.theme}
                <select
                  aria-label={copy.theme}
                  value={draft.theme}
                  onChange={(event) => setDraft((prev) => ({ ...prev, theme: event.target.value as UiSettings["theme"] }))}
                >
                  <option value="light">light</option>
                  <option value="dark">dark</option>
                  <option value="system">system</option>
                </select>
              </label>
              <label className="switch-row">
                <span>
                  {copy.compactCards}
                  <small>{copy.compactCardsHelp}</small>
                </span>
                <input
                  type="checkbox"
                  checked={draft.compactFeed}
                  onChange={(event) => setDraft((prev) => ({ ...prev, compactFeed: event.target.checked }))}
                />
              </label>
              <label className="switch-row">
                <span>
                  {copy.autoScroll}
                  <small>{copy.autoScrollHelp}</small>
                </span>
                <input
                  type="checkbox"
                  checked={draft.autoScroll}
                  onChange={(event) => setDraft((prev) => ({ ...prev, autoScroll: event.target.checked }))}
                />
              </label>
            </div>

            <div className="settings-footer">
              <button type="button" className="ghost" onClick={onClose}>
                {copy.cancel}
              </button>
              <button
                type="button"
                onClick={() => {
                  onSave({
                    ...draft,
                    pageSize: clampPageSize(draft.pageSize),
                  });
                }}
              >
                {copy.save}
              </button>
            </div>
          </section>
        </div>
      </section>
    </div>
  );
}
