# Krynix Glossary

This glossary is the project-level term index.
For layered platform vocabulary, see `docs/00_overview/glossary_platform.md`.

## Terms

### Replay
- `CURRENT`: integrity verification of trace artifacts and optional baseline drift comparison.
- `PLANNED`: deterministic execution replay of agent logic.

### Replay Mode
- `CURRENT`: `integrity`, `baseline-diff`.
- `PLANNED`: `execution`.

### Redaction
- `CURRENT`: deterministic field-name-pattern based masking with optional custom patterns.
- `PARTIAL`: not every secret naming variant is covered by defaults.

### Trust Spine
Krynix role as the cross-layer evidence/policy/replay backbone rather than complete runtime platform ownership.

### Input Layer
Pre-execution context and intent/risk checks.

### Runtime Layer
Tool mediation and guard decisions around execution.

### Output Layer
Response mapping, output guards, and provenance emission.

### Drift
Difference between current trace behavior and an approved baseline trace.

### Provenance
Trace-linked evidence chain from input signals to output delivery action.

### Guard
A control component that emits a decision (`allow`, `deny`, `require-approval`, `warn`).

### Decision
Structured trust outcome with action, severity, and evidence references.
