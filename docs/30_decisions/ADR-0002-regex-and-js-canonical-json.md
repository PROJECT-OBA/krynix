# ADR-0002: ECMAScript RegExp and JavaScript-Native Canonical JSON

**Status:** Accepted

**Date:** 2026-02-22

**Context:**

Two implementation decisions affect every component that touches policy matching or hash chain computation:

1. **Regex engine for the `matches` operator.** The policy spec's `matches` operator needs a well-defined regex dialect. Options considered: PCRE (Perl Compatible Regular Expressions) and ECMAScript RegExp (JavaScript's built-in `RegExp`).

2. **Canonical JSON numeric formatting.** The hash chain requires byte-identical serialization of TraceEvents. JSON numbers must produce the same output regardless of how they are constructed. Options considered: a custom numeric formatter and JavaScript's native `JSON.stringify` behavior for finite numbers.

**Decision:**

### Regex: ECMAScript RegExp

The `matches` operator uses ECMAScript RegExp (`new RegExp(pattern)`) as defined by the ECMAScript specification. PCRE is explicitly excluded from v1.

**Rationale:**
- Krynix is implemented in TypeScript/Node.js. Using `new RegExp()` means zero additional dependencies for regex matching.
- ECMAScript RegExp covers the vast majority of patterns needed for policy rules (character classes, anchors, quantifiers, alternation, groups).
- PCRE adds features (lookbehind of variable length, atomic groups, recursive patterns, `\p{...}` Unicode categories beyond what ES supports) that are not needed for v1 use cases (matching tool names, file paths, content strings).
- Adding a PCRE dependency (e.g., `pcre2-wasm`) introduces a native/WASM binding that complicates installation, CI, and cross-platform support.
- If PCRE is needed in the future, it can be added in v2+ as a separate `matches_pcre` operator or by swapping the engine behind `matches`, with the version boundary providing a clear migration point.

### Canonical JSON: `JSON.stringify` for Finite Numbers

Canonical JSON serialization rejects `NaN`, `Infinity`, `-Infinity`, and `BigInt` values before serialization. For all finite numbers, the output matches `JSON.stringify` behavior:

- No leading zeros
- No trailing zeros after the decimal point
- `1.0` serializes as `1`
- `0.10` serializes as `0.1`

**Rationale:**
- `JSON.stringify` is the only numeric serialization behavior available in JavaScript without custom formatting. Any other scheme would require reimplementing numeric-to-string conversion with exact IEEE 754 semantics.
- `NaN`, `Infinity`, and `-Infinity` are not valid JSON values. Their presence in a TraceEvent indicates a bug in trace production and should be caught early.
- `BigInt` is not serializable by `JSON.stringify` and would throw. Rejecting it explicitly with a clear error message is better than an opaque `TypeError`.
- This decision makes the canonical JSON implementation trivially correct in TypeScript: sort keys, use `JSON.stringify` for values, concatenate. No custom numeric formatting code to audit or maintain.

**Consequences:**

- Policy authors must use ECMAScript RegExp syntax for `matches` patterns. Patterns using PCRE-only features will fail with a `RegExp` syntax error at policy parse time.
- Trace producers must not emit `NaN`, `Infinity`, `-Infinity`, or `BigInt` values in any TraceEvent field. The canonical JSON serializer will reject these with a descriptive error.
- Future PCRE support (v2+) will require an ADR update and a clear migration path.
- Non-JavaScript implementations of canonical JSON must match `JSON.stringify` output for numeric formatting to produce byte-identical hashes.

**References:**
- [trace_spec.md - Canonical JSON](../10_architecture/trace_spec.md#canonical-json)
- [policy_spec.md - Operator Reference](../10_architecture/policy_spec.md#operator-reference)
- [ECMAScript RegExp Specification](https://tc39.es/ecma262/#sec-regexp-regular-expression-objects)
