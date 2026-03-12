import type { Unit, UnitTeam, UnitType } from '../../../shared/types.js';

const UNIT_TYPES: UnitType[] = ['infantry', 'vehicle', 'air'];

const PREFIXES: Record<UnitTeam, string[]> = {
  alpha: ['Wolf', 'Eagle', 'Falcon', 'Bear', 'Tiger', 'Lion', 'Viper', 'Ghost'],
  bravo: ['Razor', 'Storm', 'Blade', 'Iron', 'Steel', 'Rock', 'Fire', 'Dark'],
};

function ri(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function generateUnits(count: number): Map<string, Unit> {
  const units = new Map<string, Unit>();
  const half = Math.floor(count / 2);

  for (let i = 0; i < count; i++) {
    const team: UnitTeam = i < half ? 'alpha' : 'bravo';
    const type = UNIT_TYPES[ri(0, UNIT_TYPES.length - 1)] as UnitType;
    const prefixes = PREFIXES[team];
    const prefix = prefixes[ri(0, prefixes.length - 1)] as string;
    const name = `${prefix}-${String(i).padStart(5, '0')}`;

    const unit: Unit = {
      id: `u${i}`,
      name,
      type,
      team,
      status: 'idle',
      health: ri(30, 100),
      x: Math.random(),
      y: Math.random(),
    };

    units.set(unit.id, unit);
  }

  return units;
}
