// Package types defines shared MCP tool result types.
// Port of mcp-server/src/tool-result.ts
package types

import "encoding/json"

// DefaultMaxResultSizeChars is the default maximum result size hint for MCP clients.
const DefaultMaxResultSizeChars = 500_000

// TextContentBlock represents an MCP text content block.
type TextContentBlock struct {
	Type string `json:"type"`
	Text string `json:"text"`
}

// ToolResult represents the result returned by an MCP tool handler.
type ToolResult struct {
	Content           []TextContentBlock     `json:"content"`
	IsError           bool                   `json:"isError,omitempty"`
	StructuredContent any                    `json:"structuredContent,omitempty"`
	Meta              map[string]any         `json:"_meta,omitempty"`
	Citations         any                    `json:"_citations,omitempty"`
}

// JsonToolResultOptions configures CreateJsonToolResult behavior.
type JsonToolResultOptions struct {
	Citations         any
	IsError           bool
	MaxResultSizeChars int
	Text              string
}

// CreateJsonToolResult builds a ToolResult with structured JSON content.
// Mirrors createJsonToolResult() from tool-result.ts.
func CreateJsonToolResult(data any, opts JsonToolResultOptions) ToolResult {
	text := opts.Text
	if text == "" {
		switch v := data.(type) {
		case string:
			text = v
		default:
			b, err := json.MarshalIndent(data, "", "  ")
			if err != nil {
				text = "{}"
			} else {
				text = string(b)
			}
		}
	}

	maxSize := opts.MaxResultSizeChars
	if maxSize == 0 {
		maxSize = DefaultMaxResultSizeChars
	}

	result := ToolResult{
		Content: []TextContentBlock{{Type: "text", Text: text}},
		StructuredContent: data,
		Meta: map[string]any{
			"anthropic/maxResultSizeChars": maxSize,
		},
	}

	if opts.IsError {
		result.IsError = true
	}
	if opts.Citations != nil {
		result.Citations = opts.Citations
	}

	return result
}

// SuccessText creates a simple text success result.
func SuccessText(text string) ToolResult {
	return ToolResult{
		Content: []TextContentBlock{{Type: "text", Text: text}},
	}
}

// ErrorText creates a simple text error result.
func ErrorText(text string) ToolResult {
	return ToolResult{
		Content: []TextContentBlock{{Type: "text", Text: text}},
		IsError: true,
	}
}
