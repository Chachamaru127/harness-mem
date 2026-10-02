import { render, screen } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { EnvironmentPanel, ROUTECLI_DASHBOARD_URL } from "../../src/components/EnvironmentPanel";

describe("EnvironmentPanel", () => {
  test("points to the RouteCLI dashboard in English", () => {
    render(<EnvironmentPanel language="en" />);
    expect(screen.getByRole("heading", { name: "Environment list moved" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Open the RouteCLI dashboard" }).getAttribute("href")).toBe(
      ROUTECLI_DASHBOARD_URL
    );
    expect(screen.getByText(/harness-mem versions/)).toBeTruthy();
  });

  test("points to the RouteCLI dashboard in Japanese", () => {
    render(<EnvironmentPanel language="ja" />);
    expect(screen.getByRole("heading", { name: "環境の一覧は RouteCLI へ移りました" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "RouteCLI の画面を開く" }).getAttribute("href")).toBe("http://127.0.0.1:8765/");
  });
});
