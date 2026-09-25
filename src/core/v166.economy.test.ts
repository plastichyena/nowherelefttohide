import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from './config';
import { createInitialState } from './state';
import { calculateEconomyPlan } from './economy-query';
import { GameEngine } from './engine';
import type { FacilityState, GameState } from './types';

function fixture() {
  const state = createInitialState(3, createDefaultConfig());
  state.units = [];
  state.checkpoints = [];
  for (const f of state.facilities) { f.workers = 0; f.infected = 0; }
  const base = state.facilities.find(f => f.type === 'farm')!;
  const center: FacilityState = { ...base, id: 'relief-supply-center-1', type: 'reliefSupplyCenter', nameKey: 'reliefSupplyCenter',
    position: { q: 23, r: 24 }, workerCapacity: 5, workers: 5, owner: 'player', status: 'owned', operationalStatus: 'operational',
    constructible: true, builtTurn: 1, securedOrder: 20, powerSupplyEnabled: true, populationOperationalTurn: 1 };
  state.facilities.push(center);
  state.resources.food = 100;
  state.resources.civilianGoods = 0;
  state.config.economy.populationConsumption = { food: 0, civilianGoods: 0 };
  state.population.unitPopulation = 0;
  return { state, center };
}
const projection = (s: GameState, id: string) => calculateEconomyPlan(s).facilities.find(p => p.facilityId === id)!;

describe('v1.6.6 production allocation', () => {
  it.each([[19, 0], [20, 1], [59, 2], [99, 4], [100, 5]])('allocates Food %i to %i integer workers', (food, workers) => {
    const { state, center } = fixture(); state.resources.food = food;
    const plan = calculateEconomyPlan(state); const p = plan.facilities.find(p => p.facilityId === center.id)!;
    expect(p.operatingWorkers).toBe(workers);
    expect(p.inputs.food).toBe(workers * 20);
    expect(p.outputs.civilianGoods ?? 0).toBe(workers * 5);
    expect(p.projectedPowerRequested).toBe(workers > 0);
    expect(plan.forecast.food.productionInputAllocated).toBe(workers * 20);
    expect(plan.forecast.food.endingStock).toBe(food - workers * 20);
    if (!workers) expect(p.stoppedReason).toBe('input_shortage');
  });

  it.each([[100, 80, 0, 20], [0, 0, 100, 0], [100, 80, 80, 100], [79, 80, 0, 0]])(
    'reserves maintenance F=%i M=%i P=%i, allowing %i input', (food, maintenance, produced, input) => {
      const { state, center } = fixture(); state.resources.food = food;
      state.population.unitPopulation = maintenance - 5;
      state.config.economy.populationConsumption.food = 1;
      const farm = state.facilities.find(f => f.type === 'farm')!;
      farm.workers = produced / 10; farm.powerSupplyEnabled = true;
      state.population.unitPopulation -= farm.workers;
      expect(projection(state, center.id).inputs.food ?? 0).toBe(input);
    });

  it('concentrates input in construction order and releases power-ineligible reservations', () => {
    const { state, center } = fixture();
    const second = { ...center, id: 'relief-supply-center-2', securedOrder: 21, position: { q: 23, r: 25 } };
    state.facilities.unshift(second); state.resources.food = 159;
    expect(projection(state, center.id).operatingWorkers).toBe(5);
    expect(projection(state, second.id).operatingWorkers).toBe(2);
    center.powerSupplyEnabled = false;
    expect(projection(state, center.id).inputs.food).toBe(0);
    expect(projection(state, second.id).operatingWorkers).toBe(5);
    center.powerSupplyEnabled = true; center.position = { q: 0, r: 0 };
    expect(projection(state, center.id).stoppedReason).toBe('out_of_supply');
    expect(projection(state, second.id).operatingWorkers).toBe(5);
    for (const f of state.facilities.filter(f => f.type === 'windPowerPlant')) f.operationalStatus = 'disabled';
    expect(projection(state, second.id).inputs.food).toBe(0);
    expect(calculateEconomyPlan(state).forecast.food.endingStock).toBe(159);
  });

  it('uses only powered relief output for maintenance, never chains new CG as military input', () => {
    const { state } = fixture();
    const military = state.facilities.find(f => f.type === 'militaryFactory')!;
    military.workers = 30; military.powerSupplyEnabled = true; military.operationalStatus = 'operational';
    const plant = state.facilities.find(f => f.type === 'powerPlant')!; plant.workers = 20; plant.operationalStatus = 'operational';
    state.resources.fuel = 1000;
    expect(projection(state, military.id).operatingWorkers).toBe(0);
    state.resources.civilianGoods = 300;
    expect(projection(state, military.id).inputs.civilianGoods).toBe(300);
    expect(projection(state, military.id).outputs.militaryGoods).toBe(120);
    for (const [stock, workers] of [[9, 0], [10, 1], [29, 2], [30, 3]]) {
      state.resources.civilianGoods = stock;
      expect(projection(state, military.id).operatingWorkers).toBe(workers);
    }
  });

  it('constructs, powers, staffs and produces through real Core actions, then refunds once', () => {
    const engine = new GameEngine(3, createDefaultConfig({ economy: { initialZombieCount: 0, initialGasCount: {min:0,max:0}, initialScreamerCount:0, initialHunterCount: {min:0,max:0}, initialResources: {food:10000,civilianGoods:10000,militaryGoods:10000,fuel:10000} } }));
    const candidate = engine.getConstructibleFacilityPositionCandidates('reliefSupplyCenter').find(c => c.legal)!;
    expect(engine.step({type:'BuildConstructibleFacility', facilityType:'reliefSupplyCenter', position:candidate.position}).error).toBeNull();
    const id = engine.getState().facilities.find(f => f.type === 'reliefSupplyCenter')!.id;
    expect(engine.step({type:'EndTurn'}).error).toBeNull();
    expect(engine.step({type:'AssignWorkers', facilityId:id, workers:5}).error).toBeNull();
    expect(engine.step({type:'AssignWorkers', facilityId:'power-plant-1', workers:20}).error).toBeNull();
    const plan = calculateEconomyPlan(engine.getState());
    expect(plan.facilities.find(p => p.facilityId === id)?.operatingWorkers).toBe(5);
    expect(engine.step({type:'EndTurn'}).error).toBeNull();
    expect(engine.getState().resources.food).toBe(plan.forecast.food.endingStock);
    expect(engine.getState().resources.civilianGoods).toBe(plan.forecast.civilianGoods.endingStock);
    expect(engine.step({type:'AssignWorkers',facilityId:id,workers:0}).error).toBeNull();
    const before = engine.getState().resources.civilianGoods;
    expect(engine.step({type:'DecommissionConstructibleFacility',facilityId:id}).error).toBeNull();
    expect(engine.getState().resources.civilianGoods).toBe(before + 25);
    expect(engine.step({type:'DecommissionConstructibleFacility',facilityId:id}).error).not.toBeNull();
    expect(engine.getState().resources.civilianGoods).toBe(before + 25);
  });
});
