import type { Unit, UnitDelta } from '@shared/types';

type Listener = () => void;
type Snapshot = { ref: Map<string, Unit>; version: number };

class UnitsStore {
  private _map = new Map<string, Unit>();
  private _seq = -1;
  private _version = 0;
  private _listeners = new Set<Listener>();
  private _snapshot: Snapshot = { ref: this._map, version: 0 };

  /** For useSyncExternalStore — new reference on every update */
  subscribe = (listener: Listener): (() => void) => {
    this._listeners.add(listener);
    return () => { this._listeners.delete(listener); };
  };

  getSnapshot = (): Snapshot => this._snapshot;

  /** For canvas render loop — always the live mutable map */
  getMap = (): Map<string, Unit> => this._map;

  getSeq = (): number => this._seq;

  applySnapshot(units: Unit[], seq: number): void {
    this._map = new Map(units.map(u => [u.id, u]));
    this._seq = seq;
    this._bump();
  }

  /** Returns true if seq gap detected — caller should trigger resync */
  applyDeltas(deltas: UnitDelta[], seq: number): boolean {
    if (this._seq === -1) return true;
    if (seq !== this._seq + 1) {
      console.warn(`[units] seq gap: expected ${this._seq + 1}, got ${seq}`);
      return true;
    }
    for (const delta of deltas) {
      const unit = this._map.get(delta.id);
      if (!unit) continue;
      if (delta.status !== undefined) unit.status = delta.status;
      if (delta.health !== undefined) unit.health = delta.health;
      if (delta.x !== undefined) unit.x = delta.x;
      if (delta.y !== undefined) unit.y = delta.y;
    }
    this._seq = seq;
    this._bump();
    return false;
  }

  private _bump(): void {
    this._version++;
    this._snapshot = { ref: this._map, version: this._version };
    for (const l of this._listeners) l();
  }
}

export const unitsStore = new UnitsStore();
