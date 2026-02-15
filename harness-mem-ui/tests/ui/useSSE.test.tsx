import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { useSSE } from "../../src/hooks/useSSE";
import type { SseUiEvent } from "../../src/lib/types";

type MessageHandler = (event: MessageEvent<string>) => void;

class MockEventSource {
  static instances: MockEventSource[] = [];
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  private readonly listeners = new Map<string, MessageHandler[]>();

  constructor(public readonly url: string) {
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: MessageHandler) {
    const current = this.listeners.get(type) || [];
    this.listeners.set(type, [...current, listener]);
  }

  close() {
    this.closed = true;
  }

  emit(type: string, data: Record<string, unknown>) {
    const event = { data: JSON.stringify(data) } as MessageEvent<string>;
    for (const listener of this.listeners.get(type) || []) {
      listener(event);
    }
  }
}

function Probe(props: { onEvent: (event: SseUiEvent) => void }) {
  const { connected, lastError } = useSSE({
    includePrivate: false,
    project: "project-a",
    onEvent: props.onEvent,
  });

  return (
    <div>
      <span data-testid="connected">{String(connected)}</span>
      <span data-testid="error">{lastError}</span>
    </div>
  );
}

beforeEach(() => {
  MockEventSource.instances = [];
  vi.stubGlobal("EventSource", MockEventSource as unknown as typeof EventSource);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("useSSE", () => {
  test("reconnects after stream error and keeps event delivery", async () => {
    const onEvent = vi.fn();
    render(<Probe onEvent={onEvent} />);

    expect(MockEventSource.instances.length).toBe(1);
    const first = MockEventSource.instances[0];

    await act(async () => {
      first.onopen?.();
    });
    await waitFor(() => {
      expect(screen.getByTestId("connected").textContent).toBe("true");
    });

    await act(async () => {
      first.emit("observation.created", { id: "obs-1", project: "project-a" });
    });
    expect(onEvent).toHaveBeenCalledWith({
      event: "observation.created",
      data: { id: "obs-1", project: "project-a" },
    });

    await act(async () => {
      first.onerror?.();
    });
    await waitFor(() => {
      expect(screen.getByTestId("connected").textContent).toBe("false");
      expect(screen.getByTestId("error").textContent).toContain("reconnecting");
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 650));
    });
    expect(MockEventSource.instances.length).toBe(2);
  });
});
