import type { Unit, UnitTeam, UnitType } from '../../../shared/types.js';

const UNIT_TYPES: UnitType[] = ['infantry', 'vehicle', 'air'];

const PREFIXES: Record<UnitTeam, string[]> = {
  alpha: ['Wolf', 'Eagle', 'Falcon', 'Bear', 'Tiger', 'Lion', 'Viper', 'Ghost'],
  bravo: ['Razor', 'Storm', 'Blade', 'Iron', 'Steel', 'Rock', 'Fire', 'Dark'],
};

// Base spawn centres per team — matches MAP_BASES in renderLoop.ts
const ALPHA_SPAWN_CENTRES = [
  { x: 0.12, y: 0.15, weight: 0.45 },  // HQ — most units
  { x: 0.35, y: 0.45, weight: 0.35 },  // FWD
  { x: 0.08, y: 0.72, weight: 0.20 },  // SUPPLY
];

const BRAVO_SPAWN_CENTRES = [
  { x: 0.88, y: 0.85, weight: 0.45 },  // HQ
  { x: 0.65, y: 0.55, weight: 0.35 },  // FWD
  { x: 0.92, y: 0.28, weight: 0.20 },  // SUPPLY
];

// Box-Muller normal distribution: mean=0, stddev=1
function randn(): number {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

// Pick a spawn centre by weighted random, then add normal noise
function spawnPosition(
  centres: typeof ALPHA_SPAWN_CENTRES,
  stddev: number,
): { x: number; y: number } {
  const r = Math.random();
  let acc = 0;
  for (const c of centres) {
    acc += c.weight;
    if (r <= acc) {
      return {
        x: clamp01(c.x + randn() * stddev),
        y: clamp01(c.y + randn() * stddev),
      };
    }
  }
  const last = centres[centres.length - 1]!;
  return {
    x: clamp01(last.x + randn() * stddev),
    y: clamp01(last.y + randn() * stddev),
  };
}

function ri(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// alphaRatio: fraction of units assigned to Alpha team (0.0–1.0). Default 0.5.
export function generateUnits(count: number, alphaRatio = 0.5): Map<string, Unit> {
  const units = new Map<string, Unit>();
  const alphaCount = Math.round(count * Math.min(1, Math.max(0, alphaRatio)));
  const half  = alphaCount;

  // Spread: HQ units tightly clustered (0.06), FWD/SUPPLY slightly spread
  const STDDEV = 0.07;

  for (let i = 0; i < count; i++) {
    const team: UnitTeam = i < half ? 'alpha' : 'bravo';
    const type  = UNIT_TYPES[ri(0, UNIT_TYPES.length - 1)] as UnitType;
    const pref  = PREFIXES[team];
    const name  = `${pref[ri(0, pref.length - 1)]}-${String(i).padStart(5, '0')}`;
    const pos   = spawnPosition(
      team === 'alpha' ? ALPHA_SPAWN_CENTRES : BRAVO_SPAWN_CENTRES,
      STDDEV,
    );

    units.set(`u${i}`, {
      id: `u${i}`,
      name,
      type,
      team,
      status: 'idle',
      health: ri(60, 100),
      x: pos.x,
      y: pos.y,
    });
  }

  return units;
}
