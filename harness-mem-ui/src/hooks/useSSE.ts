import { useEffect, useRef, useState } from "react";
import type { SseUiEvent } from "../lib/types";

interface UseSseOptions {
  includePrivate: boolean;
  project?: string;
  onEvent: (event: SseUiEvent) => void;
}

export function useSSE(options: UseSseOptions) {
  const { includePrivate, project, onEvent } = options;
  const [connected, setConnected] = useState(false);
  const [lastError, setLastError] = useState<string>("");
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sourceRef = useRef<EventSource | null>(null);
  const retryRef = useRef(0);
  const onEventRef = useRef(onEvent);

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    let unmounted = false;

    const cleanupSource = () => {
      if (sourceRef.current) {
        sourceRef.current.close();
        sourceRef.current = null;
      }
    };

    const connect = () => {
      cleanupSource();
      const params = new URLSearchParams();
      params.set("include_private", includePrivate ? "true" : "false");
      if (project && project !== "__all__") {
        params.set("project", project);
      }
      const source = new EventSource(`/api/stream?${params.toString()}`);
      sourceRef.current = source;

      const handleData = (eventName: string, event: MessageEvent<string>) => {
        try {
          const parsed = JSON.parse(event.data) as Record<string, unknown>;
          onEventRef.current({ event: eventName, data: parsed });
        } catch {
          // ignored
        }
      };

      source.addEventListener("ready", (event) => handleData("ready", event as MessageEvent<string>));
      source.addEventListener("observation.created", (event) =>
        handleData("observation.created", event as MessageEvent<string>)
      );
      source.addEventListener("session.finalized", (event) => handleData("session.finalized", event as MessageEvent<string>));
      source.addEventListener("health.changed", (event) => handleData("health.changed", event as MessageEvent<string>));
      source.addEventListener("ping", (event) => handleData("ping", event as MessageEvent<string>));

      source.onopen = () => {
        if (unmounted) return;
        retryRef.current = 0;
        setConnected(true);
        setLastError("");
      };

      source.onerror = () => {
        if (unmounted) return;
        setConnected(false);
        setLastError("stream disconnected, reconnecting...");
        cleanupSource();
        const waitMs = Math.min(5000, 500 * (retryRef.current + 1));
        retryRef.current += 1;
        reconnectRef.current = setTimeout(connect, waitMs);
      };
    };

    connect();

    return () => {
      unmounted = true;
      if (reconnectRef.current) {
        clearTimeout(reconnectRef.current);
        reconnectRef.current = null;
      }
      cleanupSource();
      setConnected(false);
    };
  }, [includePrivate, project]);

  return { connected, lastError };
}
