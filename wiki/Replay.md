# Replay

**Replay** is deterministic re-execution of a recorded trace to verify that agent behavior is reproducible. If a trace cannot be replayed to produce identical results, the agent's behavior may not be fully understood or trusted.

## Overview

Replay does not re-run the agent. It re-executes the recorded sequence of operations with all external inputs stubbed from the trace, verifying that the agent's logic produces identical decisions and actions.

A valid replay produces byte-identical outputs given:
1. The same recorded trace as input
2. A valid **Determinism Envelope**
3. The same code version

## Determinism Envelope

The Determinism Envelope is the set of constraints that guarantee reproducibility. All five must hold simultaneously during replay:

### 1. Seed Handling

All PRNG operations use a `replay_seed` recorded in the `lifecycle:session_start` event:

```json
{
  "event_type": "lifecycle",
  "payload": {
    "action": "session_start",
    "context": { "replay_seed": 42 }
  }
}
```

During replay, all randomness (UUIDs, selections, shuffles) is seeded with this value. No unseeded randomness is permitted.

### 2. Time Freezing

Wall-clock reads return the `timestamp` from the corresponding TraceEvent, not actual system time. Time always advances monotonically.

### 3. Network Stubbing

All network I/O is replaced with recorded responses from the original trace. No live connections are made. Any network call not in the trace is a replay error.

### 4. Filesystem Snapshotting

Replay operates against a filesystem snapshot, not the live filesystem. File reads return content recorded in `observation` events.

### 5. Dependency Pinning

Runtime dependencies are locked to the exact versions used during the original execution via lock files.

## Golden Traces

**Golden traces** are verified traces committed to version control and used as regression baselines:

```
test/golden/
  session-001.trace.jsonl    # Verified trace file
  session-002.trace.jsonl
```

CI runs replay verification against all golden traces on every build:

```bash
krynix replay --verify --golden-dir test/golden/
```

If agent logic changes cause a golden trace to diverge, the CI gate fails. This catches behavioral regressions before they ship.

### Regenerating Golden Traces

When intentional behavior changes occur, regenerate the golden traces:

```bash
krynix replay --regenerate --golden-dir test/golden/
```

This recomputes hash chains for all traces in the directory. Review the diff carefully before committing.

## Divergence Detection

When replay produces different output than the original trace, the replay engine reports:
- The exact event where divergence occurred
- Field-level diff between expected and actual values
- The replay seed and envelope configuration

Use verbose output for debugging:

```bash
krynix replay --verify --verbose --trace session.trace.jsonl
```

## Replay Guarantees and Limitations

### What Replay Guarantees

- Given identical inputs and a valid envelope, replay produces the same sequence of `decision` and `tool_call` events
- Hash chain verification passes on the replayed trace
- Divergence is detected and reported at the exact point it occurs

### What Replay Does NOT Guarantee

- **Cross-platform floating-point identity** -- mitigated by pinning platform in CI
- **Identical LLM outputs** -- mitigated by recording LLM responses and replaying from recordings
- **GPU computation determinism** -- out of scope (Krynix targets CPU-bound agent logic)

## CLI Commands

```bash
# Verify a single trace
krynix replay --verify --trace session.trace.jsonl

# Verify all golden traces
krynix replay --verify --golden-dir test/golden/

# Verbose output for divergence debugging
krynix replay --verify --verbose --trace session.trace.jsonl

# Regenerate hash chains
krynix replay --regenerate --trace session.trace.jsonl

# Regenerate all golden traces
krynix replay --regenerate --golden-dir test/golden/
```

## See Also

- [Determinism Specification](https://github.com/artificialvirus/krynix/blob/main/docs/10_architecture/determinism_spec.md) -- Full replay specification
- [[Trace]] -- The input format for replay
- [[Trust Pipeline]] -- How replay fits into the trust loop
