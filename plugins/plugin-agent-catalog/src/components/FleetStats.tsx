/**
 * Summary stat tiles above the fleet table. Current-state counts only (no
 * trends/charts — that stays enterprise). Tiles with a filter are clickable
 * and toggle the fleet's active filter.
 */

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
      const color = tile.tone ? TONE_COLOR[tile.tone] : undefined;
      return (
        <button
          key={tile.id}
          type="button"
          disabled={!clickable}
          aria-pressed={active}
          onClick={() => clickable && onToggle(tile.id)}
          style={{
            textAlign: 'left',
            font: 'inherit',
            padding: '10px 14px',
            borderRadius: 8,
            border: active
              ? `1px solid ${color ?? '#8b8d98'}`
              : '1px solid transparent',
            background: 'rgba(128,128,128,0.10)',
            cursor: clickable ? 'pointer' : 'default',
            opacity: !tile.filter || value > 0 ? 1 : 0.55,
          }}
        >
          <div style={{ fontSize: 13, opacity: 0.75, marginBottom: 2 }}>
            {tile.ghost && <GhostIcon />} {tile.label}
          </div>
          <div style={{ fontSize: 24, fontWeight: 500, color }}>{value}</div>
        </button>
      );
    })}
  </div>
);
