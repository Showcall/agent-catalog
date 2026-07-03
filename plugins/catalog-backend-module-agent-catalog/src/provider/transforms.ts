/**
 * Pure transforms: kagent CRDs -> Backstage catalog entities.
 *
 * Entity model (see project plan §3.1 / the Component-vs-Agent decision):
 *  - Agent CRD        -> kind: Component, spec.type: "ai-agent"
 *  - a2aConfig        -> kind: API, spec.type: "a2a" (agent providesApis it)
 *  - ModelConfig CRD  -> kind: Resource, spec.type: "llm-model-config"
 *  - tools references -> dependsOn relations (resources by convention)
 *
 * Rich structured data rides in spec (permissive), flat greppable data in
 * annotations under the agentcatalog.io/* namespace.
 */

import type { Entity } from '@backstage/catalog-model';
import type { KagentAgent, KagentModelConfig } from './types';

export const ANNOTATION_PREFIX = 'agentcatalog.io';
export const AGENT_COMPONENT_TYPE = 'ai-agent';
export const A2A_API_TYPE = 'a2a';
export const MODEL_RESOURCE_TYPE = 'llm-model-config';

/** Backstage entity names: [a-z0-9] separated by [-_.], max 63 chars. */
export function sanitizeName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9\-_.]/g, '-')
    .replace(/^[-_.]+|[-_.]+$/g, '')
    .slice(0, 63);
}

function locationOf(cluster: string, ns: string, kind: string, name: string) {
  // Provider-managed entities must carry managed-by/origin locations.
  const target = `kagent://${cluster}/${ns}/${kind}/${name}`;
  return {
    'backstage.io/managed-by-location': target,
    'backstage.io/managed-by-origin-location': target,
  };
}

/**
 * Owner resolution, in priority order:
 *  1. `backstage.io/owner` annotation on the CRD
 *  2. `agentcatalog.io/owner` annotation
 *  3. same keys as labels (fallback for plain, non-ref owners only)
 *  4. the configured defaultOwner
 *
 * Annotations come FIRST because Backstage owners are entity refs like
 * `group:default/sre`, and `:`/`/` are illegal in Kubernetes label values —
 * so the ref form only survives as an annotation. Teams adopt this by
 * annotating their Agent CRDs — document it loudly.
 */
export function resolveOwner(
  obj: { metadata?: KagentAgent['metadata'] },
  defaultOwner: string,
): string {
  const meta = obj.metadata ?? {};
  return (
    meta.annotations?.['backstage.io/owner'] ??
    meta.annotations?.[`${ANNOTATION_PREFIX}/owner`] ??
    meta.labels?.['backstage.io/owner'] ??
    meta.labels?.[`${ANNOTATION_PREFIX}/owner`] ??
    defaultOwner
  );
}

function readyLifecycle(agent: KagentAgent): string {
  // Map CRD readiness onto Backstage lifecycle, overridable via label.
  const explicit =
    agent.metadata?.labels?.[`${ANNOTATION_PREFIX}/lifecycle`] ??
    agent.metadata?.annotations?.[`${ANNOTATION_PREFIX}/lifecycle`];
  if (explicit) return explicit;
  const ready = agent.status?.conditions?.some(
    c => (c.type === 'Ready' || c.type === 'Accepted') && c.status === 'True',
  );
  return ready ? 'production' : 'experimental';
}

/**
 * Names of McpServer/Agent dependencies referenced by an Agent spec.
 * Reads kagent v1alpha2 tool refs (`declarative.tools[].mcpServer.name` /
 * `.agent.name`). The returned `toolServers` are MCP server names.
 */
export function extractToolRefs(agent: KagentAgent): {
  toolServers: string[];
  agents: string[];
} {
  const toolServers = new Set<string>();
  const agents = new Set<string>();
  for (const tool of agent.spec?.declarative?.tools ?? []) {
    const ts = tool?.mcpServer?.name;
    if (typeof ts === 'string' && ts) toolServers.add(ts);
    const ref = tool?.agent?.name;
    if (typeof ref === 'string' && ref) agents.add(ref);
  }
  return { toolServers: [...toolServers], agents: [...agents] };
}

export interface TransformOptions {
  clusterName: string;
  defaultOwner: string;
}

/** Where a card came from — drives the `card-source` annotation. */
export type CardSource = 'live' | 'synthesized' | 'stale';

/**
 * An A2A agent card. Loosely typed: it may be the real payload fetched from
 * `/.well-known/agent.json` or a card we synthesize from the CRD.
 */
export interface A2ACard {
  name?: string;
  description?: string;
  skills?: unknown[];
  capabilities?: Record<string, unknown>;
  preferredTransport?: string;
  protocolVersion?: string;
  url?: string;
  version?: string;
  [key: string]: unknown;
}

/**
 * Build the A2A `API` entity for an agent from a card. Shared by the CRD
 * transform (synthesized card) and the live-card enrichment pass, so the two
 * can never drift in name/owner/lifecycle. `source` is recorded as an
 * annotation so the catalog shows whether the card is live or a fallback.
 */
export function a2aApiEntity(
  agent: KagentAgent,
  opts: TransformOptions,
  card: A2ACard,
  source: CardSource,
): Entity {
  const ns = agent.metadata?.namespace ?? 'default';
  const rawName = agent.metadata?.name ?? 'unknown-agent';
  const apiName = sanitizeName(`${rawName}-a2a-${opts.clusterName}`);
  return {
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'API',
    metadata: {
      name: apiName,
      title: `${rawName} (A2A)`,
      description: `A2A agent card for ${rawName}`,
      annotations: {
        ...locationOf(opts.clusterName, ns, 'AgentA2A', rawName),
        [`${ANNOTATION_PREFIX}/cluster`]: opts.clusterName,
        [`${ANNOTATION_PREFIX}/card-source`]: source,
      },
      tags: ['a2a'],
    },
    spec: {
      type: A2A_API_TYPE,
      lifecycle: readyLifecycle(agent),
      owner: resolveOwner(agent, opts.defaultOwner),
      definition: JSON.stringify(card, null, 2),
    },
  };
}

/** The A2A API entity name for an agent (deterministic; used by enrichment). */
export function a2aApiName(agent: KagentAgent, clusterName: string): string {
  const rawName = agent.metadata?.name ?? 'unknown-agent';
  return sanitizeName(`${rawName}-a2a-${clusterName}`);
}

/**
 * Transform one kagent Agent CRD into catalog entities.
 * Returns [Component] or [Component, API] when a2aConfig is present.
 */
export function kagentAgentToEntities(
  agent: KagentAgent,
  opts: TransformOptions,
): Entity[] {
  const ns = agent.metadata?.namespace ?? 'default';
  const rawName = agent.metadata?.name ?? 'unknown-agent';
  const name = sanitizeName(`${rawName}-${opts.clusterName}`);
  const owner = resolveOwner(agent, opts.defaultOwner);
  const decl = agent.spec?.declarative ?? {};
  const { toolServers, agents: agentDeps } = extractToolRefs(agent);

  const dependsOn: string[] = [];
  if (decl.modelConfig) {
    dependsOn.push(
      `resource:default/${sanitizeName(
        `${decl.modelConfig}-${opts.clusterName}`,
      )}`,
    );
  }
  for (const ts of toolServers) {
    dependsOn.push(
      `resource:default/${sanitizeName(`${ts}-${opts.clusterName}`)}`,
    );
  }
  for (const dep of agentDeps) {
    dependsOn.push(
      `component:default/${sanitizeName(`${dep}-${opts.clusterName}`)}`,
    );
  }

  const hasA2a = !!decl.a2aConfig?.skills?.length;
  const apiName = sanitizeName(`${rawName}-a2a-${opts.clusterName}`);

  const component: Entity = {
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'Component',
    metadata: {
      name,
      title: rawName,
      description: agent.spec?.description ?? 'kagent agent',
      annotations: {
        ...locationOf(opts.clusterName, ns, 'Agent', rawName),
        [`${ANNOTATION_PREFIX}/runtime`]: 'kagent',
        [`${ANNOTATION_PREFIX}/cluster`]: opts.clusterName,
        [`${ANNOTATION_PREFIX}/namespace`]: ns,
        ...(decl.modelConfig
          ? { [`${ANNOTATION_PREFIX}/model-config`]: decl.modelConfig }
          : {}),
      },
      tags: ['ai-agent', 'kagent', ...(hasA2a ? ['a2a'] : [])],
    },
    spec: {
      type: AGENT_COMPONENT_TYPE,
      lifecycle: readyLifecycle(agent),
      owner,
      ...(dependsOn.length ? { dependsOn } : {}),
      ...(hasA2a ? { providesApis: [apiName] } : {}),
      // Rich structured payload for the frontend plugin (permissive spec).
      agent: {
        runtime: 'kagent',
        cluster: opts.clusterName,
        namespace: ns,
        modelConfig: decl.modelConfig,
        toolServers,
        systemPromptPresent: !!decl.systemMessage,
      },
    } as Entity['spec'],
  };

  if (!hasA2a) return [component];

  // Synthesized card from the CRD. The live-card enrichment pass replaces this
  // with the real /.well-known/agent.json payload when the agent is reachable.
  const syntheticCard: A2ACard = {
    name: rawName,
    description: agent.spec?.description ?? '',
    skills: decl.a2aConfig?.skills ?? [],
    source: 'kagent-crd (synthesized; not fetched from .well-known)',
  };

  return [component, a2aApiEntity(agent, opts, syntheticCard, 'synthesized')];
}

/** Transform a ModelConfig CRD into a Resource entity. */
export function modelConfigToEntity(
  mc: KagentModelConfig,
  opts: TransformOptions,
): Entity {
  const ns = mc.metadata?.namespace ?? 'default';
  const rawName = mc.metadata?.name ?? 'unknown-modelconfig';
  return {
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'Resource',
    metadata: {
      name: sanitizeName(`${rawName}-${opts.clusterName}`),
      title: rawName,
      description: `Model config: ${mc.spec?.provider ?? '?'} / ${
        mc.spec?.model ?? '?'
      }`,
      annotations: {
        ...locationOf(opts.clusterName, ns, 'ModelConfig', rawName),
        [`${ANNOTATION_PREFIX}/cluster`]: opts.clusterName,
        ...(mc.spec?.provider
          ? { [`${ANNOTATION_PREFIX}/provider`]: String(mc.spec.provider) }
          : {}),
        ...(mc.spec?.model
          ? { [`${ANNOTATION_PREFIX}/model`]: String(mc.spec.model) }
          : {}),
      },
      tags: ['llm', 'kagent'],
    },
    spec: {
      type: MODEL_RESOURCE_TYPE,
      owner: resolveOwner(mc, opts.defaultOwner),
    },
  };
}
