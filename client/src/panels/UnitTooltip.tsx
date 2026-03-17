import type { Unit } from '@shared/types';

interface Props {
  unit: Unit;
  x: number;
  y: number;
}

const STATUS_LABEL: Record<string, string> = {
  active:    'ACTIVE',
  attacking: 'ENGAGING',
  moving:    'MOVING',
  idle:      'IDLE',
  destroyed: 'KIA',
};

function sectorOf(unit: Unit): string {
  const right  = unit.x >= 0.5;
  const bottom = unit.y >= 0.5;
  if (!right && !bottom) return 'A1';
  if ( right && !bottom) return 'A2';
  if (!right &&  bottom) return 'B1';
  return 'B2';
}

export function UnitTooltip({ unit, x, y }: Props) {
  const hpPct     = unit.health;
  const isAlpha   = unit.team === 'alpha';
  const teamColor = isAlpha ? '#3b82f6' : '#ef4444';
  const hpColor   = hpPct > 50 ? '#22c55e' : hpPct > 25 ? '#f97316' : '#ef4444';

  return (
    <div
      className="unit-tooltip"
      style={{ left: x, top: y - 8 }}
    >
      <div className="unit-tooltip-header" style={{ color: teamColor }}>
        {unit.name}
      </div>
      <div className="unit-tooltip-row">
        <span className="unit-tooltip-label">HP</span>
        <div className="unit-tooltip-bar-wrap">
          <div
            className="unit-tooltip-bar-fill"
            style={{ width: `${hpPct}%`, background: hpColor }}
          />
        </div>
        <span className="unit-tooltip-value">{unit.health}</span>
      </div>
      <div className="unit-tooltip-row">
        <span className="unit-tooltip-label">Status</span>
        <span className="unit-tooltip-value">{STATUS_LABEL[unit.status] ?? unit.status}</span>
      </div>
      <div className="unit-tooltip-row">
        <span className="unit-tooltip-label">Type</span>
        <span className="unit-tooltip-value">{unit.type.toUpperCase()}</span>
      </div>
      <div className="unit-tooltip-row">
        <span className="unit-tooltip-label">Sector</span>
        <span className="unit-tooltip-value">{sectorOf(unit)}</span>
      </div>
    </div>
  );
}
