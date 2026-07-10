import fs from 'node:fs';
import path from 'node:path';

const [rootDir, appDir] = process.argv.slice(2);
if (!rootDir || !appDir) {
  throw new Error('usage: patch-backstage-demo.mjs <agent-catalog-root> <backstage-app-dir>');
}

const frontendPort = process.env.DEMO_BACKSTAGE_PORT ?? '3001';
const backendPort = process.env.DEMO_BACKSTAGE_BACKEND_PORT ?? '7008';
const litellmPort = process.env.DEMO_LITELLM_PORT ?? '4400';

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function upsertDependency(packageJsonPath, name, version = 'workspace:*') {
  const pkg = readJson(packageJsonPath);
  pkg.dependencies ??= {};
  pkg.dependencies[name] = version;
  writeJson(packageJsonPath, pkg);
}

const rootPackage = path.join(appDir, 'package.json');
const rootPackageJson = readJson(rootPackage);
rootPackageJson.workspaces ??= ['packages/*'];
if (!rootPackageJson.workspaces.includes('plugins/*')) {
  rootPackageJson.workspaces.push('plugins/*');
}
writeJson(rootPackage, rootPackageJson);

upsertDependency(
  path.join(appDir, 'packages/app/package.json'),
  '@showcall/backstage-plugin-agent-catalog',
);
upsertDependency(
  path.join(appDir, 'packages/backend/package.json'),
  '@showcall/backstage-plugin-catalog-backend-module-agent-catalog',
);

const appEntry = path.join(appDir, 'packages/app/src/App.tsx');
let appSource = fs.readFileSync(appEntry, 'utf8');
const frontendImport = "import agentCatalogPlugin from '@showcall/backstage-plugin-agent-catalog';";
if (!appSource.includes(frontendImport)) {
  const catalogImport = "import catalogPlugin from '@backstage/plugin-catalog/alpha';";
  if (appSource.includes(catalogImport)) {
    appSource = appSource.replace(catalogImport, `${catalogImport}\n${frontendImport}`);
  } else {
    appSource = `${frontendImport}\n${appSource}`;
  }
}
if (
  appSource.includes('features: [catalogPlugin, navModule]') &&
  !appSource.includes('features: [catalogPlugin, agentCatalogPlugin, navModule]')
) {
  appSource = appSource.replace(
    'features: [catalogPlugin, navModule]',
    'features: [catalogPlugin, agentCatalogPlugin, navModule]',
  );
}
fs.writeFileSync(appEntry, appSource);

const backendIndex = path.join(appDir, 'packages/backend/src/index.ts');
let backendSource = fs.readFileSync(backendIndex, 'utf8');
const moduleImport = "backend.add(import('@showcall/backstage-plugin-catalog-backend-module-agent-catalog'));";
if (!backendSource.includes(moduleImport)) {
  const insertion = [
    '// agent-catalog demo: ingest kagent, ARK, A2A, heuristic, and gateway usage entities',
    moduleImport,
    '',
  ].join('\n');
  if (backendSource.includes('// permission plugin')) {
    backendSource = backendSource.replace('// permission plugin', `${insertion}// permission plugin`);
  } else {
    backendSource = backendSource.replace('backend.start();', `${insertion}backend.start();`);
  }
  fs.writeFileSync(backendIndex, backendSource);
}

const orgPath = path.join(rootDir, 'demo/backstage/org.yaml');

// By default the demo scans the current kubectl context as one "demo" cluster.
// Set DEMO_CLUSTER_CONTEXTS="ctxA,ctxB,ctxC" to scan several clusters instead —
// each context becomes its own agentCatalog.clusters entry. Without this, the
// hardcoded single entry would replace (not merge with) any multi-cluster list.
const clusterContexts = (process.env.DEMO_CLUSTER_CONTEXTS ?? '')
  .split(',')
  .map(s => s.trim())
  .filter(Boolean);
const clustersYaml = clusterContexts.length
  ? clusterContexts.map(ctx => `    - name: ${ctx}\n      context: ${ctx}`).join('\n')
  : '    - name: demo';

const overlay = `app:
  title: Agent Catalog Demo
  baseUrl: http://localhost:${frontendPort}
  packages: all

backend:
  baseUrl: http://localhost:${backendPort}
  listen:
    port: ${backendPort}
  cors:
    origin: http://localhost:${frontendPort}
    methods: [GET, HEAD, PATCH, POST, PUT, DELETE]
    credentials: true
  database:
    client: better-sqlite3
    connection: ':memory:'

catalog:
  locations:
    - type: file
      target: ${JSON.stringify(orgPath)}
      rules:
        - allow: [User, Group]

agentCatalog:
  defaultOwner: group:default/platform-team
  excludeNamespaces:
    - kube-system
    - local-path-storage
  schedule:
    frequencyMinutes: 1
    timeoutMinutes: 1
  cardEnrichment:
    timeoutMs: 2000
    port: 8080
    paths:
      - /.well-known/agent-card.json
      - /.well-known/agent.json
  a2aDiscovery:
    enabled: true
    labelSelector: agentcatalog.io/a2a=true
    claimedBy:
      - group: kagent.dev
        kind: Agent
      - group: ark.mckinsey.com
        kind: Agent
  ark:
    enabled: true
  heuristics:
    enabled: true
  usage:
    enabled: true
    source: litellm
    baseUrl: http://localhost:${litellmPort}
    apiKeyEnv: LITELLM_SPEND_KEY
    windowDays: 7
    includeCost: false
    schedule:
      frequencyMinutes: 1
  clusters:
${clustersYaml}
`;

fs.writeFileSync(path.join(appDir, 'app-config.agent-catalog-demo.yaml'), overlay);
