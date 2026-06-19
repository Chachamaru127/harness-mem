package tools

import (
	"testing"
	"time"
)

// TestColdStart_HarnessMemSubset measures the cold-start cost of the Go MCP
// server's tool registry construction.  "Cold start" here means: the time
// taken to enumerate AllTools() (which constructs every mcp.NewTool definition
// from scratch — the dominant cost of process boot for a stdio MCP server),
// measured as the median of N independent runs from a fresh local state.
//
// §F-1 (S78-C02b) target: ~5ms.  We assert a generous ceiling of 50ms so the
// test stays useful under CI noise but still catches a regression that moves
// us toward triple digits.  The median is logged so the §F-1 A/B JSON can be
// updated with a real number.
//
// Why median over min: a single best-case run can hide consistent slowdowns;
// median over 11 samples reflects steady-state behavior without being
// distracted by a one-off GC pause.
func TestColdStart_HarnessMemSubset(t *testing.T) {
	const samples = 11
	durations := make([]time.Duration, 0, samples)

	for i := 0; i < samples; i++ {
		start := time.Now()
		tools := AllTools()
		elapsed := time.Since(start)
		if len(tools) == 0 {
			t.Fatalf("AllTools() returned 0 tools on iteration %d", i)
		}
		durations = append(durations, elapsed)
	}

	// Selection sort small slice — avoid pulling in sort just for medians.
	for i := 0; i < len(durations); i++ {
		minIdx := i
		for j := i + 1; j < len(durations); j++ {
			if durations[j] < durations[minIdx] {
				minIdx = j
			}
		}
		durations[i], durations[minIdx] = durations[minIdx], durations[i]
	}

	median := durations[len(durations)/2]
	t.Logf("cold-start median over %d samples: %v (min=%v, max=%v)",
		samples, median, durations[0], durations[len(durations)-1])

	// Ceiling — see commentary above.  Adjust deliberately if it ever fires.
	if median > 50*time.Millisecond {
		t.Errorf("cold-start median %v exceeds 50ms ceiling", median)
	}
}
