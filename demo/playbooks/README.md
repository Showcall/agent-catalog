# Demo playbooks

Short, self-contained scenarios you run **on top of an already-running demo**
to show off one capability end-to-end — "watch this happen", not just "here is a
table". Each playbook plants the scenario it needs, tells you what to look for,
and cleans up after itself.

Start the base demo first:

```bash
./demo/up.sh
./demo/backstage.sh
```

Then run a playbook.

## Available playbooks

| Playbook | Shows | Run |
|---|---|---|
| [`shadow-agent/`](shadow-agent/) | **Audit sweep / shadow discovery** ([ADR 0007](../../docs/adr/0007-audit-sweep.md)) — an agent nobody registered, found by probing | `./demo/playbooks/shadow-agent/run.sh` |

Some capabilities are **off by default** (the audit sweep is a port-probing
workload). A playbook that needs one will tell you the switch to flip — for the
sweep, restart Backstage with `DEMO_SWEEP=1 ./demo/backstage.sh`.

## Writing a new playbook

A playbook is a directory under `demo/playbooks/<name>/` with:

- `manifest.yaml` — the Kubernetes resources the scenario needs.
- `run.sh` — apply them, narrate the "aha", and (where it can) verify the
  outcome against the demo Backstage catalog API.
- `cleanup.sh` — remove what `run.sh` created.
- a short `README.md` — the story the playbook tells.

Keep the base demo (`demo/manifests/demo.yaml`) clean and representative; put
feature-specific theater here instead.
