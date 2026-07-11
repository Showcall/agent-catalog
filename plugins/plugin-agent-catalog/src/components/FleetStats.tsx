/**
 * Summary stat tiles above the fleet table. Current-state counts only (no
 * trends/charts — those remain future scope). Tiles with a filter are clickable
 * and toggle the fleet's active filter.
 */

import { Typography } from '@material-ui/core';
import { GhostIcon } from './GhostIcon';
import { TILES, type FleetStats, type FilterTone } from './fleetView';

const TONE_COLOR: Record<FilterTone, string> = {
  accent: '#7f77dd',
  danger: '#e5484d',
  warning: '#f5a524',
};

export const FleetStatsBar = ({
  stats,
  activeId,
  onToggle,
}: {
  stats: FleetStats;
  activeId?: string;
  onToggle: (tileId: string) => void;
}) => (
  <div
    style={{
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
      gap: 10,
      marginBottom: 16,
    }}
  >
    {TILES.map(tile => {
      const value = stats[tile.stat];
      const clickable = !!tile.filter && value > 0;
      const active = activeId === tile.id;
      // Tone the number only when there's something to see; a "0" shouldn't
      // read as an alert. All tiles stay fully legible regardless.
      const color = tile.tone && value > 0 ? TONE_COLOR[tile.tone] : undefined;
      return (
        <button
          key={tile.id}
          type="button"
          aria-pressed={active}
          onClick={() => clickable && onToggle(tile.id)}
          style={{
            textAlign: 'left',
            font: 'inherit',
            color: 'inherit',
            padding: '10px 14px',
            borderRadius: 8,
            border: active
              ? `1px solid ${color ?? '#8b8d98'}`
              : '1px solid transparent',
            background: 'rgba(128,128,128,0.10)',
            cursor: clickable ? 'pointer' : 'default',
          }}
        >
          <Typography
            variant="caption"
            color="textSecondary"
            component="div"
            style={{ marginBottom: 2 }}
          >
            {tile.ghost && <GhostIcon />} {tile.label}
          </Typography>
          <Typography variant="h5" component="div" style={{ fontWeight: 500, color }}>
            {value}
          </Typography>
        </button>
      );
    })}
  </div>
);
