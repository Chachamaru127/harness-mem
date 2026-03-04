import { useCallback, useEffect, useState } from "react";
import { fetchTokenStats } from "../lib/api";
import { getUiCopy } from "../lib/i18n";
import type { TokenStatsRow, TokenStatsTotals, UiLanguage } from "../lib/types";

interface CostPanelProps {
  language: UiLanguage;
  project?: string;
}

type GroupBy = "model" | "day" | "project";
type TimeRange = "7d" | "30d" | "all";

function formatCost(value: number): string {
  if (value === 0) return "$0.00";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  return `$${value.toFixed(2)}`;
}

function formatTokens(value: number): string {
  if (value === 0) return "0";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
  return String(value);
}

function getSinceDate(range: TimeRange): string | undefined {
  if (range === "all") return undefined;
  const days = range === "7d" ? 7 : 30;
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString();
}

export function CostPanel({ language, project }: CostPanelProps) {
  const copy = getUiCopy(language);
  const [rows, setRows] = useState<TokenStatsRow[]>([]);
  const [totals, setTotals] = useState<TokenStatsTotals | null>(null);
  const [groupBy, setGroupBy] = useState<GroupBy>("model");
  const [timeRange, setTimeRange] = useState<TimeRange>("30d");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadData = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetchTokenStats({
        groupBy,
        since: getSinceDate(timeRange),
        project: project === "__all__" ? undefined : project,
      });
      if (response.ok) {
        setRows(response.items);
        const meta = response.meta as Record<string, unknown>;
        if (meta.totals && typeof meta.totals === "object") {
          setTotals(meta.totals as TokenStatsTotals);
        }
      } else {
        setError(response.error || "Failed to load cost data");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [groupBy, timeRange, project]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const groupLabel = groupBy === "model" ? copy.costs.model : groupBy === "day" ? copy.costs.day : copy.costs.project;

  return (
    <div className="cost-panel">
      <div className="cost-header">
        <div>
          <h2 className="panel-title">{copy.costs.title}</h2>
          <p className="panel-subtitle">{copy.costs.subtitle}</p>
        </div>
        <button type="button" className="cost-refresh-btn" onClick={() => void loadData()} disabled={loading}>
          {copy.costs.refresh}
        </button>
      </div>

      {/* KPI Cards */}
      {totals && totals.total_cost > 0 && (
        <div className="cost-kpi-grid">
          <div className="cost-kpi-card cost-kpi-total">
            <span className="cost-kpi-label">{copy.costs.totalCost}</span>
            <span className="cost-kpi-value">{formatCost(totals.total_cost)}</span>
          </div>
          <div className="cost-kpi-card">
            <span className="cost-kpi-label">{copy.costs.inputTokens}</span>
            <span className="cost-kpi-value">{formatTokens(totals.total_input_tokens)}</span>
          </div>
          <div className="cost-kpi-card">
            <span className="cost-kpi-label">{copy.costs.outputTokens}</span>
            <span className="cost-kpi-value">{formatTokens(totals.total_output_tokens)}</span>
          </div>
          <div className="cost-kpi-card">
            <span className="cost-kpi-label">{copy.costs.messages}</span>
            <span className="cost-kpi-value">{formatTokens(totals.message_count)}</span>
          </div>
        </div>
      )}

      {/* Controls */}
      <div className="cost-controls">
        <div className="cost-group-buttons" role="group" aria-label="Group by">
          <button
            type="button"
            className={`cost-group-btn ${groupBy === "model" ? "active" : ""}`}
            onClick={() => setGroupBy("model")}
          >
            {copy.costs.groupByModel}
          </button>
          <button
            type="button"
            className={`cost-group-btn ${groupBy === "day" ? "active" : ""}`}
            onClick={() => setGroupBy("day")}
          >
            {copy.costs.groupByDay}
          </button>
          <button
            type="button"
            className={`cost-group-btn ${groupBy === "project" ? "active" : ""}`}
            onClick={() => setGroupBy("project")}
          >
            {copy.costs.groupByProject}
          </button>
        </div>
        <div className="cost-range-buttons" role="group" aria-label="Time range">
          <button
            type="button"
            className={`cost-range-btn ${timeRange === "7d" ? "active" : ""}`}
            onClick={() => setTimeRange("7d")}
          >
            {copy.costs.last7Days}
          </button>
          <button
            type="button"
            className={`cost-range-btn ${timeRange === "30d" ? "active" : ""}`}
            onClick={() => setTimeRange("30d")}
          >
            {copy.costs.last30Days}
          </button>
          <button
            type="button"
            className={`cost-range-btn ${timeRange === "all" ? "active" : ""}`}
            onClick={() => setTimeRange("all")}
          >
            {copy.costs.allTime}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && <p className="cost-error">{error}</p>}

      {/* Loading */}
      {loading && <p className="cost-loading">{copy.loading}</p>}

      {/* No data */}
      {!loading && !error && rows.length === 0 && (
        <p className="cost-empty">{copy.costs.noData}</p>
      )}

      {/* Cost Table */}
      {rows.length > 0 && (
        <div className="cost-table-wrapper">
          <table className="cost-table">
            <thead>
              <tr>
                <th>{groupLabel}</th>
                <th className="num">{copy.costs.inputTokens}</th>
                <th className="num">{copy.costs.outputTokens}</th>
                <th className="num">{copy.costs.cacheWriteTokens}</th>
                <th className="num">{copy.costs.cacheReadTokens}</th>
                <th className="num">{copy.costs.messages}</th>
                <th className="num cost-col">{copy.costs.totalCost}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label || "unknown"}>
                  <td className="cost-label-cell">{row.label || "unknown"}</td>
                  <td className="num">{formatTokens(row.total_input_tokens)}</td>
                  <td className="num">{formatTokens(row.total_output_tokens)}</td>
                  <td className="num">{formatTokens(row.total_cache_write_tokens)}</td>
                  <td className="num">{formatTokens(row.total_cache_read_tokens)}</td>
                  <td className="num">{row.message_count}</td>
                  <td className="num cost-col">{formatCost(row.total_cost)}</td>
                </tr>
              ))}
            </tbody>
            {totals && (
              <tfoot>
                <tr className="cost-total-row">
                  <td><strong>{copy.costs.totalLabel}</strong></td>
                  <td className="num"><strong>{formatTokens(totals.total_input_tokens)}</strong></td>
                  <td className="num"><strong>{formatTokens(totals.total_output_tokens)}</strong></td>
                  <td className="num"><strong>{formatTokens(totals.total_cache_write_tokens)}</strong></td>
                  <td className="num"><strong>{formatTokens(totals.total_cache_read_tokens)}</strong></td>
                  <td className="num"><strong>{totals.message_count}</strong></td>
                  <td className="num cost-col"><strong>{formatCost(totals.total_cost)}</strong></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {/* Cost Bar Chart (visual breakdown) */}
      {rows.length > 0 && groupBy === "model" && (
        <div className="cost-bar-chart">
          {rows.map((row) => {
            const maxCost = Math.max(...rows.map((r) => r.total_cost));
            const pct = maxCost > 0 ? (row.total_cost / maxCost) * 100 : 0;
            return (
              <div className="cost-bar-row" key={row.label || "unknown"}>
                <span className="cost-bar-label">{row.label || "unknown"}</span>
                <div className="cost-bar-track">
                  <div className="cost-bar-fill" style={{ width: `${pct}%` }} />
                </div>
                <span className="cost-bar-value">{formatCost(row.total_cost)}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
