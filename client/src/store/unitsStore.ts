import type { Unit, UnitDelta } from '@shared/types';

type Listener = () => void;
type DeltaListener = (deltas: UnitDelta[]) => void;
type Snapshot = { ref: Map<string, Unit>; version: number };

class UnitsStore {
  private _map = new Map<string, Unit>();
  private _seq = -1;
  private _version = 0;
  private _listeners = new Set<Listener>();
  private _deltaListeners = new Set<DeltaListener>();
  private _snapshotListeners = new Set<Listener>();
  private _snapshot: Snapshot = { ref: this._map, version: 0 };

  /** For useSyncExternalStore — new reference on every update */
  subscribe = (listener: Listener): (() => void) => {
    this._listeners.add(listener);
    return () => { this._listeners.delete(listener); };
  };

  /** Called with raw deltas after the map is mutated — for WebGL partial uploads */
  subscribeDelta = (listener: DeltaListener): (() => void) => {
    this._deltaListeners.add(listener);
    return () => { this._deltaListeners.delete(listener); };
  };

  /** Called only when a full snapshot arrives (resync) — for WebGL full reload */
  subscribeSnapshot = (listener: Listener): (() => void) => {
    this._snapshotListeners.add(listener);
    return () => { this._snapshotListeners.delete(listener); };
  };

  getSnapshot = (): Snapshot => this._snapshot;

  /** For canvas render loop — always the live mutable map */
  getMap = (): Map<string, Unit> => this._map;

  getSeq = (): number => this._seq;

  applySnapshot(units: Unit[], seq: number): void {
    // Reuse existing map — clear and repopulate to avoid allocating a new 20k-entry Map.
    // This keeps GC pressure low and avoids a heap spike from two live Maps.
    this._map.clear();
    for (const u of units) {
      this._map.set(u.id, u);
    }
    this._seq = seq;
    for (const l of this._snapshotListeners) l();
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
    for (const l of this._deltaListeners) l(deltas);
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
