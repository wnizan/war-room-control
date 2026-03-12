import { randomUUID } from 'crypto';
import type { Unit, UnitDelta, TickUpdate, GameEvent, KPISummary } from '../../../shared/types.js';

const TICK_MIN  = 200;
const TICK_MAX  = 350;
const EVENT_CAP = 25;

// Normal random move delta
const MOVE_RANDOM  = 0.010;
// Advance toward enemy objective (conquest pull)
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
function advanceMove(unit: Unit): { nx: number; ny: number } {
  const obj = unit.team === 'alpha' ? ALPHA_OBJECTIVE : BRAVO_OBJECTIVE;
  const dx = obj.x - unit.x;
  const dy = obj.y - unit.y;
  const dist = Math.sqrt(dx * dx + dy * dy);

  // Advance component (normalised direction * step), only when not already close
  const advX = dist > 0.05 ? (dx / dist) * MOVE_ADVANCE : 0;
  const advY = dist > 0.05 ? (dy / dist) * MOVE_ADVANCE : 0;

  // Random component
  const rndX = (Math.random() - 0.5) * MOVE_RANDOM;
  const rndY = (Math.random() - 0.5) * MOVE_RANDOM;

  return {
    nx: clamp(unit.x + advX + rndX, 0, 1),
    ny: clamp(unit.y + advY + rndY, 0, 1),
  };
}

export function computeTick(units: Map<string, Unit>, seq: number): TickUpdate {
  const timestamp = Date.now();

  const aliveAlpha: string[] = [];
  const aliveBravo: string[] = [];
  for (const [id, u] of units) {
    if (u.status !== 'destroyed') {
      if (u.team === 'alpha') aliveAlpha.push(id);
      else aliveBravo.push(id);
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
      // Attack nearest enemy
      const enemyPool = unit.team === 'alpha' ? aliveBravo : aliveAlpha;
      const targetId  = pickRandom(enemyPool);
      if (targetId !== undefined) {
        const target = units.get(targetId);
        if (target && target.status !== 'destroyed') {
          const dmg   = ri(5, 20);
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

    } else if (r < 0.68) {
      // Heal
      if (unit.health < 100) {
        const heal  = ri(3, 10);
        const newHp = Math.min(100, unit.health + heal);
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
