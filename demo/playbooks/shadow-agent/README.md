# Playbook: shadow-agent discovery

**Shows:** the audit sweep ([ADR 0007](../../../docs/adr/0007-audit-sweep.md))
finding an agent that nobody registered.

## The story

Someone spun up an agent at a hackathon, gave it a Service, and shipped it. It
speaks A2A and serves a valid card — but it has **no `agentcatalog.io/a2a`
label, no kagent/ARK CRD, and no owner**, and it lives in its own namespace.
Label discovery skips it. The CRD providers never see it. To your catalog, it
does not exist.

The **audit sweep** probes unlabeled Services for a card. It finds this one and
catalogs it as `discovery: probe` — surfacing the agent nobody told you about.

## Run it

```bash
# base demo already up: ./demo/up.sh && ./demo/backstage.sh
./demo/playbooks/shadow-agent/run.sh
```

The sweep is **off by default** (it is a port-probing workload — tell your
security team before enabling it for real). If the script reports the sweep
isn't on, enable it and restart Backstage, then re-run:

```bash
DEMO_SWEEP=1 ./demo/backstage.sh
./demo/playbooks/shadow-agent/run.sh
```

Then open <http://localhost:3001/agents> and look for `shadow-invoice-bot` with
discovery `probe`.

## Clean up

```bash
./demo/playbooks/shadow-agent/cleanup.sh
```
