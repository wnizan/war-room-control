import type { KPISummary } from '@shared/types';

type Listener = () => void;

const DEFAULT_KPI: KPISummary = {
  seq: 0,
  aliveAlpha: 0,
  aliveBravo: 0,
  destroyedAlpha: 0,
  destroyedBravo: 0,
  zoneControl: { alpha: 50, bravo: 50 },
};

class KpiStore {
  private _kpi: KPISummary = DEFAULT_KPI;
  private _listeners = new Set<Listener>();

  subscribe = (listener: Listener): (() => void) => {
    this._listeners.add(listener);
    return () => { this._listeners.delete(listener); };
  };

  getSnapshot = (): KPISummary => this._kpi;

  update(kpi: KPISummary): void {
    // Skip notification if meaningful values haven't changed (seq always changes)
    if (
      this._kpi.aliveAlpha === kpi.aliveAlpha &&
      this._kpi.aliveBravo === kpi.aliveBravo &&
      this._kpi.destroyedAlpha === kpi.destroyedAlpha &&
      this._kpi.destroyedBravo === kpi.destroyedBravo &&
      this._kpi.zoneControl.alpha === kpi.zoneControl.alpha &&
      this._kpi.zoneControl.bravo === kpi.zoneControl.bravo
    ) {
      return;
    }

    this._kpi = kpi;
    for (const l of this._listeners) l();
  }
}

export const kpiStore = new KpiStore();
