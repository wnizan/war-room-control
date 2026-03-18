import { createServer } from 'http';
import { generateUnits } from './simulation/units.js';
import { computeTick, computeKPI } from './simulation/tick.js';
import { WsTransport } from './transport/websocket.js';
import { createRequestHandler } from './api/routes.js';

const PORT = 3001;
const BASE_TICK_MS = 1000;
let currentTickMs = BASE_TICK_MS;

// Allow override via UNIT_COUNT env var (e.g. UNIT_COUNT=5000 npm start)
// Clamps to [100, 100_000] to avoid degenerate values
const UNIT_COUNT = (() => {
  const raw = process.env['UNIT_COUNT'];
  if (raw) {
    const n = parseInt(raw, 10);
    if (!isNaN(n) && n >= 100 && n <= 100_000) return n;
  }
  return 20_000;
})();

// ── Simulation state ─────────────────────────────────────────────────────────
console.log(`[boot] Generating ${UNIT_COUNT} units...`);
let units = generateUnits(UNIT_COUNT);
let seq = 0;
console.log(`[boot] ${units.size} units ready.`);

// ── HTTP + WebSocket server ───────────────────────────────────────────────────
// ws is declared here so handleRestart (below) can close over it.
const httpServer = createServer(createRequestHandler(() => units, handleRestart, handleSpeed));

const ws = new WsTransport(httpServer, () => ({
  units: Array.from(units.values()),
  kpi: computeKPI(units, seq),
  seq,
}));

// ── Restart handler ───────────────────────────────────────────────────────────
function handleRestart(alphaRatio: number): void {
  console.log(`[restart] alphaRatio=${alphaRatio.toFixed(2)}`);
  units = generateUnits(UNIT_COUNT, alphaRatio);
  seq = 0;
  ws.broadcastSnapshot({
    units: Array.from(units.values()),
    kpi: computeKPI(units, seq),
    seq,
  });
  console.log(`[restart] Done. ${units.size} units regenerated.`);
}

// ── Speed handler ─────────────────────────────────────────────────────────────
function handleSpeed(multiplier: number): void {
  currentTickMs = Math.round(BASE_TICK_MS / multiplier);
  console.log(`[speed] x${multiplier} → tick every ${currentTickMs}ms`);
  restartLoop();
}

// ── Simulation loop ───────────────────────────────────────────────────────────
let loopHandle: ReturnType<typeof setInterval> | null = null;

function restartLoop(): void {
  if (loopHandle !== null) clearInterval(loopHandle);
  loopHandle = setInterval(() => {
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
  }, currentTickMs);
}

restartLoop();

// ── Start ─────────────────────────────────────────────────────────────────────
httpServer.listen(PORT, () => {
  console.log(`[ready] HTTP  → http://localhost:${PORT}`);
  console.log(`[ready] WS    → ws://localhost:${PORT}`);
  console.log(`[ready] Units → http://localhost:${PORT}/api/units`);
});
