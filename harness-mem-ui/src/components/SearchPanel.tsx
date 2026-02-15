import { useState } from "react";
import type { FeedItem, SearchFacetsItem } from "../lib/types";

interface SearchPanelProps {
  includePrivate: boolean;
  selectedProject: string;
  onSearch: (payload: Record<string, unknown>) => Promise<Array<Record<string, unknown>>>;
  onLoadFacets: (payload: Record<string, unknown>) => Promise<Record<string, unknown> | null>;
  onOpenTimeline: (id: string) => void;
  onOpenObservation: (id: string) => void;
}

export function SearchPanel(props: SearchPanelProps) {
  const { includePrivate, selectedProject, onSearch, onLoadFacets, onOpenTimeline, onOpenObservation } = props;
  const [query, setQuery] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [limit, setLimit] = useState(20);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [facets, setFacets] = useState<SearchFacetsItem | null>(null);

  const run = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError("");
    try {
      const result = await onSearch({
        query,
        project: selectedProject === "__all__" ? undefined : selectedProject,
        session_id: sessionId || undefined,
        limit,
        include_private: includePrivate,
      });
      setItems(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const loadFacets = async () => {
    setError("");
    try {
      const result = await onLoadFacets({
        query: query || undefined,
        project: selectedProject === "__all__" ? undefined : selectedProject,
        include_private: includePrivate,
      });
      if (!result) {
        setFacets(null);
        return;
      }
      setFacets(result as unknown as SearchFacetsItem);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
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
        <label htmlFor="search-query" className="sr-only">Search query</label>
        <input
          id="search-query"
          aria-label="Search query"
          value={query}
          placeholder="query"
          onChange={(event) => setQuery(event.target.value)}
        />
        <label htmlFor="search-session-id" className="sr-only">Session id</label>
        <input
          id="search-session-id"
          aria-label="Session id (optional)"
          value={sessionId}
          placeholder="session_id (optional)"
          onChange={(event) => setSessionId(event.target.value)}
        />
        <label htmlFor="search-limit" className="sr-only">Search limit</label>
        <input
          id="search-limit"
          aria-label="Search result limit"
          type="number"
          value={limit}
          min={1}
          max={100}
          onChange={(event) => setLimit(Number(event.target.value || 20))}
        />
        <button type="submit">search</button>
        <button
          type="button"
          onClick={() => {
            void loadFacets();
          }}
        >
          facets
        </button>
      </form>
      {loading ? <div className="loading" aria-live="polite">Searching...</div> : null}
      {error ? <div className="error" role="alert">{error}</div> : null}

      {facets ? (
        <section className="facet-panel">
          <h3>Facets ({facets.total_candidates})</h3>
          <div className="facet-row">
            <strong>Projects:</strong>
            <span>
              {(facets.projects || []).slice(0, 6).map((entry) => `${entry.value}(${entry.count})`).join(", ") || "-"}
            </span>
          </div>
          <div className="facet-row">
            <strong>Types:</strong>
            <span>
              {(facets.event_types || []).slice(0, 6).map((entry) => `${entry.value}(${entry.count})`).join(", ") || "-"}
            </span>
          </div>
          <div className="facet-row">
            <strong>Top tags:</strong>
            <span>
              {(facets.tags || []).slice(0, 8).map((entry) => `${entry.value}(${entry.count})`).join(", ") || "-"}
            </span>
          </div>
        </section>
      ) : null}

      {items.length === 0 && !loading ? <div className="empty">Run a query to see matching memories.</div> : null}
      <div className="feed-list">
        {items.map((raw) => {
          const item = raw as unknown as FeedItem;
          return (
            <article key={item.id} className="feed-card compact">
              <h3>{item.title || item.id}</h3>
              <p>{item.content || ""}</p>
              <div className="card-actions">
                {item.id ? <button type="button" onClick={() => onOpenTimeline(item.id!)}>timeline</button> : null}
                {item.id ? <button type="button" onClick={() => onOpenObservation(item.id!)}>details</button> : null}
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
