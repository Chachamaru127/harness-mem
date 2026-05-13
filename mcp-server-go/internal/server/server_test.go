package server

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"reflect"
	"sort"
	"testing"

	mcpserver "github.com/mark3labs/mcp-go/server"
)

func TestNewServerRegistersToolNamesFromSingleSource(t *testing.T) {
	t.Setenv("HARNESS_MEM_TOOLS", "all")

	got := serverToolNames(NewServer())
	want := registeredToolNames()

	assertSameNames(t, got, want)
	if len(got) == 0 {
		t.Fatal("expected all tool visibility to register tools")
	}
}

func TestNewServerRespectsCoreVisibility(t *testing.T) {
	t.Setenv("HARNESS_MEM_TOOLS", "core")

	got := serverToolNames(NewServer())
	want := registeredToolNames()

	assertSameNames(t, got, want)
	if len(got) != 7 {
		t.Fatalf("expected core visibility to expose 7 tools, got %d (%v)", len(got), got)
	}
}

func TestStreamableHTTPConstructorExposesSameToolsAsConfiguredServer(t *testing.T) {
	for _, visibility := range []string{"all", "core"} {
		t.Run(visibility, func(t *testing.T) {
			t.Setenv("HARNESS_MEM_TOOLS", visibility)

			httpServer := NewStreamableHTTPServer(mcpserver.WithStateLess(true))
			testServer := httptest.NewServer(httpServer)
			defer testServer.Close()

			got := listHTTPToolNames(t, testServer.URL)
			want := serverToolNames(NewServer())

			assertSameNames(t, got, want)
		})
	}
}

func TestTransportMCPServerFactoriesShareConfiguredToolSource(t *testing.T) {
	for _, visibility := range []string{"all", "core"} {
		t.Run(visibility, func(t *testing.T) {
			t.Setenv("HARNESS_MEM_TOOLS", visibility)

			want := registeredToolNames()
			stdioNames := serverToolNames(newStdioMCPServer())
			httpNames := serverToolNames(newStreamableHTTPMCPServer())

			assertSameNames(t, stdioNames, want)
			assertSameNames(t, httpNames, want)
			assertSameNames(t, stdioNames, httpNames)
		})
	}
}

func listHTTPToolNames(t *testing.T, endpoint string) []string {
	t.Helper()

	body := bytes.NewBufferString(`{"jsonrpc":"2.0","id":1,"method":"tools/list"}`)
	req, err := http.NewRequest(http.MethodPost, endpoint, body)
	if err != nil {
		t.Fatalf("create tools/list request: %v", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("post tools/list request: %v", err)
	}
	defer resp.Body.Close()

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read tools/list response: %v", err)
	}
	if resp.StatusCode != http.StatusOK {
		t.Fatalf("tools/list status = %d, body = %s", resp.StatusCode, string(raw))
	}

	var decoded struct {
		Result struct {
			Tools []struct {
				Name string `json:"name"`
			} `json:"tools"`
		} `json:"result"`
		Error any `json:"error"`
	}
	if err := json.Unmarshal(raw, &decoded); err != nil {
		t.Fatalf("decode tools/list response %q: %v", string(raw), err)
	}
	if decoded.Error != nil {
		t.Fatalf("tools/list returned error: %#v", decoded.Error)
	}

	names := make([]string, 0, len(decoded.Result.Tools))
	for _, tool := range decoded.Result.Tools {
		names = append(names, tool.Name)
	}
	sort.Strings(names)
	return names
}

func assertSameNames(t *testing.T, got, want []string) {
	t.Helper()

	if !reflect.DeepEqual(got, want) {
		t.Fatalf("tool names mismatch\n got: %v\nwant: %v", got, want)
	}
}
