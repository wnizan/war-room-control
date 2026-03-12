import type { GameEvent } from '@shared/types';

type Listener = () => void;
const MAX_EVENTS = 50;

class EventsStore {
  private _events: GameEvent[] = [];
  private _listeners = new Set<Listener>();

  subscribe = (listener: Listener): (() => void) => {
    this._listeners.add(listener);
    return () => { this._listeners.delete(listener); };
  };

  getSnapshot = (): GameEvent[] => this._events;

  addEvents(incoming: GameEvent[]): void {
    if (incoming.length === 0) return;
    this._events = [...incoming, ...this._events].slice(0, MAX_EVENTS);
    for (const l of this._listeners) l();
  }

  clear(): void {
    this._events = [];
    for (const l of this._listeners) l();
  }
}

export const eventsStore = new EventsStore();
