import { createServer } from 'http';
import { generateUnits } from './simulation/units.js';
import { computeTick, computeKPI } from './simulation/tick.js';
import { WsTransport } from './transport/websocket.js';
import { createRequestHandler } from './api/routes.js';

const PORT = 3001;
const TICK_MS = 1000;
const UNIT_COUNT = 20_000;

// ── Simulation state ─────────────────────────────────────────────────────────
console.log(`[boot] Generating ${UNIT_COUNT} units...`);
const units = generateUnits(UNIT_COUNT);
let seq = 0;
console.log(`[boot] ${units.size} units ready.`);

// ── HTTP + WebSocket server ───────────────────────────────────────────────────
const httpServer = createServer(createRequestHandler(() => units));

const ws = new WsTransport(httpServer, () => ({
  units: Array.from(units.values()),
  kpi: computeKPI(units, seq),
  seq,
}));

// ── Simulation loop ───────────────────────────────────────────────────────────
setInterval(() => {
  seq++;
  const tick = computeTick(units, seq);
  ws.broadcast(tick);

  if (seq % 10 === 0) {
    const { aliveAlpha, aliveBravo, destroyedAlpha, destroyedBravo } = tick.kpi;
    console.log(
      `[tick ${seq}] alive: α${aliveAlpha} β${aliveBravo} ` +
      `destroyed: α${destroyedAlpha} β${destroyedBravo} ` +
      `deltas: ${tick.units.length} events: ${tick.events.length} ` +
      `clients: ${ws.clientCount}`
    );
  }
}, TICK_MS);

// ── Start ─────────────────────────────────────────────────────────────────────
httpServer.listen(PORT, () => {
  console.log(`[ready] HTTP  → http://localhost:${PORT}`);
  console.log(`[ready] WS    → ws://localhost:${PORT}`);
  console.log(`[ready] Units → http://localhost:${PORT}/api/units`);
});
