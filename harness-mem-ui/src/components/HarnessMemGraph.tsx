/**
 * HarnessMemGraph — ナレッジグラフ可視化コンポーネント
 *
 * GET /v1/graph?entity=X&depth=N からサブグラフを取得し、
 * GraphPanel で force-directed レイアウトを使って表示する。
 * V5-001: 8種の relation types に対応。
 */

import { useCallback, useEffect, useState } from "react";
import { fetchSubgraph } from "../lib/api";
import type { SubgraphEdge, SubgraphNode } from "../lib/types";
import { GraphPanel, type GraphEdge, type GraphNode } from "./GraphPanel";

interface HarnessMemGraphProps {
  /** 初期エンティティ検索クエリ */
  initialEntity?: string;
  /** プロジェクトフィルタ */
  project?: string;
  /** 探索深度 (1-5) */
  depth?: number;
}

function toGraphNodes(nodes: SubgraphNode[]): GraphNode[] {
  return nodes.map((n) => ({
    id: n.id,
    label: n.title || n.id.slice(0, 12),
  }));
}

function toGraphEdges(edges: SubgraphEdge[]): GraphEdge[] {
  return edges.map((e) => ({
    from: e.source,
    to: e.target,
    relation: e.relation,
  }));
}

const RELATION_LABELS: Record<string, string> = {
  follows: "follows",
  extends: "extends",
  updates: "updates",
  shared_entity: "shared",
  derives: "derives",
  contradicts: "contradicts",
  causes: "causes",
  part_of: "part of",
};

const RELATION_COLORS: Record<string, string> = {
  updates: "#ef4444",
  extends: "#3b82f6",
  derives: "#8b5cf6",
  follows: "#10b981",
  shared_entity: "#f59e0b",
  contradicts: "#dc2626",
  causes: "#ea580c",
  part_of: "#0891b2",
};

export function HarnessMemGraph({ initialEntity = "", project, depth = 2 }: HarnessMemGraphProps) {
  const [entityInput, setEntityInput] = useState(initialEntity);
  const [depthInput, setDepthInput] = useState(depth);
  const [nodes, setNodes] = useState<GraphNode[]>([]);
  const [edges, setEdges] = useState<GraphEdge[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [centerEntity, setCenterEntity] = useState("");
  const [nodeCount, setNodeCount] = useState(0);
  const [edgeCount, setEdgeCount] = useState(0);

  const loadGraph = useCallback(
    async (entity: string, d: number) => {
      if (!entity.trim()) return;
      setLoading(true);
      setError("");
      try {
        const result = await fetchSubgraph({
          entity: entity.trim(),
          depth: d,
          project: project || undefined,
          limit: 100,
        });
        setNodes(toGraphNodes(result.nodes));
        setEdges(toGraphEdges(result.edges));
        setCenterEntity(result.center_entity);
        setNodeCount(result.nodes.length);
        setEdgeCount(result.edges.length);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setNodes([]);
        setEdges([]);
      } finally {
        setLoading(false);
      }
    },
    [project]
  );

  // 初期エンティティが指定されている場合は自動ロード
  useEffect(() => {
    if (initialEntity.trim()) {
      void loadGraph(initialEntity, depth);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void loadGraph(entityInput, depthInput);
  };

  return (
    <div
      style={{ display: "flex", flexDirection: "column", gap: 12, height: "100%" }}
      aria-label="Knowledge graph"
    >
      {/* 検索フォーム */}
      <form
        onSubmit={handleSubmit}
        style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}
        aria-label="Graph search form"
      >
        <input
          type="text"
          placeholder="Entity name (e.g. Plans.md, CLAUDE.md, harness)"
          value={entityInput}
          onChange={(e) => setEntityInput(e.target.value)}
          style={{
            flex: 1,
            minWidth: 200,
            padding: "6px 10px",
            border: "1px solid #d1d5db",
            borderRadius: 6,
            fontSize: 13,
          }}
          aria-label="Entity input"
        />
        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13 }}>
          Depth:
          <select
            value={depthInput}
            onChange={(e) => setDepthInput(Number(e.target.value))}
            style={{ padding: "5px 8px", borderRadius: 6, border: "1px solid #d1d5db", fontSize: 13 }}
            aria-label="Depth selector"
          >
            {[1, 2, 3, 4, 5].map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </label>
        <button
          type="submit"
          disabled={loading || !entityInput.trim()}
          style={{
            padding: "6px 14px",
            background: "#2563eb",
            color: "white",
            border: "none",
            borderRadius: 6,
            fontSize: 13,
            cursor: loading || !entityInput.trim() ? "not-allowed" : "pointer",
            opacity: loading || !entityInput.trim() ? 0.6 : 1,
          }}
        >
          {loading ? "Loading..." : "Search"}
        </button>
      </form>

      {/* ステータス表示 */}
      {error && (
        <div
          style={{ color: "#dc2626", fontSize: 13, padding: "6px 10px", background: "#fef2f2", borderRadius: 6 }}
          role="alert"
        >
          {error}
        </div>
      )}
      {centerEntity && !loading && (
        <div style={{ fontSize: 12, color: "#6b7280" }}>
          Graph for <strong>{centerEntity}</strong> — {nodeCount} nodes, {edgeCount} edges
        </div>
      )}

      {/* legend */}
      {(nodes.length > 0 || edges.length > 0) && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 11 }} aria-label="Relation legend">
          {Object.entries(RELATION_LABELS).map(([rel, label]) => (
            <span key={rel} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span
                style={{
                  display: "inline-block",
                  width: 20,
                  height: 3,
                  background: RELATION_COLORS[rel] ?? "#9ca3af",
                  borderRadius: 2,
                }}
              />
              <span style={{ color: "#374151" }}>{label}</span>
            </span>
          ))}
        </div>
      )}

      {/* グラフ本体 */}
      <div style={{ flex: 1, minHeight: 300 }}>
        <GraphPanel nodes={nodes} edges={edges} width={700} height={450} />
      </div>
    </div>
  );
}
