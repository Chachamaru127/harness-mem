package util

import "testing"

func TestIsValidPath(t *testing.T) {
	tests := []struct {
		name  string
		input string
		want  bool
	}{
		{"normal path", "/foo/bar.go", true},
		{"traversal", "../etc/passwd", false},
		{"null byte", "foo\x00bar", false},
		{"shell dangerous chars semicolon", "foo;rm -rf", false},
		{"empty string", "", false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := IsValidPath(tc.input)
			if got != tc.want {
				t.Errorf("IsValidPath(%q) = %v, want %v", tc.input, got, tc.want)
			}
		})
	}
}

func TestIsValidID(t *testing.T) {
	longID := make([]byte, 129)
	for i := range longID {
		longID[i] = 'a'
	}

	tests := []struct {
		name  string
		input string
		want  bool
	}{
		{"normal id", "my-session_123", true},
		{"empty string", "", false},
		{"129 chars exceeds max", string(longID), false},
		{"special chars with space and exclamation", "foo bar!", false},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := IsValidID(tc.input)
			if got != tc.want {
				t.Errorf("IsValidID(%q) = %v, want %v", tc.input, got, tc.want)
			}
		})
	}
}
