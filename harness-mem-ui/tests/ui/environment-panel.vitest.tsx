import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import { EnvironmentPanel } from "../../src/components/EnvironmentPanel";
import type { EnvironmentSnapshot } from "../../src/lib/types";

const sampleSnapshot: EnvironmentSnapshot = {
  snapshot_id: "env_123456",
  generated_at: "2026-02-23T12:00:00.000Z",
  summary: {
    total: 8,
    ok: 5,
    warning: 2,
    missing: 1,
    servers: 2,
    languages: 2,
    cli_tools: 2,
    ai_tools: 2,
  },
  servers: [
    {
      id: "daemon",
      name: "Harness Memory Daemon",
      description: "Core API server",
      status: "ok",
      last_checked_at: "2026-02-23T12:00:00.000Z",
      pid: 12345,
      port: 37888,
      protocol: "http",
      bind_address: "127.0.0.1",
      process_name: "bun",
      message: null,
    },
    {
      id: "ui",
      name: "Harness Memory UI",
      description: "Web UI server",
      status: "warning",
      last_checked_at: "2026-02-23T12:00:00.000Z",
      pid: 22222,
      port: 37901,
      protocol: "http",
      bind_address: "127.0.0.1",
      process_name: "bun",
      message: "context endpoint timeout",
    },
  ],
  languages: [
    {
      id: "node",
      name: "Node.js",
      description: "runtime",
      status: "ok",
      last_checked_at: "2026-02-23T12:00:00.000Z",
      installed: true,
      version: "v22.10.0",
      message: null,
    },
    {
      id: "python3",
      name: "Python",
      description: "runtime",
      status: "missing",
      last_checked_at: "2026-02-23T12:00:00.000Z",
      installed: false,
      version: null,
      message: "python3 is not installed",
    },
  ],
  cli_tools: [
    {
      id: "git",
      name: "git",
      description: "cli",
      status: "ok",
      last_checked_at: "2026-02-23T12:00:00.000Z",
      installed: true,
      version: "git version 2.47.0",
      message: null,
    },
    {
      id: "jq",
      name: "jq",
      description: "cli",
      status: "ok",
      last_checked_at: "2026-02-23T12:00:00.000Z",
      installed: true,
      version: "jq-1.7",
      message: null,
    },
  ],
  ai_tools: [
    {
      id: "codex",
      name: "Codex CLI",
      description: "ai",
      status: "ok",
      last_checked_at: "2026-02-23T12:00:00.000Z",
      installed: true,
      version: "codex-cli 0.104.0",
      message: null,
    },
    {
      id: "doctor",
      name: "Doctor Snapshot",
      description: "ai",
      status: "warning",
      last_checked_at: "2026-02-23T12:00:00.000Z",
      installed: true,
      version: "degraded",
      message: "check wiring",
    },
  ],
  errors: [{ section: "ai_tools", message: "tool-versions.json missing fields" }],
};

describe("EnvironmentPanel", () => {
  test("renders summary, sections, statuses, and FAQ in Japanese", () => {
    const onRefresh = vi.fn();
    render(
      <EnvironmentPanel
        snapshot={sampleSnapshot}
        loading={false}
        error=""
        language="ja"
        onRefresh={onRefresh}
      />
    );

    expect(screen.getByText("環境ステータス")).toBeDefined();
    expect(screen.getByText("5秒サマリー")).toBeDefined();
    expect(screen.getAllByText("内部サーバー").length).toBeGreaterThan(0);
    expect(screen.getAllByText("言語 / ランタイム").length).toBeGreaterThan(0);
    expect(screen.getAllByText("CLI ツール").length).toBeGreaterThan(0);
    expect(screen.getAllByText("AI / MCP ツール").length).toBeGreaterThan(0);
    expect(screen.getAllByText("正常").length).toBeGreaterThan(0);
    expect(screen.getAllByText("注意").length).toBeGreaterThan(0);
    expect(screen.getAllByText("未検出").length).toBeGreaterThan(0);
    expect(screen.getByText("非専門家向け FAQ")).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: "環境を更新" }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  test("shows empty state when snapshot is unavailable", () => {
    render(
      <EnvironmentPanel
        snapshot={null}
        loading={false}
        error=""
        language="en"
        onRefresh={() => undefined}
      />
    );

    expect(screen.getByText("Environment snapshot is not available yet.")).toBeDefined();
  });
});
