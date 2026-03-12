import { useSyncExternalStore } from 'react';
import { kpiStore } from '../store/kpiStore';

export function KpiStrip() {
  const kpi = useSyncExternalStore(kpiStore.subscribe, kpiStore.getSnapshot);

  const totalAlive     = kpi.aliveAlpha + kpi.aliveBravo;
  const totalDestroyed = kpi.destroyedAlpha + kpi.destroyedBravo;

  // Zone control: determine leader text
  const zoneLead = kpi.zoneControl.alpha > kpi.zoneControl.bravo
    ? 'alpha'
    : kpi.zoneControl.bravo > kpi.zoneControl.alpha
      ? 'bravo'
      : 'neutral';

  return (
    <div className="kpi-strip">
      <div className="kpi-card">
        <span className="kpi-label">Alpha Alive</span>
        <span className="kpi-value alpha">{kpi.aliveAlpha.toLocaleString()}</span>
        <span className="kpi-sub">α team active</span>
      </div>

      <div className="kpi-card">
        <span className="kpi-label">Bravo Alive</span>
        <span className="kpi-value bravo">{kpi.aliveBravo.toLocaleString()}</span>
        <span className="kpi-sub">β team active</span>
      </div>

      <div className="kpi-card">
        <span className="kpi-label">Total Alive</span>
        <span className="kpi-value zone">{totalAlive.toLocaleString()}</span>
        <span className="kpi-sub">of 20,000</span>
      </div>

      <div className="kpi-card">
        <span className="kpi-label">Destroyed</span>
        <span className="kpi-value destroyed">{totalDestroyed.toLocaleString()}</span>
        <span className="kpi-sub">α{kpi.destroyedAlpha} β{kpi.destroyedBravo}</span>
      </div>

      <div className="kpi-card">
        <span className="kpi-label">Zone Control</span>
        <span className={'kpi-value ' + zoneLead}>
          {kpi.zoneControl.alpha}% / {kpi.zoneControl.bravo}%
        </span>
        <span className="kpi-sub">α / β</span>
      </div>
    </div>
  );
}
