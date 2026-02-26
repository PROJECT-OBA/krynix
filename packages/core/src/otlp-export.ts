/**
 * OTLP trace export — convert TraceEvent[] to OpenTelemetry protobuf-JSON format.
 *
 * Pure function with zero external dependencies. Produces the standard OTel
 * `ExportTraceServiceRequest` JSON structure that OTel collectors accept.
 *
 * See `docs/20_development/observability.md` for mapping rationale.
 *
 * @module
 */

import type { TraceEvent, ToolResultPayload, ErrorPayload } from "./types.js";
import { SCHEMA_VERSION } from "./types.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** OTel attribute value — only one field is set per the protobuf-JSON convention. */
export interface OtlpAttributeValue {
  stringValue?: string;
  intValue?: string;
  doubleValue?: number;
  boolValue?: boolean;
}

/** OTel key-value attribute. */
export interface OtlpAttribute {
  key: string;
  value: OtlpAttributeValue;
}

/** OTel span status. */
export interface OtlpStatus {
  code: number;
  message?: string;
}

/** A single OTel span in protobuf-JSON format. */
export interface OtlpSpan {
  traceId: string;
  spanId: string;
  parentSpanId: string;
  name: string;
  kind: number;
  startTimeUnixNano: string;
  endTimeUnixNano: string;
  attributes: OtlpAttribute[];
  status: OtlpStatus;
}

/** Scope information for an instrumentation library. */
export interface OtlpScope {
  name: string;
  version: string;
}

/** Complete OTel export envelope (`ExportTraceServiceRequest`). */
export interface OtlpExportData {
  resourceSpans: Array<{
    resource: { attributes: OtlpAttribute[] };
    scopeSpans: Array<{
      scope: OtlpScope;
      spans: OtlpSpan[];
    }>;
  }>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** OTel SpanKind: INTERNAL (not a client/server/consumer/producer span). */
const SPAN_KIND_INTERNAL = 1;

/** OTel StatusCode: UNSET. */
const STATUS_CODE_UNSET = 0;

/** OTel StatusCode: ERROR. */
const STATUS_CODE_ERROR = 2;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Convert a Krynix trace to OTel protobuf-JSON format.
 *
 * @param trace - Array of TraceEvents (may be empty)
 * @returns OTel `ExportTraceServiceRequest` JSON structure
 */
export function convertToOtlp(trace: readonly TraceEvent[]): OtlpExportData {
  if (trace.length === 0) {
    return {
      resourceSpans: [
        {
          resource: { attributes: [] },
          scopeSpans: [
            {
              scope: { name: "krynix", version: SCHEMA_VERSION },
              spans: [],
            },
          ],
        },
      ],
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const firstEvent = trace[0]!;

  const resourceAttrs: OtlpAttribute[] = [
    { key: "service.name", value: { stringValue: "krynix" } },
    { key: "agent.id", value: { stringValue: firstEvent.agent_id } },
    { key: "session.id", value: { stringValue: firstEvent.session_id } },
  ];

  const spans: OtlpSpan[] = trace.map((event) => convertEvent(event));

  return {
    resourceSpans: [
      {
        resource: { attributes: resourceAttrs },
        scopeSpans: [
          {
            scope: { name: "krynix", version: SCHEMA_VERSION },
            spans,
          },
        ],
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Strip dashes from a UUID string.
 * "7c9e6679-7425-40de-944b-e07fc1f90ae7" → "7c9e6679742540de944be07fc1f90ae7"
 */
function uuidToHex(uuid: string): string {
  return uuid.replace(/-/g, "");
}

/**
 * Convert a UUID to a 32-char OTel trace ID (128-bit).
 */
function toTraceId(sessionId: string): string {
  return uuidToHex(sessionId);
}

/**
 * Convert a UUID to a 16-char OTel span ID (64-bit).
 * Takes the first 16 hex characters (first 64 bits).
 */
function toSpanId(eventId: string): string {
  return uuidToHex(eventId).slice(0, 16);
}

/**
 * Convert an ISO 8601 timestamp to Unix nanoseconds as a string.
 * Uses BigInt to avoid precision loss (nanosecond timestamps exceed MAX_SAFE_INTEGER).
 */
function toNanoTimestamp(isoTimestamp: string): string {
  const ms = new Date(isoTimestamp).getTime();
  if (isNaN(ms)) return "0";
  return (BigInt(ms) * 1_000_000n).toString();
}

/**
 * Convert a TraceEvent to an OTel span.
 */
function convertEvent(event: TraceEvent): OtlpSpan {
  const startNano = toNanoTimestamp(event.timestamp);

  // tool_result events have duration_ms — compute endTime
  let endNano = startNano;
  if (event.event_type === "tool_result") {
    const payload = event.payload as ToolResultPayload;
    const startMs = new Date(event.timestamp).getTime();
    if (!isNaN(startMs)) {
      const endMs = startMs + payload.duration_ms;
      endNano = (BigInt(endMs) * 1_000_000n).toString();
    }
  }

  // Map error events to ERROR status
  let status: OtlpStatus;
  if (event.event_type === "error") {
    const payload = event.payload as ErrorPayload;
    status = { code: STATUS_CODE_ERROR, message: payload.message };
  } else {
    status = { code: STATUS_CODE_UNSET };
  }

  // Flatten payload into attributes
  const attributes = flattenPayload(event);

  return {
    traceId: toTraceId(event.session_id),
    spanId: toSpanId(event.event_id),
    parentSpanId: event.parent_id !== null ? toSpanId(event.parent_id) : "",
    name: event.event_type,
    kind: SPAN_KIND_INTERNAL,
    startTimeUnixNano: startNano,
    endTimeUnixNano: endNano,
    attributes,
    status,
  };
}

/**
 * Flatten a TraceEvent's payload into OTel attributes.
 *
 * Top-level primitive values become typed attributes.
 * Nested objects/arrays are serialized as JSON strings.
 * All keys are prefixed with "krynix.".
 */
function flattenPayload(event: TraceEvent): OtlpAttribute[] {
  const attrs: OtlpAttribute[] = [];
  const payload = event.payload as unknown as Record<string, unknown>;

  // Add event metadata as attributes
  attrs.push({ key: "krynix.event_id", value: { stringValue: event.event_id } });
  attrs.push({
    key: "krynix.sequence_num",
    value: { intValue: String(event.sequence_num) },
  });

  for (const [key, val] of Object.entries(payload)) {
    const attrKey = `krynix.${key}`;

    if (typeof val === "string") {
      attrs.push({ key: attrKey, value: { stringValue: val } });
    } else if (typeof val === "number") {
      if (Number.isInteger(val)) {
        attrs.push({ key: attrKey, value: { intValue: String(val) } });
      } else {
        attrs.push({ key: attrKey, value: { doubleValue: val } });
      }
    } else if (typeof val === "boolean") {
      attrs.push({ key: attrKey, value: { boolValue: val } });
    } else if (val !== null && val !== undefined) {
      // Nested objects/arrays → JSON string
      attrs.push({ key: attrKey, value: { stringValue: JSON.stringify(val) } });
    }
  }

  return attrs;
}
