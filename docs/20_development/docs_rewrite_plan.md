# Documentation Rewrite Plan

## Purpose
Define file-by-file actions to align repository documentation and agent rules with the canonical platform architecture direction.

## Source-Of-Truth Rule
Primary narrative source is `docs/10_architecture/platform_architecture_spec.md`.
ADRs record irreversible decisions/tradeoffs only.

## File-By-File Actions
| File | Action | Target Edit |
|---|---|---|
| `docs/10_architecture/platform_architecture_spec.md` | Keep (new canonical) | Canonical layered architecture, truth labels, contract drafts, operational usage, roadmap. |
| `README.md` | Edit | Reframe as entry + quickstart, link to canonical spec, clarify current replay mode and runtime scope. |
| `docs/10_architecture/architecture.md` | Edit | Align to layered model and Krynix trust-spine role with `CURRENT/PARTIAL/PLANNED` tags. |
| `docs/10_architecture/determinism_spec.md` | Edit | Split current integrity/baseline guarantees vs planned execution replay. |
| `docs/10_architecture/policy_spec.md` | Edit | Clarify CI-first current semantics and runtime integration as partial/planned. |
| `docs/10_architecture/component_contract_matrix.md` | Keep (new) | Responsibility/trust matrix with evidence references. |
| `docs/00_overview/glossary_platform.md` | Keep (new) | Platform vocabulary for layered architecture terms. |
| `docs/00_overview/alignment_gap_report.md` | Keep (new) | Contradiction and ambiguity baseline. |
| `docs/20_development/documentation_governance.md` | Keep (new) | Precedence, reviewer policy, PR checklist, docs CI checks. |
| `docs/20_development/implementation_planning_gate.md` | Keep (new) | Decision-ready gate note for implementation planning phase. |
| `wiki/Home.md` | Edit | Add canonical-source notice and status labeling expectations. |
| `wiki/Architecture-Overview.md` | Edit | Align replay and runtime scope language to canonical. |
| `wiki/Replay.md` | Edit | Clarify current replay mode and planned execution replay. |
| `wiki/Trust-Pipeline.md` | Edit | Use integrity + baseline drift wording, not execution replay claims. |
| `wiki/FAQ.md` | Edit | Correct replay/redaction/runtime scope answers. |
| `wiki/Getting-Started.md` | Edit | Update onboarding commands and truthful behavior claims. |
| `wiki/CLI-Reference.md` | Edit | Include `--golden-dir` and note verify semantics. |
| `wiki/Glossary.md` | Merge | Keep concise wiki mirror and defer canonical definitions to docs glossary files. |
| Other `wiki/*` with duplicated outdated claims | Deprecate | Add short notice directing to canonical spec if not maintained. |
| `CLAUDE.md` | Edit | Add truth-labeling and source-precedence requirements. |
| `AGENTS.md` | Keep (new) | Root agent instructions aligned with canonical architecture and truth-label policy. |
| `.claude/rules/architecture.md` | Done | Architecture rules with truth labels and source precedence. |
| `.claude/rules/code-style.md` | Done | Code style guide (replaces `.agents/STYLE.md`). |
| `.claude/rules/testing.md` | Done | Testing rules with CI gate requirements. |
| `.claude/rules/claims.md` | Done | Truth labeling rules (`CURRENT/PARTIAL/PLANNED`). |
| `.github/workflows/ci.yml` | Edit | Add docs checks step. |
| `scripts/docs/*` | Keep (new) | Implement link, terminology, claim-tag, and README-canonical consistency checks. |
| `package.json` | Edit | Add docs check script commands. |

## Merge / Archive Guidance
- Merge candidate: wiki glossary content into `docs/00_overview/glossary_platform.md` and keep wiki glossary as pointer.
- Archive candidate: wiki pages that keep outdated replay/determinism narratives and are not actively maintained.
- ADR usage: do not move narrative architecture into ADRs; reserve ADRs for irreversible choices.

## Execution Order
1. Canonical files (`platform_architecture_spec.md`, glossary, matrix, governance).
2. Gap report and rewrite plan publication.
3. README + core architecture specs alignment.
4. Wiki alignment or deprecation notices.
5. Agent/rules alignment.
6. CI docs checks and script wiring.
7. Implementation planning gate note.

## Exit Criteria
- Canonical spec is the only normative architecture narrative source.
- README/wiki/agent rules do not conflict with canonical current-state claims.
- Docs checks run in CI and fail on regressions.
