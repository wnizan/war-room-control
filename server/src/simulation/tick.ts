import { randomUUID } from 'crypto';
import type { Unit, UnitDelta, TickUpdate, GameEvent, KPISummary } from '../../../shared/types.js';

const TICK_MIN = 200;
const TICK_MAX = 350;
const MOVE_DELTA = 0.015;
const EVENT_CAP = 25;

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

// Partial Fisher-Yates: shuffle first `count` elements in-place, return them
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

export function computeTick(units: Map<string, Unit>, seq: number): TickUpdate {
  const timestamp = Date.now();

  // Pre-compute alive pools per team for O(1) enemy selection
  const aliveAlpha: string[] = [];
  const aliveBravo: string[] = [];
  for (const [id, u] of units) {
    if (u.status !== 'destroyed') {
      if (u.team === 'alpha') aliveAlpha.push(id);
      else aliveBravo.push(id);
    }
  }

  const allAlive = [...aliveAlpha, ...aliveBravo];
  const tickCount = ri(TICK_MIN, TICK_MAX);
  const selected = sampleIds(allAlive, tickCount);

  const deltaMap = new Map<string, UnitDelta>();
  const events: GameEvent[] = [];

  for (const id of selected) {
    const unit = units.get(id);
    if (!unit || unit.status === 'destroyed') continue;

    const r = Math.random();

    if (r < 0.35) {
      // move
      const nx = clamp(unit.x + (Math.random() - 0.5) * MOVE_DELTA, 0, 1);
      const ny = clamp(unit.y + (Math.random() - 0.5) * MOVE_DELTA, 0, 1);
      unit.x = nx;
      unit.y = ny;
      unit.status = 'moving';
      deltaMap.set(id, { ...deltaMap.get(id), id, x: nx, y: ny, status: 'moving' });

    } else if (r < 0.55) {
      // attack
      const enemyPool = unit.team === 'alpha' ? aliveBravo : aliveAlpha;
      const targetId = pickRandom(enemyPool);
      if (targetId !== undefined) {
        const target = units.get(targetId);
        if (target && target.status !== 'destroyed') {
          const dmg = ri(5, 20);
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

    } else if (r < 0.65) {
      // heal
      if (unit.health < 100) {
        const heal = ri(3, 10);
        const newHp = Math.min(100, unit.health + heal);
        unit.health = newHp;
        unit.status = 'active';
        deltaMap.set(id, { ...deltaMap.get(id), id, health: newHp, status: 'active' });
        if (events.length < EVENT_CAP) {
          events.push({ id: randomUUID(), type: 'heal', timestamp, targetId: id, detail: `${unit.name} +${heal}hp` });
        }
      }

    } else {
      // idle transition
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
  let aliveAlpha = 0;
  let aliveBravo = 0;
  let destroyedAlpha = 0;
  let destroyedBravo = 0;

  for (const u of units.values()) {
    const destroyed = u.status === 'destroyed';
    if (u.team === 'alpha') {
      if (destroyed) destroyedAlpha++; else aliveAlpha++;
    } else {
      if (destroyed) destroyedBravo++; else aliveBravo++;
    }
  }

  const totalAlive = aliveAlpha + aliveBravo;

  return {
    seq,
    aliveAlpha,
    aliveBravo,
    destroyedAlpha,
    destroyedBravo,
    zoneControl: {
      alpha: totalAlive > 0 ? Math.round((aliveAlpha / totalAlive) * 100) : 50,
      bravo: totalAlive > 0 ? Math.round((aliveBravo / totalAlive) * 100) : 50,
    },
  };
}
