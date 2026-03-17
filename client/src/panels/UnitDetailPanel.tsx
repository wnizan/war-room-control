import { useSyncExternalStore } from 'react';
import { selectionStore } from '../store/selectionStore';
import { unitsStore } from '../store/unitsStore';
import type { Unit } from '@shared/types';

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

export function UnitDetailPanel() {
  const selectedId = useSyncExternalStore(selectionStore.subscribe, selectionStore.getSnapshot);
  const snapshot   = useSyncExternalStore(unitsStore.subscribe, unitsStore.getSnapshot);
  const unit: Unit | null = selectedId != null ? (snapshot.ref.get(selectedId) ?? null) : null;

  const isAlpha   = unit?.team === 'alpha';
  const teamColor = isAlpha ? '#3b82f6' : '#ef4444';
  const hpPct     = unit?.health ?? 0;
  const hpColor   = hpPct > 50 ? '#22c55e' : hpPct > 25 ? '#f97316' : '#ef4444';

  return (
    <div className="panel unit-detail-panel">
      <div className="panel-header">
        <span className="panel-header-title">Unit Intel</span>
      </div>
      {unit === null ? (
        <div className="unit-detail-empty">Click a unit on the map</div>
      ) : (
        <div className="unit-detail-body">
          <div className="unit-detail-name" style={{ color: teamColor }}>{unit.name}</div>
          <div className="unit-detail-row">
            <span className="unit-detail-label">Team</span>
            <span className="unit-detail-value" style={{ color: teamColor }}>
              {unit.team.toUpperCase()}
            </span>
          </div>
          <div className="unit-detail-row">
            <span className="unit-detail-label">Type</span>
            <span className="unit-detail-value">{unit.type.toUpperCase()}</span>
          </div>
          <div className="unit-detail-row">
            <span className="unit-detail-label">Status</span>
            <span className="unit-detail-value">{STATUS_LABEL[unit.status] ?? unit.status}</span>
          </div>
          <div className="unit-detail-row unit-detail-hp-row">
            <span className="unit-detail-label">HP</span>
            <div className="unit-detail-bar-wrap">
              <div
                className="unit-detail-bar-fill"
                style={{ width: `${hpPct}%`, background: hpColor }}
              />
            </div>
            <span className="unit-detail-value">{unit.health} / 100</span>
          </div>
          <div className="unit-detail-row">
            <span className="unit-detail-label">Sector</span>
            <span className="unit-detail-value">{sectorOf(unit)}</span>
          </div>
          <div className="unit-detail-row">
            <span className="unit-detail-label">Position</span>
            <span className="unit-detail-value">
              ({unit.x.toFixed(3)}, {unit.y.toFixed(3)})
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
