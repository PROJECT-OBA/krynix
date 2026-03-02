# FAQ

## What does Krynix do today?
`CURRENT`: Krynix provides trace integrity, policy evaluation, replay integrity checks, and CI/post-run evidence workflows.

## Is replay deterministic execution today?
No. Determinism remains a core design principle, but current replay guarantee is integrity + baseline diff. Execution replay is planned and tracked.

## Is Krynix the full platform?
No. Krynix is the trust spine, not full platform ownership of input/runtime/output controls.

## Does Krynix block runtime actions today?
Not as a built-in OSS guarantee. `CURRENT` enforcement boundary is CI/post-run. Runtime blocking is integration-specific and `PARTIAL` in current direction.

## How complete is redaction?
`PARTIAL`: built-in redaction is field-name-pattern based and deterministic, with optional custom patterns. It should not be treated as universal secret detection.

## Where is the authoritative architecture document?
`docs/10_architecture/platform_architecture_spec.md`
