# Security Policy

Showcall Agent Catalog is an open source technical preview. We take reports
seriously, especially reports involving Kubernetes permissions, service-proxy
requests, A2A card fetching, gateway credentials, or untrusted catalog data.

## Reporting a Vulnerability

Please report vulnerabilities privately through
[GitHub Private Vulnerability Reporting](https://github.com/Showcall/agent-catalog/security/advisories/new).

Do **not** open a public GitHub issue, pull request, discussion, or npm comment
with exploit details.

Please include, when available:

- affected package, version, or commit
- a clear description of the impact
- reproduction steps or a minimal proof of concept
- required configuration, permissions, or deployment assumptions
- possible mitigations or workarounds

Redact API keys, kubeconfig contents, bearer tokens, internal hostnames,
customer data, and other sensitive information. If a proof of concept needs
real infrastructure, replace it with a local or synthetic example whenever
possible.

## What to Expect

The maintainers will review the report, may request clarification, and will
coordinate a fix and disclosure timeline with the reporter when appropriate.
We aim to acknowledge reports within five business days when feasible; this is
not a fixed response or resolution SLA.

Please avoid destructive testing, service degradation, data access beyond what
is necessary to demonstrate the issue, or exfiltration of secrets. Stop testing
and report immediately if you encounter real credentials or private data.

## Scope

Agent Catalog reads sensitive operational state, including Kubernetes Services,
Endpoints, Deployments, runtime custom resources, LLM-gateway usage ledgers,
and live A2A agent cards fetched through the kube-apiserver service proxy.

Reports are especially useful for issues such as:

- privilege escalation or unintended Kubernetes resource access
- unsafe kube-apiserver service-proxy or A2A endpoint requests
- credential leakage, including LiteLLM gateway keys
- server-side request forgery or unbounded response processing
- catalog entity injection that could mislead ownership or governance views
- vulnerabilities introduced by the published frontend or backend packages

For vulnerabilities in a third-party dependency, report to the upstream
maintainer as well. Include the Agent Catalog impact in a private report if the
dependency is reachable through this project or affects the published package.

## Hardening Guidance

- Grant only the least-privilege, read-only RBAC in
  [`deploy/rbac.yaml`](deploy/rbac.yaml).
- Heuristic discovery reads container environment-variable names and image
  names only; it does not read Secret or ConfigMap values.
- Provide the LiteLLM gateway key through the environment variable named by
  `agentCatalog.usage.apiKeyEnv`; do not put secrets in `app-config.yaml`.

## Supported Versions

Security fixes are developed against the latest release line. Older technical-
preview versions may not receive backported fixes.

| Version              | Support     |
| -------------------- | ----------- |
| Latest `0.3.x`       | Supported   |
| Older `0.x` releases | Best effort |
