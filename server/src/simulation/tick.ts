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

// Sample up to `sampleSize` random enemies, return the closest one.
// O(sampleSize) instead of O(n) — avoids scanning all 10k enemies per attacker.
function pickNearest(
  units: Map<string, Unit>,
  attacker: Unit,
  enemyIds: string[],
  sampleSize: number,
): string | undefined {
  if (enemyIds.length === 0) return undefined;
  const sample = sampleIds(enemyIds, Math.min(sampleSize, enemyIds.length));
  let bestId: string | undefined;
  let bestDist = Infinity;
  for (const id of sample) {
    const e = units.get(id);
    if (!e || e.status === 'destroyed') continue;
    const dx = e.x - attacker.x, dy = e.y - attacker.y;
    const d2 = dx * dx + dy * dy;
    if (d2 < bestDist) { bestDist = d2; bestId = id; }
  }
  return bestId;
}

function sampleIds(ids: string[], count: number): string[] {
  const arr = ids.slice();
  const n = Math.min(count, arr.length);
  for (let i = 0; i < n; i++) {
    const j = i + Math.floor(Math.random() * (arr.length - i));
    const tmp = arr[i] as string;
    arr[i] = arr[j] as string;
    arr[j] = tmp;
  }
  return arr.slice(0, n);
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

  // Build per-team AND per-type pools once — avoids O(n) filter per attacker
  const aliveAlpha: string[] = [];
  const aliveBravo: string[] = [];
  const aliveAlphaByType: Record<string, string[]> = { infantry: [], vehicle: [], air: [] };
  const aliveBravoByType: Record<string, string[]> = { infantry: [], vehicle: [], air: [] };

  for (const [id, u] of units) {
    if (u.status !== 'destroyed') {
      if (u.team === 'alpha') {
        aliveAlpha.push(id);
        aliveAlphaByType[u.type]!.push(id);
      } else {
        aliveBravo.push(id);
        aliveBravoByType[u.type]!.push(id);
      }
    }
  }

  const allAlive  = [...aliveAlpha, ...aliveBravo];
  const tickCount = ri(TICK_MIN, TICK_MAX);
  const selected  = sampleIds(allAlive, tickCount);

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
      // Concat only the allowed type pools (max 3 lookups, no iteration)
      const enemyPool: string[] = [];
      if (canAttack.has('infantry')) enemyPool.push(...enemyByType['infantry']!);
      if (canAttack.has('vehicle'))  enemyPool.push(...enemyByType['vehicle']!);
      if (canAttack.has('air'))      enemyPool.push(...enemyByType['air']!);
      const targetId = pickNearest(units, unit, enemyPool, 12);
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

  return {
    seq,
    timestamp,
    units: Array.from(deltaMap.values()),
    events,
    kpi: computeKPI(units, seq),
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
