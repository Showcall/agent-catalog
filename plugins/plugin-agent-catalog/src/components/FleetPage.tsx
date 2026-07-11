/**
 * The fleet view: every AI agent across all sources, one table.
 * "It's 10 PM. Do you know where your agents are?"
 *
 * Leads with summary tiles and a collapsible "Needs attention" panel; both are
 * click-to-filter over the table below. All current-state, read-only — filtering
 * the live view, not saved views or dashboards.
 */

import { useEffect, useMemo, useState } from 'react';
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
import {
  Button,
  Checkbox,
  Chip,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
} from '@material-ui/core';
import ViewColumn from '@material-ui/icons/ViewColumn';
import { toRow, type AgentRow } from './rows';
import { computeHealth, type HealthFinding } from './health';
import { HealthSummary } from './HealthSummary';
import { FleetStatsBar } from './FleetStats';
import { GhostIcon } from './GhostIcon';
import {
  TILES,
  computeFleetStats,
  filterRows,
  type FleetFilter,
} from './fleetView';

const statusChip = (good: boolean, label: string) => (
  <Chip
    label={label}
    size="small"
    style={{ backgroundColor: good ? '#1db95433' : '#e5484d33' }}
  />
);

const ALL_COLUMNS: TableColumn<AgentRow>[] = [
  {
    title: 'Agent',
    field: 'name',
    highlight: true,
    render: row => (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <EntityRefLink entityRef={row.entity} title={row.name} />
        {row.discovery === 'probe' && (
          <span
            title="Found by the sweep — nobody registered it"
            style={{ color: '#7f77dd', display: 'inline-flex' }}
          >
            <GhostIcon />
          </span>
        )}
      </span>
    ),
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
        statusChip(row.reachable === 'true', row.reachable === 'true' ? 'yes' : 'no')
      ),
  },
  {
    title: 'Source',
    field: 'sourceStatus',
    render: row =>
      row.sourceStatus === '—' ? (
        <>—</>
      ) : (
        statusChip(
          row.sourceStatus === 'available',
          row.sourceStatus === 'available' ? 'online' : 'offline',
        )
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
  { title: 'Last observed', field: 'lastObservedAt' },
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

const DEFAULT_HIDDEN = ['discovery', 'interfaceStatus', 'lastActive', 'lastObservedAt'];

type Active = { kind: 'tile' | 'find'; filter: FleetFilter } | undefined;

export const FleetPage = () => {
  const catalogApi = useApi(catalogApiRef);
  const [rows, setRows] = useState<AgentRow[] | undefined>();
  const [findings, setFindings] = useState<HealthFinding[]>([]);
  const [error, setError] = useState<Error | undefined>();
  const [active, setActive] = useState<Active>();
  const [hidden, setHidden] = useState<Set<string>>(new Set(DEFAULT_HIDDEN));
  const [colAnchor, setColAnchor] = useState<HTMLElement | null>(null);

  useEffect(() => {
    Promise.all([
      catalogApi.getEntities({
        filter: {
          kind: 'Component',
          'spec.type': ['ai-agent', 'ai-agent-team', 'llm-workload'],
        },
      }),
      catalogApi.getEntities({
        filter: { kind: 'Resource', 'spec.type': 'llm-gateway' },
      }),
    ])
      .then(([agentRes, gatewayRes]) => {
        setRows(agentRes.items.map(toRow));
        setFindings(computeHealth(agentRes.items, gatewayRes.items));
      })
      .catch(setError);
  }, [catalogApi]);

  const stats = useMemo(() => computeFleetStats(rows ?? []), [rows]);
  const visibleRows = useMemo(
    () => filterRows(rows ?? [], active?.filter),
    [rows, active],
  );
  const columns = useMemo(
    () => ALL_COLUMNS.filter(c => !hidden.has(c.field as string)),
    [hidden],
  );

  const toggleTile = (tileId: string) => {
    if (active?.kind === 'tile' && active.filter.id === tileId) {
      setActive(undefined);
      return;
    }
    const tile = TILES.find(t => t.id === tileId);
    if (tile?.filter) {
      setActive({ kind: 'tile', filter: { id: tile.id, label: tile.label, match: tile.filter } });
    }
  };

  const selectFinding = (f: HealthFinding) => {
    if (active?.kind === 'find' && active.filter.id === f.id) {
      setActive(undefined);
      return;
    }
    setActive({
      kind: 'find',
      filter: { id: f.id, label: f.title, match: row => f.entities.includes(row.entity) },
    });
  };

  const toggleColumn = (field: string) =>
    setHidden(prev => {
      const next = new Set(prev);
      if (next.has(field)) next.delete(field);
      else next.add(field);
      return next;
    });

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
          <>
            <FleetStatsBar
              stats={stats}
              activeId={active?.kind === 'tile' ? active.filter.id : undefined}
              onToggle={toggleTile}
            />
            <div style={{ marginBottom: 16 }}>
              <HealthSummary
                findings={findings}
                total={rows.length}
                activeFindingId={active?.kind === 'find' ? active.filter.id : undefined}
                onSelectFinding={selectFinding}
              />
            </div>

            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                marginBottom: 8,
              }}
            >
              {active && (
                <Chip
                  label={`Showing: ${active.filter.label} (${visibleRows.length})`}
                  onDelete={() => setActive(undefined)}
                  size="small"
                />
              )}
              <span style={{ marginLeft: 'auto' }}>
                <Button
                  size="small"
                  startIcon={<ViewColumn />}
                  onClick={e => setColAnchor(e.currentTarget)}
                >
                  Columns
                </Button>
                <Menu
                  anchorEl={colAnchor}
                  open={!!colAnchor}
                  onClose={() => setColAnchor(null)}
                >
                  {ALL_COLUMNS.filter(c => c.field !== 'name').map(c => (
                    <MenuItem
                      key={c.field as string}
                      onClick={() => toggleColumn(c.field as string)}
                      dense
                    >
                      <ListItemIcon style={{ minWidth: 34 }}>
                        <Checkbox
                          edge="start"
                          size="small"
                          checked={!hidden.has(c.field as string)}
                          tabIndex={-1}
                          disableRipple
                        />
                      </ListItemIcon>
                      <ListItemText primary={c.title as string} />
                    </MenuItem>
                  ))}
                </Menu>
              </span>
            </div>

            <Table<AgentRow>
              title={`Fleet (${visibleRows.length}${
                active ? ` of ${rows.length}` : ''
              })`}
              options={{
                search: true,
                paging: false,
                padding: 'dense',
                rowStyle: (row: AgentRow) =>
                  row.discovery === 'probe'
                    ? { backgroundColor: 'rgba(127,119,221,0.06)' }
                    : {},
              }}
              columns={columns}
              data={visibleRows}
            />
          </>
        )}
      </Content>
    </Page>
  );
};
