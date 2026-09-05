import { describe, expect, it } from 'vitest';
import { GameEngine } from './engine';
import { createDefaultConfig } from './config';
import { createInitialState, synchronizePopulation } from './state';
import { calculateEconomyPlan, forecastEndTurn, forecastProductionCapacity } from './economy-query';
import { deriveStrategicForecast } from './forecast';
import type { GameState, ResourceType } from './types';

const resources: ResourceType[] = ['food', 'civilianGoods', 'militaryGoods', 'fuel'];
const config = () => createDefaultConfig({ economy: { initialZombieCount: 0, initialHunterCount: { min: 0, max: 0 } } });
const setup = () => createInitialState(152, config());
const facility = (state: GameState, id: string) => state.facilities.find(f => f.id === id)!;

describe('v1.5.2 production capacity and economy plan', () => {
  it('matches actual resource production and the query forecast without mutating State/RNG', () => {
    const engine = new GameEngine(152, config());
    const before = engine.getState();
    const capacity = forecastProductionCapacity(before);
    expect(engine.getQuery().getStrategicForecast().productionCapacity).toEqual(capacity);
    expect(deriveStrategicForecast(before).productionCapacity).toEqual(capacity);
    expect(engine.getState()).toEqual(before);
    const result = engine.step({ type: 'EndTurn' });
    expect(result.error).toBeNull();
    for (const resource of resources) {
      const produced = result.events.filter(e => e.type === 'resource_produced' && e.payload.resource === resource)
        .reduce((sum, e) => sum + Number(e.payload.amount), 0);
      expect(capacity.resources[resource].projectedEndTurnOutput).toBe(produced);
      expect(capacity.resources[resource].ratedGapUpperBound).toBeGreaterThanOrEqual(0);
    }
    expect(capacity).toMatchObject({ boundsSimultaneouslyAchievable: false, blockingReasonsOverlap: true, exactReallocationCapacityComputed: false });
    expect(Object.values(capacity.resources).every(r => r.feasibleHeadroom === 'not_computed')).toBe(true);
  });

  it('keeps infected city resident ratings separate from stopped output, and applies the population soft cap', () => {
    const state = setup();
    const capital = facility(state, 'capital');
    capital.workers = 130;
    capital.infected = 1;
    capital.operationalStatus = 'infected';
    const capacity = forecastProductionCapacity(state);
    const city = capacity.facilities.find(f => f.facilityId === 'capital')!;
    expect(city).toMatchObject({ installedRatedOutputs: {}, currentWorkerRatedOutputs: {},
      residentRatedOutputs: { civilianGoods: 100 }, residentSoftCapRatedCeiling: { civilianGoods: 100 }, residentSoftCapGap: { civilianGoods: 0 } });
    expect(city.inactiveReasons).toContain('infection');
    expect(calculateEconomyPlan(state).facilities.find(f => f.facilityId === 'capital')!.outputs).toEqual({});
    expect(capacity.resources.civilianGoods.residentRatedOutputAtCurrentPopulation).toBe(100);
    expect(capacity.resources.civilianGoods.currentTotalRatedCapacity).toBe(
      capacity.resources.civilianGoods.currentFacilityWorkerRatedCapacity + 100);
    capital.workers = 20;
    expect(forecastProductionCapacity(state).facilities.find(f => f.facilityId === 'capital')!.residentSoftCapGap).toEqual({ civilianGoods: 80 });
  });

  it('reports full staffing at the rated bound and counts fixed wind separately from staffed generation', () => {
    const state = setup();
    const farm = facility(state, 'farm-1');
    facility(state, 'capital').workers -= 30 - farm.workers;
    farm.workers = 30;
    const capacity = forecastProductionCapacity(state);
    expect(capacity.resources.food).toMatchObject({ installedFacilityRatedCapacity: 300,
      currentFacilityWorkerRatedCapacity: 300, projectedEndTurnOutput: 300, ratedGapUpperBound: 0, utilizationRatio: 1 });
    expect(capacity.electricity).toMatchObject({ installedFacilityRatedCapacity: 315,
      currentFacilityWorkerRatedCapacity: 45, currentPlanPhysicalCapacity: 45 });
    expect(capacity.facilities.find(f => f.facilityId === 'farm-1')!.inactiveReasons).not.toContain('unassigned_workers');
  });

  it('includes completed inactive owned equipment, excludes building/unowned/ruined equipment, and distinguishes power OFF', () => {
    const state = setup();
    const farm = facility(state, 'farm-1');
    farm.powerSupplyEnabled = false;
    const off = forecastProductionCapacity(state);
    expect(off.resources.food).toMatchObject({ installedFacilityRatedCapacity: 300, projectedEndTurnOutput: 0, ratedGapUpperBound: 300, utilizationRatio: 0 });
    expect(off.facilities.find(f => f.facilityId === 'farm-1')!.inactiveReasons).toContain('power_supply_off');
    for (const status of ['recovering', 'disabled', 'infected'] as const) {
      farm.operationalStatus = status;
      farm.infected = status === 'infected' ? 1 : 0;
      const current = forecastProductionCapacity(state);
      expect(current.resources.food.installedFacilityRatedCapacity).toBe(300);
      expect(current.facilities.find(f => f.facilityId === farm.id)!.inactiveReasons).toContain(status === 'infected' ? 'infection' : status);
    }
    farm.infected = 0;
    for (const excluded of ['building', 'ruined', 'unowned'] as const) {
      farm.owner = excluded === 'unowned' ? 'none' : 'player';
      farm.status = excluded === 'ruined' ? 'ruined' : excluded === 'unowned' ? 'unowned' : 'owned';
      farm.operationalStatus = excluded === 'building' ? 'building' : excluded === 'ruined' ? 'ruined' : 'stopped';
      const capacity = forecastProductionCapacity(state);
      expect(capacity.facilities.some(f => f.facilityId === farm.id)).toBe(false);
      expect(capacity.resources.food).toMatchObject({ installedFacilityRatedCapacity: 0, projectedEndTurnOutput: 0, utilizationRatio: null, utilizationUnavailableReason: 'no_rated_capacity' });
    }
  });

  it('allocates one shared input stock across factories in secured order and reallocates it when the first is OFF', () => {
    const state = setup();
    state.resources.civilianGoods = 7;
    for (const [index, id] of ['military-factory-1', 'military-factory-2'].entries()) {
      Object.assign(facility(state, id), { owner: 'player', status: 'owned', operationalStatus: 'operational',
        workers: 5, infected: 0, powerSupplyEnabled: true, securedOrder: 20 + index, populationOperationalTurn: 1 });
    }
    facility(state, 'capital').workers -= 10;
    synchronizePopulation(state);
    const plan = calculateEconomyPlan(state);
    expect(plan.facilities.find(f => f.facilityId === 'military-factory-1')!.inputs).toEqual({ civilianGoods: 5 });
    expect(plan.facilities.find(f => f.facilityId === 'military-factory-2')!.inputs).toEqual({ civilianGoods: 2 });
    const capacity = forecastProductionCapacity(state);
    expect(capacity.resources.militaryGoods).toMatchObject({ installedFacilityRatedCapacity: 240,
      currentFacilityWorkerRatedCapacity: 40, projectedEndTurnOutput: 28, currentPlanPrePowerOutput: 28, ratedGapUpperBound: 212 });
    expect(capacity.resources.militaryGoods.blockingReasonCounts.production_input_shortage).toBe(1);
    facility(state, 'military-factory-1').powerSupplyEnabled = false;
    const changed = calculateEconomyPlan(state);
    expect(changed.facilities.find(f => f.facilityId === 'military-factory-2')!.inputs).toEqual({ civilianGoods: 5 });
    expect(forecastProductionCapacity(state).resources.militaryGoods.projectedEndTurnOutput).toBe(20);
  });

  it('keeps Fuel generation/refill limited to starting stock even when Refinery production is positive', () => {
    const engine = new GameEngine(152, config());
    const state = engine.getState() as GameState;
    state.resources.fuel = 1;
    state.units.forEach(unit => { unit.currentFuel = 0; });
    expect(engine.step({ type: 'LoadSnapshot', snapshot: state }).error).toBeNull();
    const capacity = forecastProductionCapacity(state);
    const forecast = forecastEndTurn(state);
    expect(capacity.electricity).toMatchObject({ fuelBasis: 'turn_start_stock', availableGenerationCapacity: 20, storable: false });
    expect(capacity.resources.fuel.projectedEndTurnOutput).toBe(50);
    expect(forecast.fuel).toMatchObject({ projectedFuelUsed: 1, projectedUnitFuelRefilled: 0, endingStock: 50 });
    expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
    expect(engine.getState().resources.fuel).toBe(50);
    expect(engine.getState().units.every(unit => unit.currentFuel === 0)).toBe(true);
    expect(engine.getQuery().getEndTurnForecast().electricity.availableGenerationCapacity).toBeGreaterThan(20);
  });

  it('does not impose supply on production and reflects reassignment without claiming simultaneous maxima', () => {
    const state = setup();
    const remote = facility(state, 'farm-5');
    Object.assign(remote, { owner: 'player', status: 'owned', operationalStatus: 'operational',
      workers: 5, infected: 0, powerSupplyEnabled: true, securedOrder: 20, populationOperationalTurn: 1 });
    facility(state, 'capital').workers -= 5;
    const first = forecastProductionCapacity(state);
    expect(calculateEconomyPlan(state).facilities.find(f => f.facilityId === remote.id)!.outputs.food).toBe(50);
    facility(state, 'capital').workers -= 1;
    remote.workers += 1;
    const after = forecastProductionCapacity(state);
    expect(after.resources.food.currentFacilityWorkerRatedCapacity).toBe(first.resources.food.currentFacilityWorkerRatedCapacity + 10);
    expect(after.resources.civilianGoods.residentRatedOutputAtCurrentPopulation).toBe(first.resources.civilianGoods.residentRatedOutputAtCurrentPopulation - 1);
    expect(after.boundsSimultaneouslyAchievable).toBe(false);
  });
});
