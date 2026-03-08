# Phase 1 Implementation Contract (Draft)

## Purpose
Define implementation-ready draft contracts for Phase 1 without changing runtime package behavior in this documentation phase.

## Where Used
- Sidecar and shim implementation planning.
- IDE/runtime integration alignment.
- CI policy/replay gate compatibility checks.

## Guarantees (Current)
- [CURRENT] This contract is documentation-only and introduces no runtime API changes now.
- [CURRENT] Existing `core/policy/replay/cli` public behavior remains the baseline.
- [PARTIAL] Runtime profile behavior depends on host integration quality.

## Planned Guarantees (Future)
- [PLANNED] Sidecar local API implementation for session/event/control flow.
- [PLANNED] Profile-aware error handling and approval persistence.

## Non-Goals
- [CURRENT] No code generation, package scaffolding, or endpoint implementation in this phase.
- [CURRENT] No replay execution-mode implementation in this phase.

## Interfaces / Contracts

### Local Sidecar API Draft

#### `POST /v1/session/start`
Request:
```json
{
  "agent_id": "string",
  "workspace": "string",
  "repo": "string",
  "profile": "dev|staging|prod",
  "metadata": {}
}
```
Response:
```json
{
  "session_id": "string"
}
```
Invariants:
- `session_id` must be unique per open session.
- `profile` must resolve to an explicit behavior matrix.

#### `POST /v1/event`
Request:
```json
{
  "session_id": "string",
  "event": {
    "event_type": "tool_call|tool_result|decision|observation|error|lifecycle|llm_request|llm_response",
    "timestamp": "ISO-8601",
    "payload": {},
    "metadata": {}
  }
}
```
Response:
```json
{
  "accepted": true
}
```
Invariants:
- Namespace policy applies to metadata keys.
- Event order must remain append-safe and hash-chain compatible.

#### `POST /v1/policy/precheck`
Request:
```json
{
  "session_id": "string",
  "candidate_action": {
    "kind": "tool_call|output_egress|prompt_ingress",
    "name": "string",
    "arguments_hash": "string"
  },
  "metadata": {}
}
```
Response:
```json
{
  "action": "allow|deny|require-approval",
  "severity": "info|warning|error|critical",
  "rule_id": "string",
  "message": "string",
  "request_id": "string"
}
```
Invariants:
- `request_id` present when `action=require-approval`.
- Decision must be traceable to policy/rule id.

#### `POST /v1/approval`
Request:
```json
{
  "session_id": "string",
  "request_id": "string",
  "approved": true,
  "reason": "string"
}
```
Response:
```json
{
  "recorded": true
}
```
Invariants:
- Approval decisions must append evidence refs to trace metadata.

#### `POST /v1/session/end`
Request:
```json
{
  "session_id": "string",
  "summary": {}
}
```
Response:
```json
{
  "trace_path": "string"
}
```
Invariants:
- Session close finalizes lifecycle end event.
- `trace_path` must resolve to a valid `.trace.jsonl` artifact.

### Config Schema Draft: `.krynix/sidecar.yaml`
```yaml
profile: dev|staging|prod
capture:
  prompt_body: off|opt_in|on
  response_body: off|opt_in|on
commands:
  protected: [string]
policies:
  path: "./policies"
tenancy:
  team: "string"
  repo: "string"
storage:
  trace_dir: "./traces"
  retention_days: 30
```
Defaults:
- `profile: dev`
- `capture.prompt_body: opt_in`
- `capture.response_body: opt_in`
- `storage.retention_days: 30`

Validation constraints:
- `retention_days >= 1`
- `commands.protected` must be non-empty in `staging/prod`
- `policies.path` must exist and be readable

### Metadata Namespace Contract
Required namespaces:
- `metadata.intent.*`
- `metadata.guard.*`
- `metadata.runtime.*`
- `metadata.output.*`

Rules:
- keys lowercase,
- JSON-serializable values,
- no override of `_krynix_*` reserved keys.

### Error Model Draft
| Failure class | dev | staging | prod |
|---|---|---|---|
| sidecar unreachable | fail-open + local warning event | fail-closed for protected operations | fail-closed for protected operations |
| policy precheck timeout | allow + warning evidence by profile | block | block |
| approval timeout | continue only if policy permits + warn | block | block |
| malformed event payload | reject + emit local error | reject + block affected action | reject + block affected action |

### Backward Compatibility Statement
Phase 1 implementation must not introduce breaking changes in:
- `@krynix/core`
- `@krynix/policy`
- `@krynix/replay`
- `@krynix/cli`

Any incompatible change requires explicit RFC and migration plan.

## Operational Usage
Draft workflow:
1. start session,
2. emit events and prechecks,
3. process approvals,
4. end session and finalize trace,
5. run CI policy/replay checks.

## Known Gaps And Roadmap
- [PARTIAL] Contracts are draft-only until implementation tasks begin.
- [PLANNED] Endpoint schemas will be promoted to versioned API docs once implemented.
