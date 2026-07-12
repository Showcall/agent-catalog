/**
 * The fleet view: every AI agent across all sources, one table.
 * "It's 10 PM. Do you know where your agents are?"
 *
 * Pure view over the backend's neutral snapshots + findings (Fork B, ADR 0011):
 * it fetches, formats, and filters — it does not derive. Leads with summary
 * tiles and a collapsible "Needs attention" panel; both are click-to-filter
 * over the table below.
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
import { EntityRefLink } from '@backstage/plugin-catalog-react';
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
import { useFleetApi, type AgentSnapshot, type Finding } from '../api/fleetApi';
import { HealthSummary } from './HealthSummary';
import { FleetStatsBar } from './FleetStats';
import { GhostIcon } from './GhostIcon';
import {
  TILES,
  computeFleetStats,
  filterRows,
  type FleetFilter,
} from './fleetView';

const DASH = '—';
const dash = (v: string | null) => v ?? DASH;

const statusChip = (good: boolean, label: string) => (
  <Chip
    label={label}
    size="small"
    style={{ backgroundColor: good ? '#1db95433' : '#e5484d33' }}
  />
);

const ALL_COLUMNS: TableColumn<AgentSnapshot>[] = [
  {
    title: 'Agent',
    field: 'name',
    highlight: true,
    render: row => (
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
        <EntityRefLink entityRef={row.ref} title={row.name} />
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
  { title: 'Owner', field: 'owner', render: row => <>{dash(row.owner)}</> },
  {
    title: 'Cluster',
    field: 'cluster',
    render: row =>
      row.cluster ? (
        <Chip label={row.cluster} size="small" variant="outlined" />
      ) : (
        <>{DASH}</>
      ),
  },
  { title: 'Runtime', field: 'runtime', render: row => <>{dash(row.runtime)}</> },
  {
    title: 'Discovery',
    field: 'discovery',
    render: row => <Chip label={row.discovery} size="small" variant="outlined" />,
  },
  {
    title: 'Lifecycle',
    field: 'lifecycle',
    render: row => <>{dash(row.lifecycle)}</>,
  },
  {
    title: 'Reachable',
    field: 'reachable',
    render: row =>
      row.reachable === null ? (
        <>{DASH}</>
      ) : (
        statusChip(row.reachable, row.reachable ? 'yes' : 'no')
      ),
  },
  {
    title: 'Source',
    field: 'sourceStatus',
    render: row =>
      row.sourceStatus === null ? (
        <>{DASH}</>
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
      row.interfaceStatus === null ? (
        <>{DASH}</>
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
  { title: 'Last active', field: 'lastActive', render: row => <>{dash(row.lastActive)}</> },
  {
    title: 'Last observed',
    field: 'lastObservedAt',
    render: row => <>{dash(row.lastObservedAt)}</>,
  },
  {
    title: 'Requests',
    field: 'usage.requests',
    type: 'numeric',
    render: row =>
      row.usage.requests !== null ? (
        <>
          {row.usage.requests}
          <span style={{ opacity: 0.6 }}> /{row.usage.window ?? ''}</span>
        </>
      ) : (
        <span style={{ opacity: 0.6 }}>no key alias</span>
      ),
  },
];

const DEFAULT_HIDDEN = ['discovery', 'interfaceStatus', 'lastActive', 'lastObservedAt'];

type Active = { kind: 'tile' | 'find'; filter: FleetFilter } | undefined;

export const FleetPage = () => {
  const fleetApi = useFleetApi();
  const [agents, setAgents] = useState<AgentSnapshot[] | undefined>();
  const [findings, setFindings] = useState<Finding[]>([]);
  const [error, setError] = useState<Error | undefined>();
  const [active, setActive] = useState<Active>();
  const [hidden, setHidden] = useState<Set<string>>(new Set(DEFAULT_HIDDEN));
  const [colAnchor, setColAnchor] = useState<HTMLElement | null>(null);

  useEffect(() => {
    Promise.all([fleetApi.getAgents(), fleetApi.getFindings()])
      .then(([a, f]) => {
        setAgents(a);
        setFindings(f);
      })
      .catch(setError);
    // fleetApi is derived from stable apis; fetch once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const stats = useMemo(() => computeFleetStats(agents ?? []), [agents]);
  const visibleRows = useMemo(
    () => filterRows(agents ?? [], active?.filter),
    [agents, active],
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
      setActive({
        kind: 'tile',
        filter: { id: tile.id, label: tile.label, match: tile.filter },
      });
    }
  };

  const selectFinding = (f: Finding) => {
    if (active?.kind === 'find' && active.filter.id === f.id) {
      setActive(undefined);
      return;
    }
    setActive({
      kind: 'find',
      filter: {
        id: f.id,
        label: f.title,
        match: agent => f.agentRefs.includes(agent.ref),
      },
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
        {!agents && !error && <Progress />}
        {agents && (
          <>
            <FleetStatsBar
              stats={stats}
              activeId={active?.kind === 'tile' ? active.filter.id : undefined}
              onToggle={toggleTile}
            />
            <div style={{ marginBottom: 16 }}>
              <HealthSummary
                findings={findings}
                total={agents.length}
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

            <Table<AgentSnapshot>
              title={`Fleet (${visibleRows.length}${
                active ? ` of ${agents.length}` : ''
              })`}
              options={{
                search: true,
                paging: false,
                padding: 'dense',
                rowStyle: (row: AgentSnapshot) =>
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
