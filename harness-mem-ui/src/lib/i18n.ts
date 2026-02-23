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
  feedTab: string;
  environmentTab: string;
  tabsAria: string;
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
  environment: {
    title: string;
    subtitle: string;
    refresh: string;
    generatedAt: string;
    snapshotId: string;
    summaryTitle: string;
    noData: string;
    errorsTitle: string;
    status: {
      ok: string;
      warning: string;
      missing: string;
    };
    sections: {
      servers: { title: string; description: string; empty: string };
      languages: { title: string; description: string; empty: string };
      cli: { title: string; description: string; empty: string };
      ai: { title: string; description: string; empty: string };
    };
    fieldLabels: {
      version: string;
      status: string;
      pid: string;
      port: string;
      bind: string;
      protocol: string;
      process: string;
      installed: string;
      message: string;
    };
    faqTitle: string;
    faq: Array<{ question: string; answer: string }>;
  };
}

const COPY: Record<UiLanguage, UiCopy> = {
  en: {
    feedTab: "Feed",
    environmentTab: "Environment",
    tabsAria: "Main tabs",
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
    environment: {
      title: "Environment status",
      subtitle: "What is installed and what is currently running.",
      refresh: "Refresh environment",
      generatedAt: "Updated",
      snapshotId: "Snapshot",
      summaryTitle: "5-second summary",
      noData: "Environment snapshot is not available yet.",
      errorsTitle: "Collection warnings",
      status: {
        ok: "Normal",
        warning: "Needs attention",
        missing: "Not detected",
      },
      sections: {
        servers: {
          title: "Internal servers",
          description: "Services running in this local environment.",
          empty: "No server data found.",
        },
        languages: {
          title: "Languages / runtimes",
          description: "Programming runtimes and package ecosystems available here.",
          empty: "No language runtime detected.",
        },
        cli: {
          title: "CLI tools",
          description: "Command line tools used for operations and diagnostics.",
          empty: "No CLI tool data found.",
        },
        ai: {
          title: "AI / MCP tools",
          description: "Agent tools and MCP wiring status.",
          empty: "No AI tool data found.",
        },
      },
      fieldLabels: {
        version: "Version",
        status: "Status",
        pid: "PID",
        port: "Port",
        bind: "Bind",
        protocol: "Protocol",
        process: "Process",
        installed: "Installed",
        message: "Note",
      },
      faqTitle: "FAQ for non-specialists",
      faq: [
        {
          question: "What does this page show?",
          answer: "It summarizes local servers, runtimes, CLI tools, and AI tool wiring in one place.",
        },
        {
          question: "What is \"Normal / Needs attention / Not detected\"?",
          answer: "Normal means healthy, Needs attention means found but not healthy, Not detected means missing.",
        },
        {
          question: "Is this page read-only?",
          answer: "Yes. V1 only reads diagnostics and does not run start/stop actions.",
        },
        {
          question: "Why can a tool be installed but still yellow?",
          answer: "Installed only confirms presence. Yellow usually means version drift or wiring issues.",
        },
        {
          question: "Where do these values come from?",
          answer: "Daemon health, doctor snapshot, versions snapshot, and local process checks.",
        },
        {
          question: "Can this expose secrets?",
          answer: "Sensitive keys/tokens are masked before API responses are returned.",
        },
      ],
    },
  },
  ja: {
    feedTab: "フィード",
    environmentTab: "環境",
    tabsAria: "メインタブ",
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
    environment: {
      title: "環境ステータス",
      subtitle: "何が入っていて、今どれが動いているかを一覧表示します。",
      refresh: "環境を更新",
      generatedAt: "更新時刻",
      snapshotId: "スナップショット",
      summaryTitle: "5秒サマリー",
      noData: "環境スナップショットがまだ取得できていません。",
      errorsTitle: "収集時の注意",
      status: {
        ok: "正常",
        warning: "注意",
        missing: "未検出",
      },
      sections: {
        servers: {
          title: "内部サーバー",
          description: "このローカル環境で動いている主要サービスです。",
          empty: "サーバー情報を取得できませんでした。",
        },
        languages: {
          title: "言語 / ランタイム",
          description: "開発で使う言語実行環境とパッケージ基盤です。",
          empty: "言語ランタイムを検出できませんでした。",
        },
        cli: {
          title: "CLI ツール",
          description: "運用・診断で使うコマンドラインツールです。",
          empty: "CLI情報を取得できませんでした。",
        },
        ai: {
          title: "AI / MCP ツール",
          description: "AIツール本体とMCP配線状態です。",
          empty: "AIツール情報を取得できませんでした。",
        },
      },
      fieldLabels: {
        version: "バージョン",
        status: "状態",
        pid: "PID",
        port: "ポート",
        bind: "バインド先",
        protocol: "プロトコル",
        process: "プロセス",
        installed: "導入",
        message: "補足",
      },
      faqTitle: "非専門家向け FAQ",
      faq: [
        {
          question: "このページは何を示していますか？",
          answer: "内部サーバー、言語/ランタイム、CLI、AI/MCP状況を1画面にまとめて表示します。",
        },
        {
          question: "「正常 / 注意 / 未検出」の違いは？",
          answer: "正常は問題なし、注意は検出済みだが要確認、未検出は見つからない状態です。",
        },
        {
          question: "このページから操作はできますか？",
          answer: "できません。V1は read-only（閲覧専用）です。",
        },
        {
          question: "導入済みなのに「注意」になるのはなぜ？",
          answer: "導入の有無と正常性は別です。配線不整合やバージョン差分で注意になります。",
        },
        {
          question: "表示データの出どころは？",
          answer: "daemon health / doctor snapshot / versions snapshot / プロセス確認結果です。",
        },
        {
          question: "機密情報は見えてしまいませんか？",
          answer: "API key や token などの値は API 応答前にマスクしています。",
        },
      ],
    },
  },
};

export function getUiCopy(language: UiLanguage): UiCopy {
  return COPY[language] || COPY.en;
}
