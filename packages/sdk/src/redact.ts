/**
 * Redaction layer for the runtime SDK.
 *
 * Two responsibilities:
 *
 * 1. **Rule-driven redaction** (`applyRedactions`) — when the policy
 *    verdict is `"redact"`, the matched rule carries a list of
 *    `Redaction` directives (path + optional pattern + optional
 *    replacement). This function applies them to a deep-cloned
 *    request body so the upstream call gets the scrubbed version.
 * 2. **Mode dispatch** — `"off"` skips redaction entirely; `"regex"`
 *    runs the rule directives literally; `"presidio"` throws (not
 *    implemented until v0.2).
 *
 * The wider `@krynix/core/redaction` module exists for trace-emission
 * redaction (scrubbing the trace JSONL before it goes to ingest /
 * disk). This module is the **runtime path** — modifying the
 * outgoing LLM / tool call before forwarding.
 *
 * @module
 */

import type { Redaction } from "@krynix/policy";
import type { PolicyDecisionRedaction } from "@krynix/core";
import type { RedactionConfig, RedactionMode } from "./types.js";

const DEFAULT_REPLACEMENT = "<REDACTED>";

/** Result of applying redactions to a request body. */
export interface AppliedRedactions {
  /** The redacted body. Always a deep clone — original is never mutated. */
  body: unknown;
  /** What was redacted (path + replacement string), for the audit-trail event. */
  applied: PolicyDecisionRedaction[];
}

/**
 * Resolve the redaction mode from caller config. Default `"regex"`.
 * `"presidio"` is recognised but throws at first use until v0.2 ships
 * the integration; the throw happens here rather than at adapter call
 * time so a misconfigured caller fails fast.
 */
export function resolveRedactionMode(cfg?: RedactionConfig): RedactionMode {
  const mode = cfg?.mode ?? "regex";
  if (mode === "presidio") {
    throw new Error(
      "Presidio-based redaction is not yet implemented in this @krynix/sdk release. " +
        "Use `redaction: { mode: 'regex' }` or `'off'`. Presidio integration is planned for v0.2.",
    );
  }
  return mode;
}

/**
 * Apply a rule's `redactions[]` directives to a request body.
 *
 * The directives come from the matched policy rule (via
 * `SingleEventResult.redactions` on `@krynix/policy`). Each one names:
 *
 * - a `path` into the body (dot-notation with `[*]` for "every element"
 *   on arrays — e.g. `messages[*].content`),
 * - an optional `pattern` (ECMAScript regex with `u` flag — see ADR-0002
 *   and `@krynix/policy`'s parse-time validation),
 * - an optional `replacement` (default `"<REDACTED>"`).
 *
 * When `pattern` is omitted, the entire field value is replaced with
 * `replacement`. When present, only matches are replaced (regex
 * `replace` with `g` modifier auto-attached so multiple occurrences
 * in the same field are all caught).
 *
 * The returned `applied[]` records what actually changed for the
 * audit trail. We record the **replacement** string in
 * `value_redacted`, never the original — the original is dropped at
 * this boundary by design.
 *
 * @param body - The request body about to be sent upstream
 * @param redactions - Directives from the matched policy rule
 * @returns Deep-cloned body + audit-trail applied list
 */
export function applyRedactions(body: unknown, redactions: Redaction[]): AppliedRedactions {
  // Always deep-clone — the upstream LLM SDK may rely on object identity
  // for its own internal state, and mutating its argument would leak
  // redactions into the caller's view of the request.
  const cloned = deepClone(body);
  const applied: PolicyDecisionRedaction[] = [];

  for (const r of redactions) {
    const replacement = r.replacement ?? DEFAULT_REPLACEMENT;
    const re = r.pattern !== undefined ? new RegExp(r.pattern, "gu") : null;
    redactAtPath(cloned, r.path, re, replacement, applied);
  }

  return { body: cloned, applied };
}

// ---------------------------------------------------------------------------
// Path traversal
// ---------------------------------------------------------------------------

/**
 * Walk a path into `obj`, replacing the resolved value(s) with the
 * regex match replacement (or the whole value if no regex).
 *
 * Path grammar:
 *   `foo`              → obj.foo
 *   `foo.bar`          → obj.foo.bar
 *   `foo[*]`           → every element of obj.foo (must be an array)
 *   `foo[*].bar`       → bar on every element of obj.foo
 *   `foo[N]`           → element N of obj.foo (standard JSONPath bracket form)
 *   `foo[N].bar`       → bar on element N of obj.foo
 *   `foo.N.bar`        → element N of obj.foo, .bar (dot-with-numeric form;
 *                        useful when array indices alternate with object keys)
 *
 * The `[N]` form was added in 0.1.0-alpha.2 (see krynix#56). Prior to
 * that, only the `[*]` wildcard worked in bracket form; `messages[0]`
 * was silently treated as a literal key `"messages[0]"` and the
 * traversal returned without applying any redaction. The `[N]` and
 * `.N.` forms are interchangeable; pick whichever matches the JSONPath
 * convention you copied your path from.
 *
 * Each leaf write logs an entry into `applied[]`.
 */
function redactAtPath(
  obj: unknown,
  path: string,
  pattern: RegExp | null,
  replacement: string,
  applied: PolicyDecisionRedaction[],
): void {
  const segments = parsePath(path);
  visit(obj, segments, 0, path, pattern, replacement, applied);
}

type PathSegment =
  | { kind: "key"; key: string }
  | { kind: "spread"; key: string }
  | { kind: "index"; key: string; index: number };

function parsePath(path: string): PathSegment[] {
  // Splits e.g. `foo[*].bar`, `messages[0].content`, `messages.0.content`
  // into a sequence of typed segments. Single-element paths like `foo`
  // split into [{kind:key,key:foo}]. The `[N]` bracket form (added in
  // alpha.2 for krynix#56) and the `.N.` dot-numeric form are equivalent.
  const out: PathSegment[] = [];
  for (const raw of path.split(".")) {
    // Pure numeric segment from the dot-form `messages.0.content` → array
    // index. Must come before the bracket regex below because the bracket
    // regex requires a non-empty key prefix.
    if (/^\d+$/.test(raw)) {
      // A bare-number segment can't reference an object key on its own;
      // it's an array index applied to whatever the previous segment
      // resolved to. Encode as an index segment with an empty key — the
      // visitor treats this as "descend into the current node at index N"
      // by piggybacking on the previous segment's resolved value. We
      // model this by emitting it as a special key-less index; visit()
      // checks for key === "" and applies the index to the array it's
      // currently pointed at.
      out.push({ kind: "index", key: "", index: Number.parseInt(raw, 10) });
      continue;
    }

    // Key with optional bracket suffix: `foo`, `foo[*]`, or `foo[N]`.
    const m = /^([^[\]]+)(?:\[(?:(\*)|(\d+))\])?$/.exec(raw);
    if (!m) {
      // Unparseable segment — treat as a literal key with no spread.
      // This is forgiving on policy authoring; a stricter validator
      // could live on the parser side later.
      out.push({ kind: "key", key: raw });
      continue;
    }
    const key = m[1] ?? raw;
    const wildcard = m[2] === "*";
    const indexStr = m[3];
    if (wildcard) {
      out.push({ kind: "spread", key });
    } else if (indexStr !== undefined) {
      out.push({ kind: "index", key, index: Number.parseInt(indexStr, 10) });
    } else {
      out.push({ kind: "key", key });
    }
  }
  return out;
}

function visit(
  node: unknown,
  segments: PathSegment[],
  index: number,
  fullPath: string,
  pattern: RegExp | null,
  replacement: string,
  applied: PolicyDecisionRedaction[],
): void {
  if (node === null || typeof node !== "object") return;
  const seg = segments[index];
  if (seg === undefined) return;
  const isLeaf = index === segments.length - 1;

  // Spread (`foo[*]`) — either recurse on every array element (interior)
  // or redact every element (leaf).
  if (seg.kind === "spread") {
    const container = node as Record<string, unknown>;
    const arr = container[seg.key];
    if (!Array.isArray(arr)) return;
    if (isLeaf) {
      for (let i = 0; i < arr.length; i++) {
        const before = arr[i];
        const after = redactValue(before, pattern, replacement);
        if (after !== before) {
          arr[i] = after;
          applied.push({ path: fullPath, value_redacted: replacement });
        }
      }
      return;
    }
    for (const child of arr) {
      visit(child, segments, index + 1, fullPath, pattern, replacement, applied);
    }
    return;
  }

  // Index (`foo[N]` with key, or bare-numeric `.N.` with empty key) —
  // resolve to the specific array element. For interior segments, recurse
  // into that element; for leaf segments, redact-and-write-back at that
  // exact array slot.
  if (seg.kind === "index") {
    const arr: unknown[] | null = (() => {
      if (seg.key === "") {
        return Array.isArray(node) ? (node as unknown[]) : null;
      }
      const container = node as Record<string, unknown>;
      const v = container[seg.key];
      return Array.isArray(v) ? (v as unknown[]) : null;
    })();
    if (arr === null) return;
    if (seg.index < 0 || seg.index >= arr.length) return;

    if (isLeaf) {
      const before = arr[seg.index];
      const after = redactValue(before, pattern, replacement);
      if (after !== before) {
        arr[seg.index] = after;
        applied.push({ path: fullPath, value_redacted: replacement });
      }
      return;
    }
    visit(arr[seg.index], segments, index + 1, fullPath, pattern, replacement, applied);
    return;
  }

  // Plain key (`foo` or interior segment of `foo.bar`) — descend into
  // the property; on a leaf, redact and write back.
  const container = node as Record<string, unknown>;
  const value = container[seg.key];
  if (isLeaf) {
    const after = redactValue(value, pattern, replacement);
    if (after !== value) {
      container[seg.key] = after;
      applied.push({ path: fullPath, value_redacted: replacement });
    }
    return;
  }
  visit(value, segments, index + 1, fullPath, pattern, replacement, applied);
}

function redactValue(value: unknown, pattern: RegExp | null, replacement: string): unknown {
  // Only redact strings — replacing structured values opaquely would
  // break the upstream caller's contract in ways the policy author
  // doesn't see coming.
  if (typeof value !== "string") return value;
  if (pattern === null) return replacement;
  return value.replace(pattern, replacement);
}

// ---------------------------------------------------------------------------
// Deep clone
// ---------------------------------------------------------------------------

/**
 * Conservative deep clone good enough for request bodies (plain JSON
 * objects + arrays + primitives). Falls through to `structuredClone`
 * when available for Date / Map / Set / Buffer support; the JSON
 * fallback catches Node 16 / browser environments without
 * `structuredClone`.
 */
function deepClone<T>(value: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(value);
  }
  return JSON.parse(JSON.stringify(value)) as T;
}
