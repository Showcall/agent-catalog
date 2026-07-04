/**
 * Partial, defensive typings for kagent CRDs (group: kagent.dev).
 *
 * IMPORTANT: verify group/version and field names against YOUR cluster:
 *   kubectl get crd agents.kagent.dev -o jsonpath='{.spec.group} {.spec.versions[*].name}'
 *   kubectl get agents.kagent.dev -A -o yaml | head -100
 * Adjust KAGENT_GROUP / KAGENT_VERSION in config.ts if they differ.
 *
 * Everything is optional on purpose: the transform must never throw on a
 * missing field — degrade gracefully and keep cataloging the fleet.
 */

export interface KubeObjectMeta {
  name?: string;
  namespace?: string;
  uid?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  creationTimestamp?: string;
}

export interface KagentA2ASkill {
  id?: string;
  name?: string;
  description?: string;
  /** v1alpha2 requires `name`; `tags` is part of the A2A skill card. */
  tags?: string[];
  examples?: string[];
  inputModes?: string[];
  outputModes?: string[];
}

/**
 * Tool reference (kagent v1alpha2). Both mcpServer and agent are object
 * refs keyed by `name` (+ optional namespace/kind/apiGroup). NOTE: v1alpha1
 * used `mcpServer.toolServer` and `agent.ref` (plain strings); those were
 * renamed in v1alpha2 — verify against your cluster.
 */
export interface KagentToolRef {
  type?: string;
  mcpServer?: {
    name?: string;
    namespace?: string;
    kind?: string;
    apiGroup?: string;
    toolNames?: string[];
    [key: string]: unknown;
  };
  agent?: {
    name?: string;
    namespace?: string;
    kind?: string;
    apiGroup?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * v1alpha2 nests the declarative agent config under `spec.declarative`.
 * (v1alpha1 had these fields flat on `spec`.) Everything optional: BYO
 * agents carry a `spec.byo` block instead and may have no declarative body.
 */
export interface KagentDeclarativeSpec {
  /** Reference to a ModelConfig resource (name, possibly ns-qualified). */
  modelConfig?: string;
  /** The system prompt. */
  systemMessage?: string;
  /** Tool references (McpServer / Agent-as-tool). */
  tools?: KagentToolRef[];
  /** A2A exposure: skills advertised on the agent card. */
  a2aConfig?: {
    skills?: KagentA2ASkill[];
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * BYO ("bring your own") agent config (v1alpha2, `spec.byo`). The CRD carries
 * only a container/deployment spec — model, tools and capabilities live
 * *inside* the image and are opaque to kagent. The interface plane surfaces
 * only via the live A2A card (see docs/adr/0001-agent-metadata-sources.md).
 */
export interface KagentByoSpec {
  deployment?: {
    image?: string;
    replicas?: number;
    /** Container env. We ingest NAMES ONLY — values may be secrets. */
    env?: Array<{ name?: string; value?: string; valueFrom?: unknown }>;
    resources?: {
      requests?: { cpu?: string; memory?: string; [key: string]: unknown };
      limits?: { cpu?: string; memory?: string; [key: string]: unknown };
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface KagentAgentSpec {
  description?: string;
  /** "Declarative" | "BYO" */
  type?: string;
  /** Declarative agent config (v1alpha2). */
  declarative?: KagentDeclarativeSpec;
  /** BYO agent config (v1alpha2). */
  byo?: KagentByoSpec;
  /**
   * Skill packages loaded from images into `/skills` — NOT the A2A card.
   * Not currently projected into the catalog.
   */
  skills?: unknown;
  [key: string]: unknown;
}

export interface KagentAgentStatus {
  conditions?: Array<{
    type?: string;
    status?: string;
    reason?: string;
    message?: string;
  }>;
  [key: string]: unknown;
}

export interface KagentAgent {
  apiVersion?: string;
  kind?: string; // "Agent"
  metadata?: KubeObjectMeta;
  spec?: KagentAgentSpec;
  status?: KagentAgentStatus;
}

export interface KagentModelConfig {
  apiVersion?: string;
  kind?: string; // "ModelConfig"
  metadata?: KubeObjectMeta;
  spec?: {
    provider?: string;
    model?: string;
    apiKeySecretRef?: string;
    [key: string]: unknown;
  };
}

/** One configured cluster to scan. */
export interface ClusterConfig {
  name: string;
  /** Path to a kubeconfig file. Omit to use default loading rules. */
  kubeconfigPath?: string;
  /** Kubeconfig context to use. Omit for current context. */
  context?: string;
  /** Set true when running in-cluster with a service account. */
  inCluster?: boolean;
}

/**
 * Live A2A-card enrichment: fetch each agent's `/.well-known/agent.json`
 * through the kube API-server service proxy and overlay it on the entity.
 * See docs/adr/0001-agent-metadata-sources.md.
 */
export interface CardEnrichmentConfig {
  enabled: boolean;
  /** Per-fetch timeout; a slow agent must not stall the whole refresh. */
  timeoutMs: number;
  /** Service port the agent serves its A2A card on (kagent default 8080). */
  port: number;
  /**
   * Card paths, tried in order. Default covers both the A2A v1.0 well-known
   * (`/.well-known/agent-card.json`) and the older path kagent serves
   * (`/.well-known/agent.json`). See docs/adr/0006-a2a-label-discovery.md.
   */
  paths: string[];
}

/** A runtime CR kind whose Services the discovery provider must skip. */
export interface ClaimedByRef {
  group: string;
  kind: string;
}

/**
 * Runtime-agnostic discovery of A2A agents via labeled Services
 * (docs/adr/0006-a2a-label-discovery.md).
 */
export interface A2ADiscoveryConfig {
  enabled: boolean;
  /** Label selector marking a Service as an A2A card server. */
  labelSelector: string;
  /** Services owned by these runtime CRs are that provider's job — skip. */
  claimedBy: ClaimedByRef[];
}

/** Minimal Service shape the discovery provider consumes (defensive). */
export interface DiscoveredService {
  metadata?: KubeObjectMeta & {
    ownerReferences?: Array<{
      apiVersion?: string;
      kind?: string;
      name?: string;
      [key: string]: unknown;
    }>;
  };
  spec?: {
    ports?: Array<{ port?: number; name?: string; [key: string]: unknown }>;
    [key: string]: unknown;
  };
}

export interface AgentCatalogConfig {
  clusters: ClusterConfig[];
  /** Entity ref used when a CRD carries no owner label. */
  defaultOwner: string;
  /** Namespaces to skip (e.g. kagent's own system agents). */
  excludeNamespaces?: string[];
  /** Override CRD group/version if your kagent differs. */
  crd: { group: string; version: string };
  schedule: { frequencyMinutes: number; timeoutMinutes: number };
  /** Live A2A-card enrichment settings. */
  cardEnrichment: CardEnrichmentConfig;
  /** Runtime-agnostic labeled-Service discovery (ADR 0006). */
  a2aDiscovery: A2ADiscoveryConfig;
  /** Traction from the LLM-gateway ledger (ADR 0008). */
  usage: UsageConfig;
  /** Heuristic discovery of LLM-consuming workloads (ADR 0009). */
  heuristics: HeuristicsConfig;
}

/**
 * Heuristic discovery (ADR 0009): flag Deployments whose pod specs
 * advertise LLM consumption. Patterns are regex strings (config-extensible).
 */
export interface HeuristicsConfig {
  enabled: boolean;
  envNamePatterns: string[];
  imagePatterns: string[];
}

/** Minimal Deployment shape the heuristic provider consumes (defensive). */
export interface DiscoveredWorkload {
  metadata?: KubeObjectMeta & {
    ownerReferences?: Array<{
      apiVersion?: string;
      kind?: string;
      name?: string;
      [key: string]: unknown;
    }>;
  };
  spec?: {
    template?: {
      metadata?: { labels?: Record<string, string> };
      spec?: {
        containers?: Array<{
          name?: string;
          image?: string;
          env?: Array<{ name?: string; value?: string; valueFrom?: unknown }>;
        }>;
      };
    };
    [key: string]: unknown;
  };
  status?: { readyReplicas?: number; [key: string]: unknown };
}

/**
 * LLM-gateway usage integration (docs/adr/0008-gateway-usage.md).
 * The catalog reads the gateway's ledger; it is never in the data path.
 */
export interface UsageConfig {
  enabled: boolean;
  /** Ledger implementation. 'litellm' is the first supported source. */
  source: string;
  /** Gateway base URL, e.g. http://litellm.gateway:4000 */
  baseUrl?: string;
  /** Env var holding the spend-scoped API key (never config plaintext). */
  apiKeyEnv: string;
  /** Rolling window for usage aggregates. */
  windowDays: number;
  /** Dollar cost on entities is opt-in (politically sensitive). */
  includeCost: boolean;
  schedule: { frequencyMinutes: number };
}
