# Trust Pipeline

The **Trust Pipeline** is the composition of Krynix's three primitives -- Trace, Policy, and Replay -- into a verification loop enforced in CI.

## How the Primitives Compose

```
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│      Trace       │     │      Policy      │     │      Replay      │
│                  │ --> │                  │ --> │                  │
│  Capture what    │     │  Evaluate what   │     │  Verify it's     │
│  the agent did   │     │  was allowed     │     │  reproducible    │
└──────────────────┘     └──────────────────┘     └──────────────────┘
                                  |
                                  v
                         ┌──────────────────┐
                         │     CI Gate      │
                         │                  │
                         │  Block merge on  │
                         │  violations      │
                         └──────────────────┘
```

Each primitive provides value independently:

| Primitive | Standalone Value |
|-----------|-----------------|
| **Trace** alone | Audit trail -- know what the agent did |
| **Policy** alone | Compliance -- ensure the agent followed rules |
| **Replay** alone | Reproducibility -- prove behavior is deterministic |

Together they answer three questions:

1. **What did the agent do?** --> Trace
2. **Was it allowed to do that?** --> Policy
3. **Can we prove it would do the same thing again?** --> Replay

## The CI Trust Gate

The trust pipeline is enforced in CI as merge gates:

```yaml
# .github/workflows/trust-gate.yml
jobs:
  trust-verification:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v2
      - run: pnpm install && pnpm build

      # Gate 1: Policy evaluation
      - name: Policy Gate
        run: pnpm krynix evaluate --trace $TRACE --policy policies/

      # Gate 2: Replay verification
      - name: Replay Gate
        run: pnpm krynix replay --verify --golden-dir test/golden/
```

**Both gates must pass for a merge to proceed.** This ensures that:

- No code reaches production without passing policy evaluation
- No behavioral regression goes undetected

## Evaluation Pipeline API

For programmatic use, the `evaluateTrace()` function (alias: `runEvaluationPipeline()`) orchestrates the full trust pipeline in a single call:

```typescript
import { evaluateTrace } from "@krynix/core";

const result = await evaluateTrace(
  {
    tracePath: "session.trace.jsonl",
    policies: [loadedPolicy],
    filter: { event_types: ["tool_call"] },
    generateBundle: true,
  },
  {
    evaluatePolicy: (events, policy) => evaluate(events, policy),
    verifyReplay: (events) => verifyTrace(events),
  },
);

// result.exitCode -- 0 for pass, higher for failures
// result.hashChain -- { valid: boolean, error?: string }
// result.stats -- trace analytics
// result.policyResults -- per-policy evaluation results
// result.replayResult -- replay verification result
// result.bundle -- compliance evidence bundle (if requested)
```

The pipeline steps are:
1. Load trace (from file or pre-loaded events)
2. Validate hash chain integrity
3. Apply event filters
4. Compute trace statistics
5. Evaluate each policy
6. Verify replay (if configured)
7. Generate compliance bundle (if requested)

Exit code is the maximum of all sub-results.

## Trust Properties

The pipeline enforces three layers of trust:

### 1. Trace Integrity

Hash chains ensure that recorded behavior cannot be silently modified. Any tampering breaks the chain and is detected during verification.

### 2. Policy Enforcement

Policies are evaluated externally from the agent and enforced via CI gates. The agent cannot bypass, modify, or influence its own policy evaluation.

### 3. Replay Verification

Deterministic replay proves that recorded behavior is reproducible. If behavior cannot be replayed identically, it may not be trustworthy.

## Data Flow

```
Agent Framework
     |
     |  (1) raw events via callback/hook
     v
Trace Adapter
     |
     |  (2) canonical TraceEvents
     v
Redaction Engine --> strips secrets from payloads
     |
     |  (3) redacted TraceEvents
     v
Hash Chain Module --> computes prev_hash, event_hash
     |
     |  (4) hash-chained TraceEvents
     v
Trace Writer --> appends to .trace.jsonl
     |
     |  (5) complete .trace.jsonl file
     ├──────────────────────────┐
     v                          v
Policy Evaluator           Replay Engine
     |                          |
     |  (6a) verdict            |  (6b) pass/diverge
     v                          v
CI Gate --> exit code --> GitHub Actions check
```

## See Also

- [[Trace]] -- Structured event capture
- [[Policy]] -- Declarative rule evaluation
- [[Replay]] -- Deterministic re-execution
- [[Architecture Overview]] -- System-level design
