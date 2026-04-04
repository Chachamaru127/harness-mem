export interface TextContentBlock {
  type: "text";
  text: string;
}

export interface ToolResult {
  content: TextContentBlock[];
  isError?: boolean;
  structuredContent?: unknown;
  _meta?: Record<string, unknown>;
  _citations?: unknown;
}

interface JsonToolResultOptions {
  citations?: unknown;
  isError?: boolean;
  maxResultSizeChars?: number;
  text?: string;
}

const DEFAULT_MAX_RESULT_SIZE_CHARS = 500_000;

export function createJsonToolResult(
  data: unknown,
  options: JsonToolResultOptions = {}
): ToolResult {
  const text =
    options.text ??
    (typeof data === "string" ? data : JSON.stringify(data, null, 2));

  const result: ToolResult = {
    content: [{ type: "text", text }],
    structuredContent: data,
    _meta: {
      "anthropic/maxResultSizeChars":
        options.maxResultSizeChars ?? DEFAULT_MAX_RESULT_SIZE_CHARS,
    },
  };

  if (options.isError) {
    result.isError = true;
  }

  if (options.citations !== undefined) {
    result._citations = options.citations;
  }

  return result;
}
