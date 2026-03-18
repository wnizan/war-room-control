import type { UnitType } from '@shared/types';

/** Max HP per unit type — mirrors server/src/simulation/unitStats.ts */
export const UNIT_MAX_HP: Record<UnitType, number> = {
  infantry: 80,
  vehicle:  110,
  air:      70,
};
