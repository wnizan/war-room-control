import type { ServerMessage } from '@shared/types';
import { unitsStore } from '../store/unitsStore';
import { kpiStore } from '../store/kpiStore';
import { eventsStore } from '../store/eventsStore';
import { recordTickUpdate } from '../observability/usePerformanceMetrics';
import { addPulse } from '../map/renderLoop';

const WS_URL = import.meta.env.DEV
  ? 'ws://localhost:3001'
  : `ws://${window.location.host}`;

const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 8_000;

let ws: WebSocket | null = null;
let reconnectDelay = BASE_DELAY_MS;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';
let _status: ConnectionStatus = 'disconnected';
const _statusListeners = new Set<(s: ConnectionStatus) => void>();

function setStatus(s: ConnectionStatus): void {
  _status = s;
  for (const l of _statusListeners) l(s);
}

export function getConnectionStatus(): ConnectionStatus { return _status; }

export function onConnectionStatus(cb: (s: ConnectionStatus) => void): () => void {
  _statusListeners.add(cb);
  return () => { _statusListeners.delete(cb); };
}

function scheduleReconnect(): void {
  if (reconnectTimer !== null) return;
  setStatus('reconnecting');
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_DELAY_MS);
    connect();
  }, reconnectDelay);
}

function connect(): void {
  if (ws !== null && ws.readyState <= WebSocket.OPEN) return;
  setStatus('connecting');

  ws = new WebSocket(WS_URL);

  ws.onmessage = ({ data }: MessageEvent<string>) => {
    const msg = JSON.parse(data) as ServerMessage;

    switch (msg.type) {
      case 'snapshot': {
        const { seq, units, kpi } = msg.payload;
        unitsStore.applySnapshot(units, seq);
        kpiStore.update(kpi);
        reconnectDelay = BASE_DELAY_MS;
        setStatus('connected');
        break;
      }
      case 'tick': {
        const { seq, units, kpi, events } = msg.payload;
        recordTickUpdate();
        const needsResync = unitsStore.applyDeltas(units, seq);
        if (needsResync) {
          ws?.close();
          return;
        }
        kpiStore.update(kpi);
        eventsStore.addEvents(events);

        // Register pulses for each event so the canvas can animate them.
        // GameEvent carries sourceId / targetId — we resolve positions from
        // the live unit map (already updated by applyDeltas above).
        const liveUnits = unitsStore.getMap();
        for (const ev of events) {
          // Prefer targetId for attack/destroy events; fall back to sourceId.
          const resolveId = ev.targetId ?? ev.sourceId;
          if (resolveId === undefined) continue;

          const unit = liveUnits.get(resolveId);
          if (unit === undefined) continue;

          switch (ev.type) {
            case 'attack':
              addPulse(ev.id, unit.x, unit.y, 'attack');
              break;
            case 'destroyed':
              addPulse(ev.id, unit.x, unit.y, 'destroy');
              break;
            case 'heal':
              addPulse(ev.id, unit.x, unit.y, 'heal');
              break;
            // 'capture' — no pulse by design; extend here if needed
          }
        }
        break;
      }
      case 'error':
        console.error('[ws] server error:', msg.payload.message);
        break;
    }
  };

  ws.onopen = () => { setStatus('connecting'); }; // awaiting snapshot
  ws.onclose = () => scheduleReconnect();
  ws.onerror = () => { ws?.close(); };
}

export function startSync(): void {
  connect();
}
