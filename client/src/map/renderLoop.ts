import type { Unit } from '@shared/types';

type UnsubscribeFn = () => void;

// ---------------------------------------------------------------------------
// Unit scale
// ---------------------------------------------------------------------------
export let unitScale: number = 1.0;

export function setUnitScale(value: number): void {
  unitScale = value;
}

// ---------------------------------------------------------------------------
// Colors
// ---------------------------------------------------------------------------
const COLOR_ALPHA   = '#3b82f6';
const COLOR_BRAVO   = '#ef4444';
const COLOR_DAMAGED = '#f97316';
const COLOR_ATTACK  = '#f59e0b';
const COLOR_DEAD    = 'rgba(80,80,90,0.5)';
const COLOR_BG      = '#0d1117';

const ZONE_FILL_NEUTRAL = 'rgba(255,255,255,0.02)';
const ZONE_FILL_ALPHA   = 'rgba(59,130,246,0.04)';
const ZONE_FILL_BRAVO   = 'rgba(249,115,22,0.04)';
const ZONE_BORDER       = 'rgba(255,255,255,0.12)';
const ZONE_LABEL_COLOR  = 'rgba(255,255,255,0.35)';
const ZONE_CTRL_ALPHA   = 'rgba(59,130,246,0.7)';
const ZONE_CTRL_BRAVO   = 'rgba(249,115,22,0.7)';
const ZONE_CTRL_CONTEST = 'rgba(245,158,11,0.7)';

const LOW_HEALTH_THRESHOLD = 25;

// ---------------------------------------------------------------------------
// Layer 0b: Terrain (offscreen canvas, rebuilt on resize only)
// ---------------------------------------------------------------------------

let terrainCanvas: OffscreenCanvas | null = null;
let terrainW = 0;
let terrainH = 0;

const TERRAIN_COLS = 40;
const TERRAIN_ROWS = 30;

const TERRAIN_COLORS: readonly string[] = [
  '#141c12', // plains
  '#16140f', // hills
  '#121216', // mountains
  '#0c141c', // water
];

function buildTerrainCanvas(W: number, H: number): OffscreenCanvas {
  const oc = new OffscreenCanvas(W, H);
  const tctx = oc.getContext('2d');
  if (!tctx) return oc;

  const cw = W / TERRAIN_COLS;
  const ch = H / TERRAIN_ROWS;

  for (let row = 0; row < TERRAIN_ROWS; row++) {
    for (let col = 0; col < TERRAIN_COLS; col++) {
      const hash = (col * 17 + row * 31 + col * row * 7) % 16;
      let colorIdx: number;
      if (hash < 7)       colorIdx = 0;
      else if (hash < 11) colorIdx = 1;
      else if (hash < 14) colorIdx = 2;
      else                colorIdx = 3;

      tctx.fillStyle = TERRAIN_COLORS[colorIdx] ?? '#141c12';
      tctx.fillRect(col * cw, row * ch, cw + 1, ch + 1);
    }
  }
  return oc;
}

// ---------------------------------------------------------------------------
// Layer 1: Sectors A1/A2/B1/B2
// ---------------------------------------------------------------------------

type SectorId = 'A1' | 'A2' | 'B1' | 'B2';

interface SectorBounds {
  x0: number; y0: number; x1: number; y1: number;
}

const SECTORS: Record<SectorId, SectorBounds> = {
  A1: { x0: 0,   y0: 0,   x1: 0.5, y1: 0.5 },
  A2: { x0: 0.5, y0: 0,   x1: 1,   y1: 0.5 },
  B1: { x0: 0,   y0: 0.5, x1: 0.5, y1: 1   },
  B2: { x0: 0.5, y0: 0.5, x1: 1,   y1: 1   },
};

const SECTOR_IDS: SectorId[] = ['A1', 'A2', 'B1', 'B2'];

function sectorOf(u: Unit): SectorId {
  const right  = u.x >= 0.5;
  const bottom = u.y >= 0.5;
  if (!right && !bottom) return 'A1';
  if ( right && !bottom) return 'A2';
  if (!right &&  bottom) return 'B1';
  return 'B2';
}

function computeSectorDominance(
  units: Map<string, Unit>,
): Record<SectorId, 'alpha' | 'bravo' | 'neutral'> {
  const alphaCount: Record<SectorId, number> = { A1: 0, A2: 0, B1: 0, B2: 0 };
  const bravoCount: Record<SectorId, number> = { A1: 0, A2: 0, B1: 0, B2: 0 };

  for (const u of units.values()) {
    if (u.status === 'destroyed') continue;
    const s = sectorOf(u);
    if (u.team === 'alpha') alphaCount[s]++;
    else                    bravoCount[s]++;
  }

  const result = {} as Record<SectorId, 'alpha' | 'bravo' | 'neutral'>;
  for (const s of SECTOR_IDS) {
    const a = alphaCount[s];
    const b = bravoCount[s];
    const total = a + b;
    if (total === 0) {
      result[s] = 'neutral';
    } else if (a / total > 0.6) {
      result[s] = 'alpha';
    } else if (b / total > 0.6) {
      result[s] = 'bravo';
    } else {
      result[s] = 'neutral';
    }
  }
  return result;
}

function drawSectors(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  dominance: Record<SectorId, 'alpha' | 'bravo' | 'neutral'>,
): void {
  ctx.save();

  for (const s of SECTOR_IDS) {
    const b  = SECTORS[s];
    const px = b.x0 * W;
    const py = b.y0 * H;
    const pw = (b.x1 - b.x0) * W;
    const ph = (b.y1 - b.y0) * H;

    switch (dominance[s]) {
      case 'alpha': ctx.fillStyle = ZONE_FILL_ALPHA;   break;
      case 'bravo': ctx.fillStyle = ZONE_FILL_BRAVO;   break;
      default:      ctx.fillStyle = ZONE_FILL_NEUTRAL;
    }
    ctx.fillRect(px, py, pw, ph);

    ctx.strokeStyle = ZONE_BORDER;
    ctx.lineWidth   = 1;
    ctx.strokeRect(px, py, pw, ph);

    ctx.font         = '11px Inter, system-ui, sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillStyle    = ZONE_LABEL_COLOR;
    ctx.fillText(s, px + 8, py + 8);

    ctx.font = '9px Inter, system-ui, sans-serif';
    const ctrl = dominance[s];
    if (ctrl === 'alpha') {
      ctx.fillStyle   = ZONE_CTRL_ALPHA;
      ctx.globalAlpha = 1;
      ctx.fillText('[ALPHA]', px + 30, py + 9);
    } else if (ctrl === 'bravo') {
      ctx.fillStyle   = ZONE_CTRL_BRAVO;
      ctx.globalAlpha = 1;
      ctx.fillText('[BRAVO]', px + 30, py + 9);
    } else {
      ctx.fillStyle   = ZONE_CTRL_CONTEST;
      ctx.globalAlpha = 0.5;
      ctx.fillText('[CONTESTED]', px + 30, py + 9);
      ctx.globalAlpha = 1;
    }
  }

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Layer 2: Base locations
// ---------------------------------------------------------------------------

interface MapBase {
  id: string;
  label: string;
  team: 'alpha' | 'bravo';
  x: number;
  y: number;
  radius: number;
}

const MAP_BASES: MapBase[] = [
  { id: 'alpha-hq',     label: 'Alpha HQ',  team: 'alpha', x: 0.12, y: 0.15, radius: 30 },
  { id: 'alpha-fwd',    label: 'Alpha Fwd', team: 'alpha', x: 0.35, y: 0.45, radius: 20 },
  { id: 'alpha-supply', label: 'Supply A',  team: 'alpha', x: 0.08, y: 0.72, radius: 18 },
  { id: 'bravo-hq',     label: 'Bravo HQ',  team: 'bravo', x: 0.88, y: 0.85, radius: 30 },
  { id: 'bravo-fwd',    label: 'Bravo Fwd', team: 'bravo', x: 0.65, y: 0.55, radius: 20 },
  { id: 'bravo-supply', label: 'Supply B',  team: 'bravo', x: 0.92, y: 0.28, radius: 18 },
];

function drawBases(ctx: CanvasRenderingContext2D, W: number, H: number): void {
  ctx.save();
  ctx.font         = '10px Inter, system-ui, sans-serif';
  ctx.textAlign    = 'center';
  ctx.textBaseline = 'bottom';

  for (const base of MAP_BASES) {
    const px    = base.x * W;
    const py    = base.y * H;
    const color = base.team === 'alpha' ? COLOR_ALPHA : COLOR_BRAVO;

    // Influence ring (dashed)
    ctx.beginPath();
    ctx.arc(px, py, base.radius, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.2;
    ctx.setLineDash([4, 4]);
    ctx.lineWidth   = 1;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    // Diamond marker
    ctx.beginPath();
    ctx.moveTo(px,     py - 5);
    ctx.lineTo(px + 4, py);
    ctx.lineTo(px,     py + 5);
    ctx.lineTo(px - 4, py);
    ctx.closePath();
    ctx.fillStyle   = color;
    ctx.globalAlpha = 0.9;
    ctx.fill();
    ctx.globalAlpha = 1;

    // Label
    ctx.fillStyle   = color;
    ctx.globalAlpha = 0.8;
    ctx.fillText(base.label, px, py - 7);
    ctx.globalAlpha = 1;
  }

  ctx.textAlign    = 'start';
  ctx.textBaseline = 'alphabetic';
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Layer 3: Combat hotspots (20x20 grid, Float32Array)
// ---------------------------------------------------------------------------

const HOTSPOT_COLS  = 20;
const HOTSPOT_ROWS  = 20;
const hotspotGrid   = new Float32Array(HOTSPOT_COLS * HOTSPOT_ROWS);
const HOTSPOT_DECAY = 0.002;
const HOTSPOT_HIT   = 0.18;

export function addHotspot(x: number, y: number): void {
  const col = Math.min(HOTSPOT_COLS - 1, (x * HOTSPOT_COLS) | 0);
  const row = Math.min(HOTSPOT_ROWS - 1, (y * HOTSPOT_ROWS) | 0);
  const idx = row * HOTSPOT_COLS + col;
  hotspotGrid[idx] = Math.min(1, (hotspotGrid[idx] ?? 0) + HOTSPOT_HIT);
}

function drawHotspots(ctx: CanvasRenderingContext2D, W: number, H: number, now: number): void {
  const cw = W / HOTSPOT_COLS;
  const ch = H / HOTSPOT_ROWS;

  ctx.save();
  for (let i = 0; i < hotspotGrid.length; i++) {
    const v = hotspotGrid[i] ?? 0;
    if (v < 0.05) {
      if (v > 0) hotspotGrid[i] = Math.max(0, v - HOTSPOT_DECAY);
      continue;
    }

    const col = i % HOTSPOT_COLS;
    const row = (i / HOTSPOT_COLS) | 0;
    const cx  = (col + 0.5) * cw;
    const cy  = (row + 0.5) * ch;

    const pulse  = Math.sin(now * 0.003) * 0.12 + 0.88;
    const radius = cw * 0.7 * v * pulse;

    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    const alphaVal = (v * 0.3).toFixed(2);
    grad.addColorStop(0, 'rgba(239,68,68,' + alphaVal + ')');
    grad.addColorStop(1, 'rgba(239,68,68,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();

    hotspotGrid[i] = Math.max(0, v - HOTSPOT_DECAY);
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Layer 5: Pulse system
// ---------------------------------------------------------------------------

export type PulseType = 'attack' | 'destroy' | 'heal';

interface Pulse {
  x: number;
  y: number;
  startTime: number;
  color: string;
}

const PULSE_DURATION_MS = 800;
const PULSE_MAX_RADIUS  = 12;

const activePulses = new Map<string, Pulse>();

const PULSE_COLORS: Record<PulseType, string> = {
  attack:  '#f59e0b',
  destroy: '#ef4444',
  heal:    '#22c55e',
};

export function addPulse(
  unitId: string,
  x: number,
  y: number,
  type: PulseType,
): void {
  activePulses.set(unitId, {
    x,
    y,
    startTime: performance.now(),
    color: PULSE_COLORS[type],
  });
  if (type === 'attack' || type === 'destroy') {
    addHotspot(x, y);
  }
}

function drawPulses(ctx: CanvasRenderingContext2D, W: number, H: number, now: number): void {
  const expired: string[] = [];

  ctx.save();
  for (const [id, pulse] of activePulses) {
    const age = now - pulse.startTime;
    if (age >= PULSE_DURATION_MS) {
      expired.push(id);
      continue;
    }

    const progress = age / PULSE_DURATION_MS;
    const radius   = progress * PULSE_MAX_RADIUS;
    const opacity  = (1 - progress) * 0.8;

    ctx.beginPath();
    ctx.arc(
      (pulse.x * W) | 0,
      (pulse.y * H) | 0,
      radius,
      0,
      Math.PI * 2,
    );
    ctx.strokeStyle = pulse.color;
    ctx.globalAlpha = opacity;
    ctx.lineWidth   = 1.5;
    ctx.stroke();
  }
  ctx.restore();

  for (const id of expired) activePulses.delete(id);
}

// ---------------------------------------------------------------------------
// Layer 6: Selected unit highlight
// ---------------------------------------------------------------------------

function drawSelection(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  units: Map<string, Unit>,
  selectedId: string | null,
): void {
  if (!selectedId) return;
  const unit = units.get(selectedId);
  if (!unit) return;

  const px  = (unit.x * W) | 0;
  const py  = (unit.y * H) | 0;
  const ARM = 10;
  const GAP = 4;

  ctx.save();

  // Outer glow
  ctx.beginPath();
  ctx.arc(px, py, GAP + ARM + 3, 0, Math.PI * 2);
  ctx.strokeStyle = '#60a5fa';
  ctx.globalAlpha = 0.3;
  ctx.lineWidth   = 8;
  ctx.stroke();

  // Crosshair
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth   = 1.5;
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.moveTo(px - GAP - ARM, py);
  ctx.lineTo(px - GAP,       py);
  ctx.moveTo(px + GAP,       py);
  ctx.lineTo(px + GAP + ARM, py);
  ctx.moveTo(px, py - GAP - ARM);
  ctx.lineTo(px, py - GAP);
  ctx.moveTo(px, py + GAP);
  ctx.lineTo(px, py + GAP + ARM);
  ctx.stroke();

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Main render loop
// ---------------------------------------------------------------------------

export function startRenderLoop(
  canvas: HTMLCanvasElement,
  getMap: () => Map<string, Unit>,
  subscribe: (cb: () => void) => UnsubscribeFn,
  getSelectedId: () => string | null,
  subscribeSelection: (cb: () => void) => UnsubscribeFn,
): UnsubscribeFn {
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => { /* no-op */ };

  let dirty = true;
  let rafId = 0;

  const unsubscribeUnits     = subscribe(() => { dirty = true; });
  const unsubscribeSelection = subscribeSelection(() => { dirty = true; });

  function hasPulses(): boolean {
    return activePulses.size > 0;
  }

  function hasActiveHotspots(): boolean {
    for (let i = 0; i < hotspotGrid.length; i++) {
      if ((hotspotGrid[i] ?? 0) >= 0.05) return true;
    }
    return false;
  }

  function draw(): void {
    const W          = canvas.width;
    const H          = canvas.height;
    const units      = getMap();
    const now        = performance.now();
    const scale      = unitScale;
    const selectedId = getSelectedId();

    // Layer 0: Background
    ctx.fillStyle = COLOR_BG;
    ctx.fillRect(0, 0, W, H);

    // Layer 0b: Terrain
    if (!terrainCanvas || terrainW !== W || terrainH !== H) {
      terrainCanvas = buildTerrainCanvas(W, H);
      terrainW = W;
      terrainH = H;
    }
    ctx.drawImage(terrainCanvas, 0, 0);

    // Layer 1: Sectors
    const dominance = computeSectorDominance(units);
    drawSectors(ctx, W, H, dominance);

    // Layer 2: Bases
    drawBases(ctx, W, H);

    // Layer 3: Hotspots
    drawHotspots(ctx, W, H, now);

    // Layer 4: Units (5 passes — sizes precomputed once per frame)
    const size3 = Math.max(1, Math.round(3 * scale));
    const size4 = Math.max(1, Math.round(4 * scale));
    const size1 = Math.max(1, Math.round(1 * scale));

    // Pass 1: alpha healthy
    ctx.fillStyle = COLOR_ALPHA;
    for (const u of units.values()) {
      if (u.team !== 'alpha') continue;
      if (u.status === 'destroyed' || u.status === 'attacking') continue;
      if (u.health < LOW_HEALTH_THRESHOLD) continue;
      ctx.fillRect((u.x * W) | 0, (u.y * H) | 0, size3, size3);
    }

    // Pass 2: bravo healthy
    ctx.fillStyle = COLOR_BRAVO;
    for (const u of units.values()) {
      if (u.team !== 'bravo') continue;
      if (u.status === 'destroyed' || u.status === 'attacking') continue;
      if (u.health < LOW_HEALTH_THRESHOLD) continue;
      ctx.fillRect((u.x * W) | 0, (u.y * H) | 0, size3, size3);
    }

    // Pass 3: damaged (either team, health < 25)
    ctx.fillStyle = COLOR_DAMAGED;
    for (const u of units.values()) {
      if (u.status === 'destroyed' || u.status === 'attacking') continue;
      if (u.health >= LOW_HEALTH_THRESHOLD) continue;
      ctx.fillRect((u.x * W) | 0, (u.y * H) | 0, size3, size3);
    }

    // Pass 4: attacking
    ctx.fillStyle = COLOR_ATTACK;
    for (const u of units.values()) {
      if (u.status !== 'attacking') continue;
      ctx.fillRect((u.x * W) | 0, (u.y * H) | 0, size4, size4);
    }

    // Pass 5: destroyed
    ctx.fillStyle = COLOR_DEAD;
    for (const u of units.values()) {
      if (u.status !== 'destroyed') continue;
      ctx.fillRect((u.x * W) | 0, (u.y * H) | 0, size1, size1);
    }

    // Layer 5: Pulses
    drawPulses(ctx, W, H, now);

    // Layer 6: Selection highlight
    drawSelection(ctx, W, H, units, selectedId);
  }

  function frame(): void {
    if (dirty || hasPulses() || hasActiveHotspots()) {
      draw();
      dirty = false;
    }
    rafId = requestAnimationFrame(frame);
  }

  rafId = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(rafId);
    unsubscribeUnits();
    unsubscribeSelection();
  };
}
