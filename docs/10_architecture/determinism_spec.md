# Determinism Specification

This document defines the requirements and mechanisms for deterministic Replay in Krynix. Replay is the process by which a recorded Trace is re-executed to verify reproducibility.

See [glossary](../00_overview/glossary.md) for term definitions. See [trace_spec](trace_spec.md) for the TraceEvent format used in Replay.

## Overview

Determinism is a core principle of Krynix. If you cannot replay an agent's execution and get identical results, you cannot trust that the agent's behavior is understood, auditable, or safe.

A **Replay** produces byte-identical outputs given:
1. The same recorded Trace as input
2. A valid Determinism Envelope
3. The same code version

Replay is NOT re-running the agent. It is re-executing the recorded sequence of operations with all external inputs stubbed from the Trace, verifying that the agent's logic produces identical decisions and actions.

## Replay Guarantees

### What Replay Guarantees

- Given identical inputs and a valid Determinism Envelope, replay produces the same sequence of `decision` and `tool_call` events
- Hash Chain verification passes on the replayed Trace
- Any divergence from the original Trace is detected and reported at the exact event where divergence occurs

### What Replay Does Not Guarantee

- Cross-platform bit-identical floating-point arithmetic (mitigated by pinning platform in CI)
- Identical LLM outputs (mitigated by recording LLM responses in the Trace and replaying from the recording)
- GPU computation determinism (out of scope; Krynix targets CPU-bound agent logic)

## Determinism Envelope

The Determinism Envelope is the complete set of constraints that must hold during Replay to guarantee reproducibility. All five constraints must be satisfied simultaneously.

### 1. Seed Handling

All PRNG (Pseudo-Random Number Generator) operations must use a `replay_seed` value.

- The `replay_seed` is a `uint64` recorded in the `lifecycle:session_start` event's `context.replay_seed` field
- During replay, all sources of randomness (UUIDs, random selections, shuffle operations) are seeded with this value
- **No unseeded randomness is permitted.** Any code path that introduces randomness without using the session's PRNG is a determinism violation.

```json
{
  "event_type": "lifecycle",
  "payload": {
    "action": "session_start",
    "context": {
      "replay_seed": 42,
      "agent_version": "0.1.0"
    }
  }
}
```

### 2. Time Freezing

Wall-clock reads during Replay return the `timestamp` from the corresponding TraceEvent being replayed, not the actual system time.

- `Date.now()`, `time.time()`, and equivalent calls are intercepted
- The returned value corresponds to the `timestamp` of the current event in the replay sequence
- Time always advances monotonically (each event's timestamp >= previous event's timestamp)
- Duration calculations use recorded `duration_ms` values from `tool_result` events

### 3. Network Stubbing

All network I/O during Replay is replaced with recorded responses from the original Trace.

- HTTP requests return the response body recorded in the corresponding `tool_result` event
- DNS lookups return recorded results
- No live network connections are made during Replay
- Any attempt to make a network call not present in the original Trace is a replay error

### 4. Filesystem Snapshotting

Replay operates against a filesystem snapshot, not the live filesystem.

- The filesystem state at `session_start` is captured (or reconstructed from recorded observations)
- File reads during Replay return the content recorded in `observation` events
- File writes during Replay are captured in an isolated overlay — they do not affect the real filesystem
- The overlay is compared against recorded `tool_result` events for write operations

### 5. Dependency Pinning

Exact package versions used during the original execution are recorded and enforced during Replay.

- The `lifecycle:session_start` event's `context` may include a `dependencies` map of package names to exact version strings
- Replay verifies that the same dependency versions are available
- Version mismatches are reported as replay warnings (not hard failures, since minor patches rarely affect determinism — but are flagged for investigation)

## Golden Trace Testing

Golden Traces are the primary mechanism for regression testing determinism.

### What is a Golden Trace

A Golden Trace is a verified `.trace.jsonl` file committed to version control that serves as a known-good baseline. It captures a complete agent session with all inputs and outputs recorded.

### Creating a Golden Trace

1. Run the agent session with tracing enabled
2. Verify the Trace is valid (hash chain intact, all required fields present)
3. Run replay against the Trace and confirm zero divergence
4. Commit the Trace to `test/golden/<descriptive-name>.trace.jsonl`

### CI Verification

CI runs the following on every build:

```bash
krynix replay --verify --golden-dir test/golden/
```

This command:
1. Loads each `.trace.jsonl` file in the golden directory
2. Replays the Trace within a Determinism Envelope
3. Compares the replay output event-by-event against the recorded Trace
4. Exits with code 0 if all Golden Traces replay identically
5. Exits with code 1 if any divergence is detected

### Maintaining Golden Traces

- When agent logic changes intentionally, affected Golden Traces must be regenerated
- Golden Trace regeneration must be explicitly documented in the PR description
- Stale Golden Traces (those that consistently diverge after a change) must be either updated or removed — never skipped

## Divergence Detection

When replay produces output that differs from the recorded Trace, Krynix reports the divergence with precision.

### Detection Algorithm

1. Replay events are compared against recorded events in sequence order
2. For each event pair (recorded vs. replayed):
   - Compare `event_type` — type mismatch is a structural divergence
   - Compare `payload` — field-by-field comparison using deep equality
   - Compare `event_hash` — hash mismatch confirms content divergence
3. Report the **first divergence point** with:
   - `sequence_num` of the divergent event
   - Expected vs. actual `event_type` and `payload`
   - Diff of the payload fields that differ

### Divergence Report Format

```json
{
  "status": "diverged",
  "first_divergence": {
    "sequence_num": 7,
    "expected": {
      "event_type": "decision",
      "payload": { "action": "write_file", "reasoning": "..." }
    },
    "actual": {
      "event_type": "decision",
      "payload": { "action": "read_file", "reasoning": "..." }
    },
    "diff": {
      "payload.action": { "expected": "write_file", "actual": "read_file" }
    }
  },
  "total_events": 42,
  "events_before_divergence": 7
}
```

## Replay Modes

### `--verify` (Default)

Compare replay output against the recorded Trace. Report pass/fail.

```bash
krynix replay --verify --trace session.trace.jsonl
```

### `--regenerate`

Re-run replay and overwrite the Trace file with the new output. Used when intentionally updating Golden Traces after a code change.

```bash
krynix replay --regenerate --trace test/golden/my-test.trace.jsonl
```

### `--verbose`

Output detailed event-by-event comparison during replay.

```bash
krynix replay --verify --verbose --trace session.trace.jsonl
```

## Constraints and Limitations

### LLM Non-Determinism

LLM providers may return different outputs for identical inputs (even with `temperature: 0`). Krynix mitigates this by recording LLM responses in `llm_response` TraceEvents. During Replay, recorded responses are injected instead of making live LLM calls.

This means Replay verifies that **given the same LLM outputs**, the agent makes the same decisions — not that the LLM itself is deterministic.

### Floating-Point Variance

IEEE 754 floating-point operations may produce different results across platforms, compilers, or optimization levels. Krynix does not attempt to solve cross-platform floating-point determinism. Golden Trace CI should run on a consistent platform (pinned CI runner image).

### External State

Any external state not captured in the Trace (database contents, API state, third-party service behavior) is not part of the Determinism Envelope. Agents that depend on external state must record that state in `observation` events for replay to work.

### Performance

Replay is not expected to match the performance of the original execution. Network stubbing and filesystem overlay add overhead. Replay is a correctness tool, not a performance benchmark.

## Future Work

- **Partial Replay:** Replay a subset of a Trace (e.g., events 10–20) for focused debugging.
- **Replay Diff Visualization:** A CLI or web tool that visualizes divergence between original and replayed Traces side-by-side.
- **Determinism Scoring:** A metric (0.0–1.0) indicating what fraction of an agent's behavior is deterministic, to guide teams toward full reproducibility incrementally.
