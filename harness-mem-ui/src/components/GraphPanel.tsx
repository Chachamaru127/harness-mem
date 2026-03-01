import { useEffect, useRef, useState } from "react";

export interface GraphNode {
  id: string;
  label: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  relation: string;
}

interface SimNode extends GraphNode {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

interface GraphPanelProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  width?: number;
  height?: number;
}

const NODE_RADIUS = 20;
const LINK_DISTANCE = 120;
const REPULSION = 3000;
const DAMPING = 0.85;
const ITERATIONS = 100;

/** 簡易force-directed layoutシミュレーション（D3.js不要）*/
function runForceLayout(nodes: GraphNode[], edges: GraphEdge[], width: number, height: number): SimNode[] {
  if (nodes.length === 0) return [];

  const sim: SimNode[] = nodes.map((n, i) => ({
    ...n,
    x: width / 2 + Math.cos((2 * Math.PI * i) / nodes.length) * 100,
    y: height / 2 + Math.sin((2 * Math.PI * i) / nodes.length) * 100,
    vx: 0,
    vy: 0,
  }));

  const indexById = new Map(sim.map((n, i) => [n.id, i]));

  for (let iter = 0; iter < ITERATIONS; iter++) {
    // 反発力
    for (let i = 0; i < sim.length; i++) {
      for (let j = i + 1; j < sim.length; j++) {
        const dx = sim[j].x - sim[i].x;
        const dy = sim[j].y - sim[i].y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = REPULSION / (dist * dist);
        sim[i].vx -= (force * dx) / dist;
        sim[i].vy -= (force * dy) / dist;
        sim[j].vx += (force * dx) / dist;
        sim[j].vy += (force * dy) / dist;
      }
    }

    // 引力（エッジ）
    for (const edge of edges) {
      const si = indexById.get(edge.from);
      const sj = indexById.get(edge.to);
      if (si === undefined || sj === undefined) continue;
      const dx = sim[sj].x - sim[si].x;
      const dy = sim[sj].y - sim[si].y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const force = (dist - LINK_DISTANCE) * 0.05;
      sim[si].vx += (force * dx) / dist;
      sim[si].vy += (force * dy) / dist;
      sim[sj].vx -= (force * dx) / dist;
      sim[sj].vy -= (force * dy) / dist;
    }

    // 中心引力
    for (const n of sim) {
      n.vx += (width / 2 - n.x) * 0.01;
      n.vy += (height / 2 - n.y) * 0.01;
    }

    // 速度適用
    for (const n of sim) {
      n.vx *= DAMPING;
      n.vy *= DAMPING;
      n.x += n.vx;
      n.y += n.vy;
      // 境界クランプ
      n.x = Math.max(NODE_RADIUS, Math.min(width - NODE_RADIUS, n.x));
      n.y = Math.max(NODE_RADIUS, Math.min(height - NODE_RADIUS, n.y));
    }
  }

  return sim;
}

const RELATION_COLORS: Record<string, string> = {
  updates: "#ef4444",
  extends: "#3b82f6",
  derives: "#8b5cf6",
  follows: "#10b981",
  shared_entity: "#f59e0b",
};

export function GraphPanel({ nodes, edges, width = 600, height = 400 }: GraphPanelProps) {
  const [simNodes, setSimNodes] = useState<SimNode[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width, height });

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        setDimensions({
          width: entry.contentRect.width || width,
          height: entry.contentRect.height || height,
        });
      }
    });
    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [width, height]);

  useEffect(() => {
    setSimNodes(runForceLayout(nodes, edges, dimensions.width, dimensions.height));
  }, [nodes, edges, dimensions]);

  if (nodes.length === 0) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "100%",
          height: "100%",
          minHeight: 200,
          color: "#6b7280",
          fontSize: 14,
        }}
      >
        No graph data
      </div>
    );
  }

  const indexById = new Map(simNodes.map((n, i) => [n.id, i]));

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height: "100%", minHeight: height, position: "relative" }}
      aria-label="Graph visualization"
    >
      <svg
        width={dimensions.width}
        height={dimensions.height}
        style={{ display: "block", background: "transparent" }}
      >
        <defs>
          <marker
            id="arrowhead"
            markerWidth="8"
            markerHeight="6"
            refX="8"
            refY="3"
            orient="auto"
          >
            <polygon points="0 0, 8 3, 0 6" fill="#9ca3af" />
          </marker>
        </defs>

        {/* Edges */}
        <g>
          {edges.map((edge, i) => {
            const si = indexById.get(edge.from);
            const sj = indexById.get(edge.to);
            if (si === undefined || sj === undefined) return null;
            const s = simNodes[si];
            const t = simNodes[sj];
            if (!s || !t) return null;
            const color = RELATION_COLORS[edge.relation] ?? "#9ca3af";
            return (
              <line
                key={`${edge.from}-${edge.to}-${i}`}
                data-edge={`${edge.from}-${edge.to}`}
                x1={s.x}
                y1={s.y}
                x2={t.x}
                y2={t.y}
                stroke={color}
                strokeWidth={1.5}
                strokeOpacity={0.7}
                markerEnd="url(#arrowhead)"
              />
            );
          })}
        </g>

        {/* Nodes */}
        <g>
          {simNodes.map((node) => (
            <g key={node.id} transform={`translate(${node.x},${node.y})`}>
              <circle
                data-node-id={node.id}
                r={NODE_RADIUS}
                fill="#2563eb"
                fillOpacity={0.85}
                stroke="#1e40af"
                strokeWidth={1.5}
              />
              <text
                textAnchor="middle"
                dy="0.35em"
                fontSize={10}
                fill="white"
                style={{ pointerEvents: "none", userSelect: "none" }}
              >
                {node.label.length > 12 ? `${node.label.slice(0, 10)}…` : node.label}
              </text>
            </g>
          ))}
        </g>
      </svg>
    </div>
  );
}
