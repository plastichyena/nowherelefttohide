import { hexKey, hexDistance } from './hex';
import { getUnit } from './state';
import { getVisibleEnemyUnits } from './visibility';
import { terrainAdjustedDamage } from './terrain';
import type { CheckpointState, FacilityState } from './types';
import type { GameState, UnitState, HumanUnitType } from './types';

export interface UnitCombatProjection {
  distance: number;
  canAttack: boolean;
  militaryGoodsCost: number;
  projectedMilitaryGoodsAfterAttack: number;
  effectiveAttack: number;
  reason: 'out_of_range' | 'insufficient_military_goods' | null;
}

export function effectiveRange(state: Readonly<GameState>, unit: Readonly<UnitState>): number {
  if (!unit.isPlayerUnit) return unit.range;
  for (let distance = unit.range; distance >= 1; distance -= 1) {
    if (forecastUnitCombatAtDistance(state, unit, distance).canAttack) return distance;
  }
  return 0;
}

/** Pure distance/resource projection shared by every Human combat path. */
export function forecastUnitCombatAtDistance(
  state: Readonly<GameState>,
  unit: Readonly<UnitState>,
  distance: number,
): UnitCombatProjection {
  const normalizedDistance = Math.max(0, Math.floor(distance));
  if (normalizedDistance < 1 || normalizedDistance > unit.range) {
    return {
      distance: normalizedDistance,
      canAttack: false,
      militaryGoodsCost: 0,
      projectedMilitaryGoodsAfterAttack: unit.currentMilitaryGoods,
      effectiveAttack: 0,
      reason: 'out_of_range',
    };
  }
  if (!unit.isPlayerUnit) {
    return {
      distance: normalizedDistance,
      canAttack: true,
      militaryGoodsCost: 0,
      projectedMilitaryGoodsAfterAttack: 0,
      effectiveAttack: unit.attack,
      reason: null,
    };
  }
  const config = state.config.units[unit.type as HumanUnitType];
  const configuredCost = config.attackMilitaryGoodsCostByRange[normalizedDistance];
  const militaryGoodsCost = Number.isInteger(configuredCost) ? configuredCost : 0;
  if (unit.currentMilitaryGoods >= militaryGoodsCost) {
    return {
      distance: normalizedDistance,
      canAttack: true,
      militaryGoodsCost,
      projectedMilitaryGoodsAfterAttack: unit.currentMilitaryGoods - militaryGoodsCost,
      effectiveAttack: unit.attack,
      reason: null,
    };
  }
  if (normalizedDistance === 1 && unit.currentMilitaryGoods === 0) {
    return {
      distance: normalizedDistance,
      canAttack: true,
      militaryGoodsCost: 0,
      projectedMilitaryGoodsAfterAttack: 0,
      effectiveAttack: Math.max(1, Math.ceil(unit.attack * config.militaryGoodsShortageAttackMultiplier)),
      reason: null,
    };
  }
  return {
    distance: normalizedDistance,
    canAttack: false,
    militaryGoodsCost,
    projectedMilitaryGoodsAfterAttack: unit.currentMilitaryGoods,
    effectiveAttack: 0,
    reason: 'insufficient_military_goods',
  };
}


export interface UnitLegalAttackProjection {
  targetUnitId: string;
  distance: number;
  militaryGoodsCost: number;
  projectedMilitaryGoodsAfterAttack: number;
  projectedAttackChargesRemaining: number;
  effectiveAttack: number;
  projectedDamageBeforeTerrain: number;
  projectedDamageAfterTerrain: number;
}

export function getUnitLegalAttackProjections(
  state: Readonly<GameState>,
  unitId: string,
): UnitLegalAttackProjection[] {
  const snapshot = state as GameState;
  const unit = getUnit(snapshot, unitId);
  if (
    !unit ||
    !unit.isPlayerUnit ||
    snapshot.phase !== 'player' ||
    snapshot.gameOver ||
    (unit.actionState === 'acted' && !unit.activity.attacked) ||
    !unit.canAttack ||
    unit.attackChargesRemaining <= 0
  ) return [];
  return getVisibleEnemyUnits(snapshot)
    .map((target) => {
      const distance = hexDistance(unit.position, target.position);
      const projection = forecastUnitCombatAtDistance(snapshot, unit, distance);
      if (!projection.canAttack) return null;
      const terrainDamage = terrainAdjustedDamage(snapshot, target, projection.effectiveAttack);
      return {
        targetUnitId: target.id,
        distance,
        militaryGoodsCost: projection.militaryGoodsCost,
        projectedMilitaryGoodsAfterAttack: projection.projectedMilitaryGoodsAfterAttack,
        projectedAttackChargesRemaining: Math.max(0, unit.attackChargesRemaining - 1),
        effectiveAttack: projection.effectiveAttack,
        projectedDamageBeforeTerrain: terrainDamage.baseDamage,
        projectedDamageAfterTerrain: Math.min(target.hp, terrainDamage.finalDamage),
      };
    })
    .filter((entry): entry is UnitLegalAttackProjection => entry !== null)
    .sort((left, right) => left.targetUnitId.localeCompare(right.targetUnitId));
}

export interface SuppressionProjection {
  targetId: string;
  targetKind: 'facility' | 'checkpoint';
  suppressionPower: number;
  projectedSuppression: number;
  projectedCivilianDamage: number;
  militaryGoodsCost: number;
  militaryGoodsCostPerCheck: number;
  projectedMilitaryGoodsAfterSuppression: number;
  suppressionChecks: number;
  projectedAttackChargesRemaining: number;
}

export function infectedSuppressionTarget(
  state: Readonly<GameState>,
  unit: Readonly<UnitState>,
): FacilityState | CheckpointState | null {
  const key = hexKey(unit.position);
  return state.facilities.find((candidate) => hexKey(candidate.position) === key && candidate.infected > 0)
    ?? state.checkpoints.find((candidate) => hexKey(candidate.position) === key && candidate.infected > 0)
    ?? null;
}

/** Conditional EndTurn suppression derived only from the current public state. */
export function forecastUnitSuppression(
  state: Readonly<GameState>,
  unit: Readonly<UnitState>,
  militaryGoods = unit.currentMilitaryGoods,
): SuppressionProjection | null {
  if (
    !unit.isPlayerUnit ||
    !unit.canAttack ||
    unit.attackChargesRemaining <= 0
  ) return null;
  const target = infectedSuppressionTarget(state, unit);
  if (!target) return null;
  const facility = 'workers' in target ? target : null;
  const checkpoint = 'waiting' in target ? target : null;
  const militaryGoodsCostPerCheck = state.config.units[unit.type as HumanUnitType].suppressionMilitaryGoodsCost;
  if (militaryGoods < militaryGoodsCostPerCheck) return null;
  const suppressionPower = unit.attack;
  const healthyPopulation = facility
    ? facility.workers
    : checkpoint
      ? checkpoint.waiting + checkpoint.screening + checkpoint.approved
      : 0;
  const suppressionChecks = Math.min(
    unit.attackChargesRemaining,
    Math.ceil(target.infected / Math.max(1, suppressionPower)),
    militaryGoodsCostPerCheck === 0
      ? unit.attackChargesRemaining
      : Math.floor(militaryGoods / militaryGoodsCostPerCheck),
  );
  const militaryGoodsCost = militaryGoodsCostPerCheck * suppressionChecks;
  return {
    targetId: target.id,
    targetKind: facility ? 'facility' : 'checkpoint',
    suppressionPower,
    projectedSuppression: Math.min(target.infected, suppressionPower * suppressionChecks),
    projectedCivilianDamage: Math.min(
      healthyPopulation,
      Math.ceil(suppressionPower * state.config.units[unit.type as HumanUnitType].suppressionCivilianDamageRate) * suppressionChecks,
    ),
    militaryGoodsCost,
    militaryGoodsCostPerCheck,
    projectedMilitaryGoodsAfterSuppression: militaryGoods - militaryGoodsCost,
    suppressionChecks,
    projectedAttackChargesRemaining: Math.max(0, unit.attackChargesRemaining - suppressionChecks),
  };
}
