/**
 * core-utils.ts
 *
 * サブモジュール間で横断的に使われる純粋ユーティリティ関数。
 * this を使わない pure function のみ定義する。
 * DB 依存がある関数は db を引数で受け取る。
 */

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { Database } from "bun:sqlite";
import { loadAdaptiveThresholdDefaults } from "../embedding/adaptive-config";
import type { ApiResponse, Config } from "./types.js";

// ---------------------------------------------------------------------------
// 時刻・基本ユーティリティ
// ---------------------------------------------------------------------------

export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * S78-D01: expires_at 正規化。
 * - ISO-8601 文字列: そのまま検証して返す
 * - Unix 秒 (number): ISO-8601 に変換
 * - null / undefined / 空文字: null を返す（無期限）
 * - パース不能な文字列: null を返す（エラーにしない）
 */
export function normalizeExpiresAt(value: unknown): string | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return null;
    return new Date(value * 1000).toISOString();
  }
  if (typeof value === "string") {
    const d = new Date(value);
    if (isNaN(d.getTime())) return null;
    return d.toISOString();
  }
  return null;
}

export function resolveHomePath(inputPath: string): string {
  if (inputPath.startsWith("~")) {
    const homeDir = process.env.HOME || process.env.USERPROFILE || ".";
    return resolve(join(homeDir, inputPath.slice(1)));
  }
  return resolve(inputPath);
}

export function ensureDir(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * 数値を [min, max] の範囲に丸める。
 * デフォルト値は呼び出し側で明示すること。
 */
export function clampLimit(input: unknown, fallback: number, min: number, max: number): number {
  const n = typeof input === "number" ? input : Number(input);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

// ---------------------------------------------------------------------------
// JSON パース
// ---------------------------------------------------------------------------

export function parseJsonSafe(value: unknown): Record<string, unknown> {
  if (typeof value === "object" && value !== null) {
    return value as unknown as Record<string, unknown>;
  }
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value) as unknown;
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      // ignore JSON parse errors
    }
  }
  return {};
}

export function toArraySafe(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string");
}

export function parseArrayJson(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((v): v is string => typeof v === "string");
  }
  if (typeof value !== "string" || !value) {
    return [];
  }
  try {
    const parsed = JSON.parse(value);
    return toArraySafe(parsed);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// ApiResponse 生成
// ---------------------------------------------------------------------------

/**
 * サブモジュール用の成功レスポンスを生成する。
 * (harness-mem-core.ts 内の makeResponse とは latency_ms の計算式が異なる)
 */
export function makeResponse(
  startedAt: number,
  items: unknown[],
  filters: Record<string, unknown>,
  extra: Record<string, unknown> = {}
): ApiResponse {
  const latency = performance.now() - startedAt;
  return {
    ok: true,
    source: "core",
    items,
    meta: {
      count: items.length,
      latency_ms: Math.round(latency * 100) / 100,
      sla_latency_ms: 200,
      filters,
      ranking: "default",
      ...extra,
    },
  };
}

export function makeErrorResponse(
  startedAt: number,
  message: string,
  filters: Record<string, unknown>
): ApiResponse {
  const latency = performance.now() - startedAt;
  return {
    ok: false,
    source: "core",
    items: [],
    meta: {
      count: 0,
      latency_ms: Math.round(latency * 100) / 100,
      sla_latency_ms: 200,
      filters,
      ranking: "error",
    },
    error: message,
  };
}

// ---------------------------------------------------------------------------
// 全文検索クエリ生成
// ---------------------------------------------------------------------------

const SYNONYM_MAP: Record<string, string[]> = {
  typescript: ["ts"],
  javascript: ["js"],
  ts: ["typescript"],
  js: ["javascript"],
  react: ["jsx", "tsx"],
  test: ["spec", "jest", "vitest"],
  spec: ["test"],
  error: ["bug", "exception", "failure"],
  bug: ["error", "issue", "defect"],
  fix: ["patch", "repair", "resolve"],
  api: ["endpoint", "route"],
  endpoint: ["api", "route"],
  database: ["db", "sqlite"],
  db: ["database", "sqlite"],
  config: ["configuration", "settings"],
  production: ["prod", "本番", "本番環境"],
  prod: ["production", "本番", "本番環境"],
  deploy: ["deployment", "release"],
  deployment: ["deploy", "release", "デプロイ", "本番環境"],
  auth: ["authentication", "login"],
  authentication: ["auth", "login", "認証", "ログイン"],
  login: ["auth", "authentication", "ログイン", "サインイン"],
  env: ["environment"],
  connection: ["connect", "接続", "接続性"],
  investigate: ["investigation", "analysis", "調査", "原因調査"],
  investigation: ["investigate", "analysis", "調査", "原因調査"],
  dep: ["dependency"],
  deps: ["dependencies"],
  dependency: ["dep", "package"],
  dependencies: ["deps", "packages"],
  refactor: ["restructure", "reorganize"],
  migrate: ["migration"],
  migration: ["migrate"],
  ui: ["interface", "frontend", "ユーザーインターフェース", "インターフェース"],
  interface: ["ui", "frontend", "ユーザーインターフェース"],
  refactoring: ["refactor", "リファクタ", "リファクタリング"],
  reusable: ["reuse", "再利用", "共通化"],
  component: ["components", "コンポーネント", "部品"],
  type: ["types", "種類", "カテゴリ", "型"],
  check: ["verify", "validation", "チェック", "確認", "型チェック"],
  scope: ["range", "範囲", "スコープ"],
  revision: ["revise", "review", "見直し", "改訂", "再策定"],
  plan: ["planning", "roadmap", "計画", "プラン"],
  traffic: ["load", "spike", "トラフィック", "負荷"],
  peak: ["ピーク", "ピーク時間", "peak-hours"],
  autoscaling: ["auto-scaling", "オートスケール", "scale-out"],
  // 日英バイリンガルエントリ（BM-008）
  // 英語 → 日本語同義語（スペース区切りクエリ時に機能）
  デプロイ: ["deploy", "deployment", "release"],
  エラー: ["error", "bug", "exception"],
  バグ: ["bug", "error", "issue"],
  データベース: ["database", "db", "sqlite"],
  認証: ["auth", "authentication", "login"],
  設定: ["config", "configuration", "settings"],
  本番: ["production", "prod", "live"],
  本番環境: ["production", "prod", "live-environment"],
  テスト: ["test", "spec", "jest"],
  リファクタ: ["refactor", "restructure"],
  リファクタリング: ["refactoring", "refactor", "restructure"],
  マイグレーション: ["migrate", "migration"],
  依存: ["dependency", "dep", "deps"],
  環境: ["env", "environment"],
  修正: ["fix", "patch", "resolve"],
  接続: ["connection", "connect"],
  調査: ["investigate", "investigation", "analysis"],
  原因調査: ["investigate", "investigation", "root-cause-analysis"],
  実装: ["implement", "implementation"],
  ビルド: ["build", "compile"],
  キャッシュ: ["cache", "caching"],
  ログ: ["log", "logging"],
  パフォーマンス: ["performance", "perf", "speed"],
  セキュリティ: ["security", "auth", "authentication"],
  クラウド: ["cloud", "aws", "gcp"],
  コンテナ: ["container", "docker", "kubernetes"],
  インターフェース: ["ui", "interface", "frontend"],
  ユーザーインターフェース: ["ui", "interface", "frontend"],
  コンポーネント: ["component", "components", "module"],
  再利用: ["reusable", "reuse", "shared"],
  型: ["type", "types", "type-system"],
  型チェック: ["type-check", "typecheck", "check"],
  種類: ["type", "category", "classification"],
  スコープ: ["scope", "range", "boundary"],
  見直し: ["revision", "review", "revise"],
  改訂: ["revision", "revise", "update"],
  再策定: ["revision", "replan", "plan"],
  トラフィック: ["traffic", "load", "spike"],
  ピーク時間: ["peak", "peak-hours", "rush-hour"],
  オートスケール: ["autoscaling", "auto-scaling", "scale-out"],
  // 英語 → 日本語逆引き（英語クエリで日本語コンテンツにヒット）
  implement: ["implementation", "実装"],
  build: ["compile", "ビルド"],
  cache: ["caching", "キャッシュ"],
  log: ["logging", "ログ"],
  performance: ["perf", "speed", "パフォーマンス"],
  security: ["auth", "authentication", "セキュリティ"],
  cloud: ["aws", "gcp", "クラウド"],
  container: ["docker", "kubernetes", "コンテナ"],
  search: ["retrieval", "query", "検索"],
  検索: ["search", "retrieval", "query"],
  // RQ-007: query expansion — 動詞変化形・派生語ステミング
  work: ["working", "worked", "works", "worker", "job", "occupation"],
  working: ["work", "worked", "works", "worker"],
  worked: ["work", "working"],
  learn: ["learning", "learned", "learns", "study", "studying"],
  learning: ["learn", "learned", "study", "studying", "education"],
  study: ["studying", "studied", "learn", "learning"],
  studying: ["study", "studied", "learn", "learning"],
  live: ["living", "lived", "reside", "residing", "stay"],
  living: ["live", "lived", "reside", "residing", "stay"],
  join: ["joined", "joins", "joining", "enter", "member"],
  joined: ["join", "joining", "entered", "member"],
  move: ["moving", "moved", "moves", "relocate", "relocation"],
  moving: ["move", "moved", "relocate"],
  start: ["starting", "started", "starts", "begin", "began", "beginning"],
  started: ["start", "starting", "begin", "began"],
  read: ["reading", "reads", "book"],
  reading: ["read", "book", "literature"],
  train: ["training", "trained", "practice", "practicing"],
  training: ["train", "trained", "practice", "coach", "coaching"],
  speak: ["speaking", "spoke", "spoken", "language", "fluent"],
  speaking: ["speak", "spoke", "language"],
  graduate: ["graduated", "graduation", "university", "college", "degree"],
  graduated: ["graduate", "graduation", "degree", "alumnus"],
  // 一般名詞の同義語拡張
  company: ["employer", "workplace", "organization", "firm", "corporation"],
  employer: ["company", "firm", "workplace"],
  job: ["work", "occupation", "position", "role", "career"],
  occupation: ["job", "work", "profession", "career", "role"],
  city: ["town", "location", "place", "area", "region"],
  town: ["city", "village", "location"],
  university: ["college", "school", "institution", "campus"],
  college: ["university", "school", "institution"],
  course: ["class", "lesson", "program", "curriculum"],
  book: ["novel", "literature", "publication", "reading", "title"],
  novel: ["book", "fiction", "literature"],
  team: ["group", "squad", "crew", "department"],
  project: ["task", "assignment", "initiative", "program"],
  certification: ["certificate", "credential", "qualification", "license"],
  certificate: ["certification", "credential", "qualification"],
  language: ["tongue", "linguistic", "speak", "fluent"],
  skill: ["ability", "capability", "expertise", "proficiency"],
  // 日本語拡張 (RQ-007)
  仕事: ["work", "job", "occupation", "company", "employer"],
  学習: ["learn", "learning", "study", "studying", "education"],
  勉強: ["study", "studying", "learn", "learning"],
  居住: ["live", "living", "reside", "residing"],
  参加: ["join", "joined", "enter", "member"],
  読書: ["read", "reading", "book", "literature"],
  訓練: ["train", "training", "practice"],
  言語: ["language", "speak", "speaking"],
  会社: ["company", "employer", "workplace", "organization"],
  大学: ["university", "college", "school"],
  資格: ["certification", "certificate", "credential", "qualification"],
  スキル: ["skill", "ability", "expertise"],
  チーム: ["team", "group", "squad"],
  プロジェクト: ["project", "task", "initiative"],
};

const SEARCH_QUERY_ALIAS_RULES: Array<{ pattern: RegExp; expansions: string[] }> = [
  {
    pattern: /(まさおベンチ|masao\s*bench)/iu,
    expansions: ["locomo benchmark", "Backboard-Locomo-Benchmark", "locomo"],
  },
  {
    pattern: /(日本語\s*(?:release|claim)\s*gate|ja(?:panese)?\s*(?:release|claim)\s*gate)/iu,
    expansions: ["ja-release-pack", "japanese release gate", "claim gate"],
  },
  {
    pattern: /(最終\s*go(?:時)?|final\s*go|run-?ci\s*final\s*go)/iu,
    expansions: ["run-ci final GO", "final GO"],
  },
  {
    pattern: /\boverall\s*f1\b/i,
    expansions: ["overall F1 mean"],
  },
  {
    pattern: /\bfreshness(?:@k)?\b/i,
    expansions: ["Freshness@K", "knowledge update freshness"],
  },
  {
    pattern: /\btoken\s*avg\b/i,
    expansions: ["average tokens", "avg tokens"],
  },
  {
    pattern: /\bp95\b/i,
    expansions: ["latency p95", "search p95"],
  },
];

// ---------------------------------------------------------------------------
// §45: 日本語形態素解析 (Intl.Segmenter)
// ---------------------------------------------------------------------------

const jaSegmenter = typeof Intl !== "undefined" && Intl.Segmenter
  ? new Intl.Segmenter("ja", { granularity: "word" })
  : null;

const KATAKANA_COMPOUND = /^[\u30A0-\u30FF]{4,}$/;
const KANJI_KATAKANA_MIX = /[\u4E00-\u9FFF].*[\u30A0-\u30FF]|[\u30A0-\u30FF].*[\u4E00-\u9FFF]/;
const HAS_CJK = /[\u3040-\u30FF\u3400-\u9FFF]/;

/**
 * Intl.Segmenter で日本語テキストを単語分割し、FTS5 用のスペース区切り文字列を返す。
 * カタカナ複合語（4文字以上）はサブワード（2-3gram）も追加して部分一致を可能にする。
 * 漢字+カタカナ混在語は構成要素に分離する。
 *
 * Intl.Segmenter が利用不可の環境では元のテキストをそのまま返す。
 */
export function segmentJapaneseForFts(text: string): string {
  if (!text || !jaSegmenter) return text;
  // CJK 文字を含まないテキストはそのまま返す（英語のみの場合）
  if (!HAS_CJK.test(text)) return text;

  const words = [...jaSegmenter.segment(text)]
    .filter((s) => s.isWordLike)
    .map((s) => s.segment);

  const expanded: string[] = [];
  for (const w of words) {
    expanded.push(w);
    // カタカナ複合語（4文字以上）→ 2-3文字サブワード追加
    if (KATAKANA_COMPOUND.test(w)) {
      const chars = [...w];
      for (let i = 0; i < chars.length - 1; i++) {
        expanded.push(chars[i] + chars[i + 1]);
      }
      for (let i = 0; i < chars.length - 2; i++) {
        expanded.push(chars[i] + chars[i + 1] + chars[i + 2]);
      }
    }
    // 漢字+カタカナ混在語 → 構成要素に分離
    if (KANJI_KATAKANA_MIX.test(w)) {
      const parts = w.split(/([\u30A0-\u30FF]+|[\u4E00-\u9FFF]+)/g).filter(Boolean);
      for (const p of parts) {
        if (p.length >= 2) expanded.push(p);
      }
    }
  }
  return expanded.join(" ");
}

// ---------------------------------------------------------------------------

/**
 * CJK文字シーケンスからバイグラムトークンを生成する。
 * unicode61 tokenizer がスペース区切りのみに依存するため、
 * クエリ側でバイグラム展開することで部分一致を可能にする。
 * 6文字以内の短いCJKトークンのみ展開し、長い文全体は展開しない。
 */
const CJK_ONLY_PATTERN = /^[\u3040-\u30ff\u3400-\u9fff]+$/;
const CJK_BIGRAM_MAX_CHARS = 6;

function expandCjkBigrams(tokens: string[]): string[] {
  const result: string[] = [];
  for (const token of tokens) {
    result.push(token);
    // 短いCJKトークン（3〜6文字）のみバイグラム展開
    if (CJK_ONLY_PATTERN.test(token) && token.length >= 3 && token.length <= CJK_BIGRAM_MAX_CHARS) {
      const chars = [...token];
      for (let i = 0; i < chars.length - 1; i += 1) {
        result.push(chars[i] + chars[i + 1]);
      }
    }
  }
  return result;
}

export function tokenize(text: string): string[] {
  // §45: Intl.Segmenter で日本語部分を単語分割してからトークン化
  // segmentJapaneseForFts はスペースで分割するので、元の英数字トークンも保持される
  // ただし Segmenter が英数字を食う場合があるため、元テキストのスペース分割結果も合流させる
  const rawTokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1);

  if (!jaSegmenter || !HAS_CJK.test(text)) {
    return expandCjkBigrams(rawTokens).slice(0, 4096);
  }

  // CJK 部分だけ Segmenter で分割し、英数字トークンは元のまま保持
  const segmentedTokens = segmentJapaneseForFts(text)
    .toLowerCase()
    .replace(/[^a-z0-9\u3040-\u30ff\u3400-\u9fff\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1);

  // 両方を合流させて重複排除
  const merged = new Set([...segmentedTokens, ...rawTokens]);
  return expandCjkBigrams([...merged]).slice(0, 4096);
}

function dedupePreserveOrder(tokens: string[]): string[] {
  const seen = new Set<string>();
  const deduped: string[] = [];
  for (const token of tokens) {
    if (!seen.has(token)) {
      seen.add(token);
      deduped.push(token);
    }
  }
  return deduped;
}

export function expandSearchQuery(query: string): string {
  const trimmed = query.trim();
  if (!trimmed) return trimmed;
  const additions = new Set<string>();
  for (const rule of SEARCH_QUERY_ALIAS_RULES) {
    if (!rule.pattern.test(trimmed)) continue;
    for (const expansion of rule.expansions) {
      additions.add(expansion);
    }
  }
  if (additions.size === 0) return trimmed;
  return `${trimmed} ${[...additions].join(" ")}`.trim();
}

export function buildSearchTokens(query: string): string[] {
  return dedupePreserveOrder(tokenize(expandSearchQuery(query)));
}

export function buildFtsQuery(query: string): string {
  const tokens = buildSearchTokens(query);
  if (tokens.length === 0) {
    return '""';
  }
  const escaped = tokens
    .map((token) => token.replace(/"/g, ""))
    .filter((token) => /^[a-z0-9\u3040-\u30ff\u3400-\u9fff]+$/.test(token));
  if (escaped.length === 0) {
    return '""';
  }

  // AND-first: 全トークン一致を最優先、個別トークン+同義語でフォールバック
  const andClause = escaped.map((t) => `"${t}"`).join(" AND ");
  const orTokens = escaped.map((t) => `"${t}"`);

  // 同義語・バイグラムで候補拡張
  for (const token of escaped) {
    const synonyms = SYNONYM_MAP[token];
    if (synonyms) {
      for (const synonym of synonyms) {
        orTokens.push(`"${synonym}"`);
      }
    }
  }
  for (let i = 0; i < escaped.length - 1; i += 1) {
    orTokens.push(`"${escaped[i]} ${escaped[i + 1]}"`);
  }

  // AND一致 > 個別トークン一致（BM25が自動的にAND一致を高スコアにする）
  return `(${andClause}) OR ${orTokens.join(" OR ")}`;
}

// ---------------------------------------------------------------------------
// プライバシーフィルタ SQL
// ---------------------------------------------------------------------------

/**
 * 観察のプライバシータグに基づいて除外条件を生成する純粋関数。
 * alias: SQL テーブルエイリアス ("o" 等)
 * includePrivate: true の場合は空文字列を返す（フィルタなし）
 */
export function visibilityFilterSql(alias: string, includePrivate: boolean): string {
  if (includePrivate) {
    return "";
  }

  // alias はコードパス内部で固定値 ("o" 等) が渡されるが、安全のためバリデーション
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(alias)) {
    throw new Error(`Invalid SQL alias: ${alias}`);
  }

  return `
    AND NOT EXISTS (
      SELECT 1
      FROM json_each(
        CASE
          WHEN json_valid(COALESCE(${alias}.privacy_tags_json, '[]')) THEN COALESCE(${alias}.privacy_tags_json, '[]')
          ELSE '["private"]'
        END
      ) AS jt
      WHERE lower(CAST(jt.value AS TEXT)) IN ('private', 'sensitive')
    )
  `;
}

// ---------------------------------------------------------------------------
// ベクトル検索ユーティリティ
// ---------------------------------------------------------------------------

export function cosineSimilarity(lhs: number[], rhs: number[]): number {
  const dim = Math.min(lhs.length, rhs.length);
  if (dim === 0) return 0;

  let dot = 0;
  let lhsNorm = 0;
  let rhsNorm = 0;
  for (let i = 0; i < dim; i += 1) {
    dot += lhs[i] * rhs[i];
    lhsNorm += lhs[i] * lhs[i];
    rhsNorm += rhs[i] * rhs[i];
  }

  if (lhsNorm === 0 || rhsNorm === 0) return 0;
  return dot / (Math.sqrt(lhsNorm) * Math.sqrt(rhsNorm));
}

export function normalizeScoreMap(raw: Map<string, number>): Map<string, number> {
  if (raw.size === 0) return new Map<string, number>();

  let minValue = Number.POSITIVE_INFINITY;
  let maxValue = Number.NEGATIVE_INFINITY;
  for (const value of raw.values()) {
    minValue = Math.min(minValue, value);
    maxValue = Math.max(maxValue, value);
  }

  if (maxValue === minValue) {
    const normalized = new Map<string, number>();
    for (const key of raw.keys()) {
      normalized.set(key, 1);
    }
    return normalized;
  }

  const normalized = new Map<string, number>();
  for (const [key, value] of raw.entries()) {
    normalized.set(key, (value - minValue) / (maxValue - minValue));
  }
  return normalized;
}

export function hasPrivateVisibilityTag(tags: string[]): boolean {
  return tags.some((tag) => {
    const normalized = tag.toLowerCase();
    return normalized === "private" || normalized === "sensitive";
  });
}

export interface RankingWeights {
  lexical: number;
  vector: number;
  recency: number;
  tag_boost: number;
  importance: number;
  graph: number;
}

export function normalizeWeights(weights: RankingWeights): RankingWeights {
  const total =
    weights.lexical +
    weights.vector +
    weights.recency +
    weights.tag_boost +
    weights.importance +
    weights.graph;
  if (total <= 0) {
    return { lexical: 0, vector: 0, recency: 0, tag_boost: 0, importance: 0, graph: 0 };
  }
  return {
    lexical: weights.lexical / total,
    vector: weights.vector / total,
    recency: weights.recency / total,
    tag_boost: weights.tag_boost / total,
    importance: weights.importance / total,
    graph: weights.graph / total,
  };
}

export interface VectorSearchResult {
  scores: Map<string, number>;
  coverage: number;
  migrationWarning?: string;
}

export interface SearchCandidate {
  id: string;
  lexical: number;
  vector: number;
  recency: number;
  tag_boost: number;
  importance: number;
  graph: number;
  fact_boost?: number;
  precision_boost?: number;
  final: number;
  rerank: number;
  created_at: string;
}

/**
 * S58-001: スコアリング結果から「なぜこの記憶が選ばれたか」を1行で説明する。
 * LLM不使用 — 各次元の寄与度（重み付きスコア）からルールベースで生成する。
 */
export function generateSearchReason(candidate: SearchCandidate): string {
  // 各次元の寄与度を計算（observation-store.ts の resolveSearchWeights と同じデフォルト重み）
  const contributions: Record<string, number> = {
    lexical: 0.30 * candidate.lexical,
    vector: 0.25 * candidate.vector,
    recency: 0.20 * candidate.recency,
    tag_boost: 0.10 * candidate.tag_boost,
    importance: 0.08 * candidate.importance,
    graph: 0.07 * candidate.graph,
  };

  // fact_boost / precision_boost が存在する場合は加味する
  if (candidate.fact_boost && candidate.fact_boost > 0) {
    contributions.fact_boost = 0.12 * candidate.fact_boost;
  }

  // 最も寄与した次元を特定
  let topKey = "lexical";
  let topValue = -1;
  for (const [key, value] of Object.entries(contributions)) {
    if (value > topValue) {
      topValue = value;
      topKey = key;
    }
  }

  // 次元 → 説明文マッピング
  const reasonMap: Record<string, string> = {
    lexical: "Title or content matches query keywords",
    vector: "Semantically similar to query",
    recency: "Recently recorded memory",
    tag_boost: "Tag matches query",
    importance: "High-importance memory",
    graph: "Expanded from related memory",
    fact_boost: "Contains relevant facts",
  };

  // スコアがすべてゼロの場合のフォールバック
  if (topValue <= 0) {
    return "Matched by broad retrieval";
  }

  return reasonMap[topKey] ?? "Matched by hybrid scoring";
}

export const EVENT_TYPE_IMPORTANCE: Record<string, number> = {
  checkpoint: 0.9,
  session_end: 0.8,
  tool_use: 0.5,
  user_prompt: 0.4,
  session_start: 0.2,
};

export function recencyScore(createdAt: string): number {
  const created = Date.parse(createdAt);
  if (Number.isNaN(created)) return 0;
  const ageMs = Math.max(0, Date.now() - created);
  const ageHours = ageMs / (1000 * 60 * 60);
  const envDays = Number(process.env.HARNESS_MEM_RECENCY_HALF_LIFE_DAYS);
  const halfLifeDays = Number.isFinite(envDays) && envDays > 0 ? envDays : 90;
  const halfLifeHours = 24 * halfLifeDays;
  return Math.exp(-ageHours / halfLifeHours);
}

export function normalizeVectorDimension(vector: number[], dimension: number): number[] {
  const normalized = vector.filter((value): value is number => typeof value === "number");
  if (normalized.length === dimension) return normalized;
  if (normalized.length > dimension) return normalized.slice(0, dimension);
  return [...normalized, ...new Array<number>(dimension - normalized.length).fill(0)];
}

export function generateEventId(): string {
  const ts = Date.now().toString(36).padStart(10, "0");
  const random = crypto.getRandomValues(new Uint8Array(8));
  const rand = [...random].map((value) => value.toString(16).padStart(2, "0")).join("");
  return `${ts}${rand}`;
}

export function isPrivateTag(tags: string[]): boolean {
  return tags.includes("private") || tags.includes("sensitive");
}

// ---------------------------------------------------------------------------
// プラットフォームごとのデフォルト定数
// ---------------------------------------------------------------------------

export const DEFAULT_OPENCODE_STORAGE_ROOT = "~/.local/share/opencode/storage";
export const DEFAULT_OPENCODE_DB_PATH = "~/.local/share/opencode/opencode.db";
export const DEFAULT_OPENCODE_INGEST_INTERVAL_MS = 5000;
export const DEFAULT_OPENCODE_BACKFILL_HOURS = 24;
export const DEFAULT_CURSOR_EVENTS_PATH = "~/.harness-mem/adapters/cursor/events.jsonl";
export const DEFAULT_CURSOR_INGEST_INTERVAL_MS = 5000;
export const DEFAULT_CURSOR_BACKFILL_HOURS = 24;
export const DEFAULT_ANTIGRAVITY_LOGS_ROOT = "~/Library/Application Support/Antigravity/logs";
export const DEFAULT_ANTIGRAVITY_WORKSPACE_STORAGE_ROOT = "~/Library/Application Support/Antigravity/User/workspaceStorage";
export const DEFAULT_ANTIGRAVITY_INGEST_INTERVAL_MS = 5000;
export const DEFAULT_ANTIGRAVITY_BACKFILL_HOURS = 24;
export const DEFAULT_GEMINI_EVENTS_PATH = "~/.harness-mem/adapters/gemini/events.jsonl";
export const DEFAULT_GEMINI_INGEST_INTERVAL_MS = 5000;
export const DEFAULT_GEMINI_BACKFILL_HOURS = 24;

// ---------------------------------------------------------------------------
// ワークスペース解決ユーティリティ
// ---------------------------------------------------------------------------

export function fileUriToPath(uriOrPath: string): string {
  const raw = uriOrPath.trim();
  if (!raw) {
    return "";
  }

  if (/^file:\/\//i.test(raw)) {
    let value = raw.replace(/^file:\/\//i, "");
    if (value.startsWith("localhost/")) {
      value = value.slice("localhost".length);
    }
    if (!value.startsWith("/")) {
      value = `/${value}`;
    }
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  return raw;
}

export function resolveWorkspaceRootFromWorkspaceFile(workspacePath: string): string {
  try {
    const raw = readFileSync(workspacePath, "utf8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const folders = Array.isArray(parsed.folders) ? parsed.folders : [];
    for (const folder of folders) {
      if (typeof folder !== "object" || folder === null || Array.isArray(folder)) {
        continue;
      }
      const pathValue = (folder as Record<string, unknown>).path;
      if (typeof pathValue !== "string" || !pathValue.trim()) {
        continue;
      }
      const normalized = pathValue.trim();
      if (normalized.startsWith("/")) {
        return resolve(normalized);
      }
      return resolve(join(dirname(workspacePath), normalized));
    }
  } catch {
    // best effort fallback below
  }

  return dirname(workspacePath);
}

export function resolveWorkspaceRootFromWorkspaceJson(workspaceJsonPath: string): string {
  let parsed: Record<string, unknown>;
  try {
    const raw = readFileSync(workspaceJsonPath, "utf8");
    const value = JSON.parse(raw) as unknown;
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return "";
    }
    parsed = value as Record<string, unknown>;
  } catch {
    return "";
  }

  const folder = typeof parsed.folder === "string" ? parsed.folder : "";
  if (folder) {
    const folderPath = fileUriToPath(folder);
    return folderPath ? resolve(folderPath) : "";
  }

  const workspace = typeof parsed.workspace === "string" ? parsed.workspace : "";
  if (!workspace) {
    return "";
  }
  const workspacePath = fileUriToPath(workspace);
  if (!workspacePath) {
    return "";
  }
  if (workspacePath.endsWith(".code-workspace")) {
    return resolveWorkspaceRootFromWorkspaceFile(workspacePath);
  }
  return resolve(workspacePath);
}

// ---------------------------------------------------------------------------
// セッション保証ユーティリティ
// ---------------------------------------------------------------------------

export function ensureSession(
  db: Database,
  sessionId: string,
  platform: string,
  project: string,
  ts: string,
  correlationId?: string | null,
  userId?: string | null,
  teamId?: string | null
): void {
  const current = new Date().toISOString();
  const resolvedUserId = userId ?? "default";
  const resolvedTeamId = teamId ?? null;
  db.query(`
    INSERT INTO mem_sessions(
      session_id, platform, project, started_at, correlation_id, user_id, team_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(session_id) DO UPDATE SET
      started_at = CASE
        WHEN mem_sessions.started_at <= excluded.started_at THEN mem_sessions.started_at
        ELSE excluded.started_at
      END,
      correlation_id = COALESCE(mem_sessions.correlation_id, excluded.correlation_id),
      updated_at = excluded.updated_at
  `).run(sessionId, platform, project, ts, correlationId ?? null, resolvedUserId, resolvedTeamId, current, current);
}

// ---------------------------------------------------------------------------
// 観察ロード
// ---------------------------------------------------------------------------

/**
 * 観察 ID の配列から観察データを一括ロードする。
 * db を引数で受け取ることで pure function に近い形で使える。
 */
export function loadObservations(db: Database, ids: string[]): Map<string, Record<string, unknown>> {
  if (ids.length === 0) {
    return new Map<string, Record<string, unknown>>();
  }

  // SQLite のバインド変数上限を考慮し、バッチ処理で安全に取得
  const MAX_BATCH = 500;
  const mapped = new Map<string, Record<string, unknown>>();

  for (let offset = 0; offset < ids.length; offset += MAX_BATCH) {
    const batch = ids.slice(offset, offset + MAX_BATCH);
    const placeholders = batch.map(() => "?").join(", ");
    const rows = db
      .query(
        `
          SELECT
            o.id,
            o.event_id,
            o.platform,
            o.project,
            o.session_id,
            o.title,
            o.content_redacted,
            o.raw_text,
            o.observation_type,
            o.memory_type,
            o.tags_json,
            o.privacy_tags_json,
            o.signal_score,
            o.access_count,
            o.last_accessed_at,
            o.created_at,
            o.updated_at,
            o.user_id,
            o.team_id,
            e.event_type
          FROM mem_observations o
          LEFT JOIN mem_events e ON e.event_id = o.event_id
          WHERE o.id IN (${placeholders})
        `
      )
      .all(...batch) as Array<Record<string, unknown>>;

    for (const row of rows) {
      const id = typeof row.id === "string" ? row.id : "";
      if (id) {
        mapped.set(id, row);
      }
    }
  }
  return mapped;
}

// ---------------------------------------------------------------------------
// getConfig — 環境変数から Config を構築するファクトリ
// (harness-mem-core.ts から分離してテスト依存を解消)
// ---------------------------------------------------------------------------

export const DEFAULT_DB_PATH = "~/.harness-mem/harness-mem.db";
export const DEFAULT_BIND_HOST = "127.0.0.1";
export const DEFAULT_BIND_PORT = 37888;
export const DEFAULT_VECTOR_DIM = 384;
export const DEFAULT_CODEX_SESSIONS_ROOT = "~/.codex/sessions";
export const DEFAULT_CODEX_INGEST_INTERVAL_MS = 5000;
export const DEFAULT_CODEX_BACKFILL_HOURS = 24;
export const DEFAULT_CLAUDE_CODE_PROJECTS_ROOT = "~/.claude/projects";
export const DEFAULT_CLAUDE_CODE_INGEST_INTERVAL_MS = 5000;
export const DEFAULT_CLAUDE_CODE_BACKFILL_HOURS = 24;
export const DEFAULT_SEARCH_RANKING = "hybrid_v3";
export const DEFAULT_SEARCH_EXPAND_LINKS = true;

export function envFlag(name: string, defaultValue: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) {
    return defaultValue;
  }
  const normalized = raw.trim().toLowerCase();
  return !(normalized === "0" || normalized === "false" || normalized === "off" || normalized === "no");
}

export function parseBackendMode(value: string | undefined): "local" | "managed" | "hybrid" {
  const normalized = (value || "").trim().toLowerCase();
  if (normalized === "managed" || normalized === "hybrid") return normalized;
  return "local";
}

export function getConfig(): Config {
  const dbPath = process.env.HARNESS_MEM_DB_PATH || DEFAULT_DB_PATH;
  const rawBindHost = (process.env.HARNESS_MEM_HOST || DEFAULT_BIND_HOST).trim();
  // リモートバインドを許可する（起動時の安全チェックは index.ts / startHarnessMemServer 側で実施）
  const bindHost = rawBindHost || DEFAULT_BIND_HOST;
  const bindPortRaw = process.env.HARNESS_MEM_PORT;
  const bindPort = bindPortRaw ? Number(bindPortRaw) : DEFAULT_BIND_PORT;
  const codexIngestIntervalRaw = Number(process.env.HARNESS_MEM_CODEX_INGEST_INTERVAL_MS || DEFAULT_CODEX_INGEST_INTERVAL_MS);
  const codexBackfillRaw = Number(process.env.HARNESS_MEM_CODEX_BACKFILL_HOURS || DEFAULT_CODEX_BACKFILL_HOURS);
  const opencodeIngestIntervalRaw = Number(
    process.env.HARNESS_MEM_OPENCODE_INGEST_INTERVAL_MS || DEFAULT_OPENCODE_INGEST_INTERVAL_MS
  );
  const opencodeBackfillRaw = Number(
    process.env.HARNESS_MEM_OPENCODE_BACKFILL_HOURS || DEFAULT_OPENCODE_BACKFILL_HOURS
  );
  const cursorIngestIntervalRaw = Number(
    process.env.HARNESS_MEM_CURSOR_INGEST_INTERVAL_MS || DEFAULT_CURSOR_INGEST_INTERVAL_MS
  );
  const cursorBackfillRaw = Number(
    process.env.HARNESS_MEM_CURSOR_BACKFILL_HOURS || DEFAULT_CURSOR_BACKFILL_HOURS
  );
  const antigravityIngestIntervalRaw = Number(
    process.env.HARNESS_MEM_ANTIGRAVITY_INGEST_INTERVAL_MS || DEFAULT_ANTIGRAVITY_INGEST_INTERVAL_MS
  );
  const antigravityBackfillRaw = Number(
    process.env.HARNESS_MEM_ANTIGRAVITY_BACKFILL_HOURS || DEFAULT_ANTIGRAVITY_BACKFILL_HOURS
  );
  const antigravityRootsRaw = process.env.HARNESS_MEM_ANTIGRAVITY_ROOTS || "";
  const antigravityWorkspaceRoots = antigravityRootsRaw
    .split(/[,\n]/)
    .map((root) => root.trim())
    .filter((root) => root.length > 0)
    .map((root) => resolveHomePath(root));
  const antigravityLogsRoot = resolveHomePath(
    process.env.HARNESS_MEM_ANTIGRAVITY_LOGS_ROOT || DEFAULT_ANTIGRAVITY_LOGS_ROOT
  );
  const antigravityWorkspaceStorageRoot = resolveHomePath(
    process.env.HARNESS_MEM_ANTIGRAVITY_WORKSPACE_STORAGE_ROOT || DEFAULT_ANTIGRAVITY_WORKSPACE_STORAGE_ROOT
  );
  const geminiIngestIntervalRaw = Number(
    process.env.HARNESS_MEM_GEMINI_INGEST_INTERVAL_MS || DEFAULT_GEMINI_INGEST_INTERVAL_MS
  );
  const geminiBackfillRaw = Number(
    process.env.HARNESS_MEM_GEMINI_BACKFILL_HOURS || DEFAULT_GEMINI_BACKFILL_HOURS
  );
  const searchRankingRaw = (process.env.HARNESS_MEM_SEARCH_RANKING || DEFAULT_SEARCH_RANKING).trim();
  const searchRanking = searchRankingRaw ? searchRankingRaw : DEFAULT_SEARCH_RANKING;
  const embeddingProviderRaw = (process.env.HARNESS_MEM_EMBEDDING_PROVIDER || "fallback").trim().toLowerCase();
  const embeddingProvider = embeddingProviderRaw || "fallback";
  const embeddingModel = (process.env.HARNESS_MEM_EMBEDDING_MODEL || "multilingual-e5").trim() || "multilingual-e5";
  const localModelsDir = (process.env.HARNESS_MEM_LOCAL_MODELS_DIR || "").trim();
  const openaiApiKey = (process.env.HARNESS_MEM_OPENAI_API_KEY || "").trim();
  const openaiEmbedModel = (process.env.HARNESS_MEM_OPENAI_EMBED_MODEL || "text-embedding-3-small").trim();
  const ollamaBaseUrl = (process.env.HARNESS_MEM_OLLAMA_BASE_URL || "http://127.0.0.1:11434").trim();
  const ollamaEmbedModel = (process.env.HARNESS_MEM_OLLAMA_EMBED_MODEL || "nomic-embed-text").trim();
  const proApiKey = (process.env.HARNESS_MEM_PRO_API_KEY || "").trim();
  const proApiUrl = (process.env.HARNESS_MEM_PRO_API_URL || "").trim();
  const adaptiveDefaults = loadAdaptiveThresholdDefaults();
  const adaptiveJaThreshold = Number(
    process.env.HARNESS_MEM_ADAPTIVE_JA_THRESHOLD || adaptiveDefaults.jaThreshold
  );
  const adaptiveCodeThreshold = Number(
    process.env.HARNESS_MEM_ADAPTIVE_CODE_THRESHOLD || adaptiveDefaults.codeThreshold
  );
  const consolidationIntervalRaw = Number(process.env.HARNESS_MEM_CONSOLIDATION_INTERVAL_MS || 60000);

  return {
    dbPath,
    bindHost,
    bindPort: Number.isFinite(bindPort) ? bindPort : DEFAULT_BIND_PORT,
    vectorDimension: clampLimit(Number(process.env.HARNESS_MEM_VECTOR_DIM || DEFAULT_VECTOR_DIM), DEFAULT_VECTOR_DIM, 32, 4096),
    embeddingProvider,
    embeddingModel,
    localModelsDir: localModelsDir || undefined,
    openaiApiKey,
    openaiEmbedModel,
    ollamaBaseUrl,
    ollamaEmbedModel,
    proApiKey,
    proApiUrl,
    adaptiveJaThreshold: Number.isFinite(adaptiveJaThreshold)
      ? Math.max(0, Math.min(1, adaptiveJaThreshold))
      : adaptiveDefaults.jaThreshold,
    adaptiveCodeThreshold: Number.isFinite(adaptiveCodeThreshold)
      ? Math.max(0, Math.min(1, adaptiveCodeThreshold))
      : adaptiveDefaults.codeThreshold,
    captureEnabled: envFlag("HARNESS_MEM_ENABLE_CAPTURE", true),
    retrievalEnabled: envFlag("HARNESS_MEM_ENABLE_RETRIEVAL", true),
    injectionEnabled: envFlag("HARNESS_MEM_ENABLE_INJECTION", true),
    codexHistoryEnabled: envFlag("HARNESS_MEM_ENABLE_CODEX_INGEST", true),
    codexProjectRoot: resolve(process.env.HARNESS_MEM_CODEX_PROJECT_ROOT || process.cwd()),
    codexSessionsRoot: resolveHomePath(process.env.HARNESS_MEM_CODEX_SESSIONS_ROOT || DEFAULT_CODEX_SESSIONS_ROOT),
    codexIngestIntervalMs: clampLimit(codexIngestIntervalRaw, DEFAULT_CODEX_INGEST_INTERVAL_MS, 1000, 300000),
    codexBackfillHours: clampLimit(codexBackfillRaw, DEFAULT_CODEX_BACKFILL_HOURS, 1, 24 * 365),
    opencodeIngestEnabled: envFlag("HARNESS_MEM_ENABLE_OPENCODE_INGEST", true),
    opencodeDbPath: resolveHomePath(process.env.HARNESS_MEM_OPENCODE_DB_PATH || DEFAULT_OPENCODE_DB_PATH),
    opencodeStorageRoot: resolveHomePath(
      process.env.HARNESS_MEM_OPENCODE_STORAGE_ROOT || DEFAULT_OPENCODE_STORAGE_ROOT
    ),
    opencodeIngestIntervalMs: clampLimit(
      opencodeIngestIntervalRaw,
      DEFAULT_OPENCODE_INGEST_INTERVAL_MS,
      1000,
      300000
    ),
    opencodeBackfillHours: clampLimit(opencodeBackfillRaw, DEFAULT_OPENCODE_BACKFILL_HOURS, 1, 24 * 365),
    cursorIngestEnabled: envFlag("HARNESS_MEM_ENABLE_CURSOR_INGEST", true),
    cursorEventsPath: resolveHomePath(process.env.HARNESS_MEM_CURSOR_EVENTS_PATH || DEFAULT_CURSOR_EVENTS_PATH),
    cursorIngestIntervalMs: clampLimit(
      cursorIngestIntervalRaw,
      DEFAULT_CURSOR_INGEST_INTERVAL_MS,
      1000,
      300000
    ),
    cursorBackfillHours: clampLimit(cursorBackfillRaw, DEFAULT_CURSOR_BACKFILL_HOURS, 1, 24 * 365),
    antigravityIngestEnabled: envFlag("HARNESS_MEM_ENABLE_ANTIGRAVITY_INGEST", false),
    antigravityWorkspaceRoots,
    antigravityLogsRoot,
    antigravityWorkspaceStorageRoot,
    antigravityIngestIntervalMs: clampLimit(
      antigravityIngestIntervalRaw,
      DEFAULT_ANTIGRAVITY_INGEST_INTERVAL_MS,
      1000,
      300000
    ),
    antigravityBackfillHours: clampLimit(
      antigravityBackfillRaw,
      DEFAULT_ANTIGRAVITY_BACKFILL_HOURS,
      1,
      24 * 365
    ),
    geminiIngestEnabled: envFlag("HARNESS_MEM_ENABLE_GEMINI_INGEST", true),
    geminiEventsPath: resolveHomePath(process.env.HARNESS_MEM_GEMINI_EVENTS_PATH || DEFAULT_GEMINI_EVENTS_PATH),
    geminiIngestIntervalMs: clampLimit(
      geminiIngestIntervalRaw,
      DEFAULT_GEMINI_INGEST_INTERVAL_MS,
      1000,
      300000
    ),
    geminiBackfillHours: clampLimit(geminiBackfillRaw, DEFAULT_GEMINI_BACKFILL_HOURS, 1, 24 * 365),
    claudeCodeIngestEnabled: envFlag("HARNESS_MEM_ENABLE_CLAUDE_CODE_INGEST", true),
    claudeCodeProjectsRoot: resolveHomePath(
      process.env.HARNESS_MEM_CLAUDE_CODE_PROJECTS_ROOT || DEFAULT_CLAUDE_CODE_PROJECTS_ROOT
    ),
    claudeCodeIngestIntervalMs: clampLimit(
      Number(process.env.HARNESS_MEM_CLAUDE_CODE_INGEST_INTERVAL_MS || DEFAULT_CLAUDE_CODE_INGEST_INTERVAL_MS),
      DEFAULT_CLAUDE_CODE_INGEST_INTERVAL_MS,
      1000,
      300000
    ),
    claudeCodeBackfillHours: clampLimit(
      Number(process.env.HARNESS_MEM_CLAUDE_CODE_BACKFILL_HOURS || DEFAULT_CLAUDE_CODE_BACKFILL_HOURS),
      DEFAULT_CLAUDE_CODE_BACKFILL_HOURS,
      1,
      24 * 365
    ),
    searchRanking,
    searchExpandLinks: envFlag("HARNESS_MEM_SEARCH_EXPAND_LINKS", DEFAULT_SEARCH_EXPAND_LINKS),
    rerankerEnabled: envFlag("HARNESS_MEM_RERANKER_ENABLED", false),
    consolidationEnabled: envFlag("HARNESS_MEM_CONSOLIDATION_ENABLED", true),
    consolidationIntervalMs: clampLimit(consolidationIntervalRaw, 60000, 5000, 600000),
    backendMode: parseBackendMode(process.env.HARNESS_MEM_BACKEND_MODE),
    managedEndpoint: (process.env.HARNESS_MEM_MANAGED_ENDPOINT || "").trim() || undefined,
    managedApiKey: (process.env.HARNESS_MEM_MANAGED_API_KEY || "").trim() || undefined,
    resumePackMaxTokens: (() => {
      const raw = Number(process.env.HARNESS_MEM_RESUME_PACK_MAX_TOKENS);
      return Number.isFinite(raw) && raw > 0 ? raw : undefined;
    })(),
    // TEAM-003: ユーザー・チーム識別
    userId: (process.env.HARNESS_MEM_USER_ID || "").trim() || undefined,
    teamId: (process.env.HARNESS_MEM_TEAM_ID || "").trim() || undefined,
    // GRAPH-003: グラフ探索最大ホップ数
    graphMaxHops: (() => {
      const raw = Number(process.env.HARNESS_MEM_GRAPH_MAX_HOPS);
      if (!Number.isFinite(raw) || raw <= 0) return undefined;
      return Math.min(Math.max(Math.floor(raw), 1), 5);
    })(),
  };
}
