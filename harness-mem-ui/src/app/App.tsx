import { useCallback, useEffect, useState } from "react";
import { EnvironmentPanel } from "../components/EnvironmentPanel";
import { FeedPanel } from "../components/FeedPanel";
import { HeaderBar } from "../components/HeaderBar";
import { ProjectSidebar } from "../components/ProjectSidebar";
import { SettingsModal } from "../components/SettingsModal";
import { useFeedPagination } from "../hooks/useFeedPagination";
import { useSSE } from "../hooks/useSSE";
import { useSettings } from "../hooks/useSettings";
import { fetchEnvironment, fetchHealth, fetchProjectsStats, fetchUiContext } from "../lib/api";
import { getUiCopy } from "../lib/i18n";
import type { EnvironmentSnapshot, FeedItem, ProjectsStatsItem, SseUiEvent } from "../lib/types";

function normalizeFeedItem(raw: Record<string, unknown>): FeedItem {
  return {
    id: typeof raw.id === "string" ? raw.id : "",
    event_id: typeof raw.event_id === "string" ? raw.event_id : undefined,
    platform: typeof raw.platform === "string" ? raw.platform : undefined,
    project: typeof raw.project === "string" ? raw.project : undefined,
    session_id: typeof raw.session_id === "string" ? raw.session_id : undefined,
    event_type: typeof raw.event_type === "string" ? raw.event_type : undefined,
    card_type: typeof raw.card_type === "string" ? raw.card_type : undefined,
    title: typeof raw.title === "string" ? raw.title : undefined,
    content: typeof raw.content === "string" ? raw.content : undefined,
    summary: typeof raw.summary === "string" ? raw.summary : undefined,
    created_at: typeof raw.created_at === "string" ? raw.created_at : undefined,
    tags: Array.isArray(raw.tags) ? raw.tags.filter((tag): tag is string => typeof tag === "string") : [],
    privacy_tags: Array.isArray(raw.privacy_tags)
      ? raw.privacy_tags.filter((tag): tag is string => typeof tag === "string")
      : [],
  };
}

function healthLabelFromItem(item: Record<string, unknown>): { label: string; degraded: boolean } {
  const status = typeof item.status === "string" ? item.status : "unknown";
  const vector = typeof item.vector_engine === "string" ? item.vector_engine : "unknown";
  const fts = typeof item.fts_enabled === "boolean" ? (item.fts_enabled ? "fts:on" : "fts:off") : "fts:?";
  return {
    label: `daemon ${status} (${vector}, ${fts})`,
    degraded: status !== "ok",
  };
}

export default function App() {
  const { settings, setSettings, updateSetting } = useSettings();
  const [projects, setProjects] = useState<ProjectsStatsItem[]>([]);
  const [healthLabel, setHealthLabel] = useState("daemon checking...");
  const [healthDegraded, setHealthDegraded] = useState(false);
  const [defaultProject, setDefaultProject] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [environmentSnapshot, setEnvironmentSnapshot] = useState<EnvironmentSnapshot | null>(null);
  const [environmentLoading, setEnvironmentLoading] = useState(false);
  const [environmentError, setEnvironmentError] = useState("");
  const copy = getUiCopy(settings.language);

  const selectedProject = settings.selectedProject;

  const {
    items: feedItems,
    hasMore,
    loading,
    error,
    loadMore,
    refresh,
    prependLiveItem,
  } = useFeedPagination({
    project: selectedProject,
    platformFilter: settings.platformFilter,
    includePrivate: settings.includePrivate,
    limit: settings.pageSize,
  });

  const loadProjects = useCallback(async () => {
    try {
      const response = await fetchProjectsStats(settings.includePrivate);
      if (response.ok) {
        setProjects(response.items);
      }
    } catch {
      // no-op
    }
  }, [settings.includePrivate]);

  const refreshStatus = useCallback(async () => {
    try {
      const health = await fetchHealth();
      const healthItem = (health.items[0] || {}) as Record<string, unknown>;
      const { label, degraded } = healthLabelFromItem(healthItem);
      setHealthLabel(label);
      setHealthDegraded(!health.ok || degraded);
    } catch (errorInput) {
      const message = errorInput instanceof Error ? errorInput.message : String(errorInput);
      setHealthLabel(`daemon unreachable (${message})`);
      setHealthDegraded(true);
    }
  }, []);

  const loadEnvironment = useCallback(async () => {
    setEnvironmentLoading(true);
    setEnvironmentError("");
    try {
      const payload = await fetchEnvironment();
      setEnvironmentSnapshot(payload.items[0] || null);
    } catch (errorInput) {
      const message = errorInput instanceof Error ? errorInput.message : String(errorInput);
      setEnvironmentError(message);
    } finally {
      setEnvironmentLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  useEffect(() => {
    void (async () => {
      try {
        const context = await fetchUiContext();
        if (context.ok && typeof context.default_project === "string" && context.default_project.trim().length > 0) {
          setDefaultProject(context.default_project.trim());
        }
      } catch {
        // no-op
      }
    })();
  }, []);

  useEffect(() => {
    if (selectedProject === "__all__") {
      return;
    }
    if (projects.length === 0) {
      return;
    }
    const exists = projects.some((project) => project.project === selectedProject);
    if (!exists) {
      updateSetting("selectedProject", "__all__");
    }
  }, [projects, selectedProject, updateSetting]);

  useEffect(() => {
    if (settings.projectAutoPinned) {
      return;
    }
    if (projects.length === 0) {
      return;
    }

    if (defaultProject && projects.some((project) => project.project === defaultProject) && selectedProject !== defaultProject) {
      updateSetting("selectedProject", defaultProject);
    }
    updateSetting("projectAutoPinned", true);
  }, [defaultProject, projects, selectedProject, settings.projectAutoPinned, updateSetting]);

  useEffect(() => {
    void refreshStatus();
    const timer = setInterval(() => {
      void refreshStatus();
    }, 5000);
    return () => clearInterval(timer);
  }, [refreshStatus]);

  useEffect(() => {
    let frame = 0;
    const updateParallax = () => {
      frame = 0;
      const shift = Math.round(window.scrollY * 0.22);
      document.documentElement.style.setProperty("--parallax-y", `${shift}px`);
    };
    const onScroll = () => {
      if (frame !== 0) {
        return;
      }
      frame = window.requestAnimationFrame(updateParallax);
    };

    updateParallax();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame !== 0) {
        window.cancelAnimationFrame(frame);
      }
      document.documentElement.style.removeProperty("--parallax-y");
    };
  }, []);

  useEffect(() => {
    if (settings.activeTab !== "environment") {
      return;
    }
    void loadEnvironment();
    const timer = setInterval(() => {
      void loadEnvironment();
    }, 60_000);
    return () => clearInterval(timer);
  }, [settings.activeTab, loadEnvironment]);

  const handleStreamEvent = useCallback(
    (event: SseUiEvent) => {
      if (event.event === "observation.created") {
        const incoming = normalizeFeedItem(event.data as Record<string, unknown>);
        if (incoming.id) {
          prependLiveItem(incoming);
        }
        void loadProjects();
        return;
      }

      if (event.event === "session.finalized") {
        void loadProjects();
        return;
      }

      if (event.event === "health.changed") {
        const data = event.data as Record<string, unknown>;
        const { label, degraded } = healthLabelFromItem(data);
        setHealthLabel(label);
        setHealthDegraded(degraded);
      }
    },
    [loadProjects, prependLiveItem]
  );

  const { connected, lastError } = useSSE({
    includePrivate: settings.includePrivate,
    project: selectedProject,
    onEvent: handleStreamEvent,
  });

  return (
    <div className="page">
      <HeaderBar
        connected={connected}
        streamError={lastError}
        healthLabel={healthLabel}
        healthDegraded={healthDegraded}
        language={settings.language}
        onRefresh={() => {
          refresh();
          void loadProjects();
          void refreshStatus();
          if (settings.activeTab === "environment") {
            void loadEnvironment();
          }
        }}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <div className="main-layout">
        <ProjectSidebar
          projects={projects}
          selectedProject={selectedProject}
          language={settings.language}
          onSelectProject={(project) => updateSetting("selectedProject", project)}
        />

        <main className="content">
          <div className="tabs" role="tablist" aria-label={copy.tabsAria}>
            <button
              type="button"
              role="tab"
              id="tab-feed"
              className={`tab ${settings.activeTab === "feed" ? "active" : ""}`}
              aria-selected={settings.activeTab === "feed"}
              aria-controls="panel-feed"
              onClick={() => updateSetting("activeTab", "feed")}
            >
              {copy.feedTab}
            </button>
            <button
              type="button"
              role="tab"
              id="tab-environment"
              className={`tab ${settings.activeTab === "environment" ? "active" : ""}`}
              aria-selected={settings.activeTab === "environment"}
              aria-controls="panel-environment"
              onClick={() => updateSetting("activeTab", "environment")}
            >
              {copy.environmentTab}
            </button>
          </div>

          {settings.activeTab === "environment" ? (
            <div role="tabpanel" id="panel-environment" aria-labelledby="tab-environment">
              <EnvironmentPanel
                snapshot={environmentSnapshot}
                loading={environmentLoading}
                error={environmentError}
                language={settings.language}
                onRefresh={() => {
                  void loadEnvironment();
                }}
              />
            </div>
          ) : (
            <div role="tabpanel" id="panel-feed" aria-labelledby="tab-feed">
              <FeedPanel
                items={feedItems}
                compact={settings.compactFeed}
                language={settings.language}
                loading={loading}
                error={error}
                hasMore={hasMore}
                onLoadMore={() => {
                  void loadMore();
                }}
                platformFilter={settings.platformFilter}
                onPlatformChange={(filter) => updateSetting("platformFilter", filter)}
              />
            </div>
          )}
        </main>
      </div>

      <SettingsModal
        open={settingsOpen}
        settings={settings}
        projects={projects}
        previewItem={feedItems[0] || null}
        onClose={() => setSettingsOpen(false)}
        onSave={(next) => {
          setSettings(next);
          setSettingsOpen(false);
          refresh();
          void loadProjects();
          if (next.activeTab === "environment") {
            void loadEnvironment();
          }
        }}
      />
    </div>
  );
}
