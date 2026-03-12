import type { UnitStatus } from '@shared/types';

type Listener = () => void;

export interface Filters {
  status: UnitStatus | 'all';
  healthMin: number;
  healthMax: number;
  name: string;
}

const DEFAULT_FILTERS: Filters = {
  status: 'all',
  healthMin: 0,
  healthMax: 100,
  name: '',
};

class FiltersStore {
  private _filters: Filters = { ...DEFAULT_FILTERS };
  private _listeners = new Set<Listener>();

  subscribe = (listener: Listener): (() => void) => {
    this._listeners.add(listener);
    return () => { this._listeners.delete(listener); };
  };

  getSnapshot = (): Filters => this._filters;

  set<K extends keyof Filters>(key: K, value: Filters[K]): void {
    this._filters = { ...this._filters, [key]: value };
    for (const l of this._listeners) l();
  }

  reset(): void {
    this._filters = { ...DEFAULT_FILTERS };
    for (const l of this._listeners) l();
  }
}

export const filtersStore = new FiltersStore();
