import type { PulseType } from '../map/renderLoop';

export interface PulseEntry {
  id: string;
  x: number;
  y: number;
  type: PulseType;
}

type Listener = () => void;

class PulsesStore {
  private _queue: PulseEntry[] = [];
  private _listeners = new Set<Listener>();

  enqueue(entry: PulseEntry): void {
    this._queue.push(entry);
    for (const l of this._listeners) l();
  }

  drain(): PulseEntry[] {
    const q = this._queue;
    this._queue = [];
    return q;
  }

  subscribe = (listener: Listener): (() => void) => {
    this._listeners.add(listener);
    return () => { this._listeners.delete(listener); };
  };
}

export const pulsesStore = new PulsesStore();
