import type { HumanUnitType, UnitType, ZombieUnitType } from './types';

/** Insertion order is the existing validation/enumeration order, not a sort order. */
export const UNIT_CATALOG = {
  police: { faction: 'human', ai: null, waveSlot: null, reanimation: 'policeZombie' },
  nationalGuard: { faction: 'human', ai: null, waveSlot: null, reanimation: 'soldierZombie' },
  riotPolice: { faction: 'human', ai: null, waveSlot: null, reanimation: 'riotZombie' },
  zombie: { faction: 'zombie', ai: 'normal', waveSlot: 'nonHorde', reanimation: null },
  hordeZombie: { faction: 'zombie', ai: 'horde', waveSlot: 'horde', reanimation: null },
  policeZombie: { faction: 'zombie', ai: 'normal', waveSlot: 'nonHorde', reanimation: null },
  soldierZombie: { faction: 'zombie', ai: 'normal', waveSlot: 'nonHorde', reanimation: null },
  riotZombie: { faction: 'zombie', ai: 'normal', waveSlot: 'nonHorde', reanimation: null },
  hunterZombie: { faction: 'zombie', ai: 'normal', waveSlot: 'nonHorde', reanimation: null },
} as const satisfies Record<UnitType, {
  faction: 'human' | 'zombie'; ai: 'normal' | 'horde' | null;
  waveSlot: 'horde' | 'nonHorde' | null; reanimation: ZombieUnitType | null;
}>;

export function isUnitType(type: unknown): type is UnitType {
  return typeof type === 'string' && Object.prototype.hasOwnProperty.call(UNIT_CATALOG, type);
}

export function isHumanUnitType(type: unknown): type is HumanUnitType {
  return isUnitType(type) && UNIT_CATALOG[type].faction === 'human';
}

export function isZombieUnitType(type: unknown): type is ZombieUnitType {
  return isUnitType(type) && UNIT_CATALOG[type].faction === 'zombie';
}

export function isNormalAiZombie(unit: { type: UnitType }): boolean {
  return isUnitType(unit.type) && UNIT_CATALOG[unit.type].ai === 'normal';
}

export const UNIT_TYPES = Object.freeze(Object.keys(UNIT_CATALOG) as UnitType[]);
export const HUMAN_UNIT_TYPES = Object.freeze(UNIT_TYPES.filter(isHumanUnitType));
export const ZOMBIE_UNIT_TYPES = Object.freeze(UNIT_TYPES.filter(isZombieUnitType));
export const WAVE_NON_HORDE_TYPES = Object.freeze(ZOMBIE_UNIT_TYPES.filter(
  (type) => UNIT_CATALOG[type].waveSlot === 'nonHorde',
)) as readonly Exclude<ZombieUnitType, 'hordeZombie'>[];
