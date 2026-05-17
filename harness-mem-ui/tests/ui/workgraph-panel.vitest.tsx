import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { WorkGraphPanel } from "../../src/components/WorkGraphPanel";

function response(items: unknown[], ranking: string) {
  return {
    ok: true,
    status: 200,
    text: async () =>
      JSON.stringify({
        ok: true,
        source: "workgraph",
        items,
        meta: { count: items.length, latency_ms: 1, filters: {}, ranking },
      }),
  } as Response;
}

function mockWorkFetch() {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), "http://localhost");
    const mode = url.searchParams.get("mode");
    if (mode === "next") {
      return response([
        {
          rank: 1,
          work_id: "S125-014",
          title: "Mem UI WorkGraph explainability",
          status: "open",
          score: 72,
          reasons: [
            { code: "priority", message: "priority 1" },
            { code: "session_continuity", message: "continues session session-s125" },
          ],
          provenance: {
            links: [{ target_type: "observation", target_id: "obs-1", relation: "evidence" }],
            events: [{ event_type: "suggested_close", actor: "hook" }],
          },
        },
      ], "work_next_v1");
    }
    if (mode === "ready") {
      return response([
        {
          work_id: "S125-015",
          title: "WorkGraph release gate",
          status: "open",
          ready: true,
          reasons: [],
          provenance: { links: [], events: [] },
        },
      ], "work_ready_v1");
    }
    return response([
      {
        work_id: "S125-010",
        title: "Claim integration",
        status: "in_progress",
        assignee: "agent-a",
        ready: false,
        reasons: [
          { code: "leased", message: "work is leased by agent-a", lease: { target: "work:S125-010", agentId: "agent-a" } },
        ],
        provenance: {
          links: [{ target_type: "lease", target_id: "lease-1", relation: "claimed" }],
          events: [{ event_type: "claimed", actor: "agent-a" }],
        },
      },
    ], "work_blocked_v1");
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("WorkGraphPanel", () => {
  test("shows next, ready, blocked, claimed, reasons, and provenance", async () => {
    mockWorkFetch();
    render(<WorkGraphPanel project="harness-mem" />);

    await screen.findByText("Mem UI WorkGraph explainability");
    expect(screen.getByText("WorkGraph release gate")).toBeDefined();
    expect(screen.getAllByText("Claim integration").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Injection reason")).toBeDefined();
    expect(screen.getByText("priority 1")).toBeDefined();
    expect(screen.getByText("evidence:observation")).toBeDefined();
    expect(screen.getAllByText("claimed:lease").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("event:claimed").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("agent-a").length).toBeGreaterThanOrEqual(1);

    await waitFor(() => {
      const calls = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
      expect(calls.map((call) => String(call[0]))).toEqual(
        expect.arrayContaining([
          "/api/work/query?project=harness-mem&mode=next&limit=3",
          "/api/work/query?project=harness-mem&mode=ready&limit=25",
          "/api/work/query?project=harness-mem&mode=blocked&limit=25",
        ])
      );
    });
  });

  test("renders disabled state without a project", () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    render(<WorkGraphPanel />);

    expect(screen.getByText("WorkGraph disabled for all-project view.")).toBeDefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
