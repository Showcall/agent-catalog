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

export function locationOf(
  cluster: string,
  ns: string,
  kind: string,
  name: string,
  scheme = 'kagent',
) {
  // Provider-managed entities must carry managed-by/origin locations.
  const target = `${scheme}://${cluster}/${ns}/${kind}/${name}`;
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
    c =>
      (c.type === 'Ready' || c.type === 'Accepted' || c.type === 'Available') &&
      c.status === 'True',
  );
  return ready ? 'production' : 'experimental';
}

/** A named, optionally namespace-qualified reference from an Agent spec. */
export interface NamespacedRef {
  name: string;
  /** Undefined = same namespace as the referencing agent (kagent default). */
  namespace?: string;
}

/**
 * McpServer/Agent dependencies referenced by an Agent spec, with their
 * namespaces. Reads kagent v1alpha2 tool refs
 * (`declarative.tools[].mcpServer.{name,namespace}` / `.agent.{name,namespace}`).
 * Namespaces matter: two `k8s-tools` servers in different namespaces are
 * different resources (see docs/adr/0005-entity-naming.md).
 */
export function extractToolRefs(agent: KagentAgent): {
  toolServers: NamespacedRef[];
  agents: NamespacedRef[];
} {
  const toolServers = new Map<string, NamespacedRef>();
  const agents = new Map<string, NamespacedRef>();
  for (const tool of agent.spec?.declarative?.tools ?? []) {
    const ts = tool?.mcpServer;
    if (typeof ts?.name === 'string' && ts.name) {
      toolServers.set(`${ts.namespace ?? ''}/${ts.name}`, {
        name: ts.name,
        namespace: ts.namespace,
      });
    }
    const ref = tool?.agent;
    if (typeof ref?.name === 'string' && ref.name) {
      agents.set(`${ref.namespace ?? ''}/${ref.name}`, {
        name: ref.name,
        namespace: ref.namespace,
      });
    }
  }
  return { toolServers: [...toolServers.values()], agents: [...agents.values()] };
}

export interface TransformOptions {
  clusterName: string;
  defaultOwner: string;
}

/**
 * Entity name for a cluster-scoped resource: name + k8s namespace + cluster.
 * The namespace is load-bearing: Kubernetes treats `default/foo` and
 * `kagent/foo` as distinct resources, so the catalog must too — omitting it
 * caused silent last-write-wins collisions (docs/adr/0005-entity-naming.md).
 */
export function qualifiedEntityName(
  rawName: string,
  ns: string,
  clusterName: string,
): string {
  return sanitizeName(`${rawName}-${ns}-${clusterName}`);
}

/**
 * Classify an agent as 'byo' or 'declarative'. Prefers the explicit
 * `spec.type` discriminator, falling back to shape (a `byo` block with no
 * `declarative`) so we degrade gracefully when the field is omitted.
 */
export function agentKind(agent: KagentAgent): 'byo' | 'declarative' {
  const t = agent.spec?.type?.toLowerCase();
  if (t === 'byo') return 'byo';
  if (t === 'declarative') return 'declarative';
  return agent.spec?.byo && !agent.spec?.declarative ? 'byo' : 'declarative';
}

/** Stringify a resource-quantity value, treating null/undefined as absent. */
function stringifyOrUndefined(v: unknown): string | undefined {
  return v === undefined || v === null ? undefined : String(v);
}

/**
 * Project the parts of a BYO deployment that are safe and useful to catalog:
 * image provenance, replicas, resource requests, and env variable NAMES.
 * Env values / valueFrom are deliberately dropped — they are frequently
 * secrets and must never land in the catalog.
 */
export function extractByoDeployment(agent: KagentAgent): {
  image?: string;
  replicas?: number;
  envNames: string[];
  cpuRequest?: string;
  memoryRequest?: string;
} {
  const d = agent.spec?.byo?.deployment ?? {};
  const envNames = (d.env ?? [])
    .map(e => e?.name)
    .filter((n): n is string => typeof n === 'string' && n.length > 0);
  const req = d.resources?.requests ?? {};
  return {
    image: typeof d.image === 'string' ? d.image : undefined,
    replicas: typeof d.replicas === 'number' ? d.replicas : undefined,
    envNames,
    cpuRequest: stringifyOrUndefined(req.cpu),
    memoryRequest: stringifyOrUndefined(req.memory),
  };
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
  locationScheme = 'kagent',
): Entity {
  const ns = agent.metadata?.namespace ?? 'default';
  const rawName = agent.metadata?.name ?? 'unknown-agent';
  const apiName = a2aApiName(agent, opts.clusterName);
  return {
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'API',
    metadata: {
      name: apiName,
      title: `${rawName} (A2A)`,
      description: `A2A agent card for ${rawName}`,
      annotations: {
        ...locationOf(opts.clusterName, ns, 'AgentA2A', rawName, locationScheme),
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
  const ns = agent.metadata?.namespace ?? 'default';
  const rawName = agent.metadata?.name ?? 'unknown-agent';
  return qualifiedEntityName(`${rawName}-a2a`, ns, clusterName);
}

/** Build the Component for a BYO agent (the container is opaque to kagent). */
function byoAgentToComponent(agent: KagentAgent, opts: TransformOptions): Entity {
  const ns = agent.metadata?.namespace ?? 'default';
  const rawName = agent.metadata?.name ?? 'unknown-agent';
  const byo = extractByoDeployment(agent);

  return {
    apiVersion: 'backstage.io/v1alpha1',
    kind: 'Component',
    metadata: {
      name: qualifiedEntityName(rawName, ns, opts.clusterName),
      title: rawName,
      description: agent.spec?.description ?? 'kagent BYO agent',
      annotations: {
        ...locationOf(opts.clusterName, ns, 'Agent', rawName),
        [`${ANNOTATION_PREFIX}/runtime`]: 'kagent',
        [`${ANNOTATION_PREFIX}/discovery`]: 'crd',
        [`${ANNOTATION_PREFIX}/agent-type`]: 'byo',
        [`${ANNOTATION_PREFIX}/cluster`]: opts.clusterName,
        [`${ANNOTATION_PREFIX}/namespace`]: ns,
        ...(byo.image ? { [`${ANNOTATION_PREFIX}/image`]: byo.image } : {}),
      },
      tags: ['ai-agent', 'kagent', 'byo'],
    },
    spec: {
      type: AGENT_COMPONENT_TYPE,
      lifecycle: readyLifecycle(agent),
      owner: resolveOwner(agent, opts.defaultOwner),
      // No modelConfig / tools / A2A here: a BYO container is opaque to
      // kagent. Its interface plane arrives via the live-card enrichment
      // pass (docs/adr/0001), which adds the API entity when reachable.
      agent: {
        runtime: 'kagent',
        agentType: 'byo',
        cluster: opts.clusterName,
        namespace: ns,
        image: byo.image,
        replicas: byo.replicas,
        envNames: byo.envNames,
        ...(byo.cpuRequest || byo.memoryRequest
          ? {
              resources: {
                cpuRequest: byo.cpuRequest,
                memoryRequest: byo.memoryRequest,
              },
            }
          : {}),
      },
    } as Entity['spec'],
  };
}

/**
 * Transform one kagent Agent CRD into catalog entities.
 * Declarative: [Component] or [Component, API] when a2aConfig is present.
 * BYO: [Component] — its API entity comes from the live-card enrichment.
 */
export function kagentAgentToEntities(
  agent: KagentAgent,
  opts: TransformOptions,
): Entity[] {
  if (agentKind(agent) === 'byo') {
    return [byoAgentToComponent(agent, opts)];
  }

  const ns = agent.metadata?.namespace ?? 'default';
  const rawName = agent.metadata?.name ?? 'unknown-agent';
  const name = qualifiedEntityName(rawName, ns, opts.clusterName);
  const owner = resolveOwner(agent, opts.defaultOwner);
  const decl = agent.spec?.declarative ?? {};
  const { toolServers, agents: agentDeps } = extractToolRefs(agent);

  // dependsOn refs: kagent resolves bare references in the agent's own
  // namespace; a "ns/name" string is explicit. Either way the namespace is
  // part of the target's identity (docs/adr/0005-entity-naming.md).
  const dependsOn: string[] = [];
  if (decl.modelConfig) {
    const [mcNs, mcName] = decl.modelConfig.includes('/')
      ? decl.modelConfig.split('/', 2)
      : [ns, decl.modelConfig];
    dependsOn.push(
      `resource:default/${qualifiedEntityName(mcName, mcNs, opts.clusterName)}`,
    );
  }
  for (const ts of toolServers) {
    dependsOn.push(
      `resource:default/${qualifiedEntityName(
        ts.name,
        ts.namespace ?? ns,
        opts.clusterName,
      )}`,
    );
  }
  for (const dep of agentDeps) {
    dependsOn.push(
      `component:default/${qualifiedEntityName(
        dep.name,
        dep.namespace ?? ns,
        opts.clusterName,
      )}`,
    );
  }

  const hasA2a = !!decl.a2aConfig?.skills?.length;

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
        [`${ANNOTATION_PREFIX}/discovery`]: 'crd',
        [`${ANNOTATION_PREFIX}/agent-type`]: 'declarative',
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
      ...(hasA2a ? { providesApis: [a2aApiName(agent, opts.clusterName)] } : {}),
      // Rich structured payload for the frontend plugin (permissive spec).
      agent: {
        runtime: 'kagent',
        agentType: 'declarative',
        cluster: opts.clusterName,
        namespace: ns,
        modelConfig: decl.modelConfig,
        toolServers: toolServers.map(t => t.name),
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
      name: qualifiedEntityName(rawName, ns, opts.clusterName),
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
