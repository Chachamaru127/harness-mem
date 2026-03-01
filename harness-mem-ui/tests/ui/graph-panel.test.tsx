import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { GraphPanel } from "../../src/components/GraphPanel";

// jsdom does not implement ResizeObserver
class MockResizeObserver {
  observe() {}
  disconnect() {}
  unobserve() {}
}
globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;

const nodes = [
  { id: "obs-1", label: "Observation A" },
  { id: "obs-2", label: "Observation B" },
  { id: "obs-3", label: "Observation C" },
];

const edges = [
  { from: "obs-1", to: "obs-2", relation: "extends" },
  { from: "obs-2", to: "obs-3", relation: "follows" },
];

describe("GraphPanel", () => {
  test("renders an SVG container for the graph", () => {
    const { container } = render(
      <GraphPanel nodes={nodes} edges={edges} />
    );
    expect(container.querySelector("svg")).not.toBeNull();
  });

  test("renders a node element for each node", () => {
    const { container } = render(
      <GraphPanel nodes={nodes} edges={edges} />
    );
    const circles = container.querySelectorAll("circle[data-node-id]");
    expect(circles.length).toBe(nodes.length);
  });

  test("renders an edge element for each edge", () => {
    const { container } = render(
      <GraphPanel nodes={nodes} edges={edges} />
    );
    const lines = container.querySelectorAll("line[data-edge]");
    expect(lines.length).toBe(edges.length);
  });

  test("displays empty state message when no nodes provided", () => {
    render(<GraphPanel nodes={[]} edges={[]} />);
    expect(screen.getByText(/no graph data/i)).not.toBeNull();
  });
});
