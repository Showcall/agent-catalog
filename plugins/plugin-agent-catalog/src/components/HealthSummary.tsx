/**
 * "Needs attention" panel above the fleet table. Renders the prioritized
 * findings from `computeHealth` — pure presentation, no data fetching, so it
 * stays easy to snapshot-test and reuse.
 */

import { InfoCard, EmptyState } from '@backstage/core-components';
import { EntityRefLink } from '@backstage/plugin-catalog-react';
import { Chip, Grid, Typography } from '@material-ui/core';
import type { HealthFinding, HealthSeverity } from './health';

const SEVERITY_COLOR: Record<HealthSeverity, string> = {
  critical: '#e5484d',
  warning: '#f5a524',
  info: '#8b8d98',
};

// How many affected subjects to list inline before collapsing to "+N more".
const MAX_INLINE = 6;

const SeverityDot = ({ severity }: { severity: HealthSeverity }) => (
  <span
    aria-hidden
    style={{
      display: 'inline-block',
      width: 8,
      height: 8,
      borderRadius: '50%',
      backgroundColor: SEVERITY_COLOR[severity],
      marginRight: 8,
      flex: '0 0 auto',
    }}
  />
);

const FindingRow = ({ finding }: { finding: HealthFinding }) => {
  const inlineEntities = finding.entities.slice(0, MAX_INLINE);
  const inlineSubjects = finding.subjects.slice(
    0,
    Math.max(0, MAX_INLINE - inlineEntities.length),
  );
  const shown = inlineEntities.length + inlineSubjects.length;
  const overflow = finding.count - shown;

  return (
    <Grid item xs={12} data-testid={`finding-${finding.id}`}>
      <div style={{ display: 'flex', alignItems: 'baseline' }}>
        <SeverityDot severity={finding.severity} />
        <Typography variant="subtitle2" component="span">
          {finding.title}
        </Typography>
        <Chip
          size="small"
          label={finding.count}
          style={{ marginLeft: 8, height: 20 }}
        />
      </div>
      <Typography
        variant="body2"
        color="textSecondary"
        style={{ margin: '2px 0 4px 16px' }}
      >
        {finding.detail}
      </Typography>
      <div style={{ marginLeft: 16 }}>
        {inlineEntities.map((entity, i) => (
          <span key={`e-${i}`} style={{ marginRight: 8 }}>
            <EntityRefLink entityRef={entity} />
          </span>
        ))}
        {inlineSubjects.map((subject, i) => (
          <Chip
            key={`s-${i}`}
            size="small"
            variant="outlined"
            label={subject}
            style={{ marginRight: 8, height: 20 }}
          />
        ))}
        {overflow > 0 && (
          <Typography variant="caption" color="textSecondary" component="span">
            +{overflow} more
          </Typography>
        )}
      </div>
    </Grid>
  );
};

export const HealthSummary = ({
  findings,
  total,
}: {
  findings: HealthFinding[];
  total: number;
}) => {
  if (!findings.length) {
    return (
      <InfoCard title="Needs attention">
        <EmptyState
          missing="info"
          title="Nothing needs attention"
          description={
            total
              ? `All ${total} cataloged agents are owned, reachable, in sync, and observed from a healthy source.`
              : 'No agents cataloged yet.'
          }
        />
      </InfoCard>
    );
  }

  return (
    <InfoCard
      title="Needs attention"
      subheader={`${findings.reduce((n, f) => n + f.count, 0)} across ${findings.length} ${
        findings.length === 1 ? 'category' : 'categories'
      }`}
    >
      <Grid container spacing={1}>
        {findings.map(finding => (
          <FindingRow key={finding.id} finding={finding} />
        ))}
      </Grid>
    </InfoCard>
  );
};
