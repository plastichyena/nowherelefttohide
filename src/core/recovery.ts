import { unitCanReceiveSupply } from './aircraft';
import { isHexSupplied } from './supply';
import type { GameState, UnitState } from './types';

export type UnitRecoveryClass = 'combat' | 'rest' | 'outOfSupply';

export interface UnitRecoveryProjection {
  projectedAmount: number;
  unavailableReasons: string[];
  activity: 'combat' | 'rest';
  recoveryClass: UnitRecoveryClass;
  rate: number;
  baseAmount: number;
  timing: 'nextPlayerTurnStart';
  requiresSurvival: true;
  requiresSupplyAtRecovery: true;
  inSupplyNow: boolean;
}

export interface RecoveryProjectionOptions {
  /** EndTurn will automatically suppress infection with the unit. */
  projectedSuppression?: boolean;
}

function roundedRecovery(maxHp: number, rate: number, rounding: 'ceil' | 'floor'): number {
  const raw = maxHp * rate;
  return rounding === 'ceil' ? Math.ceil(raw) : Math.floor(raw);
}

/**
 * Derive the conditional recovery visible to Core, UI, and Agent consumers.
 * Supply is evaluated again when the next player turn actually starts.
 */
export function deriveUnitRecovery(
  state: Readonly<GameState>,
  unit: Readonly<UnitState>,
  options: RecoveryProjectionOptions = {},
): UnitRecoveryProjection {
  const inSupplyNow = unit.isPlayerUnit && unitCanReceiveSupply(unit) && isHexSupplied(state, unit.position);
  const combat = unit.activity.overran === true || (unit.type === 'multipurposeHelicopter' && unit.activity.moved) || unit.activity.attacked || unit.activity.intercepted || unit.activity.suppressed || options.projectedSuppression === true;
  const recoveryClass: UnitRecoveryClass = !inSupplyNow ? 'outOfSupply' : combat ? 'combat' : 'rest';
  const rate = recoveryClass === 'combat'
    ? state.config.naturalRecovery.combatRate
    : recoveryClass === 'rest'
      ? state.config.naturalRecovery.restRate
      : 0;
  return {
    projectedAmount: Math.min(Math.max(0,unit.maxHp-unit.hp),roundedRecovery(unit.maxHp,rate,state.config.naturalRecovery.rounding)),
    unavailableReasons: [...(!inSupplyNow?[unit.transportedByUnitId?'transported':'supply_unavailable']:[]),...(unit.hp>=unit.maxHp?['hp_full']:[])],
    activity:combat?'combat':'rest',
    recoveryClass,
    rate,
    baseAmount: roundedRecovery(unit.maxHp, rate, state.config.naturalRecovery.rounding),
    timing: 'nextPlayerTurnStart',
    requiresSurvival: true,
    requiresSupplyAtRecovery: true,
    inSupplyNow,
  };
}
