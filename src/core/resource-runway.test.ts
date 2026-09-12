import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from './config';
import { deriveCrisisSummary } from './crisis';
import { forecastEndTurn } from './economy-query';
import { deriveStrategicForecast } from './forecast';
import {
  deriveResourceRunwayForecast,
  estimateResourceRunway,
} from './resource-runway';
import { createCityPopulationSnapshot, createInitialState, synchronizePopulation } from './state';
import type { GameState } from './types';

function tenPersonNoProductionState(food: number): GameState {
  const state = createInitialState(15750, createDefaultConfig({
    economy: {
      initialResources: { food, civilianGoods: 1_000, militaryGoods: 1_000, fuel: 1_000 },
      initialZombieCount: 0,
      initialHunterCount: { min: 0, max: 0 },
      initialGasCount: { min: 0, max: 0 },
    },
  }));
  for (const facility of state.facilities) {
    if (facility.owner === 'player') facility.workers = 0;
  }
  state.facilities.find((facility) => facility.type === 'capital')!.workers = 10;
  state.units = [];
  synchronizePopulation(state);
  createCityPopulationSnapshot(state);
  return state;
}

describe('v1.5.7 resource runway', () => {
  it('uses the first actual shortage turn and treats stock ending at zero as covered', () => {
    expect(estimateResourceRunway({
      startingStock: 20,
      production: 0,
      demand: 10,
      order: 'production_before_demand',
      nextEndTurnShortage: false,
    })).toMatchObject({ estimatedShortageTurn: 3, nextEndTurnShortage: false, unavailableReason: null });
    expect(estimateResourceRunway({
      startingStock: 10,
      production: 0,
      demand: 10,
      order: 'production_before_demand',
      nextEndTurnShortage: false,
    }).estimatedShortageTurn).toBe(2);
    expect(estimateResourceRunway({
      startingStock: 0,
      production: 0,
      demand: 10,
      order: 'production_before_demand',
      nextEndTurnShortage: true,
    }).estimatedShortageTurn).toBe(1);
  });

  it('preserves Civilian Goods reservation and Fuel production timing', () => {
    expect(estimateResourceRunway({
      startingStock: 10,
      production: 10,
      demand: 15,
      maintenanceDemand: 5,
      productionInputDemand: 10,
      order: 'civilian_goods_reservation',
      nextEndTurnShortage: false,
    }).estimatedShortageTurn).toBe(2);
    expect(estimateResourceRunway({
      startingStock: 0,
      production: 100,
      demand: 10,
      order: 'production_after_demand',
      nextEndTurnShortage: true,
    })).toMatchObject({ estimatedShortageTurn: 1, nextEndTurnShortage: true });
  });

  it('returns explicit null reasons for non-depletion, non-storage, and unstable production input', () => {
    expect(estimateResourceRunway({
      startingStock: 20,
      production: 10,
      demand: 10,
      order: 'production_before_demand',
      nextEndTurnShortage: false,
    })).toMatchObject({ estimatedShortageTurn: null, unavailableReason: 'not_depleting' });

    const state = tenPersonNoProductionState(20);
    const strategic = deriveStrategicForecast(state);
    expect(strategic.resources.electricity.runway.current).toMatchObject({
      estimatedShortageTurn: null,
      unavailableReason: 'non_storable',
    });

    const inputConstrained = structuredClone(forecastEndTurn(state));
    inputConstrained.civilianGoods.productionInputShortage = 1;
    expect(deriveResourceRunwayForecast('militaryGoods', inputConstrained, 0).current.unavailableReason)
      .toBe('input_dependency_unstable');
  });

  it('reapplies fuel-limited generation after virtual loss instead of subtracting physical output', () => {
    const state = tenPersonNoProductionState(100);
    const fuelLimited = structuredClone(forecastEndTurn(state));
    fuelLimited.fuel.windPowerAvailable = 0;
    fuelLimited.fuel.powerPlantPhysicalCapacity = 100;
    fuelLimited.fuel.turnStartFuel = 4;
    fuelLimited.electricity.availableGenerationCapacity = 10;
    fuelLimited.electricity.requiredPowerDemand = 10;
    fuelLimited.electricity.shortage = 0;
    const runway = deriveResourceRunwayForecast('electricity', fuelLimited, 50, {
      electricityContributorKind: 'fuel_power',
    });
    expect(runway.productionWithoutLargestContributor).toBe(10);
    expect(runway.withoutLargestContributor.nextEndTurnShortage).toBe(false);
  });

  it('includes eligible Army Base refill requirements in the Military Goods demand basis', () => {
    const state = tenPersonNoProductionState(100);
    const exact = structuredClone(forecastEndTurn(state));
    exact.militaryGoods.startingStock = 10;
    exact.militaryGoods.projectedProduction = 0;
    exact.militaryGoods.totalRefillDemand = 0;
    exact.militaryGoods.totalUnfilledRefillDemand = 0;
    const runway = deriveResourceRunwayForecast('militaryGoods', exact, 0, {
      militaryGoodsArmyBaseRefillDemand: 20,
    });
    expect(runway.currentDemandBasis).toBe(20);
    expect(runway.demandBreakdown).toEqual({ unitRefill: 0, armyBaseRefill: 20 });
    expect(runway.current).toMatchObject({ estimatedShortageTurn: 1, nextEndTurnShortage: true });
  });

  it('separates current runway from virtual largest-contributor loss', () => {
    const state = createInitialState(15751, createDefaultConfig({
      economy: {
        initialResources: { food: 100, civilianGoods: 1_000, militaryGoods: 1_000, fuel: 1_000 },
        initialZombieCount: 0,
        initialHunterCount: { min: 0, max: 0 },
        initialGasCount: { min: 0, max: 0 },
      },
    }));
    const food = deriveStrategicForecast(state).resources.food;
    expect(food.runway.current.estimatedShortageTurn).toBeNull();
    expect(food.runway.current.unavailableReason).toBe('not_depleting');
    expect(food.runway.withoutLargestContributor.estimatedShortageTurn).not.toBeNull();
    expect(deriveCrisisSummary(state).filter((entry) => entry.reasonCode === 'resource_runway_risk')).toEqual([]);
  });

  it('emits current-state critical/warnings at 1/2/3 but not 4 turns', () => {
    const cases = [
      { stock: 0, severity: 'critical', turn: 1 },
      { stock: 10, severity: 'warning', turn: 2 },
      { stock: 20, severity: 'warning', turn: 3 },
      { stock: 30, severity: null, turn: 4 },
    ] as const;
    for (const entry of cases) {
      const state = tenPersonNoProductionState(entry.stock);
      state.facilities.find((facility) => facility.type === 'capital')!.workers = 19;
      state.facilities.find((facility) => facility.type === 'farm')!.workers = 1;
      synchronizePopulation(state);
      createCityPopulationSnapshot(state);
      const food = deriveStrategicForecast(state).resources.food.runway.current;
      expect(food.estimatedShortageTurn).toBe(entry.turn);
      const alert = deriveCrisisSummary(state).find((candidate) =>
        candidate.reasonCode === 'resource_runway_risk' && candidate.entityIds[0] === 'food');
      expect(alert?.severity ?? null).toBe(entry.severity);
      if (entry.severity) {
        expect(alert?.publicFacts.causeCodes).toContain('demand_exceeds_current_production');
      }
    }
  });

  it('publishes overcrowding as a current-runway cause without changing the stable reason code', () => {
    const state = tenPersonNoProductionState(0);
    const capital = state.facilities.find((facility) => facility.type === 'capital')!;
    capital.workers = state.config.facilities.capital.workerCapacity + 1;
    synchronizePopulation(state);
    createCityPopulationSnapshot(state);
    const demand = forecastEndTurn(state).food.maintenanceRequired;
    state.resources.food = demand;
    state.events.push({
      id: 'runway-population-increase',
      turn: state.turn,
      phase: state.phase,
      type: 'population_transferred',
      payload: { from: 'road-north', to: capital.id, people: 1, reason: 'unmanaged_pass_through' },
    });
    const alert = deriveCrisisSummary(state).find((candidate) =>
      candidate.reasonCode === 'resource_runway_risk' && candidate.entityIds[0] === 'food');
    expect(alert).toMatchObject({ severity: 'warning', reasonCode: 'resource_runway_risk' });
    expect(alert?.publicFacts.causeCodes).toContain('overcrowding');
    expect(alert?.publicFacts.causeCodes).toContain('population_increase');
    expect(alert?.publicFacts.estimatedShortageTurn).toBe(2);
  });

  it('keeps the existing exact next-turn forecast for a fuel shortage despite refinery output', () => {
    const state = tenPersonNoProductionState(100);
    const exact = structuredClone(forecastEndTurn(state));
    exact.fuel.turnStartFuel = 0;
    exact.fuel.projectedRefineryProduction = 100;
    exact.fuel.projectedTotalFuelDemand = 10;
    exact.fuel.totalFuelShortage = 10;
    const runway = deriveResourceRunwayForecast('fuel', exact, 0);
    expect(runway.projectedCurrentProduction).toBe(100);
    expect(runway.current.nextEndTurnShortage).toBe(true);
    expect(runway.current.estimatedShortageTurn).toBe(1);
  });
});
