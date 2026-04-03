# Truth Labeling & Claims

All major capability claims in docs, PR text, or generated artifacts must include one of:
- `CURRENT` — implemented and tested
- `PARTIAL` — partially implemented
- `PLANNED` — not yet implemented

No untagged aspirational language in normative sections.

## Incorrect vs Correct Examples

| Incorrect | Correct |
|-----------|---------|
| "Replay re-executes agent logic deterministically today." | "Current CLI replay guarantee is integrity verification. Baseline drift comparison exists as library function." |
| "Krynix OSS blocks runtime actions by default." | "Runtime blocking is integration-specific in OSS today." |
| "Krynix receives all user requests before the agent." | "Request ingress ownership depends on deployment mode." |
| "Krynix blocks requests based on inferred intent." | "Advisory intelligence informs; observable actions enforce." |

## Enforcement Hierarchy

deterministic hard controls > policy-based > advisory intelligence

Advisory alone must not be the sole basis for critical denial.
