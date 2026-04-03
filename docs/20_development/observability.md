# Observability

This document describes how Krynix exposes operational data for monitoring, alerting, and debugging.

See [glossary](../00_overview/glossary.md) for term definitions. See [trace_spec](../10_architecture/trace_spec.md) for the TraceEvent format. See [architecture](../10_architecture/architecture.md) for the pipeline overview.

## Philosophy

**Traces are the observability data.** Krynix does not invent a separate observability format. The same TraceEvents used for policy evaluation and replay are the source of truth for operational visibility. Observability is a view over existing trace data, not a parallel data stream.

## Export Formats

### JSON Lines (Native)

The native `.trace.jsonl` format is directly consumable by log aggregation systems. Each line is a self-contained JSON object that can be indexed, searched, and aggregated.

```bash
# Stream traces to a log aggregator
tail -f traces/session.trace.jsonl | curl -X POST -d @- https://logs.example.com/ingest
```

### OpenTelemetry Span Conversion

Krynix traces can be converted to OpenTelemetry spans for integration with OTel-compatible backends (Jaeger, Zipkin, Grafana Tempo). The `krynix export` CLI command provides this conversion.

Mapping:

| Krynix Concept | OTel Concept |
|---|---|
| Agent Session (`session_id`) | Trace ID |
| TraceEvent (`event_id`) | Span ID |
| `parent_id` | Parent Span ID |
| `event_type` | Span name |
| `timestamp` + `duration_ms` | Span start/end time (`duration_ms` is only available on `tool_result` events) |
| `payload` | Span attributes |
| `error` event type | Span status = ERROR |

**Note:** `session_id` is a UUIDv4 (128-bit) while OTel Trace IDs are also 128-bit, so the mapping is 1:1. `event_id` is also UUIDv4, mapping to the 128-bit OTel Span ID (which is typically 64-bit) — this may require truncation or a mapping strategy. TraceEvent payloads can contain high-cardinality values (e.g., full LLM prompt text); these should be mapped to span attributes with care to avoid exceeding backend attribute size limits.

```bash
# Export trace to OTLP JSON format
krynix export --format otlp-json --trace traces/session.trace.jsonl
```

## Derived Metrics

These metrics are computed from trace data and are available as structured output from the CLI or exportable to metrics backends.

### Per-Session Metrics

| Metric | Description | Source |
|---|---|---|
| `krynix.session.event_count` | Total TraceEvents in session | Count of events in trace |
| `krynix.session.duration_ms` | Session wall-clock duration | `session_end.timestamp - session_start.timestamp` |
| `krynix.session.tool_call_count` | Number of tool invocations | Count of `tool_call` events |
| `krynix.session.llm_request_count` | Number of LLM API calls | Count of `llm_request` events |
| `krynix.session.error_count` | Number of errors | Count of `error` events |
| `krynix.session.token_usage` | Total LLM tokens consumed | Sum of `prompt_tokens + completion_tokens` from all `llm_response` events |

### Per-Evaluation Metrics

| Metric | Description | Source |
|---|---|---|
| `krynix.policy.violation_count` | Policy violations in evaluation | Count from policy evaluator output |
| `krynix.policy.verdict` | Final policy verdict | `pass`, `fail`, or `require-approval` |
| `krynix.policy.max_severity` | Highest severity violation | Max severity across violations |

### Per-Replay Metrics

| Metric | Description | Source |
|---|---|---|
| `krynix.replay.status` | Replay result | `pass` or `diverged` |
| `krynix.replay.divergence_event` | First divergence `sequence_num` | From divergence report |
| `krynix.replay.events_verified` | Events successfully verified | Count before divergence |

## Alerting

**Note:** Alert severity labels below (Critical, High, Medium, Low) are operational triage categories for the alert system. They are separate from the policy severity levels (`info`, `warning`, `error`, `critical`) defined in [policy_spec](../10_architecture/policy_spec.md), though they are correlated where applicable.

### When to Alert

| Condition | Severity | Action |
|---|---|---|
| Hash chain validation failure | Critical | Potential trace tampering. Investigate immediately. |
| `critical`-severity policy violation | Critical | Agent attempted a critical-severity action. Review trace. |
| Replay divergence in CI | High | Trace hash chain or structure verification failed. Review code changes. |
| `error`-severity policy violation | Medium | Policy violation blocking merge. Fix before retry. |
| Golden trace regeneration required | Low | Code change affected deterministic behavior. Regenerate and review. |

### Alert Format

```json
{
  "alert": "policy_violation",
  "severity": "critical",
  "session_id": "7c9e6679-7425-40de-944b-e07fc1f90ae7",
  "agent_id": "agent-1",
  "policy": "no-shell-exec",
  "rule_id": "deny-shell",
  "message": "Shell execution is not permitted",
  "trace_file": "traces/session.trace.jsonl",
  "event_sequence_num": 4
}
```

## Integration with External Platforms

### Grafana + Loki

Pipe JSON Lines traces to Loki for log-based observability:

```yaml
# promtail config snippet
scrape_configs:
  - job_name: krynix-traces
    static_configs:
      - targets: [localhost]
        labels:
          job: krynix
          __path__: /var/krynix/traces/*.trace.jsonl
```

### Datadog

Use the JSON Lines format with Datadog log ingestion, mapping `event_type` to Datadog facets for filtering and dashboarding.

### Custom Integration

The CLI outputs structured JSON to stdout that can be piped to any system:

```bash
# Policy evaluation results as JSON (default output)
krynix evaluate --trace traces/session.trace.jsonl --policy policies/

# Replay results as JSON (default output)
krynix replay --verify --trace traces/session.trace.jsonl
```

## Data Sensitivity

**Caution:** Trace data may contain PII or sensitive content in `payload` fields (e.g., user prompts in `llm_request`, file contents in `tool_result`). The Krynix redaction engine handles known secret patterns (`*_key`, `*_token`, etc.), but does **not** perform general PII detection.

Before shipping traces to external observability platforms (Datadog, Grafana Cloud, etc.):
- Verify that redaction rules cover all sensitive fields in your environment
- Consider additional payload filtering at the export boundary
- Ensure the external platform's data retention and access policies meet your compliance requirements
