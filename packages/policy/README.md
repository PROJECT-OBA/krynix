# @krynix/policy

Policy evaluation engine for Krynix. Parses YAML policy files, matches rules against trace events, and produces evaluation verdicts (`pass`, `fail`, `require-approval`).

## Key Exports

- `parsePolicy()` — parse and validate a YAML policy file
- `evaluate()` — evaluate a trace against a parsed policy
- `matchRule()` — match a single event against a rule
- `diffPolicies()` — compare two policies and detect security regressions
- `mergePolicy()` / `resolvePolicy()` — policy inheritance and merging
- `createHttpPolicyResolver()` — resolve policies from an HTTP endpoint

## Usage

```typescript
import { parsePolicy, evaluate } from "@krynix/policy";
import { readTrace } from "@krynix/core";

const policy = parsePolicy(`
  apiVersion: krynix.dev/v1
  kind: Policy
  metadata:
    name: no-secret-tools
    version: "1.0"
    description: Block tools with secret in the name
  spec:
    scope:
      agents: ["*"]
      event_types: ["tool_call"]
    rules:
      - id: block-secret-tools
        description: Deny tool calls containing secret
        match:
          event_type: tool_call
          payload:
            - field: tool_name
              operator: contains
              value: secret
        action: deny
        severity: error
        message: "Tool calls with 'secret' in the name are not permitted"
`);

const events = await readTrace("./traces/session.trace.jsonl");
const result = evaluate(events, policy);
// result.verdict: "pass" | "fail" | "require-approval"
```

## Part of Krynix

This package is part of the [Krynix](https://github.com/PROJECT-OBA/krynix) monorepo. See the root README for full documentation.
