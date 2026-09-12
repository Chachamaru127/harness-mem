import { fireEvent, render, screen } from "@testing-library/react";
import { vi } from "vitest";
import { ProjectSidebar } from "../../src/components/ProjectSidebar";

describe("ProjectSidebar", () => {
  test("same-basename projects have distinct labels and preserve the full selected value", () => {
    const onSelectProject = vi.fn();
    render(<ProjectSidebar projects={["/a/repo", "/b/repo"].map((project) => ({ project, canonical_project: project, display_name: "repo", observations: 1, sessions: 1, updated_at: null }))} loading={false} selectedProject="/a/repo" language="en" onSelectProject={onSelectProject} />);
    fireEvent.click(screen.getByText("a/repo"));
    fireEvent.click(screen.getByText("b/repo"));
    expect(onSelectProject.mock.calls.map((args) => args[0])).toEqual(["/a/repo", "/b/repo"]);
  });

  test("shows stale project stats as refreshing instead of zero-count stats", () => {
    render(
      <ProjectSidebar
        projects={[
          {
            project: "/Users/example/harness-mem",
            canonical_project: "harness-mem",
            observations: 0,
            sessions: 0,
            updated_at: null,
            stale: true,
          },
        ]}
        loading={false}
        selectedProject="/Users/example/harness-mem"
        language="en"
        onSelectProject={() => undefined}
      />
    );

    expect(screen.getAllByText("refreshing...").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByText("0 obs / 0 sessions")).toBeNull();
  });
});
