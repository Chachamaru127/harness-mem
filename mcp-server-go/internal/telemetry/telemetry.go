package telemetry

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	defaultNamespace = "harness-mem"
	defaultTimeout   = 5 * time.Second
	maxLocalSpans    = 128
)

type Runtime struct {
	mu             sync.Mutex
	serviceName    string
	serviceVersion string
	resource       map[string]any
	mode           string
	endpoint       string
	headers        map[string]string
	timeout        time.Duration
	spans          []span
	flushedSpans   int
	shutdown       bool
	lastFlushErr   string
}

type span struct {
	TraceID string         `json:"traceId"`
	SpanID  string         `json:"spanId"`
	Name    string         `json:"name"`
	Start   string         `json:"startTimeUnixNano"`
	End     string         `json:"endTimeUnixNano"`
	Attrs   map[string]any `json:"-"`
}

func InitFromEnv(serviceName, serviceVersion string) *Runtime {
	envResource := parseResourceAttributes(os.Getenv("OTEL_RESOURCE_ATTRIBUTES"))
	if envName := strings.TrimSpace(os.Getenv("OTEL_SERVICE_NAME")); envName != "" {
		serviceName = envName
	} else if resourceName, ok := envResource["service.name"].(string); ok && strings.TrimSpace(resourceName) != "" {
		serviceName = strings.TrimSpace(resourceName)
	}
	if resourceVersion, ok := envResource["service.version"].(string); ok && strings.TrimSpace(resourceVersion) != "" {
		serviceVersion = strings.TrimSpace(resourceVersion)
	}

	resource := sanitizeAttrs(map[string]any{
		"service.namespace":    defaultNamespace,
		"service.name":         serviceName,
		"service.version":      serviceVersion,
		"harness.component":    "mcp-gateway",
		"process.pid":          os.Getpid(),
		"process.runtime.name": "go",
	})
	for key, value := range envResource {
		if !sensitiveKey(key) {
			resource[key] = value
		}
	}
	resource["service.name"] = serviceName
	resource["service.version"] = serviceVersion

	mode, endpoint := resolveExporter()
	r := &Runtime{
		serviceName:    serviceName,
		serviceVersion: serviceVersion,
		resource:       resource,
		mode:           mode,
		endpoint:       endpoint,
		headers:        mergeHeaders(os.Getenv("OTEL_EXPORTER_OTLP_HEADERS"), os.Getenv("OTEL_EXPORTER_OTLP_TRACES_HEADERS")),
		timeout:        parseTimeout(os.Getenv("OTEL_EXPORTER_OTLP_TRACES_TIMEOUT"), os.Getenv("OTEL_EXPORTER_OTLP_TIMEOUT")),
	}
	r.Record("telemetry.sdk.init", map[string]any{"telemetry.component": "mcp-gateway"})
	return r
}

func (r *Runtime) Record(name string, attrs map[string]any) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.mode == "disabled" || r.shutdown {
		return
	}
	now := strconv.FormatInt(time.Now().UnixNano(), 10)
	r.spans = append(r.spans, span{
		TraceID: randomHex(16),
		SpanID:  randomHex(8),
		Name:    name,
		Start:   now,
		End:     now,
		Attrs:   sanitizeAttrs(attrs),
	})
	if len(r.spans) > maxLocalSpans {
		r.spans = r.spans[len(r.spans)-maxLocalSpans:]
	}
}

func (r *Runtime) Shutdown(ctx context.Context, reason string) error {
	r.Record("telemetry.sdk.shutdown", map[string]any{"telemetry.shutdown.reason": reason})
	err := r.Flush(ctx)
	r.mu.Lock()
	r.shutdown = true
	r.mu.Unlock()
	return err
}

func (r *Runtime) Flush(ctx context.Context) error {
	r.Record("telemetry.sdk.flush", map[string]any{"telemetry.flush.reason": "shutdown"})
	r.mu.Lock()
	if r.mode == "disabled" || r.mode == "local" {
		r.flushedSpans += len(r.spans)
		r.spans = nil
		r.lastFlushErr = ""
		r.mu.Unlock()
		return nil
	}
	spans := append([]span(nil), r.spans...)
	endpoint := r.endpoint
	headers := map[string]string{}
	for key, value := range r.headers {
		headers[key] = value
	}
	resource := map[string]any{}
	for key, value := range r.resource {
		resource[key] = value
	}
	r.mu.Unlock()

	if endpoint == "" || len(spans) == 0 {
		return nil
	}
	timeoutCtx, cancel := context.WithTimeout(ctx, r.timeout)
	defer cancel()
	body, err := json.Marshal(buildPayload(resource, spans))
	if err != nil {
		r.setFlushError(err)
		return err
	}
	req, err := http.NewRequestWithContext(timeoutCtx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		r.setFlushError(err)
		return err
	}
	req.Header.Set("content-type", "application/json")
	for key, value := range headers {
		req.Header.Set(key, value)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		r.setFlushError(err)
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		err := fmt.Errorf("OTLP exporter returned HTTP %d", resp.StatusCode)
		r.setFlushError(err)
		return err
	}

	r.mu.Lock()
	r.flushedSpans += len(spans)
	if len(r.spans) >= len(spans) {
		r.spans = r.spans[len(spans):]
	} else {
		r.spans = nil
	}
	r.lastFlushErr = ""
	r.mu.Unlock()
	return nil
}

func (r *Runtime) setFlushError(err error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.lastFlushErr = err.Error()
}

func resolveExporter() (string, string) {
	if envTruthy(os.Getenv("OTEL_SDK_DISABLED")) || strings.EqualFold(strings.TrimSpace(os.Getenv("OTEL_TRACES_EXPORTER")), "none") {
		return "disabled", ""
	}
	if endpoint := strings.TrimSpace(os.Getenv("OTEL_EXPORTER_OTLP_TRACES_ENDPOINT")); endpoint != "" {
		return "otlp_http", endpoint
	}
	if endpoint := strings.TrimSpace(os.Getenv("OTEL_EXPORTER_OTLP_ENDPOINT")); endpoint != "" {
		return "otlp_http", appendTracePath(endpoint)
	}
	return "local", ""
}

func appendTracePath(endpoint string) string {
	trimmed := strings.TrimRight(strings.TrimSpace(endpoint), "/")
	if strings.HasSuffix(trimmed, "/v1/traces") {
		return trimmed
	}
	return trimmed + "/v1/traces"
}

func parseResourceAttributes(raw string) map[string]any {
	out := map[string]any{}
	for _, part := range splitCommaList(raw) {
		key, value, ok := strings.Cut(part, "=")
		key = strings.TrimSpace(key)
		if !ok || key == "" || sensitiveKey(key) {
			continue
		}
		out[key] = strings.TrimSpace(value)
	}
	return out
}

func mergeHeaders(values ...string) map[string]string {
	headers := map[string]string{}
	for _, raw := range values {
		for _, part := range splitCommaList(raw) {
			key, value, ok := strings.Cut(part, "=")
			key = strings.TrimSpace(key)
			value = strings.TrimSpace(value)
			if ok && key != "" && value != "" {
				headers[key] = value
			}
		}
	}
	return headers
}

func splitCommaList(raw string) []string {
	if raw == "" {
		return nil
	}
	parts := []string{}
	current := strings.Builder{}
	escaping := false
	for _, ch := range raw {
		if escaping {
			current.WriteRune(ch)
			escaping = false
			continue
		}
		if ch == '\\' {
			escaping = true
			continue
		}
		if ch == ',' {
			parts = append(parts, current.String())
			current.Reset()
			continue
		}
		current.WriteRune(ch)
	}
	if current.Len() > 0 {
		parts = append(parts, current.String())
	}
	return parts
}

func parseTimeout(values ...string) time.Duration {
	for _, raw := range values {
		if strings.TrimSpace(raw) == "" {
			continue
		}
		ms, err := strconv.Atoi(strings.TrimSpace(raw))
		if err == nil && ms > 0 {
			if ms < 100 {
				ms = 100
			}
			if ms > 60000 {
				ms = 60000
			}
			return time.Duration(ms) * time.Millisecond
		}
	}
	return defaultTimeout
}

func envTruthy(raw string) bool {
	switch strings.ToLower(strings.TrimSpace(raw)) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}

func sanitizeAttrs(attrs map[string]any) map[string]any {
	out := map[string]any{}
	for key, value := range attrs {
		if key == "" || sensitiveKey(key) {
			continue
		}
		switch v := value.(type) {
		case string, bool, int, int64, float64:
			out[key] = v
		}
	}
	return out
}

func sensitiveKey(key string) bool {
	normalized := strings.ToLower(key)
	for _, needle := range []string{"secret", "token", "password", "passwd", "api_key", "apikey", "authorization", "credential"} {
		if strings.Contains(normalized, needle) {
			return true
		}
	}
	return false
}

func randomHex(bytes int) string {
	raw := make([]byte, bytes)
	if _, err := rand.Read(raw); err != nil {
		return strings.Repeat("0", bytes*2)
	}
	return hex.EncodeToString(raw)
}

func buildPayload(resource map[string]any, spans []span) map[string]any {
	converted := make([]map[string]any, 0, len(spans))
	for _, span := range spans {
		converted = append(converted, map[string]any{
			"traceId":           span.TraceID,
			"spanId":            span.SpanID,
			"name":              span.Name,
			"kind":              1,
			"startTimeUnixNano": span.Start,
			"endTimeUnixNano":   span.End,
			"attributes":        otlpAttrs(span.Attrs),
		})
	}
	return map[string]any{
		"resourceSpans": []map[string]any{
			{
				"resource": map[string]any{"attributes": otlpAttrs(resource)},
				"scopeSpans": []map[string]any{
					{
						"scope": map[string]any{
							"name":    "harness-mem.telemetry",
							"version": "s128-007",
						},
						"spans": converted,
					},
				},
			},
		},
	}
}

func otlpAttrs(attrs map[string]any) []map[string]any {
	out := make([]map[string]any, 0, len(attrs))
	for key, value := range attrs {
		out = append(out, map[string]any{"key": key, "value": otlpValue(value)})
	}
	return out
}

func otlpValue(value any) map[string]any {
	switch v := value.(type) {
	case bool:
		return map[string]any{"boolValue": v}
	case int:
		return map[string]any{"intValue": strconv.Itoa(v)}
	case int64:
		return map[string]any{"intValue": strconv.FormatInt(v, 10)}
	case float64:
		return map[string]any{"doubleValue": v}
	default:
		return map[string]any{"stringValue": fmt.Sprint(v)}
	}
}
