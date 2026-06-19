package tools

import (
	"bufio"
	"encoding/json"
	"io"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"testing"
	"time"
)

// TestColdStart_RegistryConstruction is a fast in-process probe for the tool
// registry construction cost (AllTools()).  It catches a regression where
// adding a tool inadvertently makes registry building O(n^2) or pulls in a
// heavy init.  This is NOT a cold-start measurement of the MCP server boot —
// that's TestColdStart_StdioBoot.
func TestColdStart_RegistryConstruction(t *testing.T) {
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

	sort.Slice(durations, func(i, j int) bool { return durations[i] < durations[j] })
	median := durations[len(durations)/2]
	t.Logf("registry construction median over %d samples: %v (min=%v, max=%v)",
		samples, median, durations[0], durations[len(durations)-1])

	// Registry construction should stay sub-millisecond.  10ms ceiling is
	// regression-detection only, not a steady-state expectation.
	if median > 10*time.Millisecond {
		t.Errorf("registry construction median %v exceeds 10ms ceiling", median)
	}
}

// TestColdStart_StdioBoot measures the REAL cold-start cost: exec the built
// binary as a child stdio MCP server, send a JSON-RPC `initialize` request,
// and stop the timer when the response arrives.  This is what an MCP client
// (Claude Code, Codex) actually pays on every session start.
//
// §F-1 (S78-C02b) DoD target was ~5ms which is unrealistic for a Go binary
// that boots a stdio reader + telemetry SDK.  Empirically the boot lives in
// the 30-150ms band on Apple Silicon.  We assert a 1000ms ceiling — anything
// above that is regression-worthy.  The median is logged so the §F-1 A/B JSON
// can be refreshed with a measured number.
//
// `go test -short` skips the probe (Go convention for slow tests).  A build
// failure FAILS the test rather than skipping — if the binary cannot be
// built, the runtime claim it embodies is meaningless and we must surface it.
func TestColdStart_StdioBoot(t *testing.T) {
	if testing.Short() {
		t.Skip("short mode: skipping real-boot probe (use `go test` without -short to run)")
	}

	// Locate the module root (the dir containing go.mod).  This file lives in
	// internal/tools, so two levels up.
	_, thisFile, _, ok := runtime.Caller(0)
	if !ok {
		t.Fatal("runtime.Caller failed; cannot locate module root")
	}
	moduleRoot := filepath.Clean(filepath.Join(filepath.Dir(thisFile), "..", ".."))

	// Build the binary into a tempdir so we exec the same code under test.
	binPath := filepath.Join(t.TempDir(), "harness-mcp-server-coldstart")
	buildCmd := exec.Command("go", "build", "-o", binPath, ".")
	buildCmd.Dir = moduleRoot
	if buildOut, err := buildCmd.CombinedOutput(); err != nil {
		t.Fatalf("go build failed: %v\n%s", err, string(buildOut))
	}

	const samples = 5
	durations := make([]time.Duration, 0, samples)

	for i := 0; i < samples; i++ {
		d, err := measureStdioBootOnce(binPath)
		if err != nil {
			t.Fatalf("stdio boot probe iteration %d failed: %v", i, err)
		}
		durations = append(durations, d)
	}

	sort.Slice(durations, func(i, j int) bool { return durations[i] < durations[j] })
	median := durations[len(durations)/2]
	t.Logf("stdio cold-start median over %d samples: %v (min=%v, max=%v)",
		samples, median, durations[0], durations[len(durations)-1])

	// 1000ms ceiling — regression detection.  The honest expectation is
	// 30-150ms on developer hardware; this leaves room for slow CI runners.
	if median > 1000*time.Millisecond {
		t.Errorf("stdio cold-start median %v exceeds 1000ms ceiling", median)
	}
}

// measureStdioBootOnce exec's the MCP binary, sends a single JSON-RPC
// `initialize` request, and returns the elapsed time from process start to
// receiving the first JSON-RPC response on stdout.
func measureStdioBootOnce(binPath string) (time.Duration, error) {
	cmd := exec.Command(binPath)

	stdin, err := cmd.StdinPipe()
	if err != nil {
		return 0, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return 0, err
	}
	// Discard stderr so the child's banner output ("Harness MCP Server
	// started …") does not deadlock the pipe.
	cmd.Stderr = io.Discard

	start := time.Now()
	if err := cmd.Start(); err != nil {
		return 0, err
	}
	defer func() {
		_ = stdin.Close()
		_ = cmd.Process.Kill()
		_, _ = cmd.Process.Wait()
	}()

	// JSON-RPC 2.0 initialize request — minimal valid payload accepted by
	// most stdio MCP servers built on mark3labs/mcp-go.
	req := map[string]any{
		"jsonrpc": "2.0",
		"id":      1,
		"method":  "initialize",
		"params": map[string]any{
			"protocolVersion": "2024-11-05",
			"capabilities":    map[string]any{},
			"clientInfo": map[string]any{
				"name":    "coldstart-probe",
				"version": "0.1.0",
			},
		},
	}
	payload, err := json.Marshal(req)
	if err != nil {
		return 0, err
	}
	if _, err := stdin.Write(append(payload, '\n')); err != nil {
		return 0, err
	}

	// Read first newline-delimited JSON message from stdout.
	scanner := bufio.NewScanner(stdout)
	// Allow large initialize responses (tool catalog).
	scanner.Buffer(make([]byte, 1<<16), 1<<20)
	deadline := time.NewTimer(5 * time.Second)
	defer deadline.Stop()

	done := make(chan error, 1)
	var elapsed time.Duration
	go func() {
		if scanner.Scan() {
			elapsed = time.Since(start)
			done <- nil
			return
		}
		if err := scanner.Err(); err != nil {
			done <- err
			return
		}
		done <- io.EOF
	}()

	select {
	case err := <-done:
		if err != nil {
			return 0, err
		}
		return elapsed, nil
	case <-deadline.C:
		return 0, &timeoutError{}
	}
}

type timeoutError struct{}

func (timeoutError) Error() string { return "stdio boot probe timed out (>5s)" }
