import { useEffect, useMemo, useState } from "react";
import type { UiSettings } from "../lib/types";

const KEY = "harness_mem_ui_settings_v1";

export const defaultSettings: UiSettings = {
  includePrivate: false,
  selectedProject: "__all__",
  projectAutoPinned: false,
  platformFilter: "__all__",
  compactFeed: false,
  pageSize: 40,
  autoScroll: true,
  theme: "light",
  designPreset: "bento",
  language: "en",
  activeTab: "feed",
};

function readSettings(): UiSettings {
  if (typeof localStorage === "undefined") {
    return defaultSettings;
  }
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      return defaultSettings;
    }
    const parsed = JSON.parse(raw) as Partial<UiSettings>;
    return {
      ...defaultSettings,
      ...parsed,
      platformFilter:
        parsed.platformFilter === "claude" ||
        parsed.platformFilter === "codex" ||
        parsed.platformFilter === "opencode" ||
        parsed.platformFilter === "cursor" ||
        parsed.platformFilter === "gemini"
          ? parsed.platformFilter
          : "__all__",
      compactFeed: typeof parsed.compactFeed === "boolean" ? parsed.compactFeed : defaultSettings.compactFeed,
      pageSize: typeof parsed.pageSize === "number" ? Math.max(10, Math.min(100, Math.trunc(parsed.pageSize))) : defaultSettings.pageSize,
      designPreset:
        parsed.designPreset === "liquid" || parsed.designPreset === "night" || parsed.designPreset === "bento"
          ? parsed.designPreset
          : defaultSettings.designPreset,
      language: parsed.language === "ja" ? "ja" : "en",
      activeTab: parsed.activeTab === "environment" || parsed.activeTab === "feed" ? parsed.activeTab : defaultSettings.activeTab,
    };
  } catch {
    return defaultSettings;
  }
}

export function useSettings() {
  const [settings, setSettings] = useState<UiSettings>(() => readSettings());

  useEffect(() => {
    localStorage.setItem(KEY, JSON.stringify(settings));
  }, [settings]);

  useEffect(() => {
    const root = document.documentElement;
    const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    const effective = settings.theme === "system" ? (prefersDark ? "dark" : "light") : settings.theme;
    root.dataset.theme = effective;
  }, [settings.theme]);

  useEffect(() => {
    document.documentElement.dataset.design = settings.designPreset;
  }, [settings.designPreset]);

  useEffect(() => {
    document.documentElement.lang = settings.language === "ja" ? "ja" : "en";
  }, [settings.language]);

  const updateSetting = useMemo(
    () =>
      <K extends keyof UiSettings>(key: K, value: UiSettings[K]) => {
        setSettings((prev) => ({ ...prev, [key]: value }));
      },
    []
  );

  return { settings, setSettings, updateSetting };
}
