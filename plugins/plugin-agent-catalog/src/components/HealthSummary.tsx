/**
 * "Needs attention" panel above the fleet table. Renders the prioritized
 * findings the backend derived (ADR 0011) — pure presentation, no derivation.
 *
 * Collapsible, and each agent-backed finding is clickable: selecting it asks
 * the fleet to filter down to exactly the affected agents. Findings with no
 * agents (e.g. unattributed gateway aliases) are shown but not clickable —
 * there is no row to filter to.
 */

import { useState } from 'react';
import { InfoCard, EmptyState } from '@backstage/core-components';
import { EntityRefLink } from '@backstage/plugin-catalog-react';
import { Chip, Grid, IconButton, Typography } from '@material-ui/core';
import ExpandMore from '@material-ui/icons/ExpandMore';
import ExpandLess from '@material-ui/icons/ExpandLess';
import type { Finding, HealthSeverity } from '../api/fleetApi';

const SEVERITY_COLOR: Record<HealthSeverity, string> = {
  critical: '#e5484d',
  warning: '#f5a524',
  info: '#8b8d98',
};

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

const FindingRow = ({
  finding,
  active,
  onSelect,
}: {
  finding: Finding;
  active: boolean;
  onSelect?: (f: Finding) => void;
}) => {
  const inlineRefs = finding.agentRefs.slice(0, MAX_INLINE);
  const inlineSubjects = finding.subjects.slice(
    0,
    Math.max(0, MAX_INLINE - inlineRefs.length),
  );
  const overflow = finding.count - (inlineRefs.length + inlineSubjects.length);
  const selectable = !!onSelect && finding.agentRefs.length > 0;

  const header = (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      <SeverityDot severity={finding.severity} />
      <Typography variant="subtitle2" component="span">
        {finding.title}
      </Typography>
      <Chip size="small" label={finding.count} style={{ marginLeft: 8, height: 20 }} />
    </div>
  );

  return (
    <Grid item xs={12} data-testid={`finding-${finding.id}`}>
      {selectable ? (
        <button
          type="button"
          aria-pressed={active}
          onClick={() => onSelect!(finding)}
          title={`Filter the fleet to these ${finding.count}`}
          style={{
            display: 'block',
            width: '100%',
            textAlign: 'left',
            font: 'inherit',
            cursor: 'pointer',
            padding: '2px 6px',
            marginLeft: -6,
            borderRadius: 6,
            border: 'none',
            background: active ? 'rgba(128,128,128,0.16)' : 'transparent',
          }}
        >
          {header}
        </button>
      ) : (
        header
      )}
      <Typography
        variant="body2"
        color="textSecondary"
        style={{ margin: '2px 0 4px 16px' }}
      >
        {finding.detail}
      </Typography>
      <div style={{ marginLeft: 16 }}>
        {inlineRefs.map((ref, i) => (
          <span key={`e-${i}`} style={{ marginRight: 8 }}>
            <EntityRefLink entityRef={ref} />
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
  activeFindingId,
  onSelectFinding,
}: {
  findings: Finding[];
  total: number;
  activeFindingId?: string;
  onSelectFinding?: (f: Finding) => void;
}) => {
  const [open, setOpen] = useState(true);

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

  const totalCount = findings.reduce((n, f) => n + f.count, 0);
  return (
    <InfoCard
      title="Needs attention"
      subheader={`${totalCount} across ${findings.length} ${
        findings.length === 1 ? 'category' : 'categories'
      }`}
      action={
        <IconButton
          aria-label={open ? 'Collapse' : 'Expand'}
          onClick={() => setOpen(o => !o)}
        >
          {open ? <ExpandLess /> : <ExpandMore />}
        </IconButton>
      }
    >
      {open && (
        <Grid container spacing={1}>
          {findings.map(finding => (
            <FindingRow
              key={finding.id}
              finding={finding}
              active={activeFindingId === finding.id}
              onSelect={onSelectFinding}
            />
          ))}
        </Grid>
      )}
    </InfoCard>
  );
};
