# Security Policy

## Supported Versions

| Version | Supported |
|---|---|
| 0.x (pre-release) | Yes (current) |

Once Krynix reaches 1.0, this table will be updated with a formal support window.

## Reporting a Vulnerability

**Do not open a public issue for security vulnerabilities.**

To report a security vulnerability, email: **security@krynix.dev**

Include:
- Description of the vulnerability
- Steps to reproduce
- Affected component (trace capture, policy engine, replay engine, CLI, adapter)
- Severity assessment (your estimate)
- Any suggested mitigation

### What to Expect

| Timeline | Action |
|---|---|
| Within 48 hours | Acknowledgment of your report |
| Within 7 days | Initial assessment and severity classification |
| Within 30 days | Fix developed and tested (for confirmed vulnerabilities) |
| Within 45 days | Fix released and advisory published |

Timelines may vary for complex issues. We will keep you informed of progress.

## Threat Categories

Security reports should map to the threat categories defined in the [threat model](docs/10_architecture/threat_model.md):

| Category | Description |
|---|---|
| **Prompt Injection** | Agent manipulated into unintended actions via crafted input |
| **Tool Abuse** | Permitted tools used in unintended ways |
| **Privilege Escalation** | Bypassing policy constraints or Trust Boundaries |
| **Secret Exfiltration** | Secrets leaked through traces, tool outputs, or LLM context |
| **Policy Tampering** | Weakening policy enforcement via file modification |
| **Trace Tampering** | Modifying traces to hide activity or fabricate history |

Reports that don't fit these categories are still welcome — they may reveal new threat vectors.

## Scope

In scope:
- Krynix core packages (`packages/core/`, `packages/policy/`, `packages/replay/`)
- Krynix CLI (`packages/cli/`)
- Official Trace Adapters (`packages/adapters/`)
- Policy evaluation logic and CI gate behavior
- Hash chain and redaction implementations

Out of scope:
- Vulnerabilities in external agent frameworks (LangChain, OpenClaw, etc.)
- Vulnerabilities in LLM providers
- Vulnerabilities in CI infrastructure (GitHub Actions, etc.)
- Social engineering attacks

## Recognition

We credit security researchers who responsibly disclose vulnerabilities (with their permission) in our security advisories.

## PGP Key

A PGP key for encrypted communication will be published at `https://krynix.dev/.well-known/security.txt` once available.
