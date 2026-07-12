/**
 * Per-agent card for entity overview pages: traction + status at a glance,
 * so nobody needs the entity inspector to answer "is this agent alive and
 * does anyone use it".
 */

import { useEffect, useState, type ReactNode } from 'react';
import { InfoCard, Progress } from '@backstage/core-components';
import { useEntity } from '@backstage/plugin-catalog-react';
import { stringifyEntityRef } from '@backstage/catalog-model';
import { Chip, Grid, Typography } from '@material-ui/core';
import { makeStyles } from '@material-ui/core/styles';
import { useFleetApi, type AgentSnapshot } from '../api/fleetApi';

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
  const fleetApi = useFleetApi();
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'ready'; snapshot: AgentSnapshot | undefined }
    | { status: 'error'; error: Error }
  >({ status: 'loading' });

  useEffect(() => {
    let mounted = true;
    setState({ status: 'loading' });
    fleetApi
      .getAgents()
      .then(agents => {
        if (!mounted) return;
        const ref = stringifyEntityRef(entity);
        setState({
          status: 'ready',
          snapshot: agents.find(agent => agent.ref === ref),
        });
      })
      .catch((error: unknown) => {
        if (!mounted) return;
        setState({
          status: 'error',
          error: error instanceof Error ? error : new Error(String(error)),
        });
      });

    return () => {
      mounted = false;
    };
    // useFleetApi returns request functions rather than a stable object.
    // Fetch once for the entity card and avoid restarting on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entity]);

  if (state.status === 'loading') {
    return (
      <InfoCard title="Agent">
        <Progress />
      </InfoCard>
    );
  }

  if (state.status === 'error') {
    return (
      <InfoCard title="Agent">
        <Typography variant="body2" color="textSecondary">
          Agent status is temporarily unavailable. {state.error.message}
        </Typography>
      </InfoCard>
    );
  }

  if (!state.snapshot) {
    return (
      <InfoCard title="Agent">
        <Typography variant="body2" color="textSecondary">
          No current agent snapshot is available for this catalog entity.
        </Typography>
      </InfoCard>
    );
  }

  return <AgentInfoCardView snapshot={state.snapshot} />;
};

export function AgentInfoCardView({ snapshot }: { snapshot: AgentSnapshot }) {
  const classes = useStyles();
  const isHeuristic = snapshot.kind === 'workload';
  const requests = snapshot.usage.requests;
  const window = snapshot.usage.window;

  return (
    <InfoCard
      title={isHeuristic ? 'LLM workload (heuristic finding)' : 'Agent'}
      subheader={
        isHeuristic ? undefined : `runtime: ${snapshot.runtime ?? 'unknown'}`
      }
    >
      <Grid container spacing={2}>
        <Grid item xs={12}>
          <div className={classes.chips}>
            {snapshot.cluster && (
              <Chip
                size="small"
                variant="outlined"
                label={`cluster: ${snapshot.cluster}`}
              />
            )}
            {snapshot.discovery && (
              <Chip
                size="small"
                variant="outlined"
                label={`discovery: ${snapshot.discovery}`}
              />
            )}
            {snapshot.reachable !== null && (
              <Chip
                size="small"
                label={snapshot.reachable ? 'reachable' : 'unreachable'}
                style={{
                  backgroundColor: snapshot.reachable
                    ? '#1db95433'
                    : '#e5484d33',
                }}
              />
            )}
            {snapshot.sourceStatus && (
              <Chip
                size="small"
                label={
                  snapshot.sourceStatus === 'available'
                    ? 'source: online'
                    : 'source: offline'
                }
                style={{
                  backgroundColor:
                    snapshot.sourceStatus === 'available'
                      ? '#1db95433'
                      : '#e5484d33',
                }}
              />
            )}
            {snapshot.cardSource && (
              <Chip
                size="small"
                variant="outlined"
                label={`card: ${snapshot.cardSource}`}
              />
            )}
            {snapshot.interfaceStatus && (
              <Chip
                size="small"
                label={
                  snapshot.interfaceStatus === 'in-sync'
                    ? 'interface: in sync'
                    : 'interface: drift'
                }
                style={{
                  backgroundColor:
                    snapshot.interfaceStatus === 'in-sync'
                      ? '#1db95433'
                      : '#f5a52433',
                }}
              />
            )}
          </div>
        </Grid>

        <Stat
          label={`Requests${window ? ` / ${window}` : ''}`}
          value={requests === null ? '—' : requests}
        />
        <Stat
          label="Tokens"
          value={snapshot.usage.tokens === null ? '—' : snapshot.usage.tokens}
        />
        <Stat label="Last active" value={snapshot.lastActive ?? '—'} />
        <Stat label="Last observed" value={snapshot.lastObservedAt ?? '—'} />
        {snapshot.usage.costUsd !== null && (
          <Stat
            label={`Cost / ${window ?? ''}`}
            value={`$${snapshot.usage.costUsd}`}
          />
        )}

        {snapshot.sourceStatus === 'unavailable' && (
          <Grid item xs={12}>
            <Typography
              variant="body2"
              color="textSecondary"
              className={classes.detail}
            >
              Source is currently unavailable. Last successful observation:{' '}
              <code>{snapshot.sourceLastSuccessAt ?? 'unknown'}</code>.
            </Typography>
          </Grid>
        )}

        {snapshot.heuristicSignals && (
          <Grid item xs={12}>
            <Typography
              variant="body2"
              color="textSecondary"
              className={classes.detail}
            >
              Flagged because: <code>{snapshot.heuristicSignals}</code>. If this
              is a real agent, label its Service{' '}
              <code>agentcatalog.io/a2a: "true"</code>; if it's a false
              positive, label it <code>"false"</code>.
            </Typography>
          </Grid>
        )}
        {snapshot.interfaceDrift && (
          <Grid item xs={12}>
            <Typography
              variant="body2"
              color="textSecondary"
              className={classes.detail}
            >
              Declared interface differs from the live card:{' '}
              <code>{snapshot.interfaceDrift}</code>.
            </Typography>
          </Grid>
        )}
        {(snapshot.model || snapshot.image) && (
          <Grid item xs={12}>
            <Typography
              variant="body2"
              color="textSecondary"
              className={classes.detail}
            >
              {snapshot.model && (
                <>
                  model config: <code>{snapshot.model}</code>{' '}
                </>
              )}
              {snapshot.image && (
                <>
                  image: <code>{snapshot.image}</code>
                </>
              )}
            </Typography>
          </Grid>
        )}
        {requests === null && (
          <Grid item xs={12}>
            <Typography
              variant="body2"
              color="textSecondary"
              className={classes.detail}
            >
              No per-agent usage: this agent has no gateway key alias. Issue it
              a key aliased{' '}
              <code>
                {String(snapshot.namespace ?? 'ns')}/{snapshot.name}
              </code>{' '}
              to light up traction.
            </Typography>
          </Grid>
        )}
      </Grid>
    </InfoCard>
  );
}
