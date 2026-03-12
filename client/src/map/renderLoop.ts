import type { Unit } from '@shared/types';

type UnsubscribeFn = () => void;

// ---------------------------------------------------------------------------
// Unit scale — mutable from outside (slider control)
// ---------------------------------------------------------------------------
export let unitScale: number = 1.0;

export function setUnitScale(value: number): void {
  unitScale = value;
}

// ---------------------------------------------------------------------------
// Color constants
// ---------------------------------------------------------------------------
const COLOR_ALPHA       = '#3b82f6';   // blue — alpha alive
const COLOR_BRAVO       = '#ef4444';   // red  — bravo alive
const COLOR_ATTACK      = '#f59e0b';   // amber — attacking (either team)
const COLOR_DEAD        = 'rgba(80,80,90,0.5)';
const COLOR_BG          = '#0d1117';

// Zone fill tints
const ZONE_FILL_NEUTRAL = 'rgba(255,255,255,0.02)';
const ZONE_FILL_ALPHA   = 'rgba(59,130,246,0.04)';
const ZONE_FILL_BRAVO   = 'rgba(249,115,22,0.04)';
const ZONE_BORDER       = 'rgba(255,255,255,0.08)';
const ZONE_LABEL_COLOR  = 'rgba(255,255,255,0.25)';

// Low-health threshold
const LOW_HEALTH_THRESHOLD = 25;

// ---------------------------------------------------------------------------
// Pulse system
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

/**
 * Register a new pulse at the given normalised coordinates.
 * Called from wsClient on each tick event.
 */
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
}

// ---------------------------------------------------------------------------
// Zone helpers
// ---------------------------------------------------------------------------

type ZoneId = 'A' | 'B' | 'C' | 'D';

interface ZoneBounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const ZONES: Record<ZoneId, ZoneBounds> = {
  A: { x0: 0,   y0: 0,   x1: 0.5, y1: 0.5 },
  B: { x0: 0.5, y0: 0,   x1: 1,   y1: 0.5 },
  C: { x0: 0,   y0: 0.5, x1: 0.5, y1: 1   },
  D: { x0: 0.5, y0: 0.5, x1: 1,   y1: 1   },
};

const ZONE_IDS: ZoneId[] = ['A', 'B', 'C', 'D'];

function zoneOf(u: Unit): ZoneId {
  const right  = u.x >= 0.5;
  const bottom = u.y >= 0.5;
  if (!right && !bottom) return 'A';
  if ( right && !bottom) return 'B';
  if (!right &&  bottom) return 'C';
  return 'D';
}

function computeZoneDominance(
  units: Map<string, Unit>,
): Record<ZoneId, 'alpha' | 'bravo' | 'neutral'> {
  const alphaCount: Record<ZoneId, number> = { A: 0, B: 0, C: 0, D: 0 };
  const bravoCount: Record<ZoneId, number> = { A: 0, B: 0, C: 0, D: 0 };

  for (const u of units.values()) {
    if (u.status === 'destroyed') continue;
    const zone = zoneOf(u);
    if (u.team === 'alpha') alphaCount[zone]++;
    else                    bravoCount[zone]++;
  }

  const result = {} as Record<ZoneId, 'alpha' | 'bravo' | 'neutral'>;
  for (const z of ZONE_IDS) {
    const total = alphaCount[z] + bravoCount[z];
    if (total === 0) {
      result[z] = 'neutral';
    } else if (alphaCount[z] / total > 0.6) {
      result[z] = 'alpha';
    } else if (bravoCount[z] / total > 0.6) {
      result[z] = 'bravo';
    } else {
      result[z] = 'neutral';
    }
  }
  return result;
}

function drawZones(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  dominance: Record<ZoneId, 'alpha' | 'bravo' | 'neutral'>,
): void {
  ctx.save();
  ctx.font = '11px Inter, system-ui, sans-serif';
  ctx.textBaseline = 'top';

  for (const z of ZONE_IDS) {
    const b = ZONES[z];
    const px = b.x0 * W;
    const py = b.y0 * H;
    const pw = (b.x1 - b.x0) * W;
    const ph = (b.y1 - b.y0) * H;

    // Fill
    switch (dominance[z]) {
      case 'alpha':
        ctx.fillStyle = ZONE_FILL_ALPHA;
        break;
      case 'bravo':
        ctx.fillStyle = ZONE_FILL_BRAVO;
        break;
      default:
        ctx.fillStyle = ZONE_FILL_NEUTRAL;
    }
    ctx.fillRect(px, py, pw, ph);

    // Border
    ctx.strokeStyle = ZONE_BORDER;
    ctx.lineWidth   = 1;
    ctx.strokeRect(px, py, pw, ph);

    // Label — 8px inset from the top-left of the zone
    ctx.fillStyle = ZONE_LABEL_COLOR;
    ctx.fillText(`Zone ${z}`, px + 8, py + 8);
  }

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Pulse drawing
// ---------------------------------------------------------------------------

function drawPulses(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  now: number,
): void {
  const expired: string[] = [];

  ctx.save();
  for (const [id, pulse] of activePulses) {
    const age = now - pulse.startTime;
    if (age >= PULSE_DURATION_MS) {
      expired.push(id);
      continue;
    }

    const progress = age / PULSE_DURATION_MS;          // 0 → 1
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
// Main render loop
// ---------------------------------------------------------------------------

export function startRenderLoop(
  canvas: HTMLCanvasElement,
  getMap: () => Map<string, Unit>,
  subscribe: (cb: () => void) => UnsubscribeFn,
): UnsubscribeFn {
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => { /* no-op */ };

  let dirty   = true;
  let rafId   = 0;

  // Mark dirty on every store notification so we redraw after new data
  const unsubscribe = subscribe(() => { dirty = true; });

  // When pulses are active we must keep redrawing even if the store is quiet
  function hasPulses(): boolean {
    return activePulses.size > 0;
  }

  function draw(): void {
    const W     = canvas.width;
    const H     = canvas.height;
    const units = getMap();
    const now   = performance.now();
    const scale = unitScale;

    // -- Background ----------------------------------------------------------
    ctx.fillStyle = COLOR_BG;
    ctx.fillRect(0, 0, W, H);

    // -- Layer 0: Zone overlays (behind units) --------------------------------
    const dominance = computeZoneDominance(units);
    drawZones(ctx, W, H, dominance);

    // -- Unit passes ----------------------------------------------------------
    // Pass 1: alpha alive (non-attacking, non-destroyed)
    ctx.fillStyle = COLOR_ALPHA;
    for (const u of units.values()) {
      if (u.team !== 'alpha') continue;
      if (u.status === 'destroyed' || u.status === 'attacking') continue;

      const lowHealth = u.health < LOW_HEALTH_THRESHOLD;
      const base      = lowHealth ? 3 : 2;
      const size      = Math.max(1, Math.round(base * scale));
      const px        = (u.x * W) | 0;
      const py        = (u.y * H) | 0;
      ctx.fillRect(px, py, size, size);
    }

    // Pass 2: bravo alive (non-attacking, non-destroyed)
    ctx.fillStyle = COLOR_BRAVO;
    for (const u of units.values()) {
      if (u.team !== 'bravo') continue;
      if (u.status === 'destroyed' || u.status === 'attacking') continue;

      const lowHealth = u.health < LOW_HEALTH_THRESHOLD;
      const base      = lowHealth ? 3 : 2;
      const size      = Math.max(1, Math.round(base * scale));
      const px        = (u.x * W) | 0;
      const py        = (u.y * H) | 0;
      ctx.fillRect(px, py, size, size);
    }

    // Pass 3: attacking (either team) — amber, slightly larger
    ctx.fillStyle = COLOR_ATTACK;
    for (const u of units.values()) {
      if (u.status !== 'attacking') continue;
      const size = Math.max(1, Math.round(3 * scale));
      const px   = (u.x * W) | 0;
      const py   = (u.y * H) | 0;
      ctx.fillRect(px, py, size, size);
    }

    // Pass 4: destroyed — dim gray, 1×1 dots
    ctx.fillStyle = COLOR_DEAD;
    for (const u of units.values()) {
      if (u.status !== 'destroyed') continue;
      const size = Math.max(1, Math.round(1 * scale));
      const px   = (u.x * W) | 0;
      const py   = (u.y * H) | 0;
      ctx.fillRect(px, py, size, size);
    }

    // -- Layer 2: Pulses (foreground, on top of units) -----------------------
    drawPulses(ctx, W, H, now);
  }

  function frame(): void {
    if (dirty || hasPulses()) {
      draw();
      dirty = false;
    }
    rafId = requestAnimationFrame(frame);
  }

  rafId = requestAnimationFrame(frame);

  return () => {
    cancelAnimationFrame(rafId);
    unsubscribe();
  };
}
