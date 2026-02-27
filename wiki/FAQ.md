# FAQ

Frequently asked questions about Krynix.

---

## General

### What is Krynix?

Krynix is a runtime trust layer for autonomous AI agents. It provides three composable primitives -- Trace (audit), Policy (constraints), and Replay (reproducibility) -- that together make agent behavior auditable, constrainable, and reproducible. These are enforced in CI as merge gates.

### Is Krynix an agent framework?

No. Krynix does not run agents, host models, or provide an execution runtime. It sits alongside existing agent frameworks (LangChain, OpenClaw, custom implementations) and provides the trust infrastructure they lack. Agent frameworks integrate with Krynix via Trace Adapters.

### What problem does Krynix solve?

Autonomous agents operate as black boxes. Krynix answers three questions about any agent execution:
1. **What did the agent do?** (Trace)
2. **Was it allowed to do that?** (Policy)
3. **Can we prove it would do the same thing again?** (Replay)

### What agent frameworks does Krynix support?

Krynix provides a Trace Adapter interface. Any framework can be supported by writing an adapter that converts framework events to Krynix TraceEvents. The `@krynix/adapter-openclaw` package is the reference implementation. See [[Writing Trace Adapters]] for how to create your own.

### Is Krynix open source?

Yes. The OSS engine (this repository) is MIT licensed. A planned Control Plane layer will provide centralized governance as a commercial offering.

---

## Technical

### How does the hash chain work?

Each TraceEvent includes the SHA-256 hash of the previous event (`prev_hash`) and its own hash (`event_hash`). This creates a chain where modifying any event invalidates all subsequent hashes. The hash is computed over the canonical JSON representation of the event (sorted keys, no whitespace). See [[Trace]] for details.

### What is a Determinism Envelope?

The Determinism Envelope is the set of constraints that must hold during replay to guarantee reproducibility: fixed PRNG seeds, frozen wall-clock time, stubbed network I/O, filesystem snapshotting, and pinned dependency versions. See [[Replay]] for the full specification.

### What are golden traces?

Golden traces are verified `.trace.jsonl` files committed to version control in `test/golden/`. CI runs replay verification against all golden traces on every build. If agent logic changes cause a golden trace to diverge, the CI gate fails, catching behavioral regressions before they ship.

### How does policy evaluation work?

Policies are YAML files with rules that match against TraceEvent patterns. Rules are evaluated in order (first-match-wins) with AND logic for multiple matchers. The final verdict (`pass`, `fail`, `require-approval`) is mapped to a CI exit code. See [[Policy]] for details.

### What is the difference between `deny` and `require-approval`?

`deny` means the action is not permitted and the CI gate fails. `require-approval` means the action needs human review -- the CI gate reports this status but can be configured to either block or proceed pending approval.

### Does Krynix work without a Control Plane?

Yes. The OSS engine is fully standalone. Every command works offline without any network connectivity. The Control Plane is an optional, additive layer for centralized governance.

---

## Traces

### What format are traces stored in?

JSON Lines (`.trace.jsonl`) -- one TraceEvent per line, UTF-8 encoded. Each event is a self-contained JSON object linked to the previous event via the hash chain.

### How does redaction work?

Krynix automatically detects sensitive field names (e.g., `api_key`, `password`, `secret`, `token`) in TraceEvent payloads and replaces their values with `[REDACTED:SHA256_PREFIX_8]`. The 8-character SHA-256 prefix enables correlation without exposing the actual value. Custom redaction patterns can be added via `redactWithPatterns()`.

### Can I filter events before processing?

Yes. The `evaluate`, `stats`, and `export` commands support filtering flags:
- `--filter-type <type>` -- filter by event type (repeatable)
- `--filter-agent <id>` -- filter by agent ID (repeatable)
- `--after <timestamp>` -- include events at or after this time
- `--before <timestamp>` -- include events at or before this time

Filters combine with AND logic across categories.

---

## Policies

### What YAML format do policies use?

Policies use the `krynix.dev/v1` API version. The format includes `metadata` (name, version, description), `spec.scope` (which agents and event types), and `spec.rules` (match/action/severity). See [[Policy YAML Schema]] for the full reference.

### Can policies inherit from other policies?

Yes. Use `metadata.extends: "parent-name@version"` to inherit rules from a parent policy. The child's rules are appended after the parent's. With the HTTP policy resolver, parent policies can be fetched from a remote registry.

### How do I test a policy before deploying it?

```bash
# Validate syntax
krynix validate --policy my-policy.policy.yaml

# Test against a sample trace
krynix policy test --policy my-policy.policy.yaml --trace sample.trace.jsonl

# Assert expected verdict
krynix policy test --policy my-policy.policy.yaml --trace sample.trace.jsonl --expect-verdict pass

# Compare with a previous version
krynix policy diff --old v1.policy.yaml --new v2.policy.yaml
```

---

## Development

### What are the prerequisites?

Node.js >= 20 LTS, pnpm >= 9, and Git >= 2.40. No additional tools or services required.

### How do I run the tests?

```bash
pnpm test              # All tests
pnpm test:integration  # Integration tests
pnpm test:golden       # Golden trace tests
```

### How is the monorepo structured?

Five packages: `@krynix/core` (foundation), `@krynix/policy` (evaluation), `@krynix/replay` (replay engine), `@krynix/adapter-openclaw` (reference adapter), and `@krynix/cli` (commands). Dependencies flow toward core. See [[Package Structure]].

### How do I contribute?

See [CONTRIBUTING.md](https://github.com/artificialvirus/krynix/blob/main/CONTRIBUTING.md). Branch from `main`, use conventional commits, write tests, ensure CI passes. For significant changes, submit an RFC first.

---

## See Also

- [[Getting Started]] -- Setup and first commands
- [[Architecture Overview]] -- System design
- [[CLI Reference]] -- Full command reference
