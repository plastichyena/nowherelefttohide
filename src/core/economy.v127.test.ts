import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from './config';
import { forecastEndTurn, forecastFacilityProduction, GameEngine } from './engine';
import { synchronizePopulation } from './state';
import type { GameState } from './types';

function editableState(engine: GameEngine): GameState {
  return JSON.parse(JSON.stringify(engine.getState())) as GameState;
}

describe('v1.2.7 economy and power grid', () => {
  it('uses Fuel only for actual power allocations and doubles powered maintenance industry', () => {
    const engine = new GameEngine(127, createDefaultConfig({ economy: { initialZombieCount: 0 } }));
    const forecast = forecastEndTurn(engine.getState());
    expect(forecast.electricity).toMatchObject({
      physicalGenerationCapacity: 30,
      requiredPowerDemand: 5,
      industrialBoostDemand: 10,
      requiredPowerAllocated: 5,
      industrialBoostAllocated: 10,
    });
    expect(forecast.fuel).toMatchObject({ generationFuelDemand: 3, projectedFuelUsed: 3 });
    expect(forecast.food).toMatchObject({ projectedProduction: 230, maintenanceRequired: 115, shortage: 0 });
    expect(forecast.civilianGoods.projectedProduction).toBe(271);
  });

  it('lets same-turn maintenance goods cover maintenance but never chains refinery Fuel into generation', () => {
    const engine = new GameEngine(128, createDefaultConfig({ economy: { initialZombieCount: 0 } }));
    const state = editableState(engine);
    state.resources.food = 0;
    state.resources.civilianGoods = 0;
    state.resources.militaryGoods = 0;
    state.resources.fuel = 0;
    expect(engine.step({ type: 'LoadSnapshot', snapshot: state }).error).toBeNull();

    const forecast = forecastEndTurn(engine.getState());
    expect(forecast.electricity.availableGenerationCapacity).toBe(0);
    expect(forecast.food).toMatchObject({ projectedProduction: 115, shortage: 0, endingStock: 0 });
    expect(forecast.civilianGoods).toMatchObject({ projectedProduction: 115, maintenanceShortage: 0 });
    expect(forecast.fuel).toMatchObject({ projectedFuelUsed: 0, projectedProduction: 50, endingStock: 50 });
    expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
    expect(engine.getState().resources.fuel).toBe(50);
  });

  it('reserves starting Civilian Goods for maintenance and only then feeds Military Factories', () => {
    const engine = new GameEngine(129, createDefaultConfig({ economy: { initialZombieCount: 0 } }));
    const state = editableState(engine);
    const military = state.facilities.find((facility) => facility.id === 'military-factory-1')!;
    military.owner = 'player';
    military.status = 'owned';
    military.operationalStatus = 'operational';
    military.workers = 5;
    military.securedOrder = 10;
    military.populationOperationalTurn = 1;
    state.facilities.find((facility) => facility.id === 'capital')!.workers -= 5;
    synchronizePopulation(state);
    state.resources.civilianGoods = 0;
    expect(engine.step({ type: 'LoadSnapshot', snapshot: state }).error).toBeNull();
    const none = forecastEndTurn(engine.getState());
    expect(none.civilianGoods).toMatchObject({ productionInputDemand: 5, productionInputAllocated: 0, productionInputShortage: 5 });
    expect(none.militaryGoods.projectedProduction).toBe(0);

    const withStock = editableState(engine);
    withStock.resources.civilianGoods = 2;
    expect(engine.step({ type: 'LoadSnapshot', snapshot: withStock }).error).toBeNull();
    const partial = forecastEndTurn(engine.getState());
    expect(partial.civilianGoods.productionInputAllocated).toBe(2);
    expect(partial.militaryGoods.projectedProduction).toBeGreaterThanOrEqual(4);
  });

  it('allocates required cities, then Farm/Civilian Factory, then input-ready Military Factory', () => {
    const engine = new GameEngine(130, createDefaultConfig({ economy: { initialZombieCount: 0 } }));
    const state = editableState(engine);
    state.facilities.find((facility) => facility.id === 'power-plant-1')!.workers = 1;
    state.facilities.find((facility) => facility.id === 'capital')!.workers += 2;
    synchronizePopulation(state);
    expect(engine.step({ type: 'LoadSnapshot', snapshot: state }).error).toBeNull();
    const projections = forecastFacilityProduction(engine.getState());
    expect(projections.find((facility) => facility.facilityId === 'capital')?.projectedPowerSupplied).toBe(true);
    expect(projections.find((facility) => facility.facilityId === 'farm-1')?.projectedPowerSupplied).toBe(true);
    expect(projections.find((facility) => facility.facilityId === 'civilian-factory-1')?.projectedPowerSupplied).toBe(false);
  });

  it('changes industrial boost requests only through SetPowerSupply and refreshes forecast immediately', () => {
    const engine = new GameEngine(131, createDefaultConfig({ economy: { initialZombieCount: 0 } }));
    const before = forecastEndTurn(engine.getState());
    expect(before.electricity.industrialBoostDemand).toBe(10);
    const result = engine.step({ type: 'SetPowerSupply', facilityId: 'farm-1', enabled: false });
    expect(result.error).toBeNull();
    expect(forecastEndTurn(engine.getState()).electricity.industrialBoostDemand).toBe(5);
    const rejected = engine.step({ type: 'SetPowerSupply', facilityId: 'capital', enabled: false });
    expect(rejected.error?.code).toBe('power_supply_not_applicable');
  });

  it('allows unlimited Power Supply changes without consuming the player action budget', () => {
    const engine = new GameEngine(1311, createDefaultConfig({ economy: { initialZombieCount: 0 } }));
    const state = editableState(engine);
    state.actionsTakenThisTurn = state.config.maxActionsPerTurn;
    expect(engine.step({ type: 'LoadSnapshot', snapshot: state }).error).toBeNull();

    expect(engine.getLegalActions()).toContainEqual({ type: 'SetPowerSupply', facilityId: 'farm-1', enabled: false });
    expect(engine.step({ type: 'SetPowerSupply', facilityId: 'farm-1', enabled: false }).error).toBeNull();
    expect(engine.getState().actionsTakenThisTurn).toBe(state.config.maxActionsPerTurn);
    expect(engine.step({ type: 'SetPowerSupply', facilityId: 'farm-1', enabled: true }).error).toBeNull();
    expect(engine.getState().actionsTakenThisTurn).toBe(state.config.maxActionsPerTurn);
  });

  it('records unmet power reasons in End Turn events even when a facility did not request power', () => {
    const engine = new GameEngine(1312, createDefaultConfig({ economy: { initialZombieCount: 0 } }));
    expect(engine.step({ type: 'SetPowerSupply', facilityId: 'farm-1', enabled: false }).error).toBeNull();
    const result = engine.step({ type: 'EndTurn' });
    expect(result.error).toBeNull();
    expect(result.events).toContainEqual(expect.objectContaining({
      type: 'power_allocated',
      payload: expect.objectContaining({ facilityId: 'farm-1', supplied: false, reason: 'power_supply_off', amount: 0 }),
    }));
    expect(result.events).toContainEqual(expect.objectContaining({
      type: 'power_allocated',
      payload: expect.objectContaining({ facilityId: 'military-factory-1', supplied: false, reason: 'no_population', amount: 0 }),
    }));
  });

  it('never partially powers a facility and keeps an unpowered city administratively usable', () => {
    const engine = new GameEngine(132, createDefaultConfig({ economy: { initialZombieCount: 0 } }));
    const state = editableState(engine);
    const capital = state.facilities.find((facility) => facility.id === 'capital')!;
    const city = state.facilities.find((facility) => facility.id === 'city-1')!;
    city.owner = 'player';
    city.status = 'owned';
    city.operationalStatus = 'operational';
    city.workers = 5;
    city.securedOrder = 8;
    city.populationOperationalTurn = 1;
    capital.workers -= 5;
    state.resources.fuel = 0;
    synchronizePopulation(state);
    state.cityPopulationSnapshot.supply.push({ facilityId: city.id, population: 5, eligible: true });
    state.cityPopulationSnapshot.reception.unshift({ facilityId: city.id, population: 5, eligible: true });
    expect(engine.step({ type: 'LoadSnapshot', snapshot: state }).error).toBeNull();

    const forecast = forecastEndTurn(engine.getState());
    expect(forecast.electricity.requiredPowerAllocated).toBe(0);
    const cityProjection = forecastFacilityProduction(engine.getState()).find((item) => item.facilityId === city.id)!;
    expect(cityProjection.outputs.civilianGoods ?? 0).toBe(0);
    expect(engine.step({ type: 'TransferPopulation', fromFacilityId: city.id, toFacilityId: capital.id, people: 1 }).error).toBeNull();
    expect(engine.getState().facilities.find((facility) => facility.id === city.id)).toMatchObject({ owner: 'player', workers: 4 });
  });

  it('rounds generation down to complete five-electricity allocations', () => {
    const engine = new GameEngine(133, createDefaultConfig({
      economy: { initialZombieCount: 0 },
      facilities: { powerPlant: { production: { powerGeneration: 3 } } },
    }));
    const state = editableState(engine);
    const plant = state.facilities.find((facility) => facility.id === 'power-plant-1')!;
    const capital = state.facilities.find((facility) => facility.id === 'capital')!;
    capital.workers += plant.workers - 1;
    plant.workers = 1;
    synchronizePopulation(state);
    expect(engine.step({ type: 'LoadSnapshot', snapshot: state }).error).toBeNull();
    const forecast = forecastEndTurn(engine.getState());
    expect(forecast.electricity.physicalGenerationCapacity).toBe(3);
    expect(forecast.electricity.availableGenerationCapacity).toBe(0);
    expect(forecast.electricity.requiredPowerAllocated).toBe(0);
  });
});
