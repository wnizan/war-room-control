import type { Unit } from '@shared/types';
import { pulsesStore } from '../store/pulsesStore';

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
  const next = Math.min(8, Math.max(1, viewport.zoom + delta));
  viewport = { ...viewport, zoom: next };
  markDirty();
}

export function resetZoom(): void {
  viewport = { zoom: 1, cx: 0.5, cy: 0.5 };
  markDirty();
}

export function getZoom(): number {
  return viewport.zoom;
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

/** Find the unit closest to canvas pixel (cx, cy), within thresholdPx pixels. Returns unit id or null. */
export function findNearestUnit(
  cx: number,
  cy: number,
  W: number,
  H: number,
  units: Map<string, Unit>,
  thresholdPx: number,
): string | null {
  const { zoom, cx: vcx, cy: vcy } = viewport;
  const nx = (cx / W - 0.5) / zoom + vcx;
  const ny = (cy / H - 0.5) / zoom + vcy;
  const threshNorm = thresholdPx / (W * zoom);
  let bestId: string | null = null;
  let bestDist = threshNorm * threshNorm;
  for (const u of units.values()) {
    const dx = u.x - nx;
    const dy = u.y - ny;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestDist) {
      bestDist = d2;
      bestId = u.id;
    }
  }
  return bestId;
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
// Font constants — defined once, reused everywhere to avoid repeated parsing
// ---------------------------------------------------------------------------
const FONT_TINY   = '8px Inter, system-ui, sans-serif';
const FONT_SMALL  = '9px Inter, system-ui, sans-serif';
const FONT_NORMAL = '10px Inter, system-ui, sans-serif';
const FONT_LABEL  = '11px Inter, system-ui, sans-serif';

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

let cachedSectorDominance: Record<SectorId, 'alpha' | 'bravo' | 'neutral'> | null = null;
let _sectorLastComputed = 0;
const SECTOR_THROTTLE_MS = 2000;

export function invalidateSectorCache(): void {
  // Throttled — cache expires by time in draw(), not on every delta
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

    // Right-side sectors (A2, B2) anchor labels to right edge; left side to left
    const isRightSector = s === 'A2' || s === 'B2';
    ctx.font = FONT_LABEL;
    ctx.textBaseline = 'top';
    ctx.fillStyle = ZONE_LABEL_COLOR;
    if (isRightSector) {
      ctx.textAlign = 'right';
      ctx.fillText(s, px2 - 8, py + 8);
    } else {
      ctx.textAlign = 'left';
      ctx.fillText(s, px + 8, py + 8);
    }

    ctx.font = FONT_SMALL;
    const ctrl = dominance[s];
    const ctrlLabel = ctrl === 'alpha' ? '[ALPHA]' : ctrl === 'bravo' ? '[BRAVO]' : '[CONTESTED]';
    if (ctrl === 'alpha') { ctx.fillStyle = ZONE_CTRL_ALPHA; ctx.globalAlpha = 1; }
    else if (ctrl === 'bravo') { ctx.fillStyle = ZONE_CTRL_BRAVO; ctx.globalAlpha = 1; }
    else { ctx.fillStyle = ZONE_CTRL_CONTEST; ctx.globalAlpha = 0.7; }
    if (isRightSector) {
      ctx.textAlign = 'right';
      ctx.fillText(ctrlLabel, px2 - 8, py + 22);
    } else {
      ctx.textAlign = 'left';
      ctx.fillText(ctrlLabel, px + 8, py + 22);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
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
const BASE_RADIUS: Record<BaseType, number> = { HQ: 46, FWD: 32, SUPPLY: 26 };
const BASE_ICON_SIZE: Record<BaseType, number> = { HQ: 11, FWD: 9, SUPPLY: 8 };

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
    ctx.globalAlpha = base.shortType === 'HQ' ? 0.75 : 0.55;
    ctx.setLineDash(base.shortType === 'HQ' ? [] : [6, 3]);
    ctx.lineWidth   = base.shortType === 'HQ' ? 2.5 : 1.5;
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
      ctx.font        = `bold ${iconSize}px Inter,system-ui,sans-serif`;
      ctx.textAlign   = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('HQ', px, py + 0.5);
    }
    ctx.globalAlpha = 1;

    // ── Glow / shape distinction per type ────────────────────────
    if (base.shortType === 'HQ') {
      // Two-pass glow
      ctx.beginPath();
      ctx.arc(px, py, radius * 1.1, 0, Math.PI * 2);
      ctx.fillStyle   = color;
      ctx.globalAlpha = 0.04;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(px, py, radius * 0.65, 0, Math.PI * 2);
      ctx.fillStyle   = color;
      ctx.globalAlpha = 0.14;
      ctx.fill();
      ctx.globalAlpha = 1;
      // Diamond outer ring
      const s = radius * 0.9;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(Math.PI / 4);
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth   = 1.5;
      ctx.strokeRect(-s, -s, s * 2, s * 2);
      ctx.globalAlpha = 1;
      ctx.restore();
    }
    if (base.shortType === 'FWD') {
      // Second concentric dashed ring
      ctx.beginPath();
      ctx.arc(px, py, radius * 0.55, 0, Math.PI * 2);
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.45;
      ctx.setLineDash([3, 3]);
      ctx.lineWidth   = 1;
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
    if (base.shortType === 'SUPPLY') {
      // Four tick marks at cardinal points
      const r = radius;
      const tl = 6;
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.65;
      ctx.lineWidth   = 1.5;
      ctx.beginPath();
      ctx.moveTo(px,     py - r);       ctx.lineTo(px,         py - r - tl);
      ctx.moveTo(px,     py + r);       ctx.lineTo(px,         py + r + tl);
      ctx.moveTo(px - r, py);           ctx.lineTo(px - r - tl, py);
      ctx.moveTo(px + r, py);           ctx.lineTo(px + r + tl, py);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // ── Label above ────────────────────────────────────────────────
    ctx.fillStyle    = '#fff';
    ctx.globalAlpha  = 0.9;
    ctx.font         = base.shortType === 'HQ' ? `bold 11px Inter,system-ui,sans-serif` : `bold 9px Inter,system-ui,sans-serif`;
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(base.label, px, py - iconSize - 3);

    // ── Type badge below ───────────────────────────────────────────
    if (base.shortType !== 'HQ') {
      ctx.fillStyle   = color;
      ctx.globalAlpha = 0.8;
      ctx.font        = FONT_TINY;
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
const hotspotGrid          = new Float32Array(HOTSPOT_COLS * HOTSPOT_ROWS);
const activeHotspotIndices = new Set<number>();
const HOTSPOT_DECAY = 0.006;   // was 0.0015 — decays 4× faster, shows only recent combat
const HOTSPOT_HIT   = 0.12;   // was 0.22  — smaller per-hit so zones don't saturate instantly

export function addHotspot(x: number, y: number): void {
  const col = Math.min(HOTSPOT_COLS - 1, (x * HOTSPOT_COLS) | 0);
  const row = Math.min(HOTSPOT_ROWS - 1, (y * HOTSPOT_ROWS) | 0);
  const idx = row * HOTSPOT_COLS + col;
  hotspotGrid[idx] = Math.min(1, (hotspotGrid[idx] ?? 0) + HOTSPOT_HIT);
  activeHotspotIndices.add(idx);
}

// Pre-built rgba strings keyed by intensity bucket (0–15) to avoid per-frame
// string allocation. Each bucket represents a 1/16 slice of [0,1].
// Format: index = Math.min(15, (v * 16) | 0)
// Opacity targets reduced for balanced visibility (not overwhelming)
const _HOTSPOT_HALO:   readonly string[] = Array.from({ length: 16 }, (_, i) => {
  const a = ((i / 16) * 0.04 * 255 + 0.5) | 0;   // was 0.07
  return `rgba(239,68,68,${(a / 255).toFixed(3)})`;
});
const _HOTSPOT_CORE1:  readonly string[] = Array.from({ length: 16 }, (_, i) => {
  const a = ((i / 16) * 0.20 * 255 + 0.5) | 0;   // was 0.75
  return `rgba(255,160,80,${(a / 255).toFixed(3)})`;
});
const _HOTSPOT_CORE2:  readonly string[] = Array.from({ length: 16 }, (_, i) => {
  const a = ((i / 16) * 0.10 * 255 + 0.5) | 0;   // was 0.35
  return `rgba(239,68,68,${(a / 255).toFixed(3)})`;
});
const _HOTSPOT_RING1:  readonly string[] = Array.from({ length: 16 }, (_, i) => {
  const a = ((i / 16) * 0.55 * 255 + 0.5) | 0;   // was 0.9
  return `rgba(255,80,60,${(a / 255).toFixed(3)})`;
});
const _HOTSPOT_RING2:  readonly string[] = Array.from({ length: 16 }, (_, i) => {
  const a = ((i / 16) * 0.35 * 255 + 0.5) | 0;   // was 0.6
  return `rgba(255,160,80,${(a / 255).toFixed(3)})`;
});
const _HOTSPOT_CROSS:  readonly string[] = Array.from({ length: 16 }, (_, i) => {
  const a = ((i / 16) * 0.5 * 255 + 0.5) | 0;    // was 0.8
  return `rgba(255,200,100,${(a / 255).toFixed(3)})`;
});
const _HOTSPOT_LABEL:  readonly string[] = Array.from({ length: 16 }, (_, i) => {
  const a = (Math.min(1, (i / 16) * 1.0) * 255 + 0.5) | 0;
  return `rgba(255,160,80,${(a / 255).toFixed(3)})`;
});

function drawHotspots(ctx: CanvasRenderingContext2D, W: number, H: number, now: number): void {
  ctx.save();

  // Hoist cellPx — constant for the entire frame
  const [x1] = toScreen(0, 0, W, H);
  const [x2] = toScreen(1 / HOTSPOT_COLS, 0, W, H);
  const cellPx = Math.abs(x2 - x1);

  const PI2 = Math.PI * 2;

  for (const i of activeHotspotIndices) {
    const v = hotspotGrid[i] ?? 0;
    const newV = Math.max(0, v - HOTSPOT_DECAY);
    hotspotGrid[i] = newV;
    if (newV === 0) {
      activeHotspotIndices.delete(i);
      continue;
    }
    if (v < 0.04) continue;

    const col = i % HOTSPOT_COLS;
    const row = (i / HOTSPOT_COLS) | 0;
    const nx = (col + 0.5) / HOTSPOT_COLS;
    const ny = (row + 0.5) / HOTSPOT_ROWS;
    const [cx, cy] = toScreen(nx, ny, W, H);

    const pulse  = Math.sin(now * 0.004) * 0.1 + 0.9;
    const radius = cellPx * 0.5 * v * pulse;
    const bi = Math.min(15, (v * 16) | 0);

    ctx.beginPath();
    ctx.arc(cx, cy, radius * 1.7, 0, PI2);
    ctx.fillStyle = _HOTSPOT_HALO[bi] ?? _HOTSPOT_HALO[15]!;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, PI2);
    ctx.fillStyle = _HOTSPOT_CORE2[bi] ?? _HOTSPOT_CORE2[15]!;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.45, 0, PI2);
    ctx.fillStyle = _HOTSPOT_CORE1[bi] ?? _HOTSPOT_CORE1[15]!;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, PI2);
    ctx.strokeStyle = _HOTSPOT_RING1[bi] ?? _HOTSPOT_RING1[15]!;
    ctx.lineWidth   = 2;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.55, 0, PI2);
    ctx.strokeStyle = _HOTSPOT_RING2[bi] ?? _HOTSPOT_RING2[15]!;
    ctx.lineWidth   = 1;
    ctx.stroke();

    if (v > 0.5) {
      const arm = radius * 0.4;
      ctx.strokeStyle = _HOTSPOT_CROSS[bi] ?? _HOTSPOT_CROSS[15]!;
      ctx.lineWidth   = 1;
      ctx.beginPath();
      ctx.moveTo(cx - arm, cy); ctx.lineTo(cx + arm, cy);
      ctx.moveTo(cx, cy - arm); ctx.lineTo(cx, cy + arm);
      ctx.stroke();
    }

    if (v > 0.7) {
      ctx.font         = FONT_SMALL;
      ctx.fillStyle    = _HOTSPOT_LABEL[bi] ?? _HOTSPOT_LABEL[15]!;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText('CONTACT', cx, cy - radius - 3);
      ctx.textAlign    = 'start';
      ctx.textBaseline = 'alphabetic';
    }
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

function addPulse(unitId: string, x: number, y: number, type: PulseType): void {
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
// Layer 7: Map marker — single pinned location, drawn on Canvas
// ---------------------------------------------------------------------------

interface MapMarker { nx: number; ny: number; placedAt: number; }
let _mapMarker: MapMarker | null = null;

export function setMapMarker(nx: number, ny: number): void {
  _mapMarker = { nx, ny, placedAt: performance.now() };
  markDirty();
}

export function clearMapMarker(): void {
  if (_mapMarker !== null) { _mapMarker = null; markDirty(); }
}

export function hasMapMarker(): boolean { return _mapMarker !== null; }

/** Convert canvas pixel click to normalised map coord */
export function canvasToNorm(cx: number, cy: number, W: number, H: number): { nx: number; ny: number } {
  const { zoom, cx: vcx, cy: vcy } = viewport;
  return {
    nx: (cx / W - 0.5) / zoom + vcx,
    ny: (cy / H - 0.5) / zoom + vcy,
  };
}

function drawMapMarker(ctx: CanvasRenderingContext2D, W: number, H: number, now: number): void {
  if (_mapMarker === null) return;
  const [px, py] = toScreen(_mapMarker.nx, _mapMarker.ny, W, H);

  const age   = now - _mapMarker.placedAt;
  const pulse = Math.sin(age * 0.004) * 0.25 + 0.75; // 0.5–1.0

  ctx.save();

  // Outer pulsing ring
  ctx.beginPath();
  ctx.arc(px, py, 12 * pulse, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(250,204,21,0.7)';
  ctx.lineWidth   = 1.5;
  ctx.stroke();

  // Inner filled circle
  ctx.beginPath();
  ctx.arc(px, py, 3, 0, Math.PI * 2);
  ctx.fillStyle = '#fde047';
  ctx.fill();

  // Crosshair arms
  const ARM = 10, GAP = 6;
  ctx.strokeStyle = '#fde047';
  ctx.globalAlpha = 0.9;
  ctx.lineWidth   = 1.5;
  ctx.beginPath();
  ctx.moveTo(px - GAP - ARM, py); ctx.lineTo(px - GAP, py);
  ctx.moveTo(px + GAP,       py); ctx.lineTo(px + GAP + ARM, py);
  ctx.moveTo(px, py - GAP - ARM); ctx.lineTo(px, py - GAP);
  ctx.moveTo(px, py + GAP);       ctx.lineTo(px, py + GAP + ARM);
  ctx.stroke();

  ctx.restore();
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Reset — call before (re)mounting to clear all stale module globals
// ---------------------------------------------------------------------------

export function resetRenderState(): void {
  // Viewport
  viewport = { zoom: 1, cx: 0.5, cy: 0.5 };
  _dirty = false;

  // Terrain
  terrainCanvas = null;
  terrainW = 0;
  terrainH = 0;

  // Sector cache
  cachedSectorDominance = null;
  _sectorLastComputed = 0;

  // Hotspot grid
  hotspotGrid.fill(0);
  activeHotspotIndices.clear();

  // Pulses
  activePulses.clear();

  // Map marker
  _mapMarker = null;

  // Unit scale
  unitScale = 1.0;
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
  resetRenderState();

  const ctxOrNull = canvas.getContext('2d', { alpha: false });
  if (!ctxOrNull) return () => { /* no-op */ };
  const ctx: CanvasRenderingContext2D = ctxOrNull;

  let dirty = true;
  let rafId = 0;

  const unsubscribeUnits     = subscribe(() => { dirty = true; invalidateSectorCache(); });
  const unsubscribeSelection = subscribeSelection(() => { dirty = true; });
  const unsubscribePulses    = pulsesStore.subscribe(() => {
    for (const entry of pulsesStore.drain()) {
      addPulse(entry.id, entry.x, entry.y, entry.type);
    }
  });

  function hasPulses(): boolean { return activePulses.size > 0; }

  function hasActiveHotspots(): boolean { return activeHotspotIndices.size > 0; }

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
    if (!cachedSectorDominance || now - _sectorLastComputed > SECTOR_THROTTLE_MS) {
      cachedSectorDominance = computeSectorDominance(units);
      _sectorLastComputed = now;
    }
    drawSectors(ctx, W, H, cachedSectorDominance);

    // Layer 2: Bases
    drawBases(ctx, W, H);

    // Layer 3: Hotspots
    drawHotspots(ctx, W, H, now);

    // Layer 4: Units — single classification pass, then batch render per bucket
    const size3 = Math.max(1, Math.round(2 * scale));
    const size4 = Math.max(1, Math.round(2 * scale));
    const size1 = 1;

    const bAlpha:   number[] = [];
    const bBravo:   number[] = [];
    const bDamaged: number[] = [];
    const bAttack:  number[] = [];
    const bDead:    number[] = [];

    for (const u of units.values()) {
      const [sx, sy] = toScreen(u.x, u.y, W, H);
      const px = sx | 0, py = sy | 0;
      if (u.status === 'destroyed') {
        bDead.push(px, py);
      } else if (u.status === 'attacking') {
        bAttack.push(px, py);
      } else if (u.health < LOW_HEALTH_THRESHOLD) {
        bDamaged.push(px, py);
      } else if (u.team === 'alpha') {
        bAlpha.push(px, py);
      } else {
        bBravo.push(px, py);
      }
    }

    ctx.fillStyle = COLOR_ALPHA;
    for (let i = 0; i < bAlpha.length; i += 2)
      ctx.fillRect(bAlpha[i]!, bAlpha[i + 1]!, size3, size3);

    ctx.fillStyle = COLOR_BRAVO;
    for (let i = 0; i < bBravo.length; i += 2)
      ctx.fillRect(bBravo[i]!, bBravo[i + 1]!, size3, size3);

    ctx.fillStyle = COLOR_DAMAGED;
    for (let i = 0; i < bDamaged.length; i += 2)
      ctx.fillRect(bDamaged[i]!, bDamaged[i + 1]!, size3, size3);

    ctx.fillStyle = COLOR_ATTACK;
    for (let i = 0; i < bAttack.length; i += 2)
      ctx.fillRect(bAttack[i]!, bAttack[i + 1]!, size4, size4);

    ctx.fillStyle = COLOR_DEAD;
    for (let i = 0; i < bDead.length; i += 2)
      ctx.fillRect(bDead[i]!, bDead[i + 1]!, size1, size1);

    // Layer 5: Pulses
    drawPulses(ctx, W, H, now);

    // Layer 6: Selection
    drawSelection(ctx, W, H, units, selectedId);

    // Layer 7: Map marker
    drawMapMarker(ctx, W, H, now);

    // Zoom level indicator
    if (viewport.zoom > 1) {
      ctx.save();
      ctx.font        = FONT_NORMAL;
      ctx.fillStyle   = 'rgba(255,255,255,0.5)';
      ctx.textAlign   = 'right';
      ctx.textBaseline = 'top';
      ctx.fillText(viewport.zoom.toFixed(1) + 'x', W - 12, 12);
      ctx.restore();
    }
  }

  function frame(): void {
    if (dirty || consumeDirty() || hasPulses() || hasActiveHotspots() || hasMapMarker()) {
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
    unsubscribePulses();
  };
}
