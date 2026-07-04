/**
 * The fleet view: every AI agent across all sources, one table.
 * "It's 10 PM. Do you know where your agents are?"
 */

import { useEffect, useState } from 'react';
import {
  Content,
  Header,
  Page,
  Progress,
  ResponseErrorPanel,
  Table,
  TableColumn,
} from '@backstage/core-components';
import { useApi } from '@backstage/core-plugin-api';
import { catalogApiRef, EntityRefLink } from '@backstage/plugin-catalog-react';
import type { Entity } from '@backstage/catalog-model';
import { Chip } from '@material-ui/core';

const A = 'agentcatalog.io';

interface AgentRow {
  entity: Entity;
  name: string;
  owner: string;
  runtime: string;
  discovery: string;
  lifecycle: string;
  reachable: string;
  lastActive: string;
  requests: number | undefined;
  window: string;
}

function toRow(entity: Entity): AgentRow {
  const ann = entity.metadata.annotations ?? {};
  const requests = ann[`${A}/usage-requests`];
  return {
    entity,
    name: entity.metadata.title ?? entity.metadata.name,
    owner: String(entity.spec?.owner ?? '—'),
    runtime: ann[`${A}/runtime`] ?? 'unknown',
    discovery: ann[`${A}/discovery`] ?? '—',
    lifecycle: String(entity.spec?.lifecycle ?? '—'),
    reachable: ann[`${A}/reachable`] ?? '—',
    lastActive: ann[`${A}/last-active`] ?? '—',
    requests: requests !== undefined ? Number(requests) : undefined,
    window: ann[`${A}/usage-window`] ?? '',
  };
}

const columns: TableColumn<AgentRow>[] = [
  {
    title: 'Agent',
    field: 'name',
    highlight: true,
    render: row => <EntityRefLink entityRef={row.entity} title={row.name} />,
  },
  { title: 'Owner', field: 'owner' },
  { title: 'Runtime', field: 'runtime' },
  {
    title: 'Discovery',
    field: 'discovery',
    render: row => <Chip label={row.discovery} size="small" variant="outlined" />,
  },
  { title: 'Lifecycle', field: 'lifecycle' },
  {
    title: 'Reachable',
    field: 'reachable',
    render: row =>
      row.reachable === '—' ? (
        <>—</>
      ) : (
        <Chip
          label={row.reachable === 'true' ? 'yes' : 'no'}
          size="small"
          style={{
            backgroundColor: row.reachable === 'true' ? '#1db95433' : '#e5484d33',
          }}
        />
      ),
  },
  { title: 'Last active', field: 'lastActive' },
  {
    title: 'Requests',
    field: 'requests',
    type: 'numeric',
    render: row =>
      row.requests !== undefined ? (
        <>
          {row.requests}
          <span style={{ opacity: 0.6 }}> /{row.window}</span>
        </>
      ) : (
        <span style={{ opacity: 0.6 }}>no key alias</span>
      ),
  },
];

export const FleetPage = () => {
  const catalogApi = useApi(catalogApiRef);
  const [rows, setRows] = useState<AgentRow[] | undefined>();
  const [error, setError] = useState<Error | undefined>();

  useEffect(() => {
    catalogApi
      .getEntities({
        // ai-agent plus honest heuristic findings (ADR 0009)
        filter: { kind: 'Component', 'spec.type': ['ai-agent', 'llm-workload'] },
      })
      .then(res => setRows(res.items.map(toRow)))
      .catch(setError);
  }, [catalogApi]);

  return (
    <Page themeId="tool">
      <Header
        title="AI Agents"
        subtitle="It's 10 PM. Do you know where your agents are?"
      />
      <Content>
        {error && <ResponseErrorPanel error={error} />}
        {!rows && !error && <Progress />}
        {rows && (
          <Table<AgentRow>
            title={`Fleet (${rows.length})`}
            options={{ search: true, paging: false, padding: 'dense' }}
            columns={columns}
            data={rows}
          />
        )}
      </Content>
    </Page>
  );
};
