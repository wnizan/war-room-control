import { WebSocketServer, WebSocket } from 'ws';
import type { IncomingMessage } from 'http';
import type { Server } from 'http';
import type { Unit, KPISummary, TickUpdate, ServerMessage, SnapshotMessage } from '../../../shared/types.js';

type SnapshotFn = () => { units: Unit[]; kpi: KPISummary; seq: number };

export class WsTransport {
  private wss: WebSocketServer;

  constructor(server: Server, getSnapshot: SnapshotFn) {
    this.wss = new WebSocketServer({ server });
    this.wss.on('connection', (ws: WebSocket, _req: IncomingMessage) => {
      this.sendSnapshot(ws, getSnapshot());
    });
  }

  private sendSnapshot(ws: WebSocket, snap: { units: Unit[]; kpi: KPISummary; seq: number }): void {
    const snapshot: SnapshotMessage = {
      type: 'snapshot',
      seq: snap.seq,
      units: snap.units,
      kpi: snap.kpi,
    };
    const msg: ServerMessage = { type: 'snapshot', payload: snapshot };
    ws.send(JSON.stringify(msg));
  }

  broadcast(tick: TickUpdate): void {
    if (this.wss.clients.size === 0) return;
    const msg: ServerMessage = { type: 'tick', payload: tick };
    const data = JSON.stringify(msg);

    for (const client of this.wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    }
  }

  get clientCount(): number {
    return this.wss.clients.size;
  }
}
