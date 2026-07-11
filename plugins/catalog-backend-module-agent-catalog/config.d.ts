export interface Config {
  /**
   * Configuration for the agent-catalog backend module, which ingests AI
   * agents (kagent, ARK), labeled A2A Services, heuristic LLM workloads, and
   * LLM-gateway usage into the Backstage catalog.
   */
  agentCatalog: {
    /**
     * Default owner reference applied to discovered entities that carry no
     * explicit `backstage.io/owner` annotation.
     * @default "group:default/platform-team"
     */
    defaultOwner?: string;

    /**
     * Kubernetes namespaces to exclude from all discovery providers.
     */
    excludeNamespaces?: string[];

    /**
     * kagent CustomResourceDefinition coordinates.
     */
    crd?: {
      /** @default "kagent.dev" */
      group?: string;
      /** @default "v1alpha2" */
      version?: string;
    };

    /**
     * Refresh schedule shared by the agent/discovery providers.
     */
    schedule?: {
      /** @default 5 */
      frequencyMinutes?: number;
      /** @default 2 */
      timeoutMinutes?: number;
    };

    /**
     * Live A2A agent-card enrichment via the kube-apiserver service proxy.
     */
    cardEnrichment?: {
      /** @default true */
      enabled?: boolean;
      /** @default 2000 */
      timeoutMs?: number;
      /** @default 8080 */
      port?: number;
      /**
       * Ordered list of card paths to try on each agent Service.
       * @default ["/.well-known/agent-card.json", "/.well-known/agent.json"]
       */
      paths?: string[];
    };

    /**
     * Runtime-agnostic discovery of labeled A2A Services.
     */
    a2aDiscovery?: {
      /** @default true */
      enabled?: boolean;
      /**
       * Kubernetes label selector marking a Service as an A2A agent.
       * @default "agentcatalog.io/a2a=true"
       */
      labelSelector?: string;
      /**
       * CRD owners whose Services are already claimed by a runtime provider,
       * so labeled discovery does not double-count them.
       */
      claimedBy?: Array<{
        group: string;
        kind: string;
      }>;
    };

    /**
     * Audit sweep (ADR 0007): probe *unlabeled* Services for an agent card to
     * surface agents nobody registered ("shadow" agents). Off by default — it
     * is a port-probing workload; tell your security team before enabling.
     * A found agent is cataloged with `agentcatalog.io/discovery: probe`; an
     * unlabeled Service with no card is ignored (not a finding).
     */
    sweep?: {
      /** @default false */
      enabled?: boolean;
      /**
       * Namespaces to skip, in addition to `excludeNamespaces`.
       * @default []
       */
      namespaceDenylist?: string[];
      /**
       * Maximum declared ports probed per Service (declared ports only).
       * @default 3
       */
      maxPorts?: number;
      /**
       * Recurring cadence in minutes. When unset there is no recurring
       * schedule: one supervised sweep runs shortly after enable, then it only
       * re-runs on operator trigger or restart.
       */
      scheduleMinutes?: number;
    };

    /**
     * ARK (ark.mckinsey.com) Agent/Team/Model discovery.
     */
    ark?: {
      /** @default true */
      enabled?: boolean;
      /** @default "ark.mckinsey.com" */
      group?: string;
      /** @default "v1alpha1" */
      version?: string;
    };

    /**
     * Heuristic discovery of unlabeled LLM-consuming workloads.
     */
    heuristics?: {
      /** @default true */
      enabled?: boolean;
      /**
       * Environment-variable name patterns that signal LLM usage.
       */
      envNamePatterns?: string[];
      /**
       * Container image name patterns that signal an agent framework.
       */
      imagePatterns?: string[];
    };

    /**
     * LLM-gateway usage/traction enrichment (LiteLLM).
     */
    usage?: {
      /** @default false */
      enabled?: boolean;
      /** @default "litellm" */
      source?: string;
      /**
       * Base URL of the LLM gateway's admin API.
       */
      baseUrl?: string;
      /**
       * Name of the environment variable holding the gateway API key. The key
       * value itself is read from the process environment, never from config.
       * @default "LITELLM_SPEND_KEY"
       */
      apiKeyEnv?: string;
      /** @default 7 */
      windowDays?: number;
      /** @default false */
      includeCost?: boolean;
      schedule?: {
        /** @default 60 */
        frequencyMinutes?: number;
      };
    };

    /**
     * Target Kubernetes clusters to scan. At least one entry is required.
     */
    clusters: Array<{
      /** Human-readable cluster name, used in entity annotations. */
      name: string;
      /** Path to a kubeconfig file for this cluster. */
      kubeconfigPath?: string;
      /** kubeconfig context to select within the kubeconfig file. */
      context?: string;
      /** Use in-cluster service-account credentials instead of a kubeconfig. */
      inCluster?: boolean;
    }>;
  };
}
