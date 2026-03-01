import { useEffect, useMemo, useRef, useState } from "react";
import { GraphPanel } from "./GraphPanel";
import type { GraphNode, GraphEdge } from "./GraphPanel";

export interface TemporalGraphNode {
  id: string;
  label: string;
  /** ISO 8601 timestamp when this node becomes valid */
  valid_from: string | null;
  /** ISO 8601 timestamp when this node expires (null = still valid) */
  valid_to: string | null;
}

export interface TemporalGraphEdge {
  from: string;
  to: string;
  relation: string;
  /** ISO 8601 timestamp when this edge becomes valid */
  valid_from?: string | null;
  /** ISO 8601 timestamp when this edge expires (null = still valid) */
  valid_to?: string | null;
}

interface TemporalGraphPanelProps {
  nodes: TemporalGraphNode[];
  edges: TemporalGraphEdge[];
  /** Currently selected time (ISO 8601). Defaults to now if not provided. */
  currentTime?: string;
  width?: number;
  height?: number;
}

function isValidAtTime(validFrom: string | null | undefined, validTo: string | null | undefined, time: Date): boolean {
  const from = validFrom ? new Date(validFrom) : null;
  const to = validTo ? new Date(validTo) : null;
  if (from && time < from) return false;
  if (to && time >= to) return false;
  return true;
}

function getTimeRange(nodes: TemporalGraphNode[], edges: TemporalGraphEdge[]): { min: Date; max: Date } {
  const timestamps: Date[] = [];
  for (const n of nodes) {
    if (n.valid_from) timestamps.push(new Date(n.valid_from));
    if (n.valid_to) timestamps.push(new Date(n.valid_to));
  }
  for (const e of edges) {
    if (e.valid_from) timestamps.push(new Date(e.valid_from));
    if (e.valid_to) timestamps.push(new Date(e.valid_to));
  }
  if (timestamps.length === 0) {
    const now = new Date();
    return { min: now, max: now };
  }
  const sorted = timestamps.sort((a, b) => a.getTime() - b.getTime());
  return { min: sorted[0], max: sorted[sorted.length - 1] };
}

export function TemporalGraphPanel({ nodes, edges, currentTime, width = 600, height = 400 }: TemporalGraphPanelProps) {
  const { min: rangeMin, max: rangeMax } = useMemo(() => getTimeRange(nodes, edges), [nodes, edges]);

  const initialTime = currentTime ? new Date(currentTime) : rangeMax;
  const [selectedTime, setSelectedTime] = useState<Date>(initialTime);

  // Update selectedTime when currentTime prop changes
  useEffect(() => {
    if (currentTime) {
      setSelectedTime(new Date(currentTime));
    }
  }, [currentTime]);

  const sliderMin = rangeMin.getTime();
  const sliderMax = rangeMax.getTime();
  const sliderValue = Math.min(Math.max(selectedTime.getTime(), sliderMin), sliderMax);

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSelectedTime(new Date(Number(e.target.value)));
  };

  // Filter nodes and edges valid at selectedTime
  const filteredNodes: GraphNode[] = useMemo(
    () =>
      nodes
        .filter((n) => isValidAtTime(n.valid_from, n.valid_to, selectedTime))
        .map((n) => ({ id: n.id, label: n.label })),
    [nodes, selectedTime]
  );

  const filteredEdges: GraphEdge[] = useMemo(
    () =>
      edges
        .filter((e) => isValidAtTime(e.valid_from, e.valid_to, selectedTime))
        .map((e) => ({ from: e.from, to: e.to, relation: e.relation })),
    [edges, selectedTime]
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: height + 50 }}>
      {/* Time Slider */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px",
          background: "#f9fafb",
          borderBottom: "1px solid #e5e7eb",
          fontSize: 12,
          color: "#374151",
        }}
      >
        <span style={{ whiteSpace: "nowrap" }}>
          {rangeMin.toLocaleDateString()}
        </span>
        <input
          type="range"
          min={sliderMin}
          max={sliderMax || sliderMin + 1}
          value={sliderValue}
          step={Math.max(1, Math.floor((sliderMax - sliderMin) / 100))}
          onChange={handleSliderChange}
          style={{ flex: 1, cursor: "pointer" }}
          aria-label="Time slider"
        />
        <span style={{ whiteSpace: "nowrap" }}>
          {rangeMax.toLocaleDateString()}
        </span>
        <span
          style={{
            marginLeft: 8,
            padding: "2px 8px",
            background: "#2563eb",
            color: "white",
            borderRadius: 4,
            whiteSpace: "nowrap",
          }}
        >
          {selectedTime.toISOString().slice(0, 10)}
        </span>
      </div>

      {/* Graph */}
      <div style={{ flex: 1, position: "relative" }}>
        <GraphPanel
          nodes={filteredNodes}
          edges={filteredEdges}
          width={width}
          height={height}
        />
      </div>
    </div>
  );
}
