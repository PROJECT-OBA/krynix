# Security Policy

Krynix is a runtime policy enforcement layer for AI agents. Security is the product, so we treat vulnerability reports as a first-class workflow. **If you want to skip to action: use [GitHub's private vulnerability reporting](https://github.com/PROJECT-OBA/krynix/security/advisories/new) on this repository.** Email is a fallback (see [Reporting a Vulnerability](#reporting-a-vulnerability) below).

## Supported Versions

Security patches go to the latest minor of each published `@krynix/*` package. Pre-1.0 packages do not receive backports to older minors — upgrade to the latest published version on the relevant npm dist-tag.

| Package | Current published track | Patches land on |
|---|---|---|
| `@krynix/core` | `0.2.x` | latest `0.2.x` |
| `@krynix/policy` | `0.2.x` | latest `0.2.x` |
| `@krynix/replay` | `0.2.x` | latest `0.2.x` |
| `@krynix/cli` | `0.2.x` | latest `0.2.x` |
| `@krynix/adapter-langchain` | `0.2.x` | latest `0.2.x` |
| `@krynix/adapter-openclaw` | `0.2.x` | latest `0.2.x` |
| `@krynix/sdk` | `0.1.0-alpha.x` (under `@alpha` tag) | latest `0.1.0-alpha.x` |
| Older versions (`< 0.2.0`) | — | not supported; please upgrade |

When a security release ships, we publish a GitHub Security Advisory on this repository with the CVE (when applicable), affected versions, fix versions, and a workaround when available. Subscribe to repository security advisories to be notified. Once Krynix reaches 1.0, this table will be updated with a formal support window.

## Reporting a Vulnerability

**Do not open a public issue for security vulnerabilities.** Open issues are publicly visible the moment they're created.

**Primary channel: [GitHub's private vulnerability reporting](https://github.com/PROJECT-OBA/krynix/security/advisories/new).** This routes the report directly to the maintainer team in a private GitHub Security Advisory — only the maintainers and people you explicitly add can see it. We strongly prefer this channel: it gives us a private discussion thread, a coordinated-disclosure draft, and a release timeline in one place.

**Secondary channel: email `security@krynix.dev`.** Use this if GitHub reporting is unavailable for any reason. We respond from the same address.

Include in your report:

- Description of the vulnerability and the impact you observed.
- Steps to reproduce, ideally as a minimal code or policy example. For SDK / policy bugs, a Vitest-style snippet against a published `@krynix/*` version is ideal — see how [krynix#56](https://github.com/PROJECT-OBA/krynix/issues/56) is structured for an example.
- Affected version(s) you tested against, plus your Node.js / runtime version.
- Affected component (trace capture, policy engine, replay engine, CLI, runtime SDK, framework adapter).
- Severity assessment (your estimate using [CVSS 3.1](https://www.first.org/cvss/v3-1/specification-document) when applicable).
- Any suggested mitigation, if you have one.
- Whether you'd like to be credited in the advisory, and under what name.

### What to Expect

| Timeline | Action |
|---|---|
| Within 48 hours | Acknowledgment of your report |
| Within 7 days | Initial assessment and severity classification |
| Within 30 days | Fix developed and tested (for confirmed vulnerabilities) |
| Within 45 days | Fix released and advisory published |
| Within 90 days (default) | Coordinated public disclosure |

Timelines may vary for complex issues. We will keep you informed of progress. If we miss any of the above, please nudge us on the same channel — we'd rather hear about a missed SLA than have a report fall through the cracks.

## Coordinated Disclosure

We follow industry-standard coordinated disclosure. The default disclosure timeline is **90 days from initial report**, with adjustments:

- **Earlier disclosure** when a fix has been released and the advisory text is ready — we don't sit on resolved issues.
- **Extended embargo** when the fix is complex or affects downstream packages that need their own patch window. We won't extend without your agreement.
- **Immediate disclosure** when there is evidence of active exploitation in the wild. We will coordinate with you but will not delay a public advisory to protect a research-paper / talk timing if users are being attacked.

Once the embargo lifts: we publish a GitHub Security Advisory (with CVE where applicable), publish patched versions to npm, deprecate the vulnerable versions, and credit the reporter under the name and link agreed.

## Scope

### In scope

- All code under the `packages/` directory in this repository — `@krynix/core`, `@krynix/policy`, `@krynix/replay`, `@krynix/cli`, `@krynix/sdk`, `@krynix/adapter-langchain`, `@krynix/adapter-openclaw`.
- Published npm packages under the `@krynix/` scope (latest minor track per [Supported Versions](#supported-versions)).
- Policy evaluation logic and CI gate behavior.
- Hash chain, signing, and redaction implementations.
- The runtime SDK's verdict pipeline (`runPipeline`, `applyRedactions`) and approval-resolution surface (`ApprovalPoller`, `approvalHandler`).
- Release pipeline integrity (Trusted Publishing config, provenance attestations, signed releases).
- Documentation that recommends insecure patterns or omits important security caveats.

### Out of scope

- **Hosted services** running on `api.krynix.dev`, `app.krynix.dev`, or any other `*.krynix.dev` subdomain. These are operated separately from this open-source repository and are not part of the OSS surface this policy covers. Please do not run security scans against them.
- **The `krynix-sdk-python` package** — separate repository with its own `SECURITY.md`. Cross-reference is fine; reports should land in that repo's advisory tracker.
- Vulnerabilities in external agent frameworks (LangChain, OpenClaw, etc.).
- Vulnerabilities in LLM providers.
- Vulnerabilities in CI infrastructure (GitHub Actions, npm registry, etc.) where Krynix is merely a consumer.
- **Self-inflicted misconfigurations** — e.g. running `@krynix/sdk` with `redaction.mode = "off"` and then being surprised that PII isn't redacted. The SDK behaves as documented; the report belongs in a configuration-help thread, not a vulnerability advisory. (For genuine bugs in documented redaction behaviour — see [krynix#56](https://github.com/PROJECT-OBA/krynix/issues/56) for the shape we expect.)
- **Theoretical attacks against the threat model** without a working proof of concept. We're happy to discuss the model, but speculation isn't a vulnerability — see the [threat model](docs/10_architecture/threat_model.md).
- **DoS via resource exhaustion** in the trace / policy parser. The packages are designed to be run against trusted inputs (your own agent's events, your own policy YAML). Inputs from untrusted users SHOULD be validated upstream; treat the SDK like any other library that parses your application's own data.
- **Best-practice / hardening suggestions** without a specific vulnerability — these are welcome as regular issues or pull requests.
- Social engineering attacks.

## Security model + boundaries

Understanding what Krynix does and doesn't protect helps reporters set expectations.

### What Krynix is designed to protect against

- **A policy-defined runtime decision being silently bypassed.** If a policy rule says `deny`, the SDK throws; if it says `redact`, the SDK rewrites the outgoing body before forwarding. Any reproducer where the documented verdict semantics are violated is a security issue — including [silent failure modes](https://github.com/PROJECT-OBA/krynix/issues/56) where a verdict is downgraded without surfacing a warning.
- **Tamper-evident trace integrity.** The hash chain in `@krynix/core` detects modification, deletion, insertion, and reordering of trace events under the assumption that the integrity-verifying party has the genuine signing public key (when signing is used) or a trusted snapshot of the head hash (when not). Cryptographic attacks against the chain are in scope.
- **Audit-trail honesty.** Decision events record the **replacement** value of a redaction, never the original — leaking the original through the audit trail is a security issue.

### What Krynix is NOT designed to protect against

- **Malicious agent code that doesn't use Krynix.** If the agent never calls the wrapped client, no policy can apply. Krynix is a library, not a sandbox.
- **Inferred intent.** Krynix enforces on observable actions (LLM requests, tool calls), not on what the agent "meant to do." Prompt-injection guards based on regex / structural matching can have false negatives — that's a property of the threat, not a Krynix bug. (A regex pattern in the policy that demonstrably matches but the SDK still forwards is a Krynix bug; an attacker who phrases a jailbreak in a way our example policy doesn't catch is a policy-authoring problem.)
- **Network attacks against the customer's LLM provider.** Krynix never sees the LLM provider's TLS layer, never decrypts traffic, never inspects upstream-only data.
- **The threat model your application wraps around Krynix.** The policy you write defines what's allowed; Krynix faithfully enforces it. A weak policy is not a Krynix vulnerability.

If you're unsure whether your finding fits in scope, file the advisory anyway — we'll route it correctly. See also the canonical [threat model](docs/10_architecture/threat_model.md).

## Threat categories

Security reports often map to the threat categories defined in the [threat model](docs/10_architecture/threat_model.md):

| Category | Description |
|---|---|
| **Prompt Injection** | Agent manipulated into unintended actions via crafted input |
| **Tool Abuse** | Permitted tools used in unintended ways |
| **Privilege Escalation** | Bypassing policy constraints or Trust Boundaries |
| **Secret Exfiltration** | Secrets leaked through traces, tool outputs, or LLM context |
| **Policy Tampering** | Weakening policy enforcement via file modification |
| **Trace Tampering** | Modifying traces to hide activity or fabricate history |
| **Silent Policy Downgrade** | A documented verdict is silently rewritten to a weaker outcome (e.g. krynix#56) |

Reports that don't fit these categories are still welcome — they may reveal new threat vectors.

## Supply chain + release integrity

Reports about how Krynix packages reach end users are in scope.

- npm packages publish via [npm Trusted Publishing](https://docs.npmjs.com/trusted-publishers) from GitHub Actions on this repository. No long-lived `NPM_TOKEN` is configured. The published-provenance attestation is generated by the workflow at release time.
- All packages publish with `--provenance` enabled, so the [npm provenance UI](https://docs.npmjs.com/generating-provenance-statements) can be used to verify the source commit and workflow run that produced any given version.
- The release workflow file is at [`.github/workflows/release.yml`](.github/workflows/release.yml) and lives in committed history — changes to it land via reviewed pull requests like any other code.
- The release workflow runs the full test + build pipeline before publishing; a failing test blocks publishing.

If you find a path that bypasses any of the above, that's a high-severity report. Please use the [primary channel](#reporting-a-vulnerability).

## Safe harbor

We will not pursue legal action against good-faith security researchers who:

- Make a good-faith effort to avoid privacy violations, service disruptions, or destruction of data.
- Do not exfiltrate any data beyond the minimum necessary to demonstrate the vulnerability.
- Give us a reasonable time to fix the issue before any public disclosure.
- Do not exploit the vulnerability against any system other than your own (or one you have explicit permission to test).
- Comply with all applicable laws.

If in doubt about whether a planned action is covered, reach out **before** taking it — we'd rather give you an "OK, that's fine" by email than have a misunderstanding after the fact.

## Recognition

We credit security researchers who responsibly disclose vulnerabilities (with their permission) in our security advisories and, optionally, in the release notes that ship the fix.

Reporters who have helped improve Krynix's security — in publication order:

_None yet — early days. Looking forward to crediting you._

## PGP key

A PGP key for encrypted communication will be published at `https://krynix.dev/.well-known/security.txt` once available. Until then, GitHub's private vulnerability reporting transport already provides end-to-end encryption between you and the maintainers in transit and at rest; PGP is only needed if you prefer the email fallback.

## Changes to this policy

Material changes to this `SECURITY.md` (changes to scope, response SLAs, disclosure timeline, or contact channels) land via reviewed pull requests like any other code change. The commit history is the audit trail for what changed when. Editorial changes (wording, typos, link fixes) don't get separate notice.
