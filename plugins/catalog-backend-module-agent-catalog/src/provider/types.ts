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

export interface KagentAgentSpec {
  description?: string;
  /** "Declarative" | "BYO" */
  type?: string;
  /** Declarative agent config (v1alpha2). */
  declarative?: KagentDeclarativeSpec;
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
  /** Card path. */
  path: string;
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
}
