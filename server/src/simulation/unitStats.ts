import type { UnitType } from '../../../shared/types.js';

export const UNIT_MAX_HP: Record<UnitType, number> = {
  infantry: 80,
  vehicle:  110,
  air:      70,
};

export const UNIT_SPAWN_HP_MIN: Record<UnitType, number> = {
  infantry: 50,
  vehicle:  70,
  air:      40,
};

export const TYPE_MOVE_MULT: Record<UnitType, number> = {
  infantry: 0.8,
  vehicle:  1.2,
  air:      1.6,
};

/** [min, max] damage range */
export const TYPE_DMG: Record<UnitType, [number, number]> = {
  infantry: [8,  18],
  vehicle:  [12, 30],
  air:      [6,  22],
};

/** Squared attack range in normalised 0-1 space */
export const TYPE_ATTACK_RANGE_SQ: Record<UnitType, number> = {
  infantry: 0.08 * 0.08,   // 0.0064
  vehicle:  0.12 * 0.12,   // 0.0144
  air:      0.20 * 0.20,   // 0.04
};

export const TYPE_CAN_ATTACK: Record<UnitType, ReadonlySet<UnitType>> = {
  infantry: new Set<UnitType>(['infantry', 'vehicle']),
  vehicle:  new Set<UnitType>(['infantry', 'vehicle']),
  air:      new Set<UnitType>(['infantry', 'vehicle', 'air']),
};

export const TYPE_CAN_HEAL: Record<UnitType, boolean> = {
  infantry: true,
  vehicle:  true,
  air:      false,
};
