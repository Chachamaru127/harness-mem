import { render, screen } from "@testing-library/react";
import { ProjectSidebar } from "../../src/components/ProjectSidebar";

describe("ProjectSidebar", () => {
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
