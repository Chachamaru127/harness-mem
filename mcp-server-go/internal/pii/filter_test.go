package pii

import (
	"strings"
	"testing"
)

// TestPhoneMasking: phone number is replaced with [PHONE].
func TestPhoneMasking(t *testing.T) {
	input := "電話番号は 03-1234-5678 です"
	got := ApplyFilter(input, defaultRules)

	if !strings.Contains(got, "[PHONE]") {
		t.Errorf("want [PHONE] in output, got: %q", got)
	}
	if strings.Contains(got, "03-1234-5678") {
		t.Errorf("phone number should be masked, got: %q", got)
	}
}

// TestEmailMasking: email address is replaced with [EMAIL].
func TestEmailMasking(t *testing.T) {
	input := "連絡先: ohashi@example.com"
	got := ApplyFilter(input, defaultRules)

	if !strings.Contains(got, "[EMAIL]") {
		t.Errorf("want [EMAIL] in output, got: %q", got)
	}
	if strings.Contains(got, "ohashi@example.com") {
		t.Errorf("email should be masked, got: %q", got)
	}
}

// TestLineIDMasking: LINE ID (@handle) is replaced with [LINE_ID].
func TestLineIDMasking(t *testing.T) {
	input := "LINEのIDは @ohashi_it です"
	got := ApplyFilter(input, defaultRules)

	if !strings.Contains(got, "[LINE_ID]") {
		t.Errorf("want [LINE_ID] in output, got: %q", got)
	}
	if strings.Contains(got, "@ohashi_it") {
		t.Errorf("LINE ID should be masked, got: %q", got)
	}
}

// TestMultiplePII: phone and email both masked in a single string.
func TestMultiplePII(t *testing.T) {
	input := "電話: 090-1234-5678、メール: tanaka@example.com"
	got := ApplyFilter(input, defaultRules)

	if !strings.Contains(got, "[PHONE]") {
		t.Errorf("want [PHONE] in output, got: %q", got)
	}
	if strings.Contains(got, "090-1234-5678") {
		t.Errorf("phone number should be masked, got: %q", got)
	}
	if !strings.Contains(got, "[EMAIL]") {
		t.Errorf("want [EMAIL] in output, got: %q", got)
	}
	if strings.Contains(got, "tanaka@example.com") {
		t.Errorf("email should be masked, got: %q", got)
	}
}

// TestNoPII: input without PII is returned unchanged.
func TestNoPII(t *testing.T) {
	input := "今日の天気は晴れです"
	got := ApplyFilter(input, defaultRules)

	if got != input {
		t.Errorf("want unchanged %q, got %q", input, got)
	}
}

// TestEmptyRules: with no rules, input is returned unchanged.
func TestEmptyRules(t *testing.T) {
	input := "電話番号は 03-1234-5678 です"
	got := ApplyFilter(input, nil)

	if got != input {
		t.Errorf("want unchanged %q, got %q", input, got)
	}
}
