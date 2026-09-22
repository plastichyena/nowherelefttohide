import type { GameState, UnitState, HumanUnitType, UnitProficiency, UnitMode } from './types';
import { isHumanUnitType } from './unit-catalog';

export function hasCapability(state: Pick<GameState, 'config'>, unit: Pick<UnitState, 'type'>, capability: 'capture' | 'recoverCheckpoint' | 'suppress' | 'contain'): boolean {
  return isHumanUnitType(unit.type) && state.config.units[unit.type].capabilities[capability];
}

export function deployedArtillery(unit: Pick<UnitState, 'type' | 'mode'>): boolean {
  return unit.type === 'fieldArtillery' && unit.mode === 'deployed';
}

export function canReact(unit: Pick<UnitState, 'type' | 'mode' | 'canAttack'>): boolean {
  return unit.canAttack && !deployedArtillery(unit);
}

export function humanAttack(state: Pick<GameState, 'config'>, type: HumanUnitType, proficiency: UnitProficiency, mode?: UnitMode): number {
  const base = type === 'fieldArtillery' && mode === 'deployed' ? state.config.units.fieldArtillery.deployed.recruitAttack : state.config.units[type].recruitAttack;
  return proficiency === 'recruit' ? base : Math.ceil(base * state.config.unitExperience.regularAttackMultiplier);
}

export function synchronizeArtilleryStats(state: Pick<GameState, 'config'>, unit: UnitState): void {
  if (unit.type !== 'fieldArtillery') return;
  const stats = unit.mode === 'deployed' ? state.config.units.fieldArtillery.deployed : state.config.units.fieldArtillery;
  unit.attack = humanAttack(state, unit.type, unit.proficiency!, unit.mode);
  unit.movement = stats.movement;
  unit.range = stats.range;
  unit.maxAttackCharges = 1;
}
