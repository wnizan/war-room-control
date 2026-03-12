import type { Unit } from '@shared/types';

type UnsubscribeFn = () => void;

// ---------------------------------------------------------------------------
// Unit scale
// ---------------------------------------------------------------------------
export let unitScale: number = 1.0;

export function setUnitScale(value: number): void {
  unitScale = value;
  markDirty();
}

// ---------------------------------------------------------------------------
// Zoom state (viewport: offsetX/Y in normalised 0-1 space, zoom 1x-8x)
// ---------------------------------------------------------------------------
interface Viewport {
  zoom: number;   // 1 = full map, 8 = max zoom
  cx: number;     // centre of view, normalised 0-1
  cy: number;
}

let viewport: Viewport = { zoom: 1, cx: 0.5, cy: 0.5 };

export function setZoom(delta: number): void {
  const next = Math.min(8, Math.max(1, viewport.zoom * delta));
  viewport = { ...viewport, zoom: next };
  markDirty();
}

export function resetZoom(): void {
  viewport = { zoom: 1, cx: 0.5, cy: 0.5 };
  markDirty();
}

export function panViewport(dx: number, dy: number): void {
  // dx/dy are in normalised map units
  const halfW = 0.5 / viewport.zoom;
  const halfH = 0.5 / viewport.zoom;
  viewport = {
    ...viewport,
    cx: Math.min(1 - halfW, Math.max(halfW, viewport.cx + dx)),
    cy: Math.min(1 - halfH, Math.max(halfH, viewport.cy + dy)),
  };
  markDirty();
}

// Called by the render loop to transform normalised coords to canvas pixels
function toScreen(nx: number, ny: number, W: number, H: number): [number, number] {
  const { zoom, cx, cy } = viewport;
  const x = ((nx - cx) * zoom + 0.5) * W;
  const y = ((ny - cy) * zoom + 0.5) * H;
  return [x, y];
}

// Dirty flag — set by zoom/pan/scale so the render loop redraws
let _dirty = false;
function markDirty(): void { _dirty = true; }
export function consumeDirty(): boolean {
  if (_dirty) { _dirty = false; return true; }
  return false;
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
const ZONE_FILL_ALPHA   = 'rgba(59,130,246,0.06)';
const ZONE_FILL_BRAVO   = 'rgba(239,68,68,0.06)';
const ZONE_BORDER       = 'rgba(255,255,255,0.15)';
const ZONE_LABEL_COLOR  = 'rgba(255,255,255,0.45)';
const ZONE_CTRL_ALPHA   = 'rgba(96,165,250,0.9)';
const ZONE_CTRL_BRAVO   = 'rgba(248,113,113,0.9)';
const ZONE_CTRL_CONTEST = 'rgba(251,191,36,0.9)';

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
  '#141c12',
  '#16140f',
  '#121216',
  '#0c141c',
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
      let ci = 0;
      if (hash < 7) ci = 0; else if (hash < 11) ci = 1; else if (hash < 14) ci = 2; else ci = 3;
      tctx.fillStyle = TERRAIN_COLORS[ci] ?? '#141c12';
      tctx.fillRect(col * cw, row * ch, cw + 1, ch + 1);
    }
  }
  return oc;
}

// ---------------------------------------------------------------------------
// Layer 1: Sectors A1/A2/B1/B2
// ---------------------------------------------------------------------------

type SectorId = 'A1' | 'A2' | 'B1' | 'B2';

interface SectorBounds { x0: number; y0: number; x1: number; y1: number; }

const SECTORS: Record<SectorId, SectorBounds> = {
  A1: { x0: 0,   y0: 0,   x1: 0.5, y1: 0.5 },
  A2: { x0: 0.5, y0: 0,   x1: 1,   y1: 0.5 },
  B1: { x0: 0,   y0: 0.5, x1: 0.5, y1: 1   },
  B2: { x0: 0.5, y0: 0.5, x1: 1,   y1: 1   },
};

const SECTOR_IDS: SectorId[] = ['A1', 'A2', 'B1', 'B2'];

function sectorOf(u: Unit): SectorId {
  const right = u.x >= 0.5, bottom = u.y >= 0.5;
  if (!right && !bottom) return 'A1';
  if ( right && !bottom) return 'A2';
  if (!right &&  bottom) return 'B1';
  return 'B2';
}

function computeSectorDominance(units: Map<string, Unit>): Record<SectorId, 'alpha' | 'bravo' | 'neutral'> {
  const ac: Record<SectorId, number> = { A1: 0, A2: 0, B1: 0, B2: 0 };
  const bc: Record<SectorId, number> = { A1: 0, A2: 0, B1: 0, B2: 0 };
  for (const u of units.values()) {
    if (u.status === 'destroyed') continue;
    const s = sectorOf(u);
    if (u.team === 'alpha') ac[s]++; else bc[s]++;
  }
  const result = {} as Record<SectorId, 'alpha' | 'bravo' | 'neutral'>;
  for (const s of SECTOR_IDS) {
    const a = ac[s], b = bc[s], total = a + b;
    if (total === 0) result[s] = 'neutral';
    else if (a / total > 0.6) result[s] = 'alpha';
    else if (b / total > 0.6) result[s] = 'bravo';
    else result[s] = 'neutral';
  }
  return result;
}

function drawSectors(
  ctx: CanvasRenderingContext2D,
  W: number, H: number,
  dominance: Record<SectorId, 'alpha' | 'bravo' | 'neutral'>,
): void {
  ctx.save();
  for (const s of SECTOR_IDS) {
    const b  = SECTORS[s];
    const [px, py] = toScreen(b.x0, b.y0, W, H);
    const [px2, py2] = toScreen(b.x1, b.y1, W, H);
    const pw = px2 - px, ph = py2 - py;

    switch (dominance[s]) {
      case 'alpha': ctx.fillStyle = ZONE_FILL_ALPHA; break;
      case 'bravo': ctx.fillStyle = ZONE_FILL_BRAVO; break;
      default:      ctx.fillStyle = ZONE_FILL_NEUTRAL;
    }
    ctx.fillRect(px, py, pw, ph);

    ctx.strokeStyle = ZONE_BORDER;
    ctx.lineWidth   = 1;
    ctx.strokeRect(px, py, pw, ph);

    ctx.font = '11px Inter, system-ui, sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillStyle = ZONE_LABEL_COLOR;
    ctx.fillText(s, px + 8, py + 8);

    ctx.font = '9px Inter, system-ui, sans-serif';
    const ctrl = dominance[s];
    if (ctrl === 'alpha') {
      ctx.fillStyle = ZONE_CTRL_ALPHA; ctx.globalAlpha = 1;
      ctx.fillText('[ALPHA]', px + 30, py + 9);
    } else if (ctrl === 'bravo') {
      ctx.fillStyle = ZONE_CTRL_BRAVO; ctx.globalAlpha = 1;
      ctx.fillText('[BRAVO]', px + 30, py + 9);
    } else {
      ctx.fillStyle = ZONE_CTRL_CONTEST; ctx.globalAlpha = 0.7;
      ctx.fillText('[CONTESTED]', px + 30, py + 9);
      ctx.globalAlpha = 1;
    }
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Layer 2: Base locations — clearly marked with type badge
// ---------------------------------------------------------------------------

type BaseType = 'HQ' | 'FWD' | 'SUPPLY';

interface MapBase {
  id: string;
  label: string;
  shortType: BaseType;
  team: 'alpha' | 'bravo';
  x: number;
  y: number;
}

const MAP_BASES: MapBase[] = [
  { id: 'alpha-hq',     label: 'Alpha HQ',  shortType: 'HQ',     team: 'alpha', x: 0.12, y: 0.15 },
  { id: 'alpha-fwd',    label: 'Alpha Fwd', shortType: 'FWD',    team: 'alpha', x: 0.35, y: 0.45 },
  { id: 'alpha-supply', label: 'Supply A',  shortType: 'SUPPLY', team: 'alpha', x: 0.08, y: 0.72 },
  { id: 'bravo-hq',     label: 'Bravo HQ',  shortType: 'HQ',     team: 'bravo', x: 0.88, y: 0.85 },
  { id: 'bravo-fwd',    label: 'Bravo Fwd', shortType: 'FWD',    team: 'bravo', x: 0.65, y: 0.55 },
  { id: 'bravo-supply', label: 'Supply B',  shortType: 'SUPPLY', team: 'bravo', x: 0.92, y: 0.28 },
];

// Sizes per base type
const BASE_RADIUS: Record<BaseType, number> = { HQ: 42, FWD: 28, SUPPLY: 22 };
const BASE_ICON_SIZE: Record<BaseType, number> = { HQ: 10, FWD: 7, SUPPLY: 6 };

function drawBases(ctx: CanvasRenderingContext2D, W: number, H: number): void {
  ctx.save();

  for (const base of MAP_BASES) {
    const [px, py] = toScreen(base.x, base.y, W, H);
    const color     = base.team === 'alpha' ? COLOR_ALPHA : COLOR_BRAVO;
    const radius    = BASE_RADIUS[base.shortType];
    const iconSize  = BASE_ICON_SIZE[base.shortType];

    // ── Influence ring — solid, visible ──────────────────────────
    ctx.beginPath();
    ctx.arc(px, py, radius, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.globalAlpha = base.shortType === 'HQ' ? 0.5 : 0.35;
    ctx.setLineDash(base.shortType === 'HQ' ? [] : [5, 4]);
    ctx.lineWidth   = base.shortType === 'HQ' ? 1.5 : 1;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;

    // ── Inner filled circle (solid base "icon") ───────────────────
    ctx.beginPath();
    ctx.arc(px, py, iconSize, 0, Math.PI * 2);
    ctx.fillStyle   = color;
    ctx.globalAlpha = 0.9;
    ctx.fill();

    // ── Type letter inside icon ────────────────────────────────────
    if (base.shortType === 'HQ') {
      ctx.globalAlpha = 1;
      ctx.fillStyle   = '#000';
      ctx.font        = `bold ${iconSize}px Inter, system-ui, sans-serif`;
      ctx.textAlign   = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('HQ', px, py + 0.5);
    }
    ctx.globalAlpha = 1;

    // ── Outer glow for HQ ─────────────────────────────────────────
    if (base.shortType === 'HQ') {
      const grad = ctx.createRadialGradient(px, py, iconSize, px, py, radius * 0.8);
      grad.addColorStop(0, color.replace('#', 'rgba(') + ',0.08)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      // Simple approximation: just fill the area
      ctx.beginPath();
      ctx.arc(px, py, radius * 0.8, 0, Math.PI * 2);
      ctx.fillStyle   = color;
      ctx.globalAlpha = 0.06;
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // ── Label above ────────────────────────────────────────────────
    ctx.fillStyle    = '#fff';
    ctx.globalAlpha  = 0.9;
    ctx.font         = `bold ${base.shortType === 'HQ' ? 11 : 9}px Inter, system-ui, sans-serif`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(base.label, px, py - iconSize - 3);

    // ── Type badge below ───────────────────────────────────────────
    if (base.shortType !== 'HQ') {
      ctx.fillStyle   = color;
      ctx.globalAlpha = 0.8;
      ctx.font        = '8px Inter, system-ui, sans-serif';
      ctx.textBaseline = 'top';
      ctx.fillText(base.shortType, px, py + iconSize + 2);
    }
    ctx.globalAlpha = 1;
  }

  ctx.textAlign    = 'start';
  ctx.textBaseline = 'alphabetic';
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Layer 3: Combat hotspots — more prominent
// ---------------------------------------------------------------------------

const HOTSPOT_COLS  = 20;
const HOTSPOT_ROWS  = 20;
const hotspotGrid   = new Float32Array(HOTSPOT_COLS * HOTSPOT_ROWS);
const HOTSPOT_DECAY = 0.0015;
const HOTSPOT_HIT   = 0.22;

export function addHotspot(x: number, y: number): void {
  const col = Math.min(HOTSPOT_COLS - 1, (x * HOTSPOT_COLS) | 0);
  const row = Math.min(HOTSPOT_ROWS - 1, (y * HOTSPOT_ROWS) | 0);
  const idx = row * HOTSPOT_COLS + col;
  hotspotGrid[idx] = Math.min(1, (hotspotGrid[idx] ?? 0) + HOTSPOT_HIT);
}

function drawHotspots(ctx: CanvasRenderingContext2D, W: number, H: number, now: number): void {
  ctx.save();
  for (let i = 0; i < hotspotGrid.length; i++) {
    const v = hotspotGrid[i] ?? 0;
    if (v < 0.04) {
      if (v > 0) hotspotGrid[i] = Math.max(0, v - HOTSPOT_DECAY);
      continue;
    }

    const col = i % HOTSPOT_COLS;
    const row = (i / HOTSPOT_COLS) | 0;

    // Centre of this grid cell in normalised space
    const nx = (col + 0.5) / HOTSPOT_COLS;
    const ny = (row + 0.5) / HOTSPOT_ROWS;
    const [cx, cy] = toScreen(nx, ny, W, H);

    // Cell width in screen pixels
    const [x1] = toScreen(0, 0, W, H);
    const [x2] = toScreen(1 / HOTSPOT_COLS, 0, W, H);
    const cellPx = Math.abs(x2 - x1);

    const pulse  = Math.sin(now * 0.004) * 0.15 + 0.85;
    const radius = cellPx * 0.8 * v * pulse;

    // Outer ring (visible border)
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(239,68,68,' + (v * 0.7).toFixed(2) + ')';
    ctx.lineWidth   = 1;
    ctx.stroke();

    // Fill glow
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
    grad.addColorStop(0, 'rgba(239,68,68,' + (v * 0.45).toFixed(2) + ')');
    grad.addColorStop(0.5, 'rgba(239,68,68,' + (v * 0.2).toFixed(2) + ')');
    grad.addColorStop(1, 'rgba(239,68,68,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fill();

    // "CONTACT" label at high intensity
    if (v > 0.6) {
      ctx.font        = '8px Inter, system-ui, sans-serif';
      ctx.fillStyle   = 'rgba(255,120,120,' + v.toFixed(2) + ')';
      ctx.textAlign   = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText('CONTACT', cx, cy - radius - 2);
      ctx.textAlign   = 'start';
      ctx.textBaseline = 'alphabetic';
    }

    hotspotGrid[i] = Math.max(0, v - HOTSPOT_DECAY);
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Layer 5: Pulse system
// ---------------------------------------------------------------------------

export type PulseType = 'attack' | 'destroy' | 'heal';

interface Pulse {
  x: number; y: number; startTime: number; color: string;
}

const PULSE_DURATION_MS = 800;
const PULSE_MAX_RADIUS  = 14;

const activePulses = new Map<string, Pulse>();

const PULSE_COLORS: Record<PulseType, string> = {
  attack:  '#f59e0b',
  destroy: '#ef4444',
  heal:    '#22c55e',
};

export function addPulse(unitId: string, x: number, y: number, type: PulseType): void {
  activePulses.set(unitId, { x, y, startTime: performance.now(), color: PULSE_COLORS[type] });
  if (type === 'attack' || type === 'destroy') addHotspot(x, y);
}

function drawPulses(ctx: CanvasRenderingContext2D, W: number, H: number, now: number): void {
  const expired: string[] = [];
  ctx.save();
  for (const [id, pulse] of activePulses) {
    const age = now - pulse.startTime;
    if (age >= PULSE_DURATION_MS) { expired.push(id); continue; }
    const progress = age / PULSE_DURATION_MS;
    const [px, py] = toScreen(pulse.x, pulse.y, W, H);
    const radius   = progress * PULSE_MAX_RADIUS;
    const opacity  = (1 - progress) * 0.8;
    ctx.beginPath();
    ctx.arc(px, py, radius, 0, Math.PI * 2);
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
  W: number, H: number,
  units: Map<string, Unit>,
  selectedId: string | null,
): void {
  if (!selectedId) return;
  const unit = units.get(selectedId);
  if (!unit) return;

  const [px, py] = toScreen(unit.x, unit.y, W, H);
  const ARM = 10, GAP = 4;

  ctx.save();
  ctx.beginPath();
  ctx.arc(px, py, GAP + ARM + 3, 0, Math.PI * 2);
  ctx.strokeStyle = '#60a5fa';
  ctx.globalAlpha = 0.3;
  ctx.lineWidth   = 8;
  ctx.stroke();

  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth   = 1.5;
  ctx.globalAlpha = 0.9;
  ctx.beginPath();
  ctx.moveTo(px - GAP - ARM, py); ctx.lineTo(px - GAP, py);
  ctx.moveTo(px + GAP,       py); ctx.lineTo(px + GAP + ARM, py);
  ctx.moveTo(px, py - GAP - ARM); ctx.lineTo(px, py - GAP);
  ctx.moveTo(px, py + GAP);       ctx.lineTo(px, py + GAP + ARM);
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
  const ctxOrNull = canvas.getContext('2d');
  if (!ctxOrNull) return () => { /* no-op */ };
  const ctx: CanvasRenderingContext2D = ctxOrNull;

  let dirty = true;
  let rafId = 0;

  const unsubscribeUnits     = subscribe(() => { dirty = true; });
  const unsubscribeSelection = subscribeSelection(() => { dirty = true; });

  function hasPulses(): boolean { return activePulses.size > 0; }

  function hasActiveHotspots(): boolean {
    for (let i = 0; i < hotspotGrid.length; i++) {
      if ((hotspotGrid[i] ?? 0) >= 0.04) return true;
    }
    return false;
  }

  function draw(): void {
    const W = canvas.width, H = canvas.height;
    const units = getMap(), now = performance.now();
    const scale = unitScale, selectedId = getSelectedId();

    // Layer 0: Background
    ctx.fillStyle = COLOR_BG;
    ctx.fillRect(0, 0, W, H);

    // Layer 0b: Terrain
    if (!terrainCanvas || terrainW !== W || terrainH !== H) {
      terrainCanvas = buildTerrainCanvas(W, H);
      terrainW = W; terrainH = H;
    }
    ctx.drawImage(terrainCanvas, 0, 0);

    // Layer 1: Sectors
    drawSectors(ctx, W, H, computeSectorDominance(units));

    // Layer 2: Bases
    drawBases(ctx, W, H);

    // Layer 3: Hotspots
    drawHotspots(ctx, W, H, now);

    // Layer 4: Units (5 passes)
    const size3 = Math.max(1, Math.round(3 * scale));
    const size4 = Math.max(1, Math.round(4 * scale));
    const size1 = Math.max(1, Math.round(1 * scale));

    ctx.fillStyle = COLOR_ALPHA;
    for (const u of units.values()) {
      if (u.team !== 'alpha' || u.status === 'destroyed' || u.status === 'attacking') continue;
      if (u.health < LOW_HEALTH_THRESHOLD) continue;
      const [x, y] = toScreen(u.x, u.y, W, H);
      ctx.fillRect(x | 0, y | 0, size3, size3);
    }

    ctx.fillStyle = COLOR_BRAVO;
    for (const u of units.values()) {
      if (u.team !== 'bravo' || u.status === 'destroyed' || u.status === 'attacking') continue;
      if (u.health < LOW_HEALTH_THRESHOLD) continue;
      const [x, y] = toScreen(u.x, u.y, W, H);
      ctx.fillRect(x | 0, y | 0, size3, size3);
    }

    ctx.fillStyle = COLOR_DAMAGED;
    for (const u of units.values()) {
      if (u.status === 'destroyed' || u.status === 'attacking') continue;
      if (u.health >= LOW_HEALTH_THRESHOLD) continue;
      const [x, y] = toScreen(u.x, u.y, W, H);
      ctx.fillRect(x | 0, y | 0, size3, size3);
    }

    ctx.fillStyle = COLOR_ATTACK;
    for (const u of units.values()) {
      if (u.status !== 'attacking') continue;
      const [x, y] = toScreen(u.x, u.y, W, H);
      ctx.fillRect(x | 0, y | 0, size4, size4);
    }

    ctx.fillStyle = COLOR_DEAD;
    for (const u of units.values()) {
      if (u.status !== 'destroyed') continue;
      const [x, y] = toScreen(u.x, u.y, W, H);
      ctx.fillRect(x | 0, y | 0, size1, size1);
    }

    // Layer 5: Pulses
    drawPulses(ctx, W, H, now);

    // Layer 6: Selection
    drawSelection(ctx, W, H, units, selectedId);

    // Zoom level indicator
    if (viewport.zoom > 1) {
      ctx.save();
      ctx.font        = '10px Inter, system-ui, sans-serif';
      ctx.fillStyle   = 'rgba(255,255,255,0.5)';
      ctx.textAlign   = 'right';
      ctx.textBaseline = 'top';
      ctx.fillText(viewport.zoom.toFixed(1) + 'x', W - 12, 12);
      ctx.restore();
    }
  }

  function frame(): void {
    if (dirty || consumeDirty() || hasPulses() || hasActiveHotspots()) {
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
