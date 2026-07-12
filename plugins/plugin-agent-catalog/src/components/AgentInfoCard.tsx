/**
 * Per-agent card for entity overview pages: traction + status at a glance,
 * so nobody needs the entity inspector to answer "is this agent alive and
 * does anyone use it".
 */

import type { ReactNode } from 'react';
import { InfoCard } from '@backstage/core-components';
import { useEntity } from '@backstage/plugin-catalog-react';
import { Chip, Grid, Typography } from '@material-ui/core';
import { makeStyles } from '@material-ui/core/styles';

const A = 'agentcatalog.io';

const useStyles = makeStyles(theme => ({
  chips: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: theme.spacing(1),
  },
  statValue: {
    overflowWrap: 'anywhere',
  },
  detail: {
    margin: 0,
    overflowWrap: 'anywhere',
  },
}));

const Stat = ({ label, value }: { label: string; value: ReactNode }) => (
  <Grid item xs={6}>
    <Typography variant="overline" color="textSecondary" component="div">
      {label}
    </Typography>
    <Typography
      variant="body1"
      component="div"
      className={useStyles().statValue}
    >
      {value}
    </Typography>
  </Grid>
);

export const AgentInfoCard = () => {
  const { entity } = useEntity();
  const classes = useStyles();
  const ann = entity.metadata.annotations ?? {};
  const agent =
    (entity.spec as { agent?: Record<string, unknown> })?.agent ?? {};

  const requests = ann[`${A}/usage-requests`];
  const tokens = ann[`${A}/usage-tokens`];
  const cost = ann[`${A}/usage-cost-usd`];
  const window = ann[`${A}/usage-window`] ?? '';
  const lastActive = ann[`${A}/last-active`];
  const reachable = ann[`${A}/reachable`];
  const sourceStatus = ann[`${A}/source-status`];
  const lastObservedAt = ann[`${A}/last-observed-at`];
  const sourceLastSuccessAt = ann[`${A}/source-last-success-at`];
  const cardSource = ann[`${A}/card-source`];
  const interfaceStatus = ann[`${A}/interface-status`];
  const interfaceDrift = ann[`${A}/interface-drift`];
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
          <div className={classes.chips}>
            {cluster && (
              <Chip
                size="small"
                variant="outlined"
                label={`cluster: ${cluster}`}
              />
            )}
            {discovery && (
              <Chip
                size="small"
                variant="outlined"
                label={`discovery: ${discovery}`}
              />
            )}
            {reachable && (
              <Chip
                size="small"
                label={reachable === 'true' ? 'reachable' : 'unreachable'}
                style={{
                  backgroundColor:
                    reachable === 'true' ? '#1db95433' : '#e5484d33',
                }}
              />
            )}
            {sourceStatus && (
              <Chip
                size="small"
                label={
                  sourceStatus === 'available'
                    ? 'source: online'
                    : 'source: offline'
                }
                style={{
                  backgroundColor:
                    sourceStatus === 'available' ? '#1db95433' : '#e5484d33',
                }}
              />
            )}
            {cardSource && (
              <Chip
                size="small"
                variant="outlined"
                label={`card: ${cardSource}`}
              />
            )}
            {interfaceStatus && (
              <Chip
                size="small"
                label={
                  interfaceStatus === 'in-sync'
                    ? 'interface: in sync'
                    : 'interface: drift'
                }
                style={{
                  backgroundColor:
                    interfaceStatus === 'in-sync' ? '#1db95433' : '#f5a52433',
                }}
              />
            )}
          </div>
        </Grid>

        <Stat
          label={`Requests${window ? ` / ${window}` : ''}`}
          value={requests ?? '—'}
        />
        <Stat label="Tokens" value={tokens ?? '—'} />
        <Stat label="Last active" value={lastActive ?? '—'} />
        <Stat label="Last observed" value={lastObservedAt ?? '—'} />
        {cost && <Stat label={`Cost / ${window}`} value={`$${cost}`} />}

        {sourceStatus === 'unavailable' && (
          <Grid item xs={12}>
            <Typography
              variant="body2"
              color="textSecondary"
              className={classes.detail}
            >
              Source is currently unavailable. Last successful observation:{' '}
              <code>{sourceLastSuccessAt ?? 'unknown'}</code>.
            </Typography>
          </Grid>
        )}

        {signals && (
          <Grid item xs={12}>
            <Typography
              variant="body2"
              color="textSecondary"
              className={classes.detail}
            >
              Flagged because: <code>{signals}</code>. If this is a real agent,
              label its Service <code>agentcatalog.io/a2a: "true"</code>; if
              it's a false positive, label it <code>"false"</code>.
            </Typography>
          </Grid>
        )}
        {interfaceDrift && (
          <Grid item xs={12}>
            <Typography
              variant="body2"
              color="textSecondary"
              className={classes.detail}
            >
              Declared interface differs from the live card:{' '}
              <code>{interfaceDrift}</code>.
            </Typography>
          </Grid>
        )}
        {(modelConfig || image) && (
          <Grid item xs={12}>
            <Typography
              variant="body2"
              color="textSecondary"
              className={classes.detail}
            >
              {modelConfig && (
                <>
                  model config: <code>{modelConfig}</code>{' '}
                </>
              )}
              {image && (
                <>
                  image: <code>{image}</code>
                </>
              )}
            </Typography>
          </Grid>
        )}
        {requests === undefined && (
          <Grid item xs={12}>
            <Typography
              variant="body2"
              color="textSecondary"
              className={classes.detail}
            >
              No per-agent usage: this agent has no gateway key alias. Issue it
              a key aliased{' '}
              <code>
                {String(agent.namespace ?? 'ns')}/
                {entity.metadata.title ?? entity.metadata.name}
              </code>{' '}
              to light up traction.
            </Typography>
          </Grid>
        )}
      </Grid>
    </InfoCard>
  );
};
