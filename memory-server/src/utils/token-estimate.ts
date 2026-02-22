export interface TokenEstimateMeta {
  estimated_input_tokens: number;
  estimated_output_tokens: number;
  estimated_total_tokens: number;
  strategy: string;
}

function normalizeText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value ?? "");
  } catch {
    return String(value ?? "");
  }
}

export function estimateTokenCount(value: unknown): number {
  const text = normalizeText(value);
  if (!text.trim()) {
    return 1;
  }
  return Math.max(1, Math.ceil(text.length / 4));
}

export function buildTokenEstimateMeta(input: {
  input: unknown;
  output: unknown;
  strategy: string;
}): TokenEstimateMeta {
  const estimated_input_tokens = estimateTokenCount(input.input);
  const estimated_output_tokens = estimateTokenCount(input.output);
  return {
    estimated_input_tokens,
    estimated_output_tokens,
    estimated_total_tokens: estimated_input_tokens + estimated_output_tokens,
    strategy: input.strategy,
  };
}
