// Package pii provides PII filtering for checkpoint content.
// Port of mcp-server/src/pii/pii-filter.ts
package pii

import (
	"encoding/json"
	"os"
	"regexp"
	"strings"
)

// Rule defines a PII masking rule.
type Rule struct {
	Pattern     *regexp.Regexp
	Replacement string
}

// defaultRules are the built-in PII patterns.
var defaultRules = []Rule{
	{regexp.MustCompile(`\b\d{2,4}[-\s]?\d{2,4}[-\s]?\d{4}\b`), "[PHONE]"},
	{regexp.MustCompile(`[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}`), "[EMAIL]"},
	{regexp.MustCompile(`@[a-zA-Z0-9_]{2,30}`), "[LINE_ID]"},
}

// GetActiveRules returns the active PII rules if HARNESS_MEM_PII_FILTER=true.
// Returns nil if PII filtering is disabled.
func GetActiveRules() []Rule {
	if strings.ToLower(os.Getenv("HARNESS_MEM_PII_FILTER")) != "true" {
		return nil
	}

	// Try loading custom rules from file
	if rulesPath := os.Getenv("HARNESS_MEM_PII_RULES_PATH"); rulesPath != "" {
		if custom := loadRules(rulesPath); custom != nil {
			return custom
		}
	}

	return defaultRules
}

// ApplyFilter applies PII masking rules to content.
func ApplyFilter(content string, rules []Rule) string {
	result := content
	for _, rule := range rules {
		result = rule.Pattern.ReplaceAllString(result, rule.Replacement)
	}
	return result
}

// loadRules loads custom PII rules from a JSON file.
func loadRules(path string) []Rule {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil
	}

	var raw []struct {
		Pattern     string `json:"pattern"`
		Replacement string `json:"replacement"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return nil
	}

	rules := make([]Rule, 0, len(raw))
	for _, r := range raw {
		re, err := regexp.Compile(r.Pattern)
		if err != nil {
			continue
		}
		rules = append(rules, Rule{Pattern: re, Replacement: r.Replacement})
	}

	if len(rules) == 0 {
		return nil
	}
	return rules
}
