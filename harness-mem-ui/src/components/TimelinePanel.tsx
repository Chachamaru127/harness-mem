interface TimelinePanelProps {
  items: Array<Record<string, unknown>>;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export function TimelinePanel(props: TimelinePanelProps) {
  const { items } = props;
  if (items.length === 0) {
    return null;
  }

  return (
    <section className="timeline-panel">
      <h3>Timeline</h3>
      <div className="timeline-grid">
        {items.map((item) => {
          const id = asString(item.id);
          const title = asString(item.title) || id || "untitled";
          const position = asString(item.position);
          const createdAt = asString(item.created_at);
          const content = asString(item.content);
          return (
            <article key={id || `${title}-${createdAt}`} className={`timeline-item ${position === "center" ? "center" : ""}`}>
              <div className="card-top">
                <strong>{title}</strong>
                <span className="card-time">{createdAt || "-"}</span>
              </div>
              <p>{content}</p>
              <div className="card-meta">
                <span>{position || "-"}</span>
                <span>{id || "-"}</span>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}
