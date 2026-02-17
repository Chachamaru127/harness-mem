import type { UiLanguage } from "./types";

type CategoryKey =
  | "prompt"
  | "discovery"
  | "change"
  | "bugfix"
  | "session_summary"
  | "checkpoint"
  | "tool_use"
  | "other";

interface UiCopy {
  appTitle: string;
  appSubtitle: string;
  settingsButton: string;
  refreshButton: string;
  projects: string;
  allProjects: string;
  noProjects: string;
  observationsUnit: string;
  sessionsUnit: string;
  feed: string;
  itemsLoadedSuffix: string;
  noFeedItems: string;
  noFeedItemsHint: string;
  loadMore: string;
  noMoreItems: string;
  loading: string;
  privacyPrefix: string;
  streamConnected: string;
  streamDisconnected: string;
  settingsTitle: string;
  settingsSubtitle: string;
  previewFor: string;
  previewProjectAria: string;
  previewAllProjects: string;
  closeSettingsAria: string;
  close: string;
  cancel: string;
  save: string;
  previewLatestContext: string;
  previewEmptyTitle: string;
  previewEmptyContent: string;
  loadingSection: string;
  loadingHelp: string;
  observations: string;
  filtersSection: string;
  filtersHelp: string;
  platformFilterAria: string;
  includePrivate: string;
  includePrivateHelp: string;
  displaySection: string;
  displayHelp: string;
  designPreset: string;
  designPresetHelp: string;
  designPresetBento: string;
  designPresetLiquid: string;
  designPresetNight: string;
  language: string;
  theme: string;
  compactCards: string;
  compactCardsHelp: string;
  autoScroll: string;
  autoScrollHelp: string;
  detailDialogTitle: string;
  detailClose: string;
  detailHint: string;
  languageEnglish: string;
  languageJapanese: string;
  category: Record<CategoryKey, string>;
}

const COPY: Record<UiLanguage, UiCopy> = {
  en: {
    appTitle: "Harness Memory Viewer",
    appSubtitle: "Project memory feed",
    settingsButton: "settings",
    refreshButton: "refresh",
    projects: "Projects",
    allProjects: "All projects",
    noProjects: "No projects yet.",
    observationsUnit: "obs",
    sessionsUnit: "sessions",
    feed: "Feed",
    itemsLoadedSuffix: "items loaded",
    noFeedItems: "No feed items yet.",
    noFeedItemsHint: "Start a new conversation and it will appear here.",
    loadMore: "load more",
    noMoreItems: "No more items",
    loading: "Loading...",
    privacyPrefix: "privacy",
    streamConnected: "stream connected",
    streamDisconnected: "stream disconnected",
    settingsTitle: "Settings",
    settingsSubtitle: "Control feed visibility and display behavior.",
    previewFor: "Preview for",
    previewProjectAria: "Preview project",
    previewAllProjects: "All projects",
    closeSettingsAria: "Close settings",
    close: "close",
    cancel: "Cancel",
    save: "Save",
    previewLatestContext: "latest context",
    previewEmptyTitle: "No feed item yet",
    previewEmptyContent: "Start a new conversation. New observations will appear here as soon as they are ingested.",
    loadingSection: "Loading",
    loadingHelp: "How many observations to load at a time.",
    observations: "Observations",
    filtersSection: "Filters",
    filtersHelp: "Which records should be visible in feed.",
    platformFilterAria: "Platform filter",
    includePrivate: "Include private",
    includePrivateHelp: "Include private and sensitive observations in view.",
    displaySection: "Display",
    displayHelp: "Visual and interaction preferences.",
    designPreset: "Design style",
    designPresetHelp: "Pick a visual direction for cards, layout, and atmosphere.",
    designPresetBento: "Bento Canvas",
    designPresetLiquid: "Liquid Glass",
    designPresetNight: "Night Signal",
    language: "Language",
    theme: "Theme",
    compactCards: "Compact cards",
    compactCardsHelp: "Reduce card height and keep feed denser.",
    autoScroll: "Auto scroll",
    autoScrollHelp: "Automatically keep latest item in view.",
    detailDialogTitle: "Full record",
    detailClose: "Close",
    detailHint: "Click to view full text",
    languageEnglish: "English",
    languageJapanese: "Japanese",
    category: {
      prompt: "PROMPT",
      discovery: "DISCOVERY",
      change: "CHANGE",
      bugfix: "BUGFIX",
      session_summary: "SESSION SUMMARY",
      checkpoint: "CHECKPOINT",
      tool_use: "TOOL USE",
      other: "OTHER",
    },
  },
  ja: {
    appTitle: "Harness メモリビューア",
    appSubtitle: "プロジェクト別メモリフィード",
    settingsButton: "設定",
    refreshButton: "更新",
    projects: "プロジェクト",
    allProjects: "すべてのプロジェクト",
    noProjects: "まだプロジェクトがありません。",
    observationsUnit: "件",
    sessionsUnit: "セッション",
    feed: "フィード",
    itemsLoadedSuffix: "件を表示",
    noFeedItems: "まだフィードがありません。",
    noFeedItemsHint: "新しい会話を開始すると、ここに表示されます。",
    loadMore: "さらに読み込む",
    noMoreItems: "これ以上ありません",
    loading: "読み込み中...",
    privacyPrefix: "機密",
    streamConnected: "ストリーム接続中",
    streamDisconnected: "ストリーム切断中",
    settingsTitle: "設定",
    settingsSubtitle: "表示内容と見た目をここで調整します。",
    previewFor: "プレビュー対象",
    previewProjectAria: "プレビュー対象プロジェクト",
    previewAllProjects: "すべてのプロジェクト",
    closeSettingsAria: "設定を閉じる",
    close: "閉じる",
    cancel: "キャンセル",
    save: "保存",
    previewLatestContext: "最新コンテキスト",
    previewEmptyTitle: "表示できるフィードがまだありません",
    previewEmptyContent: "新しい会話が取り込まれると、ここに直近の内容が表示されます。",
    loadingSection: "読み込み",
    loadingHelp: "1回で読み込む観測件数を設定します。",
    observations: "観測件数",
    filtersSection: "フィルター",
    filtersHelp: "フィードに表示する対象を選びます。",
    platformFilterAria: "プラットフォームフィルター",
    includePrivate: "プライベートを含める",
    includePrivateHelp: "private / sensitive タグ付きの記録も表示します。",
    displaySection: "表示",
    displayHelp: "見た目と表示動作を調整します。",
    designPreset: "デザインスタイル",
    designPresetHelp: "カード、背景、質感の方向性を選びます。",
    designPresetBento: "Bento Canvas",
    designPresetLiquid: "Liquid Glass",
    designPresetNight: "Night Signal",
    language: "表示言語",
    theme: "テーマ",
    compactCards: "カードをコンパクト表示",
    compactCardsHelp: "カード高さを抑えて一覧性を上げます。",
    autoScroll: "自動スクロール",
    autoScrollHelp: "新着時に最新カードを追従表示します。",
    detailDialogTitle: "全文表示",
    detailClose: "閉じる",
    detailHint: "クリックで全文を表示",
    languageEnglish: "English",
    languageJapanese: "日本語",
    category: {
      prompt: "プロンプト",
      discovery: "発見",
      change: "変更",
      bugfix: "バグ修正",
      session_summary: "セッション要約",
      checkpoint: "チェックポイント",
      tool_use: "ツール実行",
      other: "その他",
    },
  },
};

export function getUiCopy(language: UiLanguage): UiCopy {
  return COPY[language] || COPY.en;
}
