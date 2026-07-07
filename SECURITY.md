# Security Policy

## Reporting a vulnerability

Please report security vulnerabilities **privately**. Do not open a public
GitHub issue.

Use GitHub's [private vulnerability
reporting](https://github.com/Showcall/agent-catalog/security/advisories/new)
("Report a vulnerability" under the Security tab). We aim to acknowledge
reports within 5 business days.

Please include: affected version/commit, a description, reproduction steps,
and the impact you observed.

## Why this matters here

agent-catalog reads sensitive operational state:

- **Kubernetes cluster state** — Services, Endpoints, Deployments, and kagent
  and ARK custom resources, across namespaces.
- **LLM-gateway spend/usage ledgers** — via an API key supplied through an
  environment variable (never stored in config).
- **Live A2A agent cards** — fetched through the kube-apiserver service proxy.

Take particular care with reports involving credential handling, the scope of
requested RBAC, cross-namespace data exposure, or SSRF via card enrichment.

## Supported versions

This project is a **technical preview** (v0.1.x). Security fixes are made
against the latest release only until a stable line is declared.

## Hardening guidance

- Grant only the least-privilege RBAC in [deploy/rbac.yaml](deploy/rbac.yaml);
  all access it needs is read-only.
- Heuristic discovery reads container **env-var names and image names only**,
  never Secret or ConfigMap values.
- Provide the gateway API key via the environment variable named by
  `agentCatalog.usage.apiKeyEnv`; do not place secrets in app-config.
