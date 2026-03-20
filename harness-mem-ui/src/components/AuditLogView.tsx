import { useCallback, useEffect, useState } from "react";
import type { AuditLogItem } from "../lib/types";
import { fetchAuditLog } from "../lib/api";

type DateRange = "today" | "7d" | "30d" | "all";

const ACTION_OPTIONS = [
  "",
  "read.search",
  "read.timeline",
  "privacy_filter",
  "boundary_filter",
  "admin.consolidation.run",
];

function formatRelative(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  if (Number.isNaN(then)) {
    return isoString;
  }
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) {
    return `${diffSec}s ago`;
  }
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) {
    return `${diffMin}m ago`;
  }
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) {
    return `${diffHour}h ago`;
  }
  const diffDay = Math.floor(diffHour / 24);
  return `${diffDay}d ago`;
}

function formatAbsolute(isoString: string): string {
  try {
    return new Date(isoString).toLocaleString();
  } catch {
    return isoString;
  }
}

function isWithinRange(isoString: string, range: DateRange): boolean {
  if (range === "all") {
    return true;
  }
  const then = new Date(isoString).getTime();
  if (Number.isNaN(then)) {
    return true;
  }
  const now = Date.now();
  const msMap: Record<Exclude<DateRange, "all">, number> = {
    today: 24 * 60 * 60 * 1000,
    "7d": 7 * 24 * 60 * 60 * 1000,
    "30d": 30 * 24 * 60 * 60 * 1000,
  };
  return now - then <= msMap[range as Exclude<DateRange, "all">];
}

function escapeCsv(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function downloadBlob(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportCsv(items: AuditLogItem[]): void {
  const header = "Timestamp,Action,Actor,Target Type,Target ID,Details\n";
  const rows = items
    .map((item) =>
      [
        item.created_at,
        item.action,
        item.actor,
        item.target_type,
        item.target_id,
        item.details ? JSON.stringify(item.details) : "",
      ]
        .map(escapeCsv)
        .join(",")
    )
    .join("\n");
  downloadBlob(header + rows, "audit-log.csv", "text/csv;charset=utf-8;");
}

function exportJson(items: AuditLogItem[]): void {
  downloadBlob(JSON.stringify(items, null, 2), "audit-log.json", "application/json");
}

function renderDetails(details: Record<string, unknown> | null): string {
  if (!details || typeof details !== "object") {
    return "";
  }
  return Object.entries(details)
    .slice(0, 4)
    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(", ");
}

export function AuditLogView() {
  const [items, setItems] = useState<AuditLogItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Filter state
  const [actionFilter, setActionFilter] = useState("");
  const [dateRange, setDateRange] = useState<DateRange>("all");
  const [textFilter, setTextFilter] = useState("");
  const [limit, setLimit] = useState(50);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const result = await fetchAuditLog({
        limit,
        action: actionFilter || undefined,
      });
      if (!result.ok) {
        setError(result.error ?? "Failed to load audit log");
        setItems([]);
      } else {
        setItems(result.items);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [limit, actionFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const filtered = items.filter((item) => {
    if (!isWithinRange(item.created_at, dateRange)) {
      return false;
    }
    if (textFilter.trim()) {
      const q = textFilter.trim().toLowerCase();
      if (
        !item.actor.toLowerCase().includes(q) &&
        !item.target_id.toLowerCase().includes(q)
      ) {
        return false;
      }
    }
    return true;
  });

  return (
    <section className="panel-block audit-log-view">
      <div className="audit-log-header">
        <h2>Audit Log</h2>
        <p className="audit-log-subtitle">Who accessed which memory and when.</p>
      </div>

      <form
        className="audit-log-filters"
        onSubmit={(e) => {
          e.preventDefault();
          void load();
        }}
      >
        <label htmlFor="audit-action-filter" className="sr-only">Action filter</label>
        <select
          id="audit-action-filter"
          aria-label="Filter by action"
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
        >
          <option value="">All actions</option>
          {ACTION_OPTIONS.filter(Boolean).map((action) => (
            <option key={action} value={action}>{action}</option>
          ))}
        </select>

        <label htmlFor="audit-date-range" className="sr-only">Date range</label>
        <select
          id="audit-date-range"
          aria-label="Date range"
          value={dateRange}
          onChange={(e) => setDateRange(e.target.value as DateRange)}
        >
          <option value="all">All time</option>
          <option value="today">Today</option>
          <option value="7d">Last 7 days</option>
          <option value="30d">Last 30 days</option>
        </select>

        <label htmlFor="audit-text-filter" className="sr-only">Search by actor or target</label>
        <input
          id="audit-text-filter"
          aria-label="Search by actor or target id"
          placeholder="actor / target_id"
          value={textFilter}
          onChange={(e) => setTextFilter(e.target.value)}
        />

        <label htmlFor="audit-limit" className="sr-only">Limit</label>
        <input
          id="audit-limit"
          aria-label="Result limit"
          type="number"
          min={1}
          max={500}
          value={limit}
          onChange={(e) => setLimit(Math.max(1, Math.min(500, Number(e.target.value || 50))))}
        />

        <button type="submit">refresh</button>
        <button
          type="button"
          className="audit-export-btn"
          disabled={filtered.length === 0}
          onClick={() => exportCsv(filtered)}
          aria-label="Export as CSV"
        >
          Export CSV
        </button>
        <button
          type="button"
          className="audit-export-btn"
          disabled={filtered.length === 0}
          onClick={() => exportJson(filtered)}
          aria-label="Export as JSON"
        >
          Export JSON
        </button>
      </form>

      {loading ? (
        <div className="loading" aria-live="polite">Loading audit log...</div>
      ) : null}

      {error ? (
        <div className="error" role="alert">{error}</div>
      ) : null}

      {!loading && !error && filtered.length === 0 ? (
        <div className="empty">No audit log entries match the current filters.</div>
      ) : null}

      {filtered.length > 0 ? (
        <div className="audit-log-table-wrapper" role="region" aria-label="Audit log entries">
          <table className="audit-log-table">
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Action</th>
                <th scope="col">Actor</th>
                <th scope="col">Target</th>
                <th scope="col">Details</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                <tr key={item.id} className="audit-log-row">
                  <td className="audit-col-time">
                    <span
                      title={formatAbsolute(item.created_at)}
                      className="audit-relative-time"
                    >
                      {formatRelative(item.created_at)}
                    </span>
                  </td>
                  <td className="audit-col-action">
                    <span className="audit-action-badge">{item.action}</span>
                  </td>
                  <td className="audit-col-actor" title={item.actor}>
                    {item.actor || "-"}
                  </td>
                  <td className="audit-col-target">
                    <span className="audit-target-type">{item.target_type}</span>
                    {item.target_id ? (
                      <span className="audit-target-id" title={item.target_id}>
                        {item.target_id.length > 40
                          ? `${item.target_id.slice(0, 40)}...`
                          : item.target_id}
                      </span>
                    ) : null}
                  </td>
                  <td className="audit-col-details" title={item.details ? JSON.stringify(item.details) : ""}>
                    {renderDetails(item.details)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="audit-log-footer">
            {filtered.length} / {items.length} entries shown
          </div>
        </div>
      ) : null}
    </section>
  );
}
