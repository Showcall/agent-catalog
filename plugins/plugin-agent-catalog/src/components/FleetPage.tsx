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
import { Chip } from '@material-ui/core';
import { toRow, type AgentRow } from './rows';

const columns: TableColumn<AgentRow>[] = [
  {
    title: 'Agent',
    field: 'name',
    highlight: true,
    render: row => <EntityRefLink entityRef={row.entity} title={row.name} />,
  },
  { title: 'Owner', field: 'owner' },
  {
    title: 'Cluster',
    field: 'cluster',
    render: row =>
      row.cluster === '—' ? (
        <>—</>
      ) : (
        <Chip label={row.cluster} size="small" variant="outlined" />
      ),
  },
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
  {
    title: 'Interface',
    field: 'interfaceStatus',
    render: row =>
      row.interfaceStatus === '—' ? (
        <>—</>
      ) : (
        <Chip
          label={row.interfaceStatus === 'in-sync' ? 'in sync' : 'drift'}
          size="small"
          style={{
            backgroundColor:
              row.interfaceStatus === 'in-sync' ? '#1db95433' : '#f5a52433',
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
        // agents + multi-agent teams + honest heuristic findings
        filter: {
          kind: 'Component',
          'spec.type': ['ai-agent', 'ai-agent-team', 'llm-workload'],
        },
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
