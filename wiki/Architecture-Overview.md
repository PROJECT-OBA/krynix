# Architecture Overview

Canonical source: `docs/10_architecture/platform_architecture_spec.md`.

## Current Architecture Summary
- `CURRENT`: Krynix OSS is the trust spine for trace/policy/replay evidence.
- `CURRENT`: primary enforcement is CI/post-run.
- `PARTIAL`: behavior drift checks exist via baseline trace comparison.
- `PLANNED`: execution replay and richer runtime-native controls.

## Layering Model
- Input Layer: intent/context guards (platform-level integration).
- Runtime Layer: tool mediation and guard decisions.
- Output Layer: response mapping and provenance.
- Krynix: cross-layer evidence and policy backbone.

## OSS Packages
- `@krynix/core`
- `@krynix/policy`
- `@krynix/replay`
- `@krynix/cli`
- `@krynix/adapter-openclaw`

For contract details, see `docs/10_architecture/component_contract_matrix.md`.
