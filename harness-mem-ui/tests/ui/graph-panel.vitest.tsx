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

// V5-001: 8種の relation types を含むエッジ
const allRelationEdges = [
  { from: "obs-1", to: "obs-2", relation: "follows" },
  { from: "obs-2", to: "obs-3", relation: "extends" },
  { from: "obs-3", to: "obs-1", relation: "updates" },
  { from: "obs-1", to: "obs-3", relation: "shared_entity" },
  { from: "obs-2", to: "obs-1", relation: "derives" },
  { from: "obs-3", to: "obs-2", relation: "contradicts" },
  { from: "obs-1", to: "obs-2", relation: "causes" },
  { from: "obs-2", to: "obs-3", relation: "part_of" },
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

  // V5-001: 新3種 relation types のレンダリングテスト
  test("renders edges with 'contradicts' relation without error", () => {
    const { container } = render(
      <GraphPanel
        nodes={nodes}
        edges={[{ from: "obs-1", to: "obs-2", relation: "contradicts" }]}
      />
    );
    const lines = container.querySelectorAll("line[data-edge]");
    expect(lines.length).toBe(1);
  });

  test("renders edges with 'causes' relation without error", () => {
    const { container } = render(
      <GraphPanel
        nodes={nodes}
        edges={[{ from: "obs-1", to: "obs-2", relation: "causes" }]}
      />
    );
    const lines = container.querySelectorAll("line[data-edge]");
    expect(lines.length).toBe(1);
  });

  test("renders edges with 'part_of' relation without error", () => {
    const { container } = render(
      <GraphPanel
        nodes={nodes}
        edges={[{ from: "obs-1", to: "obs-2", relation: "part_of" }]}
      />
    );
    const lines = container.querySelectorAll("line[data-edge]");
    expect(lines.length).toBe(1);
  });

  test("renders all 8 relation types simultaneously", () => {
    const { container } = render(
      <GraphPanel nodes={nodes} edges={allRelationEdges} />
    );
    const lines = container.querySelectorAll("line[data-edge]");
    expect(lines.length).toBe(allRelationEdges.length);
  });

  test("does not render edges for nodes that do not exist", () => {
    const { container } = render(
      <GraphPanel
        nodes={[{ id: "obs-1", label: "A" }]}
        edges={[{ from: "obs-1", to: "missing-id", relation: "follows" }]}
      />
    );
    // 片方が存在しないエッジは描画しない
    const lines = container.querySelectorAll("line[data-edge]");
    expect(lines.length).toBe(0);
  });

  test("truncates long node labels", () => {
    const longLabelNodes = [{ id: "n1", label: "VeryLongObservationTitleThatExceeds12Chars" }];
    const { container } = render(
      <GraphPanel nodes={longLabelNodes} edges={[]} />
    );
    // ラベルが切り詰められていることを確認（テキストが元のラベルと異なる）
    const text = container.querySelector("text");
    expect(text?.textContent?.length).toBeLessThan(longLabelNodes[0].label.length);
  });
});
