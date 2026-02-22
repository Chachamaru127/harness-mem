import { createSimpleReranker } from "./simple-reranker";
import { type RerankerRegistryResult } from "./types";

function parseEnabled(raw: unknown): boolean {
  if (typeof raw === "boolean") {
    return raw;
  }
  if (typeof raw === "string") {
    const normalized = raw.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "no", "off"].includes(normalized)) {
      return false;
    }
  }
  return false;
}

export function createRerankerRegistry(enabledInput: unknown): RerankerRegistryResult {
  const enabled = parseEnabled(enabledInput);
  if (!enabled) {
    return {
      enabled: false,
      reranker: null,
      warnings: [],
    };
  }

  return {
    enabled: true,
    reranker: createSimpleReranker(),
    warnings: [],
  };
}
