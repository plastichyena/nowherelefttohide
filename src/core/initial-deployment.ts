import type { FixedMap, HexCoord, HumanUnitType, UnitProficiency, UnitType } from './types';

export const FIXED_INITIAL_UNIT_POSITIONS = {
  police: { q: 24, r: 25 },
  nationalGuard: { q: 26, r: 25 },
} as const;

/** Keep creation order and explicit initial proficiency stable across refactors. */
export const INITIAL_HUMAN_DEPLOYMENT: readonly {
  id: string; type: HumanUnitType; position: HexCoord; proficiency: UnitProficiency;
}[] = [
  { id: 'police-1', type: 'police', position: FIXED_INITIAL_UNIT_POSITIONS.police, proficiency: 'regular' },
  { id: 'national-guard-1', type: 'nationalGuard', position: FIXED_INITIAL_UNIT_POSITIONS.nationalGuard, proficiency: 'regular' },
];

export function initialUnitDeployment(
  map: Pick<FixedMap, 'initialZombiePositions'>,
  hunterPositions: readonly HexCoord[],
  zombieCount: number,
): Array<{ id: string; type: UnitType; position: HexCoord; proficiency?: UnitProficiency }> {
  return [
    ...INITIAL_HUMAN_DEPLOYMENT,
    ...map.initialZombiePositions.slice(0, zombieCount).map((position, index) => ({
      id: `zombie-${index + 1}`, type: 'zombie' as const, position,
    })),
    ...hunterPositions.map((position, index) => ({
      id: `hunter-zombie-initial-${index + 1}`, type: 'hunterZombie' as const, position,
    })),
  ];
}
