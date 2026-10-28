#!/usr/bin/env bun
/**
 * Regenerates docs/specs/2026-10-living-memory/progress-dashboard.html from the
 * live harness-mem DB. Read-only against the DB; the only write is the HTML.
 *
 * Usage: bun scripts/progress-dashboard.ts
 * DB path: HARNESS_MEM_DB_PATH or ~/.harness-mem/harness-mem.db
 */
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

const REPO_ROOT = resolve(import.meta.dir, "..");
const OUT_PATH = join(REPO_ROOT, "docs/specs/2026-10-living-memory/progress-dashboard.html");
const DB_PATH = process.env.HARNESS_MEM_DB_PATH || join(homedir(), ".harness-mem", "harness-mem.db");
const STATE_DIR = join(homedir(), ".harness-mem");

function fmt(n: number): string {
  return Math.round(n).toLocaleString("en-US");
}

function nowJst(): string {
  const d = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return `${d.toISOString().slice(0, 16).replace("T", " ")} JST`;
}

function dirGb(path: string): number {
  try {
    const result = Bun.spawnSync({
      cmd: ["du", "-sk", path],
      stdout: "pipe",
      stderr: "ignore",
    });
    const kb = Number(result.stdout.toString().trim().split(/\s+/)[0]);
    return Number.isFinite(kb) ? (kb * 1024) / 1e9 : 0;
  } catch {
    return 0;
  }
}

function isLoopRunning(script: string): boolean {
  const result = Bun.spawnSync({ cmd: ["ps", "-axo", "args="], stdout: "pipe", stderr: "ignore" });
  return result.stdout.toString().split("\n").some(line =>
    /^\S*\bbun\s/.test(line.trim()) && line.includes(`scripts/${script}.ts`));
}

async function getHealth(): Promise<number> {
  try {
    const res = await fetch("http://127.0.0.1:37888/health/ready", {
      signal: AbortSignal.timeout(3000),
    });
    return res.status;
  } catch {
    return 0;
  }
}

const db = new Database(DB_PATH, { readonly: true });

const totals =
  db
    .query<{ total: number; keep: number; compact: number; fallback: number; blocked: number }, []>(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(decision = 'keep'), 0) AS keep,
              COALESCE(SUM(decision = 'compact'), 0) AS compact,
              COALESCE(SUM(fallback = 1), 0) AS fallback,
              COALESCE(SUM(batch_id LIKE 'blocked-%'), 0) AS blocked
         FROM mem_triage_decisions`,
    )
    .get() ?? { total: 0, keep: 0, compact: 0, fallback: 0, blocked: 0 };

const activeModel =
  db.query<{ value: string }, []>("SELECT value FROM mem_meta WHERE key = 'triage.active_model'").get()
    ?.value ?? null;

const pending = activeModel
  ? (db
      .query<{ n: number }, [string]>(
        `SELECT COUNT(*) AS n
           FROM mem_observations o
          WHERE o.archived_at IS NULL
            AND o.content IS NOT NULL
            AND length(o.content) > 0
            AND NOT EXISTS (
              SELECT 1 FROM mem_triage_decisions d
               WHERE d.observation_id = o.id AND d.model = ?
                 AND (d.fallback = 0 OR d.batch_id LIKE 'blocked-%' OR d.batch_id LIKE 'rejected-%')
            )`,
      )
      .get(activeModel)?.n ?? 0)
  : 0;

const rejected = db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM mem_triage_decisions WHERE batch_id LIKE 'rejected-%'").get()?.n ?? 0;
const last10m =
  db
    .query<{ n: number }, []>(
      "SELECT COUNT(*) AS n FROM mem_triage_decisions WHERE julianday(created_at) > julianday('now','-10 minutes')",
    )
    .get()?.n ?? 0;
const last1h =
  db
    .query<{ n: number }, []>(
      "SELECT COUNT(*) AS n FROM mem_triage_decisions WHERE julianday(created_at) > julianday('now','-1 hour')",
    )
    .get()?.n ?? 0;
const last24h =
  db
    .query<{ n: number }, []>(
      "SELECT COUNT(*) AS n FROM mem_triage_decisions WHERE julianday(created_at) > julianday('now','-1 day')",
    )
    .get()?.n ?? 0;

const summaryRows = db
  .query<{ status: string; n: number }, []>(
    "SELECT status, COUNT(*) AS n FROM mem_summary_jobs GROUP BY status",
  )
  .all();
const summary = { pending: 0, running: 0, completed: 0, failed: 0, blocked: 0 };
for (const row of summaryRows) {
  if (row.status in summary) summary[row.status as keyof typeof summary] = row.n;
}

const currentSummary = db.query<{ n: number }, []>(
  "SELECT COUNT(*) AS n FROM mem_summary_jobs WHERE model = 'claude-haiku-5-5' AND status = 'completed'",
).get()?.n ?? 0;
const emptyOutputRecovery = db.query<{ n: number }, []>(`SELECT COUNT(*) AS n FROM mem_summary_jobs old
  WHERE old.error = 'legacy_empty_summary_retry' AND NOT EXISTS (
    SELECT 1 FROM mem_summary_jobs done WHERE done.session_id = old.session_id AND done.status = 'completed')`).get()?.n ?? 0;

const summaryRunning = isLoopRunning("summary-loop");
const eligibleSummarySessions = Number((db.query(`SELECT COUNT(*) AS n FROM (
  SELECT o.session_id, o.project FROM mem_observations o
  JOIN mem_triage_decisions d ON d.observation_id = o.id
  WHERE d.decision = 'compact' AND COALESCE(d.durable, 0) < 0.5
    AND NOT EXISTS (SELECT 1 FROM mem_summary_jobs j WHERE j.session_id = o.session_id
      AND j.status IN ('completed', 'running', 'blocked'))
  GROUP BY o.session_id, o.project
)`).get() as { n: number }).n);
const summaryState = summaryRunning ? "実行中" : eligibleSummarySessions > 0 ? "停止（対象あり）" : "待機（対象0件）";

const archived =
  db
    .query<{ n: number }, []>("SELECT COUNT(*) AS n FROM mem_observations WHERE archived_at IS NOT NULL")
    .get()?.n ?? 0;

const health = await getHealth();
const archiveRunning = isLoopRunning("triage-compact-loop");
const triageRunning = isLoopRunning("triage-loop");

const decided = totals.total;
const keep = totals.keep;
const compact = totals.compact;
const fallback = totals.fallback;
const blocked = totals.blocked;
const transient = Math.max(0, fallback - blocked);
const totalUniverse = decided + pending;
const triagePct = totalUniverse > 0 ? (decided / totalUniverse) * 100 : 0;
const summaryTotal = summary.pending + summary.running + summary.completed + summary.failed + summary.blocked;
const summaryPct = summaryTotal > 0 ? (summary.completed / summaryTotal) * 100 : 0;
const archivePct = compact > 0 ? (archived / compact) * 100 : 0;
const lastJevAt = (db.query("SELECT MAX(created_at) AS t FROM mem_triage_decisions").get() as { t: string | null } | null)?.t ?? null;
const timeLabel = (iso: string | null): string => {
  if (!iso) return "記録なし";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "記録なし"
    : d.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tokyo" });
};
const jevState = pending <= 10 ? "idle" : triageRunning && health === 200 ? "on" : "off";
const summaryLlmOn = summaryRunning;

const rateWindow = last1h > 0 ? "直近1時間" : "直近24時間";
const ratePerMin = last1h > 0 ? last1h / 60 : last24h / 1440;
const rateLabel = ratePerMin >= 1 ? fmt(ratePerMin) : ratePerMin.toFixed(1);
const etaRatePerMin = Math.max(ratePerMin, last24h / 1440);
const etaDays = triageRunning && etaRatePerMin > 0 ? pending / etaRatePerMin / 1440 : null;
const etaText =
  etaDays === null ? "n/a" : etaDays < 1 ? `約${Math.max(1, Math.round(etaDays * 24))}時間` : `約${etaDays.toFixed(1)}日`;

const dbGb = existsSync(DB_PATH) ? statSync(DB_PATH).size / 1e9 : 0;
const backupsGb = dirGb(join(STATE_DIR, "backups"));
const modelsGb = dirGb(join(STATE_DIR, "models"));
const totalGb = dbGb + backupsGb + modelsGb;
const dbStackPct = totalGb > 0 ? (dbGb / totalGb) * 100 : 0;
const backupsStackPct = totalGb > 0 ? (backupsGb / totalGb) * 100 : 0;
const modelsStackPct = totalGb > 0 ? (modelsGb / totalGb) * 100 : 0;
const reductionPct = Math.round((1 - dbGb / 26.3) * 100);
const reductionLabel = reductionPct >= 0 ? `−${reductionPct}%` : `+${Math.abs(reductionPct)}%`;

const dashOffset = (339.29 * (1 - triagePct / 100)).toFixed(1);
const healthPill =
  health === 200
    ? `<span class="pill live"><i></i>記憶サーバー稼働中</span>`
    : `<span class="pill stop"><i></i>停止中（health ${health || "000"}）</span>`;
const healthPillValue = health === 200 ? "health 200" : `health ${health || "000"}`;
const triageChip =
  pending <= 10
    ? `<span class="chip done">完了</span>`
    : !triageRunning
      ? `<span class="chip stop">停止</span>`
      : health === 200
        ? `<span class="chip run">実行中</span>`
        : `<span class="chip stop">停止</span>`;
const summaryChip =
  health !== 200
    ? `<span class="chip stop">停止</span>`
    : summaryRunning
      ? `<span class="chip run">実行中</span>`
      : `<span class="chip wait">${summaryState}</span>`;
const archiveChip = archiveRunning
  ? `<span class="chip run">実行中</span>`
  : `<span class="chip wait">待機</span>`;
const stagesHead = !triageRunning
  ? "仕分けは停止中。要約と archive の実プロセスは下記に表示。"
  : "仕分けを実行中。要約と archive は順番に実行。purge / VACUUM は対象外。";


const freelistPages = Number((db.query("PRAGMA freelist_count").get() as { freelist_count?: number } | null)?.freelist_count ?? 0);
const pageSize = Number((db.query("PRAGMA page_size").get() as { page_size?: number } | null)?.page_size ?? 0);
const freelistGb = (freelistPages * pageSize) / 1e9;
const lastAudit = (action: string) =>
  (db.query("SELECT created_at FROM mem_audit_log WHERE action = ? ORDER BY created_at DESC LIMIT 1").get(action) as { created_at: string } | null)?.created_at ?? null;
const lastPurgeAt = lastAudit("admin.purge.execute");
const lastVacuumAt = lastAudit("admin.vacuum.execute");
const purgedStubs = Number((db.query("SELECT count(*) AS n FROM mem_archive_stubs WHERE archive_state = 'purged'").get() as { n: number }).n);
const archivedStubs = Number((db.query("SELECT count(*) AS n FROM mem_archive_stubs WHERE archive_state = 'archived'").get() as { n: number }).n);
const jst = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo", month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "未実行";
const vacuumDone = lastVacuumAt !== null && (lastPurgeAt === null || lastVacuumAt >= lastPurgeAt);
const vacuumNeeded = freelistGb >= 1;

const STYLES = `
  :root{
    --bg:#f5f7fb; --card:#ffffff; --ink:#0f172a; --muted:#64748b; --line:#e2e8f0;
    --blue:#2563eb; --blue-soft:#dbeafe; --green:#16a34a; --green-soft:#dcfce7;
    --amber:#d97706; --amber-soft:#fef3c7; --red:#dc2626; --red-soft:#fee2e2;
    --purple:#7c3aed; --purple-soft:#ede9fe; --teal:#0d9488; --teal-soft:#ccfbf1;
  }
  *{box-sizing:border-box}
  html,body{margin:0;padding:0}
  body{
    background:
      radial-gradient(1100px 480px at 12% -12%, #e3edff 0%, rgba(227,237,255,0) 62%),
      radial-gradient(900px 420px at 92% 0%, #e8fbf6 0%, rgba(232,251,246,0) 58%),
      var(--bg);
    color:var(--ink);
    font-family:-apple-system,BlinkMacSystemFont,"Hiragino Sans","Noto Sans JP","Yu Gothic",sans-serif;
    -webkit-font-smoothing:antialiased;
    line-height:1.6;
  }
  .wrap{max-width:1120px;margin:0 auto;padding:28px 20px 44px}
  .head{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;flex-wrap:wrap;margin-bottom:18px}
  .brand{display:flex;align-items:center;gap:14px}
  .mark{
    width:46px;height:46px;border-radius:13px;flex:0 0 46px;
    background:linear-gradient(145deg,#3b82f6,#1d4ed8);
    color:#fff;font-weight:800;font-size:15px;letter-spacing:-.02em;
    display:grid;place-items:center;box-shadow:0 6px 16px rgba(37,99,235,.28)
  }
  .eyebrow{font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--blue);margin-bottom:1px}
  h1{font-size:25px;line-height:1.25;letter-spacing:-.035em;margin:0;font-weight:800}
  .sub{font-size:12.5px;color:var(--muted);margin-top:2px}
  .pills{display:flex;gap:8px;flex-wrap:wrap;padding-top:4px}
  .pill{
    display:inline-flex;align-items:center;gap:7px;padding:6px 11px;border-radius:999px;
    background:rgba(255,255,255,.8);border:1px solid rgba(15,23,42,.07);
    font-size:11.5px;font-weight:600;color:#475569;white-space:nowrap;
    box-shadow:0 1px 2px rgba(15,23,42,.03)
  }
  .pill.live{background:var(--green-soft);border-color:#bbf7d0;color:#166534}
  .pill.live i{width:7px;height:7px;border-radius:50%;background:var(--green);display:block;box-shadow:0 0 0 3px rgba(22,163,74,.16)}
  .pill.stop{background:var(--red-soft);border-color:#fecaca;color:#991b1b}
  .pill.stop i{width:7px;height:7px;border-radius:50%;background:var(--red);display:block;box-shadow:0 0 0 3px rgba(220,38,38,.16)}
  .card{
    background:var(--card);border:1px solid rgba(15,23,42,.065);border-radius:18px;
    box-shadow:0 1px 2px rgba(15,23,42,.035),0 10px 30px rgba(15,23,42,.045);
    padding:22px
  }
  .card-head{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:14px}
  h2{font-size:15px;font-weight:800;letter-spacing:-.015em;margin:0}
  .muted{font-size:12px;color:var(--muted)}
  .tag{font-size:10.5px;font-weight:700;padding:4px 9px;border-radius:999px;letter-spacing:.02em}
  .tag.blue{background:var(--blue-soft);color:#1d4ed8}
  .hero{display:grid;grid-template-columns:1.12fr .88fr;gap:16px;margin-bottom:16px}
  .triage-body{display:flex;align-items:center;gap:22px}
  .focus{padding:2px 0}
  .focus-row{display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid #f1f5f9}
  .focus-row:last-of-type{border-bottom:0}
  .focus-row .fname{flex:1;min-width:0;display:flex;flex-direction:column}
  .focus-row strong{font-size:14px;font-weight:800}
  .focus-row small{font-size:11.5px;color:var(--muted);line-height:1.5}
  .focus-row .fpct{font-size:20px;font-weight:800;letter-spacing:-.03em;white-space:nowrap}
  .focus-row.blocked .fpct{font-size:10.5px;font-weight:700;color:var(--amber);background:var(--amber-soft);padding:3px 8px;border-radius:999px}
  .focus-bar{height:8px;border-radius:999px;background:#eef2f7;overflow:hidden;margin:0 0 8px}
  .focus-bar i{display:block;height:100%;border-radius:999px}
  .llm{margin-bottom:16px}
  .llm-row{display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid #f1f5f9}
  .llm-row:last-of-type{border-bottom:0}
  .llm-row .lname{flex:1;min-width:0}
  .llm-row strong{font-size:13.5px;font-weight:800}
  .llm-row small{display:block;font-size:11.5px;color:var(--muted)}
  .llm-dot{width:9px;height:9px;border-radius:50%;flex:0 0 9px}
  .llm-dot.on{background:var(--green);box-shadow:0 0 0 3px rgba(22,163,74,.15)}
  .llm-dot.idle{background:#94a3b8;box-shadow:0 0 0 3px rgba(148,163,184,.15)}
  .llm-dot.off{background:var(--red);box-shadow:0 0 0 3px rgba(220,38,38,.15)}
  .donut{width:164px;height:164px;flex:0 0 164px;display:block}
  .donut .pct{font-size:30px;font-weight:800;letter-spacing:-.04em;fill:var(--ink)}
  .donut .cap{font-size:10.5px;font-weight:700;fill:var(--muted);letter-spacing:.08em}
  .triage-copy{min-width:0;flex:1}
  .big{font-size:30px;font-weight:800;letter-spacing:-.04em;line-height:1.1;white-space:nowrap}
  .big small{font-size:13px;font-weight:600;color:var(--muted);letter-spacing:0;white-space:normal}
  .triage-copy p{font-size:13px;color:#475569;margin:8px 0 12px}
  .triage-copy strong{color:var(--ink);font-weight:800}
  .split{display:flex;gap:16px;flex-wrap:wrap;font-size:12px;color:#475569}
  .split span{display:inline-flex;align-items:center;gap:6px}
  .dot{width:8px;height:8px;border-radius:50%;display:inline-block}
  .dot.keep{background:var(--blue)}
  .dot.compact{background:var(--amber)}
  .footnote{border-top:1px solid var(--line);margin-top:16px;padding-top:11px;font-size:11.5px;color:var(--muted)}
  .now .card-head{margin-bottom:8px}
  .now-row{display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid #f1f5f9}
  .now-row:last-of-type{border-bottom:0}
  .status-dot{width:8px;height:8px;border-radius:50%;background:var(--blue);flex:0 0 8px;box-shadow:0 0 0 3px rgba(37,99,235,.13)}
  .status-dot.purple{background:var(--purple);box-shadow:0 0 0 3px rgba(124,58,237,.13)}
  .status-dot.teal{background:var(--teal);box-shadow:0 0 0 3px rgba(13,148,136,.13)}
  .now-row div{flex:1;min-width:0;display:flex;flex-direction:column}
  .now-row strong{font-size:13px;font-weight:700}
  .now-row small{font-size:11.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .chip{font-size:10.5px;font-weight:700;padding:3px 8px;border-radius:999px;white-space:nowrap}
  .chip.run{background:var(--green-soft);color:#166534}
  .chip.wait{background:var(--amber-soft);color:#92400e}
  .chip.stop{background:#f1f5f9;color:#475569}
  .chip.done{background:var(--blue-soft);color:#1d4ed8}
  .db-box{margin-top:12px;padding:13px 14px;border-radius:13px;background:linear-gradient(135deg,#eff6ff,#f8fafc);border:1px solid #dbeafe;display:grid;grid-template-columns:1fr auto;align-items:center;gap:2px 10px}
  .db-box span{font-size:11.5px;font-weight:700;color:#1e40af}
  .db-box strong{font-size:23px;font-weight:800;letter-spacing:-.035em;grid-row:span 2;color:#1e3a8a}
  .db-box small{font-size:11px;color:#64748b}
  .stages{margin-bottom:16px}
  .section-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:6px}
  .stage{display:grid;grid-template-columns:38px 1fr;gap:13px;padding:15px 0;border-top:1px solid #f1f5f9}
  .stage:first-of-type{border-top:0;padding-top:10px}
  .num{width:32px;height:32px;border-radius:10px;display:grid;place-items:center;font-size:11px;font-weight:800;letter-spacing:.02em}
  .num.blue{background:var(--blue-soft);color:#1d4ed8}
  .num.purple{background:var(--purple-soft);color:#6d28d9}
  .num.teal{background:var(--teal-soft);color:#0f766e}
  .num.amber{background:var(--amber-soft);color:#b45309}
  .num.slate{background:#f1f5f9;color:#475569}
  .stage-top{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
  .stage-title{display:flex;align-items:baseline;gap:9px;flex-wrap:wrap}
  .stage-title strong{font-size:14px;font-weight:800}
  .stage-sub{font-size:11.5px;color:var(--muted)}
  .bar{height:8px;border-radius:999px;background:#eef2f7;overflow:hidden;margin:9px 0 7px}
  .bar i{display:block;height:100%;border-radius:999px}
  .stage-meta{display:flex;gap:16px;flex-wrap:wrap;font-size:11.5px;color:var(--muted)}
  .stage-meta strong{color:var(--ink);font-weight:800}
  .stage-note{font-size:11px;color:#94a3b8;margin-top:3px}
  .waitbar{height:8px;border-radius:999px;background:repeating-linear-gradient(90deg,#eef2f7 0 8px,#f8fafc 8px 14px);margin:9px 0 7px}
  .bottom{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px}
  .stack{display:flex;height:19px;border-radius:999px;overflow:hidden;background:#eef2f7;margin:18px 0 13px}
  .stack i{display:block;height:100%}
  .legend{display:flex;gap:14px;flex-wrap:wrap;font-size:11.5px;color:#475569}
  .legend span{display:inline-flex;align-items:center;gap:6px}
  .legend b{color:var(--ink);font-weight:800}
  .note{font-size:11.5px;color:var(--muted);margin:12px 0 0;padding-top:11px;border-top:1px solid var(--line)}
  .done{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:11px}
  .done li{display:flex;gap:9px;align-items:flex-start}
  .check{width:18px;height:18px;flex:0 0 18px;border-radius:50%;background:var(--green-soft);color:#15803d;font-size:11px;font-weight:800;display:grid;place-items:center;margin-top:2px}
  .done div{display:flex;flex-direction:column;line-height:1.45}
  .done strong{font-size:12.5px;font-weight:700}
  .done small{font-size:11px;color:var(--muted)}
  .next{margin-top:14px;padding:10px 12px;border-radius:11px;background:#f8fafc;border:1px solid var(--line);font-size:11.5px;color:#475566}
  .next span{display:inline-block;background:var(--blue);color:#fff;font-weight:800;font-size:10px;padding:2px 7px;border-radius:6px;margin-right:7px;letter-spacing:.04em}
  footer{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap;font-size:11px;color:#94a3b8;padding:2px 4px}
  @media (max-width:900px){
    .hero{grid-template-columns:1fr}
    .bottom{grid-template-columns:1fr}
  }
  @media (max-width:560px){
    .wrap{padding:20px 13px 34px}
    h1{font-size:21px}
    .card{padding:17px;border-radius:15px}
    .triage-body{gap:14px}
    .donut{width:128px;height:128px;flex-basis:128px}
    .big{font-size:24px}
    .stage{grid-template-columns:1fr;gap:7px}
    .num{display:none}
    .pills{padding-top:0}
    .stage-meta{gap:10px}
  }
`;

const html = `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>harness-mem 圧縮パイプライン</title>
<style>${STYLES}</style>
</head>
<body>
<div class="wrap">

  <header class="head">
    <div class="brand">
      <div class="mark">hm</div>
      <div>
        <div class="eyebrow">harness-mem</div>
        <h1>記憶の圧縮パイプライン</h1>
        <div class="sub">${nowJst()} 時点</div>
      </div>
    </div>
    <div class="pills">
      ${healthPill}
      <span class="pill">${healthPillValue}</span>
      
    </div>
  </header>

  <section class="hero">
    <div class="card">
      <div class="card-head">
        <h2>現在着手中のタスク</h2>
        <span class="tag blue">${summaryRunning || archiveRunning || triageRunning ? "実行中" : "待機"}</span>
      </div>
      <div class="focus">
        <div class="focus-row">
          <div class="fname"><strong>archive</strong><small>要約済みの行を保存し、ベクトルも整理</small></div>
          <span class="fpct">${archivePct.toFixed(1)}%</span>
        </div>
        <div class="focus-bar"><i style="width:${archivePct.toFixed(1)}%;background:linear-gradient(90deg,#2dd4bf,#0d9488)"></i></div>
        <div class="focus-row">
          <div class="fname"><strong>要約</strong><small>${fmt(summary.completed)} 完了 / ${summary.running} 実行中 / ${summary.pending} 待ち</small></div>
          <span class="fpct">${summaryPct.toFixed(1)}%</span>
        </div>
        <div class="focus-bar"><i style="width:${summaryPct.toFixed(1)}%;background:linear-gradient(90deg,#a78bfa,#7c3aed)"></i></div>
        <div class="focus-row blocked">
          <div class="fname"><strong>recall 検証</strong><small>検索で思い出せるか確認。未通過のため purge は停止</small></div>
          <span class="fpct">未通過</span>
        </div>
      </div>
      <div class="footnote">仕分け済み ${fmt(decided)} 行。要約対象 ${fmt(eligibleSummarySessions)} セッション。要約と archive は時間を分けて実行。</div>
    </div>

    <div class="card now">
      <div class="card-head"><h2>いま動いているもの</h2></div>
      <div class="now-row">
        <span class="status-dot"></span>
        <div><strong>仕分け（Jev）</strong><small>${pending <= 10 ? "完了。LLM は待機中" : `${rateLabel} 行/分で処理（${rateWindow}）`}</small></div>
        ${triageChip}
      </div>
      <div class="now-row">
        <span class="status-dot purple"></span>
        <div><strong>要約（claude-haiku-5-5）</strong><small>${fmt(currentSummary)} 完了（Haiku） / 対象 ${eligibleSummarySessions}件 / ${summaryState}</small></div>
        ${summaryChip}
      </div>
      <div class="now-row">
        <span class="status-dot teal"></span>
        <div><strong>archive（LLMなし）</strong><small>${fmt(archived)} 行を保存済み</small></div>
        <span class="chip run">${archiveRunning ? "実行中" : "待機"}</span>
      </div>
      <div class="db-box">
        <span>DB サイズ</span>
        <strong>${dbGb.toFixed(1)} GB</strong>
        <small>ベクトル整理前 26.3GB から ${reductionLabel}</small>
      </div>
    </div>
  </section>

  <section class="card stages">
    <div class="section-head">
      <h2>5つの工程</h2>
      <span class="muted">${stagesHead}</span>
    </div>

    <div class="stage">
      <div class="num blue">01</div>
      <div>
        <div class="stage-top">
          <div class="stage-title"><strong>仕分け</strong><span class="stage-sub">残す / 圧縮する / 捨てる を判定</span></div>
          ${triageChip}
        </div>
        <div class="bar"><i style="width:${triagePct.toFixed(1)}%;background:linear-gradient(90deg,#60a5fa,#2563eb)"></i></div>
        <div class="stage-meta"><span><strong>${triagePct.toFixed(2)}%</strong> ${fmt(decided)} / ${fmt(totalUniverse)} 行</span><span>残り ${fmt(pending)} 行 / リクエスト拒否で保留 ${fmt(rejected)} 行</span><span>${pending <= 10 ? "完了" : triageRunning ? `ETA ${etaText}` : "停止中（ETA未算出）"}</span></div>
        <div class="stage-note">keep ${fmt(keep)} 行、compact ${fmt(compact)} 行。判定は Jev。interval 1分で実測 ${rateLabel} 行/分。</div>
      </div>
    </div>

    <div class="stage">
      <div class="num purple">02</div>
      <div>
        <div class="stage-top">
          <div class="stage-title"><strong>要約</strong><span class="stage-sub">compact 行をセッション単位で要約</span></div>
          ${summaryChip}
        </div>
        <div class="bar"><i style="width:${summaryPct.toFixed(1)}%;background:linear-gradient(90deg,#a78bfa,#7c3aed)"></i></div>
        <div class="stage-meta"><span><strong>${summaryPct.toFixed(1)}%</strong> 過去を含むジョブ ${fmt(summaryTotal)} 件</span><span>completed ${fmt(summary.completed)}</span><span>running ${summary.running} / pending ${summary.pending}</span></div>
        <div class="stage-note">blocked ${summary.blocked}、failed ${summary.failed}。空出力からの回復待ち ${emptyOutputRecovery}件。failedには別モデルで回復済みの過去履歴も含む。4並列、effort low。</div>
      </div>
    </div>

    <div class="stage">
      <div class="num teal">03</div>
      <div>
        <div class="stage-top">
          <div class="stage-title"><strong>archive</strong><span class="stage-sub">要約済みの行を保存し、ベクトルも整理</span></div>
          ${archiveChip}
        </div>
        <div class="bar"><i style="width:${archivePct.toFixed(1)}%;background:linear-gradient(90deg,#2dd4bf,#0d9488)"></i></div>
        <div class="stage-meta"><span><strong>${archivePct.toFixed(1)}%</strong> ${fmt(archived)} / ${fmt(compact)} 行</span><span>要約が付いた順</span><span>ベクトルも同時に削除</span></div>
        <div class="stage-note">compactでもdurableが0.5以上の行は保存する。未要約や秘密検出による保留行もarchiveしない。</div>
      </div>
    </div>

    <div class="stage">
      <div class="num amber">04</div>
      <div>
        <div class="stage-top">
          <div class="stage-title"><strong>purge</strong><span class="stage-sub">復元できる行だけを削除</span></div>
          <span class="chip ${lastPurgeAt ? "done" : "wait"}">${lastPurgeAt ? "完了" : "未実行"}</span>
        </div>
        <div class="bar"><i style="width:100%;background:linear-gradient(90deg,#fbbf24,#d97706)"></i></div>
        <div class="stage-meta"><span><strong>${fmt(purgedStubs)} 行</strong> の本文を削除済み</span><span>最終実行 ${jst(lastPurgeAt)}</span><span>本文が残る archive ${fmt(archivedStubs)} 行</span></div>
        <div class="stage-note">本文が残る行（要約を含む）は対象外。追加の purge は本人承認ごとに実行する。</div>
      </div>
    </div>

    <div class="stage">
      <div class="num slate">05</div>
      <div>
        <div class="stage-top">
          <div class="stage-title"><strong>VACUUM</strong><span class="stage-sub">削除した領域を実際に解放</span></div>
          <span class="chip ${vacuumNeeded ? "wait" : vacuumDone ? "done" : "wait"}">${vacuumNeeded ? "実行待ち" : vacuumDone ? "完了" : "待機"}</span>
        </div>
        ${vacuumDone && !vacuumNeeded ? `<div class="bar"><i style="width:100%;background:linear-gradient(90deg,#94a3b8,#475569)"></i></div>` : `<div class="waitbar"></div>`}
        <div class="stage-meta"><span><strong>空き ${freelistGb.toFixed(2)}GB</strong></span><span>最終実行 ${jst(lastVacuumAt)}</span><span>26.7GB → 15.6GB（10/27）</span></div>
        <div class="stage-note">${vacuumNeeded ? "空きページが 1GB 以上ある。daemon を止めて VACUUM すると縮む。" : "空きページがほぼ無いため、再実行しても縮まない。次の purge の後に実行する。"}</div>
      </div>
    </div>
  </section>

  <section class="card llm">
    <div class="card-head"><h2>LLM の稼働状況</h2><span class="muted">仕分けと要約で使うモデル</span></div>
    <div class="llm-row">
      <span class="llm-dot ${jevState}"></span>
      <div class="lname"><strong>Jev 1.14.0（仕分け）</strong><small>Cloudflare 経由。最後の判定 ${timeLabel(lastJevAt)}</small></div>
      <span class="chip ${jevState === "on" ? "run" : jevState === "idle" ? "wait" : "stop"}">${jevState === "on" ? "実行中" : jevState === "idle" ? "待機（完了）" : "停止"}</span>
    </div>
    <div class="llm-row">
      <span class="llm-dot ${summaryLlmOn ? "on" : "idle"}"></span>
      <div class="lname"><strong>claude-haiku-5-5（要約）</strong><small>Claude Code 既存Max契約経由。Haiku完了 ${fmt(currentSummary)} / 実行中 ${summary.running} / 待ち ${summary.pending}</small></div>
      <span class="chip ${summaryLlmOn ? "run" : "wait"}">${summaryState}</span>
    </div>
    <div class="llm-row">
      <span class="llm-dot idle"></span>
      <div class="lname"><strong>Clairic（事実抽出）</strong><small>今回のHaiku要約では無効</small></div>
      <span class="chip wait">無効</span>
    </div>
    <div class="footnote">要約モデルは claude-haiku-5-5。状態は実プロセスで判定。DBのrunning件数は保存されたジョブ状態であり、稼働の証明には使わない。</div>
  </section>

  <section class="bottom">
    <div class="card">
      <div class="card-head"><h2>データの内訳</h2><span class="muted">合計 ${Math.round(totalGb)}GB</span></div>
      <div class="stack">
        <i style="width:${dbStackPct.toFixed(1)}%;background:#2563eb"></i>
        <i style="width:${backupsStackPct.toFixed(1)}%;background:#94a3b8"></i>
        <i style="width:${modelsStackPct.toFixed(1)}%;background:#0d9488"></i>
      </div>
      <div class="legend">
        <span><i class="dot" style="background:#2563eb"></i>DB <b>${dbGb.toFixed(0)}GB</b></span>
        <span><i class="dot" style="background:#94a3b8"></i>backups <b>${backupsGb.toFixed(0)}GB</b></span>
        <span><i class="dot" style="background:#0d9488"></i>models <b>${modelsGb.toFixed(0)}GB</b></span>
      </div>
      <p class="note">backups は purge 前の 1 本（2026-10-27）。古い 2 本は削除済み。</p>
    </div>

    <div class="card">
      <div class="card-head"><h2>完了済み / 次にやること</h2></div>
      <ul class="done">
        <li><span class="check">✓</span><div><strong>L2 ベクトル整理</strong><small>不要な 667k 行を削除。26.3GB → 20.2GB（−6.1GB）。</small></div></li>
        <li><span class="check">✓</span><div><strong>purge と VACUUM</strong><small>${fmt(purgedStubs)} 行の本文を削除。DB 26.7GB → 15.6GB（${jst(lastVacuumAt)}）。</small></div></li>
        <li><span class="check">✓</span><div><strong>秘密情報の除去</strong><small>検出して削除し、スキャナを強化。要約の出力も検査する。</small></div></li>
      </ul>
      <div class="next"><span>次</span>${pending <= 10 ? "仕分け確認" : triageRunning ? `仕分け完了（${etaText}）` : "仕分けの停止原因を確認"} → 要約の消化 → archive。次の purge / VACUUM は本人承認後。</div>
    </div>
  </section>

  <footer>
    <span>データ源: mem_triage_decisions / mem_summary_jobs / mem_observations / du</span>
    <span>${nowJst()} 時点。</span>
  </footer>

</div>
</body>
</html>`;

mkdirSync(dirname(OUT_PATH), { recursive: true });
writeFileSync(OUT_PATH, html, "utf8");

console.log(
  JSON.stringify(
    {
      out: OUT_PATH,
      decided,
      pending,
      keep,
      compact,
      triage_pct: Number(triagePct.toFixed(1)),
      rate_per_min: Number(ratePerMin.toFixed(2)),
      rate_window: rateWindow,
      eta_days: etaDays === null ? null : Number(etaDays.toFixed(2)),
      summary,
      archived,
      db_gb: Number(dbGb.toFixed(2)),
      backups_gb: Number(backupsGb.toFixed(2)),
      models_gb: Number(modelsGb.toFixed(2)),
      health,
      summary_running: summaryRunning,
      eligible_summary_sessions: eligibleSummarySessions,
      archive_running: archiveRunning,
      triage_running: triageRunning,
    },
    null,
    2,
  ),
);

db.close();
