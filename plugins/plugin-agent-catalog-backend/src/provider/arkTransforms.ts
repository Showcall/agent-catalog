/**
 * Pure transforms for ARK (ark.mckinsey.com) CRDs -> catalog entities
 * (ADR 0010, Tier B). Same entity model as kagent, second runtime:
 *
 *  - ARK Agent -> Component, spec.type: ai-agent, runtime: ark
 *  - ARK Team  -> Component, spec.type: ai-agent-team (an agent can belong
 *    to many teams — a Backstage System would allow only one)
 *  - ARK Model -> Resource, spec.type: llm-model-config
 *
 * ARK's modelRef carries an explicit namespace and its tools enum includes
 * `agent`/`team` — the namespace-aware refs of ADR 0005 map 1:1.
 */

import type { Entity } from '@backstage/catalog-model';
import type { ArkAgent, ArkModel, ArkTeam } from './types';
import {
  AGENT_COMPONENT_TYPE,
  ANNOTATION_PREFIX,
  MODEL_RESOURCE_TYPE,
  locationOf,
  qualifiedEntityName,
  resolveOwner,
  type TransformOptions,
} from './transforms';

export const ARK_LOCATION_SCHEME = 'ark';
export const AGENT_TEAM_TYPE = 'ai-agent-team';

/** Lifecycle from ARK's Available condition (label/annotation override wins). */
function arkLifecycle(obj: ArkAgent | ArkTeam): string {
  const meta = obj.metadata ?? {};
  const explicit =
    meta.labels?.[`${ANNOTATION_PREFIX}/lifecycle`] ??
    meta.annotations?.[`${ANNOTATION_PREFIX}/lifecycle`];
  if (explicit) return explicit;
  const ready = obj.status?.conditions?.some(
    c =>
      (c.type === 'Available' || c.type === 'Ready') && c.status === 'True',
  );
  return ready ? 'production' : 'experimental';
}

export function arkAgentToComponent(
  agent: ArkAgent,
  opts: TransformOptions,
): Entity {
  const ns = agent.metadata?.namespace ?? 'default';
  const rawName = agent.metadata?.name ?? 'unknown-agent';
  const spec = agent.spec ?? {};

  const dependsOn: string[] = [];
  if (spec.modelRef?.name) {
    dependsOn.push(
      `resource:default/${qualifiedEntityName(
        spec.modelRef.name,
        spec.modelRef.namespace ?? ns,
        opts.clusterName,
      )}`,
    );
  }
  const toolNames: string[] = [];
  for (const t of spec.tools ?? []) {
    if (typeof t?.name !== 'string' || !t.name) continue;
    toolNames.push(t.name);
    if (t.type === 'agent' || t.type === 'team') {
      dependsOn.push(
        `component:default/${qualifiedEntityName(t.name, ns, opts.clusterName)}`,
      );
    } else if (t.type === 'mcp') {
      dependsOn.push(
        `resource:default/${qualifiedEntityName(t.name, ns, opts.clusterName)}`,
      );
    }
  }

  return {
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'Component',
    metadata: {
      name: qualifiedEntityName(rawName, ns, opts.clusterName),
      title: rawName,
      description: spec.description ?? 'ARK agent',
      annotations: {
        ...locationOf(opts.clusterName, ns, 'Agent', rawName, ARK_LOCATION_SCHEME),
        [`${ANNOTATION_PREFIX}/runtime`]: 'ark',
        [`${ANNOTATION_PREFIX}/discovery`]: 'crd',
        [`${ANNOTATION_PREFIX}/cluster`]: opts.clusterName,
        [`${ANNOTATION_PREFIX}/namespace`]: ns,
        ...(spec.modelRef?.name
          ? { [`${ANNOTATION_PREFIX}/model-config`]: spec.modelRef.name }
          : {}),
      },
      tags: ['ai-agent', 'ark'],
    },
    spec: {
      type: AGENT_COMPONENT_TYPE,
      lifecycle: arkLifecycle(agent),
      owner: resolveOwner(agent, opts.defaultOwner),
      ...(dependsOn.length ? { dependsOn } : {}),
      agent: {
        runtime: 'ark',
        discovery: 'crd',
        cluster: opts.clusterName,
        namespace: ns,
        modelConfig: spec.modelRef?.name,
        toolServers: toolNames,
        systemPromptPresent: !!spec.prompt,
      },
    } as Entity['spec'],
  };
}

export function arkTeamToComponent(
  team: ArkTeam,
  opts: TransformOptions,
): Entity {
  const ns = team.metadata?.namespace ?? 'default';
  const rawName = team.metadata?.name ?? 'unknown-team';
  const spec = team.spec ?? {};

  // Members (agents or nested teams) are Components either way.
  const dependsOn = (spec.members ?? [])
    .filter(m => typeof m?.name === 'string' && m.name)
    .map(
      m =>
        `component:default/${qualifiedEntityName(
          m.name as string,
          ns,
          opts.clusterName,
        )}`,
    );

  return {
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'Component',
    metadata: {
      name: qualifiedEntityName(rawName, ns, opts.clusterName),
      title: rawName,
      description: spec.description ?? 'ARK multi-agent team',
      annotations: {
        ...locationOf(opts.clusterName, ns, 'Team', rawName, ARK_LOCATION_SCHEME),
        [`${ANNOTATION_PREFIX}/runtime`]: 'ark',
        [`${ANNOTATION_PREFIX}/discovery`]: 'crd',
        [`${ANNOTATION_PREFIX}/cluster`]: opts.clusterName,
        [`${ANNOTATION_PREFIX}/namespace`]: ns,
        ...(spec.strategy
          ? { [`${ANNOTATION_PREFIX}/team-strategy`]: spec.strategy }
          : {}),
      },
      tags: ['ai-agent-team', 'ark'],
    },
    spec: {
      type: AGENT_TEAM_TYPE,
      lifecycle: arkLifecycle(team),
      owner: resolveOwner(team, opts.defaultOwner),
      ...(dependsOn.length ? { dependsOn } : {}),
      agent: {
        runtime: 'ark',
        discovery: 'crd',
        kind: 'team',
        cluster: opts.clusterName,
        namespace: ns,
        strategy: spec.strategy,
        members: (spec.members ?? []).map(m => m.name).filter(Boolean),
      },
    } as Entity['spec'],
  };
}

export function arkModelToResource(
  model: ArkModel,
  opts: TransformOptions,
): Entity {
  const ns = model.metadata?.namespace ?? 'default';
  const rawName = model.metadata?.name ?? 'unknown-model';
  const spec = model.spec ?? {};
  return {
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'Resource',
    metadata: {
      name: qualifiedEntityName(rawName, ns, opts.clusterName),
      title: rawName,
      description: `ARK model: ${spec.provider ?? '?'} / ${
        spec.model?.value ?? '?'
      }`,
      annotations: {
        ...locationOf(opts.clusterName, ns, 'Model', rawName, ARK_LOCATION_SCHEME),
        [`${ANNOTATION_PREFIX}/runtime`]: 'ark',
        [`${ANNOTATION_PREFIX}/cluster`]: opts.clusterName,
        ...(spec.provider
          ? { [`${ANNOTATION_PREFIX}/provider`]: String(spec.provider) }
          : {}),
        ...(spec.model?.value
          ? { [`${ANNOTATION_PREFIX}/model`]: String(spec.model.value) }
          : {}),
      },
      tags: ['llm', 'ark'],
    },
    spec: {
      type: MODEL_RESOURCE_TYPE,
      owner: resolveOwner(model, opts.defaultOwner),
    },
  };
}
