import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { useSettings } from "../../src/hooks/useSettings";

function Probe() {
  const { settings, updateSetting } = useSettings();
  return (
    <div>
      <button onClick={() => updateSetting("includePrivate", !settings.includePrivate)}>toggle-private</button>
      <button onClick={() => updateSetting("theme", "dark")}>set-dark</button>
      <span data-testid="include-private">{String(settings.includePrivate)}</span>
    </div>
  );
}

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

describe("useSettings", () => {
  test("persists settings to localStorage and applies theme", () => {
    render(<Probe />);

    expect(screen.getByTestId("include-private").textContent).toBe("false");
    fireEvent.click(screen.getByText("toggle-private"));
    fireEvent.click(screen.getByText("set-dark"));

    expect(screen.getByTestId("include-private").textContent).toBe("true");
    expect(document.documentElement.dataset.theme).toBe("dark");

    const raw = localStorage.getItem("harness_mem_ui_settings_v1");
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw || "{}");
    expect(parsed.includePrivate).toBe(true);
    expect(parsed.theme).toBe("dark");
  });
});
