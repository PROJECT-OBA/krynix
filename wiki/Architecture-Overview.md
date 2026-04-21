# Architecture Overview

Canonical source: `docs/10_architecture/platform_architecture_spec.md`.

## Current Architecture Summary
- `CURRENT`: Krynix OSS is the trust spine for trace/policy/replay evidence.
- `CURRENT`: primary enforcement is CI/post-run.
- `PARTIAL`: behavior drift comparison library exists (`compareTraces`); not yet integrated into CLI.
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

For architecture details, see [platform_architecture_spec.md](https://github.com/PROJECT-OBA/krynix/blob/main/docs/10_architecture/platform_architecture_spec.md).
