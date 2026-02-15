import { useEffect, useState } from "react";

interface ObservationPanelProps {
  includePrivate: boolean;
  selectedIds: string[];
  onLoad: (payload: Record<string, unknown>) => Promise<Array<Record<string, unknown>>>;
}

export function ObservationPanel(props: ObservationPanelProps) {
  const { includePrivate, selectedIds, onLoad } = props;
  const [idsText, setIdsText] = useState("");
  const [compact, setCompact] = useState(true);
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setIdsText(selectedIds.join(","));
  }, [selectedIds]);

  const run = async () => {
    const ids = idsText
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean);
    if (ids.length === 0) return;
    setLoading(true);
    setError("");
    try {
      const result = await onLoad({
        ids,
        include_private: includePrivate,
        compact,
      });
      setItems(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="panel-block">
      <form
        className="row"
        onSubmit={(event) => {
          event.preventDefault();
          void run();
        }}
      >
        <label htmlFor="observation-ids" className="sr-only">Observation ids</label>
        <input
          id="observation-ids"
          aria-label="Observation ids (comma separated)"
          value={idsText}
          placeholder="ids comma separated"
          onChange={(event) => setIdsText(event.target.value)}
        />
        <label htmlFor="observation-compact">
          <input
            id="observation-compact"
            type="checkbox"
            checked={compact}
            onChange={(event) => setCompact(event.target.checked)}
          />
          compact
        </label>
        <button type="submit">load</button>
      </form>
      {loading ? <div className="loading" aria-live="polite">Loading observations...</div> : null}
      {error ? <div className="error" role="alert">{error}</div> : null}
      {items.length === 0 && !loading ? <div className="empty">Select timeline/search items to load details.</div> : null}
      <div className="feed-list">
        {items.map((item) => (
          <article key={String(item.id)} className="feed-card compact">
            <h3>{String(item.title || item.id)}</h3>
            <p>{String(item.content || "")}</p>
            <div className="card-meta">
              <span>{String(item.project || "-")}</span>
              <span>{String(item.session_id || "-")}</span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
