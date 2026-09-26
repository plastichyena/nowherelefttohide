import type { UnitState } from './types';

export type ZombieTargetReason = 'visible_population' | 'inherited_horde' | 'wave_capital' | 'capital' | 'noise' | 'idle';

/** Once per eligible zombie, using the existing phase-start final decision. */
export function updateZombiePursuit(unit: UnitState, reason: ZombieTargetReason, bonus: number): void {
  const pursuing = reason !== 'noise' && reason !== 'idle';
  unit.pursuitMovementBonus = pursuing && unit.pursuitTargetLastPhase ? bonus : 0;
  unit.pursuitTargetLastPhase = pursuing;
}

/** Latest resolved budget, never a prediction of the next snapshot. */
export function effectiveZombieMovement(unit: Pick<UnitState, 'movement'> & Partial<Pick<UnitState, 'pursuitMovementBonus'>>): number {
  return unit.movement + (unit.pursuitMovementBonus ?? 0);
}
