import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "vitest";
import { useSettings } from "../../src/hooks/useSettings";

function Probe() {
  const { settings, updateSetting } = useSettings();
  return (
    <div>
      <button onClick={() => updateSetting("includePrivate", !settings.includePrivate)}>toggle-private</button>
      <button onClick={() => updateSetting("theme", "dark")}>set-dark</button>
      <button onClick={() => updateSetting("language", "ja")}>set-ja</button>
      <button onClick={() => updateSetting("designPreset", "liquid")}>set-liquid</button>
      <span data-testid="include-private">{String(settings.includePrivate)}</span>
      <span data-testid="language">{settings.language}</span>
      <span data-testid="design">{settings.designPreset}</span>
    </div>
  );
}

afterEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
  document.documentElement.removeAttribute("data-design");
  document.documentElement.removeAttribute("lang");
});

describe("useSettings", () => {
  test("defaults to english and persists language/theme updates", () => {
    render(<Probe />);

    expect(screen.getByTestId("include-private").textContent).toBe("false");
    expect(screen.getByTestId("language").textContent).toBe("en");
    expect(screen.getByTestId("design").textContent).toBe("bento");
    expect(document.documentElement.lang).toBe("en");
    expect(document.documentElement.dataset.design).toBe("bento");
    fireEvent.click(screen.getByText("toggle-private"));
    fireEvent.click(screen.getByText("set-dark"));
    fireEvent.click(screen.getByText("set-ja"));
    fireEvent.click(screen.getByText("set-liquid"));

    expect(screen.getByTestId("include-private").textContent).toBe("true");
    expect(screen.getByTestId("language").textContent).toBe("ja");
    expect(screen.getByTestId("design").textContent).toBe("liquid");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(document.documentElement.lang).toBe("ja");
    expect(document.documentElement.dataset.design).toBe("liquid");

    const raw = localStorage.getItem("harness_mem_ui_settings_v1");
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw || "{}");
    expect(parsed.includePrivate).toBe(true);
    expect(parsed.theme).toBe("dark");
    expect(parsed.language).toBe("ja");
    expect(parsed.designPreset).toBe("liquid");
  });
});
