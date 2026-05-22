# Telemetry Plumbing

S128-007 uses a lightweight OpenTelemetry-compatible runtime instead of adding
the full OpenTelemetry SDK dependency set. The reason is scope: this slice fixes
the service/resource/env/shutdown contract first, while S128-008 owns semantic
span and metric naming. Pulling in the full SDK before the semantic contract is
fixed would add dependency weight without changing the current local-first
observability behavior.

The env contract follows the standard OTel names that matter for this slice:
`OTEL_SERVICE_NAME`, `OTEL_RESOURCE_ATTRIBUTES`,
`OTEL_EXPORTER_OTLP_ENDPOINT`, `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`,
`OTEL_EXPORTER_OTLP_HEADERS`, `OTEL_EXPORTER_OTLP_TRACES_HEADERS`,
`OTEL_EXPORTER_OTLP_TIMEOUT`, `OTEL_EXPORTER_OTLP_TRACES_TIMEOUT`,
`OTEL_TRACES_EXPORTER`, and `OTEL_SDK_DISABLED`.

Default mode is local-only and performs no network export. OTLP HTTP export is
enabled only when an OTLP endpoint env var is explicitly set. Flush errors are
recorded in telemetry status and never fail recall/search paths.
