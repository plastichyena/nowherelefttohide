import type { FixedMap, HexCoord, HumanUnitType, UnitProficiency, UnitType } from './types';

export const INITIAL_CHECKPOINT_DEPLOYMENT = [
  { id: 'checkpoint-1', branchId: 'north', position: { q: 25, r: 20 } },
  { id: 'checkpoint-2', branchId: 'east', position: { q: 30, r: 25 } },
  { id: 'checkpoint-3', branchId: 'south', position: { q: 25, r: 30 } },
  { id: 'checkpoint-4', branchId: 'west', position: { q: 20, r: 25 } },
] as const;

export const FIXED_INITIAL_UNIT_POSITIONS = {
  police: { q: 24, r: 25 },
  police2: { q: 25, r: 24 },
  police3: { q: 25, r: 26 },
  police4: { q: 24, r: 26 },
  riotPolice: { q: 24, r: 24 },
  reconTeam: { q: 26, r: 26 },
  nationalGuard: { q: 26, r: 25 },
} as const;

/** Keep creation order and explicit initial proficiency stable across refactors. */
export const INITIAL_HUMAN_DEPLOYMENT: readonly {
  id: string; type: HumanUnitType; position: HexCoord; proficiency: UnitProficiency;
}[] = [
  { id: 'police-1', type: 'police', position: FIXED_INITIAL_UNIT_POSITIONS.police, proficiency: 'regular' },
  { id: 'police-2', type: 'police', position: FIXED_INITIAL_UNIT_POSITIONS.police2, proficiency: 'regular' },
  { id: 'police-3', type: 'police', position: FIXED_INITIAL_UNIT_POSITIONS.police3, proficiency: 'regular' },
  { id: 'police-4', type: 'police', position: FIXED_INITIAL_UNIT_POSITIONS.police4, proficiency: 'regular' },
  { id: 'riot-police-1', type: 'riotPolice', position: FIXED_INITIAL_UNIT_POSITIONS.riotPolice, proficiency: 'regular' },
  { id: 'recon-team-1', type: 'reconTeam', position: FIXED_INITIAL_UNIT_POSITIONS.reconTeam, proficiency: 'regular' },
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
