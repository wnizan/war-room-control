import { useSyncExternalStore } from 'react';
import type { GameEventType } from '@shared/types';
import { eventsStore } from '../store/eventsStore';

const EVENT_ICONS: Record<GameEventType, string> = {
  attack:    '⚔',
  destroyed: '💀',
  heal:      '✚',
  capture:   '⚑',
};

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m`;
}

export function EventFeed() {
  const events = useSyncExternalStore(eventsStore.subscribe, eventsStore.getSnapshot);

  return (
    <div className="panel event-feed">
      <div className="panel-header">
        <span className="panel-header-title">Events</span>
        <span className="kpi-sub">{events.length}</span>
      </div>
      <div className="panel-body event-list">
        {events.map(e => (
          <div key={e.id} className={`event-item event-type-${e.type}`}>
            <span className="event-icon">{EVENT_ICONS[e.type]}</span>
            <span className="event-detail">
              {e.detail ?? e.type}
              <span style={{ color: 'var(--color-text-muted)', marginLeft: 6 }}>
                {timeAgo(e.timestamp)}
              </span>
            </span>
          </div>
        ))}
        {events.length === 0 && (
          <div style={{ padding: 'var(--space-4)', color: 'var(--color-text-muted)', fontSize: 'var(--font-size-sm)' }}>
            Awaiting events…
          </div>
        )}
      </div>
    </div>
  );
}
