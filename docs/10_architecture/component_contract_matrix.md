# Component Contract Matrix

| Component | Responsibility | Trust Property | Current Status | Evidence (Code/Test/Doc) |
|---|---|---|---|---|
| `@krynix/core` trace model | Canonical TraceEvent handling and validation pipeline helpers | Structural consistency for traces | CURRENT | `packages/core/src/types.ts`, `packages/core/src/trace-reader.ts`, `docs/10_architecture/trace_spec.md` |
| `@krynix/core` hash chain | Compute/validate `prev_hash` + `event_hash` | Tamper evidence | CURRENT | `packages/core/src/hash-chain.ts`, `packages/core/src/hash-chain.test.ts`, `docs/10_architecture/trace_spec.md` |
| `@krynix/core` redaction | Field-name-pattern secret redaction with deterministic placeholders | Secret minimization in artifacts | PARTIAL | `packages/core/src/redaction.ts`, `packages/core/src/redaction.test.ts`, `docs/10_architecture/trace_spec.md` |
| `@krynix/policy` parser | Parse/validate policy YAML | Deterministic policy interpretation | CURRENT | `packages/policy/src/parser.ts`, `packages/policy/src/parser.test.ts`, `docs/10_architecture/policy_spec.md` |
| `@krynix/policy` matcher/evaluator | Match rules and compute verdicts | Policy decision correctness | CURRENT | `packages/policy/src/matcher.ts`, `packages/policy/src/evaluator.ts`, tests in same package |
| `@krynix/replay` verify | Verify lifecycle/sequence/session/hash/envelope integrity | Evidence integrity verification | CURRENT | `packages/replay/src/replay-runner.ts`, `packages/replay/src/replay-runner.test.ts`, `docs/10_architecture/determinism_spec.md` |
| `@krynix/replay` baseline comparator | Compare two trace event arrays for structural drift | Behavioral drift detection from artifacts | PARTIAL (library only, not CLI-integrated) | `packages/replay/src/comparator.ts`, `packages/replay/src/comparator.test.ts`, `test/integration/baseline-comparison.test.ts` |
| Replay execution mode | Deterministic re-execution of agent logic | High-assurance behavior reproducibility | PLANNED | `docs/10_architecture/platform_architecture_spec.md`, planned RFC |
| `@krynix/cli evaluate` | CI/post-run policy gating command | Enforce policy outcomes in pipelines | CURRENT | `packages/cli/src/evaluate.ts`, `packages/cli/src/help.ts` |
| `@krynix/cli replay` | Replay integrity verification via CLI | Repeatable integrity checks in CI | CURRENT | `packages/cli/src/replay.ts`, `packages/cli/src/help.ts` |
| Adapters (`@krynix/adapter-openclaw`) | Normalize framework events into TraceEvents | Upstream event consistency | CURRENT | `packages/adapter-openclaw/src/*`, `docs/10_architecture/integration_contracts.md` |
| Input layer `IntentClassifier` | Assess request intent/risk before action | Early risk signal for policy decisions | PLANNED | `docs/10_architecture/platform_architecture_spec.md` |
| Runtime `ToolMediationProxy` | Intercept tool calls and apply pre/post checks | Runtime control point and provenance capture | PLANNED | `docs/10_architecture/platform_architecture_spec.md` |
| Runtime `MultiScanGuard` | File/content scanning, data-poisoning detection | Runtime safeguard against unsafe context/actions | PLANNED | `docs/10_architecture/platform_architecture_spec.md` |
| Output `ResponseMapper` | Classify response and map delivery action | Safe delivery and explainability | PLANNED | `docs/10_architecture/platform_architecture_spec.md` |
| Output `ProvenanceBuilder` | Link outputs to decisions/evidence | Transparency and auditability | PLANNED | `docs/10_architecture/platform_architecture_spec.md` |
| Control Plane registry and governance | Centralized storage/distribution/governance around artifacts | Organizational governance at scale | PLANNED | `docs/10_architecture/control_plane_spec.md`, `docs/00_overview/product_model.md` |
