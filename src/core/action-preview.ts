import { forecastEndTurn } from './economy-query';
import { GameEngine } from './engine';
import { cloneState } from './state';
import type { EndTurnForecast, GameAction, GameState, JsonValue, ResourceType } from './types';

export interface SupportHeadroomProjection {
  peopleEquivalent: number;
  limitingResources: Array<'food' | 'civilianGoods'>;
  resources: {
    food: { available: number; committedDemand: number; perPersonCost: number; peopleEquivalent: number };
    civilianGoods: { available: number; committedDemand: number; perPersonCost: number; peopleEquivalent: number };
  };
}

export interface EconomyPreviewSnapshot {
  food: number;
  civilianGoods: number;
  militaryGoods: number;
  fuel: number;
  electricity: { capacity: number; required: number; shortage: number };
  populationLoss: number;
  projectedHealthyCivilians: number;
  guaranteedDefeat: boolean;
  refineryAllowance: EndTurnForecast['refineryAllowance'];
}

export interface CoreActionPreview {
  baseRevision: number;
  action: GameAction;
  legal: boolean;
  reasonCode: string | null;
  reason: string | null;
  immediate: {
    resourceDelta: Record<ResourceType, number>;
    healthyCivilianDelta: number;
    unitPopulationDelta: number;
    refineryAllowanceDelta: number;
  };
  nextEndTurn: { before: EconomyPreviewSnapshot; after: EconomyPreviewSnapshot };
  supportHeadroom: { before: SupportHeadroomProjection; after: SupportHeadroomProjection; delta: number };
  completionTurn: number | null;
  firstEconomyEffectTurn: number;
  steadyStatePerTurnDelta: Record<'food' | 'civilianGoods' | 'militaryGoods' | 'fuel' | 'electricity', number>;
  uncertain: string[];
}

function shortagePopulationLoss(state: Readonly<GameState>, forecast: EndTurnForecast): number {
  const afterFood = Math.max(0, state.population.healthyCivilians - forecast.food.shortage);
  const afterCivilian = Math.max(0, afterFood - forecast.civilianGoods.maintenanceShortage);
  return state.population.healthyCivilians - afterCivilian;
}

function snapshot(state: Readonly<GameState>, forecast: EndTurnForecast): EconomyPreviewSnapshot {
  const populationLoss = shortagePopulationLoss(state, forecast);
  const projectedHealthyCivilians = Math.max(0, state.population.healthyCivilians - populationLoss);
  return {
    food: forecast.food.endingStock,
    civilianGoods: forecast.civilianGoods.endingStock,
    militaryGoods: forecast.militaryGoods.projectedEndingStock,
    fuel: forecast.fuel.endingStock,
    electricity: {
      capacity: forecast.electricity.physicalGenerationCapacity,
      required: forecast.electricity.requiredPowerDemand,
      shortage: forecast.electricity.shortage,
    },
    populationLoss,
    projectedHealthyCivilians,
    guaranteedDefeat: projectedHealthyCivilians === 0,
    refineryAllowance: structuredClone(forecast.refineryAllowance),
  };
}

export function deriveSupportHeadroom(
  state: Readonly<GameState>,
  forecast: EndTurnForecast = forecastEndTurn(state),
): SupportHeadroomProjection {
  const foodCost = state.config.economy.populationConsumption.food;
  const civilianCost = state.config.economy.populationConsumption.civilianGoods;
  const foodAvailable = forecast.food.startingStock + forecast.food.projectedProduction;
  const civilianAvailable = forecast.civilianGoods.startingStock
    - forecast.civilianGoods.productionInputAllocated
    + forecast.civilianGoods.projectedProduction;
  const foodPeople = foodCost > 0 ? Math.floor(Math.max(0, foodAvailable - forecast.food.maintenanceRequired) / foodCost) : Number.MAX_SAFE_INTEGER;
  const civilianPeople = civilianCost > 0 ? Math.floor(Math.max(0, civilianAvailable - forecast.civilianGoods.maintenanceRequired) / civilianCost) : Number.MAX_SAFE_INTEGER;
  const peopleEquivalent = Math.min(foodPeople, civilianPeople);
  const limitingResources: SupportHeadroomProjection['limitingResources'] = [];
  if (foodPeople === peopleEquivalent) limitingResources.push('food');
  if (civilianPeople === peopleEquivalent) limitingResources.push('civilianGoods');
  return {
    peopleEquivalent,
    limitingResources,
    resources: {
      food: { available: foodAvailable, committedDemand: forecast.food.maintenanceRequired, perPersonCost: foodCost, peopleEquivalent: foodPeople },
      civilianGoods: { available: civilianAvailable, committedDemand: forecast.civilianGoods.maintenanceRequired, perPersonCost: civilianCost, peopleEquivalent: civilianPeople },
    },
  };
}

function zeroResourceDelta(): Record<ResourceType, number> {
  return { food: 0, civilianGoods: 0, militaryGoods: 0, fuel: 0 };
}

function productionDelta(before: EndTurnForecast, after: EndTurnForecast): CoreActionPreview['steadyStatePerTurnDelta'] {
  return {
    food: after.food.projectedProduction - before.food.projectedProduction,
    civilianGoods: after.civilianGoods.projectedProduction - before.civilianGoods.projectedProduction,
    militaryGoods: after.militaryGoods.projectedProduction - before.militaryGoods.projectedProduction,
    fuel: after.fuel.projectedProduction - before.fuel.projectedProduction,
    electricity: after.electricity.physicalGenerationCapacity - before.electricity.physicalGenerationCapacity,
  };
}

/**
 * Pure-from-the-caller's-perspective action preview. A disposable Engine
 * validates and applies the action to a detached snapshot; the live Engine,
 * RNG, action sequence, events, and query revision are never touched.
 */
export function previewCoreAction(
  state: Readonly<GameState>,
  action: GameAction,
  baseRevision: number,
): CoreActionPreview {
  const beforeState = cloneState(state as GameState);
  const beforeForecast = forecastEndTurn(beforeState);
  const beforeHeadroom = deriveSupportHeadroom(beforeState, beforeForecast);
  let afterState = beforeState;
  let legal = true;
  let reasonCode: string | null = null;
  let reason: string | null = null;

  if (action.type === 'StartNewGame' || action.type === 'LoadSnapshot') {
    legal = false;
    reasonCode = 'preview_unsupported_action';
    reason = 'Session lifecycle actions are not previewable';
  } else if (action.type !== 'EndTurn') {
    const scratch = new GameEngine(beforeState.seed, beforeState.config);
    const loaded = scratch.step({ type: 'LoadSnapshot', snapshot: beforeState });
    if (loaded.error) throw new Error(`Preview snapshot rejected: ${loaded.error.code}`);
    const result = scratch.step(action);
    if (result.error) {
      legal = false;
      reasonCode = result.error.code;
      reason = result.error.message;
    } else {
      afterState = cloneState(result.state as GameState);
    }
  } else {
    const scratch = new GameEngine(beforeState.seed, beforeState.config);
    const loaded = scratch.step({ type: 'LoadSnapshot', snapshot: beforeState });
    if (loaded.error) throw new Error(`Preview snapshot rejected: ${loaded.error.code}`);
    legal = scratch.getLegalActions().some((candidate) => candidate.type === 'EndTurn');
    if (!legal) {
      reasonCode = 'wrong_phase';
      reason = 'Turn can only end during the player phase';
    }
  }

  const afterForecast = forecastEndTurn(afterState);
  const afterHeadroom = deriveSupportHeadroom(afterState, afterForecast);
  const resourceDelta = zeroResourceDelta();
  for (const resource of Object.keys(resourceDelta) as ResourceType[]) {
    resourceDelta[resource] = afterState.resources[resource] - beforeState.resources[resource];
  }
  const built = afterState.facilities.find((facility) => facility.constructible && facility.builtTurn === beforeState.turn
    && !beforeState.facilities.some((candidate) => candidate.id === facility.id));
  const recovered = afterState.facilities.find((facility) => facility.recoveryOperationalTurn !== null
    && beforeState.facilities.find((candidate) => candidate.id === facility.id)?.recoveryOperationalTurn !== facility.recoveryOperationalTurn);
  return {
    baseRevision,
    action: structuredClone(action),
    legal,
    reasonCode,
    reason,
    immediate: {
      resourceDelta,
      healthyCivilianDelta: afterState.population.healthyCivilians - beforeState.population.healthyCivilians,
      unitPopulationDelta: afterState.population.unitPopulation - beforeState.population.unitPopulation,
      refineryAllowanceDelta: afterState.refineryAllowance.remainingAllowance - beforeState.refineryAllowance.remainingAllowance,
    },
    nextEndTurn: { before: snapshot(beforeState, beforeForecast), after: snapshot(afterState, afterForecast) },
    supportHeadroom: { before: beforeHeadroom, after: afterHeadroom, delta: afterHeadroom.peopleEquivalent - beforeHeadroom.peopleEquivalent },
    completionTurn: built ? beforeState.turn + 1 : recovered?.recoveryOperationalTurn ?? null,
    firstEconomyEffectTurn: built ? beforeState.turn + 1 : beforeState.turn,
    steadyStatePerTurnDelta: productionDelta(beforeForecast, afterForecast),
    uncertain: ['combat', 'infection', 'refugee_arrivals', 'zombie_ai', 'unpublished_wave_composition'],
  };
}

export function coreActionPreviewJson(state: Readonly<GameState>, action: GameAction, baseRevision: number): JsonValue {
  return previewCoreAction(state, action, baseRevision) as unknown as JsonValue;
}
