import { randomUUID } from 'crypto';
import type { Unit, UnitDelta, TickUpdate, GameEvent, KPISummary } from '../../../shared/types.js';
import {
  TYPE_MOVE_MULT, TYPE_DMG, TYPE_ATTACK_RANGE_SQ,
  TYPE_CAN_ATTACK, TYPE_CAN_HEAL, UNIT_MAX_HP,
} from './unitStats.js';

const TICK_MIN  = 200;
const TICK_MAX  = 350;
const EVENT_CAP = 25;

// Base move deltas — multiplied per unit type by TYPE_MOVE_MULT
const MOVE_RANDOM  = 0.010;
const MOVE_ADVANCE = 0.003;

// Enemy objectives: alpha advances toward bravo HQ, bravo toward alpha HQ
const ALPHA_OBJECTIVE = { x: 0.88, y: 0.85 };  // Bravo HQ
const BRAVO_OBJECTIVE = { x: 0.12, y: 0.15 };  // Alpha HQ

function ri(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function pickRandom<T>(arr: T[]): T | undefined {
  if (arr.length === 0) return undefined;
  return arr[Math.floor(Math.random() * arr.length)];
}

// ---------------------------------------------------------------------------
// Module-level reusable buffers — zero allocation per tick
// ---------------------------------------------------------------------------
const _seenScratch  = new Set<number>();
const _seenScratch2 = new Set<number>();
const _sampleResult: string[] = [];

const _aliveAlpha: string[] = [];
const _aliveBravo: string[] = [];
const _alphaInfantry: string[] = [];
const _alphaVehicle:  string[] = [];
const _alphaAir:      string[] = [];
const _bravoInfantry: string[] = [];
const _bravoVehicle:  string[] = [];
const _bravoAir:      string[] = [];

// Sample up to `sampleSize` random enemies across multiple pools, return the closest one.
function pickNearestFromPools(
  units: Map<string, Unit>,
  attacker: Unit,
  pools: string[][],
  sampleSize: number,
): string | undefined {
  let total = 0;
  for (const p of pools) total += p.length;
  if (total === 0) return undefined;

  const n = Math.min(sampleSize, total);
  let bestId: string | undefined;
  let bestDist = Infinity;

  _seenScratch.clear();
  let attempts = 0;
  const maxAttempts = n * 3;
  while (_seenScratch.size < n && attempts < maxAttempts) {
    attempts++;
    const r = Math.floor(Math.random() * total);
    if (_seenScratch.has(r)) continue;
    _seenScratch.add(r);

    let idx = r;
    for (const pool of pools) {
      if (idx < pool.length) {
        const id = pool[idx]!;
        const e = units.get(id);
        if (e && e.status !== 'destroyed') {
          const dx = e.x - attacker.x, dy = e.y - attacker.y;
          const d2 = dx * dx + dy * dy;
          if (d2 < bestDist) { bestDist = d2; bestId = id; }
        }
        break;
      }
      idx -= pool.length;
    }
  }
  return bestId;
}

// Sample n distinct ids from multiple pools without materializing a combined array
function sampleFromPools(pools: string[][], n: number): string[] {
  let total = 0;
  for (const p of pools) total += p.length;
  const count = Math.min(n, total);
  _sampleResult.length = 0;
  _seenScratch2.clear();
  let attempts = 0;
  const maxAttempts = count * 4;
  while (_sampleResult.length < count && attempts < maxAttempts) {
    attempts++;
    const r = Math.floor(Math.random() * total);
    if (_seenScratch2.has(r)) continue;
    _seenScratch2.add(r);
    let idx = r;
    for (const pool of pools) {
      if (idx < pool.length) { _sampleResult.push(pool[idx]!); break; }
      idx -= pool.length;
    }
  }
  return _sampleResult;
}

// Move a unit: mix of random drift + directional advance toward objective
// Speed is scaled by TYPE_MOVE_MULT per unit type
function advanceMove(unit: Unit): { nx: number; ny: number } {
  const obj  = unit.team === 'alpha' ? ALPHA_OBJECTIVE : BRAVO_OBJECTIVE;
  const mult = TYPE_MOVE_MULT[unit.type];
  const dx   = obj.x - unit.x;
  const dy   = obj.y - unit.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  const advMag = MOVE_ADVANCE * mult;
  const rndMag = MOVE_RANDOM  * mult;

  const advX = dist > 0.05 ? (dx / dist) * advMag : 0;
  const advY = dist > 0.05 ? (dy / dist) * advMag : 0;

  const rndX = (Math.random() - 0.5) * rndMag;
  const rndY = (Math.random() - 0.5) * rndMag;

  return {
    nx: clamp(unit.x + advX + rndX, 0, 1),
    ny: clamp(unit.y + advY + rndY, 0, 1),
  };
}

export function computeTick(units: Map<string, Unit>, seq: number): TickUpdate {
  const timestamp = Date.now();

  // Reset reusable buffers (no allocation)
  _aliveAlpha.length = 0; _aliveBravo.length = 0;
  _alphaInfantry.length = 0; _alphaVehicle.length = 0; _alphaAir.length = 0;
  _bravoInfantry.length = 0; _bravoVehicle.length = 0; _bravoAir.length = 0;

  for (const [id, u] of units) {
    if (u.status !== 'destroyed') {
      if (u.team === 'alpha') {
        _aliveAlpha.push(id);
        if (u.type === 'infantry') _alphaInfantry.push(id);
        else if (u.type === 'vehicle') _alphaVehicle.push(id);
        else _alphaAir.push(id);
      } else {
        _aliveBravo.push(id);
        if (u.type === 'infantry') _bravoInfantry.push(id);
        else if (u.type === 'vehicle') _bravoVehicle.push(id);
        else _bravoAir.push(id);
      }
    }
  }

  // Typed pool lookups — references only, no object allocation
  const aliveAlphaByType = { infantry: _alphaInfantry, vehicle: _alphaVehicle, air: _alphaAir };
  const aliveBravoByType = { infantry: _bravoInfantry, vehicle: _bravoVehicle, air: _bravoAir };

  const tickCount = ri(TICK_MIN, TICK_MAX);
  const selected = sampleFromPools([_aliveAlpha, _aliveBravo], tickCount);

  const deltaMap = new Map<string, UnitDelta>();
  const events: GameEvent[] = [];

  for (const id of selected) {
    const unit = units.get(id);
    if (!unit || unit.status === 'destroyed') continue;

    const r = Math.random();

    if (r < 0.40) {
      // Move with conquest advance
      const { nx, ny } = advanceMove(unit);
      unit.x = nx; unit.y = ny; unit.status = 'moving';
      deltaMap.set(id, { ...deltaMap.get(id), id, x: nx, y: ny, status: 'moving' });

    } else if (r < 0.58) {
      // Attack — use pre-built per-type pools (no filter per attacker)
      const enemyByType = unit.team === 'alpha' ? aliveBravoByType : aliveAlphaByType;
      const canAttack   = TYPE_CAN_ATTACK[unit.type];
      // Build pool references only — no array copy, no spread
      const pools: string[][] = [];
      if (canAttack.has('infantry')) pools.push(enemyByType['infantry']!);
      if (canAttack.has('vehicle'))  pools.push(enemyByType['vehicle']!);
      if (canAttack.has('air'))      pools.push(enemyByType['air']!);
      const targetId = pickNearestFromPools(units, unit, pools, 12);
      if (targetId !== undefined) {
        const target = units.get(targetId);
        if (target && target.status !== 'destroyed') {
          // Range check — only attack if within type-specific range
          const dx = target.x - unit.x;
          const dy = target.y - unit.y;
          const d2 = dx * dx + dy * dy;
          if (d2 <= TYPE_ATTACK_RANGE_SQ[unit.type]) {
            const [dMin, dMax] = TYPE_DMG[unit.type];
            const dmg   = ri(dMin, dMax);
            const newHp = Math.max(0, target.health - dmg);
            target.health = newHp;

            if (newHp === 0) {
              target.status = 'destroyed';
              deltaMap.set(targetId, { ...deltaMap.get(targetId), id: targetId, health: 0, status: 'destroyed' });
              if (events.length < EVENT_CAP) {
                events.push({ id: randomUUID(), type: 'destroyed', timestamp, sourceId: id, targetId, detail: `${unit.name} destroyed ${target.name}` });
              }
            } else {
              deltaMap.set(targetId, { ...deltaMap.get(targetId), id: targetId, health: newHp });
              if (events.length < EVENT_CAP) {
                events.push({ id: randomUUID(), type: 'attack', timestamp, sourceId: id, targetId, detail: `${unit.name} hit ${target.name} -${dmg}hp` });
              }
            }
            unit.status = 'attacking';
            deltaMap.set(id, { ...deltaMap.get(id), id, status: 'attacking' });
          }
        }
      }

    } else if (r < 0.68) {
      // Heal — air units cannot heal; max HP is type-specific
      const maxHp = UNIT_MAX_HP[unit.type];
      if (TYPE_CAN_HEAL[unit.type] && unit.health < maxHp) {
        const heal  = ri(3, 10);
        const newHp = Math.min(maxHp, unit.health + heal);
        unit.health = newHp; unit.status = 'active';
        deltaMap.set(id, { ...deltaMap.get(id), id, health: newHp, status: 'active' });
        if (events.length < EVENT_CAP) {
          events.push({ id: randomUUID(), type: 'heal', timestamp, targetId: id, detail: `${unit.name} +${heal}hp` });
        }
      }

    } else {
      if (unit.status !== 'idle') {
        unit.status = 'idle';
        deltaMap.set(id, { ...deltaMap.get(id), id, status: 'idle' });
      }
    }
  }

  // KPI: use already-built buffers — no extra loop over 20k units
  const aliveA = _aliveAlpha.length;
  const aliveB = _aliveBravo.length;
  const totalU = units.size;
  const totalAlive = aliveA + aliveB;
  const kpi: KPISummary = {
    seq,
    aliveAlpha: aliveA,
    aliveBravo: aliveB,
    destroyedAlpha: totalU / 2 - aliveA,
    destroyedBravo: totalU / 2 - aliveB,
    zoneControl: {
      alpha: totalAlive > 0 ? Math.round((aliveA / totalAlive) * 100) : 50,
      bravo: totalAlive > 0 ? Math.round((aliveB / totalAlive) * 100) : 50,
    },
  };

  return {
    seq,
    timestamp,
    units: Array.from(deltaMap.values()),
    events,
    kpi,
  };
}

export function computeKPI(units: Map<string, Unit>, seq: number): KPISummary {
  let aliveAlpha = 0, aliveBravo = 0, destroyedAlpha = 0, destroyedBravo = 0;
  for (const u of units.values()) {
    const d = u.status === 'destroyed';
    if (u.team === 'alpha') { if (d) destroyedAlpha++; else aliveAlpha++; }
    else                    { if (d) destroyedBravo++; else aliveBravo++; }
  }
  const totalAlive = aliveAlpha + aliveBravo;
  return {
    seq, aliveAlpha, aliveBravo, destroyedAlpha, destroyedBravo,
    zoneControl: {
      alpha: totalAlive > 0 ? Math.round((aliveAlpha / totalAlive) * 100) : 50,
      bravo: totalAlive > 0 ? Math.round((aliveBravo / totalAlive) * 100) : 50,
    },
  };
}
