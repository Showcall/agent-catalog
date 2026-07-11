/**
 * Per-agent card for entity overview pages: traction + status at a glance,
 * so nobody needs the entity inspector to answer "is this agent alive and
 * does anyone use it".
 */

import type { ReactNode } from 'react';
import { InfoCard } from '@backstage/core-components';
import { useEntity } from '@backstage/plugin-catalog-react';
import { Chip, Grid, Typography } from '@material-ui/core';

const A = 'agentcatalog.io';

const Stat = ({ label, value }: { label: string; value: ReactNode }) => (
  <Grid item xs={4}>
    <Typography variant="overline" color="textSecondary" component="div">
      {label}
    </Typography>
    <Typography variant="h6" component="div">
      {value}
    </Typography>
  </Grid>
);

export const AgentInfoCard = () => {
  const { entity } = useEntity();
  const ann = entity.metadata.annotations ?? {};
  const agent = (entity.spec as { agent?: Record<string, unknown> })?.agent ?? {};

  const requests = ann[`${A}/usage-requests`];
  const tokens = ann[`${A}/usage-tokens`];
  const cost = ann[`${A}/usage-cost-usd`];
  const window = ann[`${A}/usage-window`] ?? '';
  const lastActive = ann[`${A}/last-active`];
  const reachable = ann[`${A}/reachable`];
  const cardSource = ann[`${A}/card-source`];
  const discovery = ann[`${A}/discovery`];
  const runtime = ann[`${A}/runtime`];
  const cluster = ann[`${A}/cluster`];
  const modelConfig = ann[`${A}/model-config`];
  const image = ann[`${A}/image`];
  const signals = ann[`${A}/heuristic-signals`];
  const isHeuristic = discovery === 'heuristic';

  return (
    <InfoCard
      title={isHeuristic ? 'LLM workload (heuristic finding)' : 'Agent'}
      subheader={isHeuristic ? undefined : `runtime: ${runtime ?? 'unknown'}`}
    >
      <Grid container spacing={2}>
        <Grid item xs={12}>
          {cluster && <Chip size="small" variant="outlined" label={`cluster: ${cluster}`} />}
          {discovery && <Chip size="small" variant="outlined" label={`discovery: ${discovery}`} />}
          {reachable && (
            <Chip
              size="small"
              label={reachable === 'true' ? 'reachable' : 'unreachable'}
              style={{
                backgroundColor: reachable === 'true' ? '#1db95433' : '#e5484d33',
              }}
            />
          )}
          {cardSource && <Chip size="small" variant="outlined" label={`card: ${cardSource}`} />}
        </Grid>

        <Stat label={`Requests${window ? ` / ${window}` : ''}`} value={requests ?? '—'} />
        <Stat label="Tokens" value={tokens ?? '—'} />
        <Stat label="Last active" value={lastActive ?? '—'} />
        {cost && <Stat label={`Cost / ${window}`} value={`$${cost}`} />}

        {signals && (
          <Grid item xs={12}>
            <Typography variant="body2" color="textSecondary">
              Flagged because: <code>{signals}</code>. If this is a real
              agent, label its Service <code>agentcatalog.io/a2a: "true"</code>;
              if it's a false positive, label it <code>"false"</code>.
            </Typography>
          </Grid>
        )}
        {(modelConfig || image) && (
          <Grid item xs={12}>
            <Typography variant="body2" color="textSecondary">
              {modelConfig && <>model config: <code>{modelConfig}</code> </>}
              {image && <>image: <code>{image}</code></>}
            </Typography>
          </Grid>
        )}
        {requests === undefined && (
          <Grid item xs={12}>
            <Typography variant="body2" color="textSecondary">
              No per-agent usage: this agent has no gateway key alias. Issue it
              a key aliased <code>{String(agent.namespace ?? 'ns')}/{entity.metadata.title ?? entity.metadata.name}</code> to
              light up traction.
            </Typography>
          </Grid>
        )}
      </Grid>
    </InfoCard>
  );
};
