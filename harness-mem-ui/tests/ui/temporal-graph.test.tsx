import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { TemporalGraphPanel } from "../../src/components/TemporalGraphPanel";

// jsdom does not implement ResizeObserver
class MockResizeObserver {
  observe() {}
  disconnect() {}
  unobserve() {}
}
globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

const nodes = [
  { id: "obs-1", label: "Node A", valid_from: "2026-01-01T00:00:00Z", valid_to: null },
  { id: "obs-2", label: "Node B", valid_from: "2026-02-01T00:00:00Z", valid_to: "2026-03-01T00:00:00Z" },
  { id: "obs-3", label: "Node C", valid_from: "2026-03-01T00:00:00Z", valid_to: null },
];

const edges = [
  { from: "obs-1", to: "obs-2", relation: "extends", valid_from: "2026-01-15T00:00:00Z", valid_to: null },
];

describe("TemporalGraphPanel", () => {
  test("renders a time slider for temporal navigation", () => {
    const { container } = render(
      <TemporalGraphPanel nodes={nodes} edges={edges} />
    );
    const slider = container.querySelector("input[type='range']");
    expect(slider).not.toBeNull();
  });

  test("shows only nodes valid at the selected time", () => {
    const { container } = render(
      <TemporalGraphPanel nodes={nodes} edges={edges} currentTime="2026-01-15T00:00:00Z" />
    );
    // obs-1 (valid from Jan 1) and obs-2 (valid from Feb 1) - obs-2 not yet valid
    const circles = container.querySelectorAll("circle[data-node-id]");
    expect(circles.length).toBe(1); // only obs-1
  });

  test("shows nodes and edges valid at a later time", () => {
    const { container } = render(
      <TemporalGraphPanel nodes={nodes} edges={edges} currentTime="2026-02-15T00:00:00Z" />
    );
    const circles = container.querySelectorAll("circle[data-node-id]");
    expect(circles.length).toBe(2); // obs-1 and obs-2 (obs-3 not yet valid)
  });

  test("displays empty state when no nodes are valid at selected time", () => {
    render(
      <TemporalGraphPanel nodes={[]} edges={[]} />
    );
    expect(screen.getByText(/no graph data/i)).not.toBeNull();
  });
});
