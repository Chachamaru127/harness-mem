/**
 * §S109 D8 P0-OBS-001 — inject envelope (案C: structured + prose 並記)
 *
 * 正本は structured 側。prose は AI エージェントへの一人称指示文として併記する。
 * structured 側に kind / signals / action_hint / trace_id / confidence を持ち、
 * consumed_rate 計測のために signals[] が次ターンの tool call / 発話に
 * 出現したかどうかを後段で grep できるようにする。
 *
 * 不変条件:
 *   1. kind は VALID_KINDS のいずれか（実行時に throw で防御）
 *   2. trace_id は inj_YYYY-MM-DD_<suffix> 形式で全 envelope ユニーク
 *   3. prose に signals 全語が含まれることを validateProseContainsSignals で別途検証
 *
 * signals[] 設計指針 (S110-007, 2026-06-19):
 *   - signals[] には PII / 秘密情報を入れない。
 *   - 許容: structural label (observation_id, decision id, file path,
 *     function name, fixed tag, branch name, salient noun).
 *   - 不可: メール / 電話番号 / API key / 秘密の token / 顧客本名 / 自由文.
 *   - 理由: signals は inject_traces.signals_json に persist され、consume
 *     detector で「次ターン発話 / tool call に含まれたか」を grep する。
 *     PII を含めると顧客本文と同じ persistence 制約 (ZDR / retention) を
 *     signals 列にも適用する必要が出る。structural label 限定で
 *     persistence 境界を軽く保つのが本 envelope の前提。
 *   - 防御 layer は claude-code-harness 側 `client-redaction.yaml` に
 *     defensive note 済 — emitter 側が PII を signals に渡しても client
 *     経路で削られる。本 JSDoc は「最初から入れない」設計指針の正本。
 */

const VALID_KINDS = [
  "contradiction",
  "recall_chain",
  "risk_warn",
  "suggest",
] as const;

export type InjectKind = (typeof VALID_KINDS)[number];

export type InjectActionHint =
  | "warn_user_before_act"
  | "read_before_edit"
  | "consider_before_decide"
  | "no_action";

export interface InjectStructured {
  kind: InjectKind;
  signals: string[];
  action_hint: InjectActionHint | string;
  confidence: number;
  trace_id: string;
}

export interface InjectEnvelope {
  structured: InjectStructured;
  prose: string;
}

export interface CreateInjectEnvelopeInput {
  kind: InjectKind;
  signals: string[];
  action_hint: InjectActionHint | string;
  confidence: number;
  prose: string;
}

const VALID_KIND_SET = new Set<string>(VALID_KINDS);

function isValidKind(kind: string): kind is InjectKind {
  return VALID_KIND_SET.has(kind);
}

function generateTraceId(): string {
  const today = new Date().toISOString().slice(0, 10);
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  const raw =
    c?.randomUUID?.() ??
    `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  const suffix = raw.replace(/[^A-Za-z0-9]/g, "").slice(0, 8);
  return `inj_${today}_${suffix}`;
}

export function createInjectEnvelope(
  input: CreateInjectEnvelopeInput,
): InjectEnvelope {
  if (!isValidKind(input.kind as string)) {
    throw new Error(`unknown inject kind: ${input.kind as string}`);
  }
  return {
    structured: {
      kind: input.kind,
      signals: [...input.signals],
      action_hint: input.action_hint,
      confidence: input.confidence,
      trace_id: generateTraceId(),
    },
    prose: input.prose,
  };
}

export interface ValidationResult {
  ok: boolean;
  missing: string[];
}

/**
 * prose に signals 全語が verbatim で含まれているか検証する。
 * unit test で envelope 生成側に強制するための gate。
 */
export function validateProseContainsSignals(
  env: InjectEnvelope,
): ValidationResult {
  const missing = env.structured.signals.filter(
    (signal) => !env.prose.includes(signal),
  );
  return { ok: missing.length === 0, missing };
}
