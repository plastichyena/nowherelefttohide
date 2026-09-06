import { createPublicFacilityProjection } from './public-entities';
import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from './config';
import { calculateEconomyPlan, forecastArmyBaseRecruitmentPower, forecastEndTurn } from './economy-query';
import { isHexSupplied } from './supply';
import { createInitialState } from './state';
import type { FacilityState, GameState } from './types';

const config = () => createDefaultConfig({
  economy: {
    initialZombieCount: 0,
    initialHunterCount: { min: 0, max: 0 },
    initialGasCount: { min: 0, max: 0 },
  },
});

function facility(state: GameState, id: string): FacilityState {
  return state.facilities.find((candidate) => candidate.id === id)!;
}

function armyBase(state: GameState): FacilityState {
  return state.facilities.find((candidate) => candidate.type === 'armyBase')!;
}

function setPowerPriorityScenario(state: GameState, base: FacilityState): void {
  for (const facilityState of state.facilities) {
    if (facilityState.id === base.id || facilityState.id === 'capital' || facilityState.id === 'power-plant-1') continue;
    facilityState.workers = 0;
    facilityState.operationalStatus = facilityState.type === 'windPowerPlant' ? 'disabled' : 'stopped';
  }
  Object.assign(facility(state, 'capital'), { workers: 1, operationalStatus: 'operational' });
  Object.assign(facility(state, 'power-plant-1'), { workers: 2, operationalStatus: 'operational' });
  Object.assign(base, { owner: 'player', status: 'owned', operationalStatus: 'operational', workers: 0, infected: 0 });
  state.pendingUnitProductions = [{
    id: 'army-base-reservation',
    cityFacilityId: base.id,
    unitType: 'nationalGuard',
    population: 10,
    readyTurn: state.turn + 1,
  }];
}

describe('v1.5.3 economy query', () => {
  it('places a normally operating Army Base reservation after all existing power tiers, even with zero workers and outside Supply', () => {
    const state = createInitialState(15301, config());
    const base = armyBase(state);
    setPowerPriorityScenario(state, base);
    expect(isHexSupplied(state, base.position)).toBe(false);

    state.resources.fuel = 3;
    state.pendingUnitProductions = [];
    expect(forecastArmyBaseRecruitmentPower(state, base.id)).toEqual({
      hasReservation: true, requested: true, supplied: false, reason: 'fuel_shortage',
    });
    state.pendingUnitProductions = [{
      id: 'army-base-reservation',
      cityFacilityId: base.id,
      unitType: 'nationalGuard',
      population: 10,
      readyTurn: state.turn + 1,
    }];
    let plan = calculateEconomyPlan(state);
    let baseProjection = plan.facilities.find((projection) => projection.facilityId === base.id)!;
    expect(plan.forecast.electricity).toMatchObject({ availableGenerationCapacity: 5, requiredPowerDemand: 10, requiredPowerAllocated: 5 });
    expect(baseProjection).toMatchObject({
      powerMode: 'required', projectedPowerRequested: true, projectedPowerSupplied: false,
      projectedPowerReason: 'fuel_shortage',
      armyBaseMilitaryGoods: { recruitmentPower: { hasReservation: true, requested: true, supplied: false, reason: 'fuel_shortage' } },
    });
    expect(plan.armyBasePowerOrders).toEqual([{ orderId: 'army-base-reservation', facilityId: base.id, powerSupplied: false }]);

    state.resources.fuel = 4;
    plan = calculateEconomyPlan(state);
    baseProjection = plan.facilities.find((projection) => projection.facilityId === base.id)!;
    expect(plan.forecast.electricity).toMatchObject({ availableGenerationCapacity: 10, requiredPowerDemand: 10, requiredPowerAllocated: 10 });
    expect(baseProjection.armyBaseMilitaryGoods?.recruitmentPower).toEqual({
      hasReservation: true, requested: true, supplied: true, reason: 'supplied',
    });
    expect(plan.armyBasePowerOrders).toEqual([{ orderId: 'army-base-reservation', facilityId: base.id, powerSupplied: true }]);
  });

  it('holds an inactive Army Base reservation at zero demand and exposes its deferred condition', () => {
    const state = createInitialState(15302, config());
    const base = armyBase(state);
    setPowerPriorityScenario(state, base);
    state.resources.fuel = 4;
    base.infected = 1;
    base.operationalStatus = 'infected';

    const plan = calculateEconomyPlan(state);
    const projection = plan.facilities.find((candidate) => candidate.facilityId === base.id)!;
    expect(plan.forecast.electricity).toMatchObject({ requiredPowerDemand: 5, requiredPowerAllocated: 5 });
    expect(projection.armyBaseMilitaryGoods?.recruitmentPower).toEqual({
      hasReservation: true, requested: false, supplied: false, reason: 'not_eligible',
    });
    expect(plan.armyBasePowerOrders).toEqual([{ orderId: 'army-base-reservation', facilityId: base.id, powerSupplied: false }]);
  });

  it('refills dedicated Army Base Military Goods only after Human Units and only when normal and supplied', () => {
    const state = createInitialState(15303, config());
    const base = armyBase(state);
    const capital = facility(state, 'capital');
    Object.assign(base, {
      owner: 'player', status: 'owned', operationalStatus: 'operational', workers: 0, infected: 0,
      position: { ...capital.position },
      armyBase: { militaryGoods: 35, interceptionsRemaining: 0, reward: 'unclaimed' as const },
    });
    state.units = state.units.filter((unit) => unit.id === 'police-1');
    state.units[0]!.currentMilitaryGoods = 0;
    state.resources.militaryGoods = 8;

    let plan = calculateEconomyPlan(state);
    let projection = plan.facilities.find((candidate) => candidate.facilityId === base.id)!;
    expect(plan.forecast.militaryGoods.units).toEqual([expect.objectContaining({ unitId: 'police-1', projectedRefillAmount: 5 })]);
    expect(plan.armyBaseMilitaryGoodsRefills).toEqual([{ facilityId: base.id, amount: 3 }]);
    expect(plan.forecast.militaryGoods.projectedEndingStock).toBe(0);
    expect(projection.armyBaseMilitaryGoods).toMatchObject({
      current: 35, capacity: 40, projectedRefillAmount: 3, projectedAfterRefill: 38, refillEligible: true, refillReason: 'national_stock_shortage',
    });

    base.position = { q: 0, r: 0 };
    expect(isHexSupplied(state, base.position)).toBe(false);
    plan = calculateEconomyPlan(state);
    projection = plan.facilities.find((candidate) => candidate.facilityId === base.id)!;
    expect(plan.armyBaseMilitaryGoodsRefills).toEqual([]);
    expect(projection.armyBaseMilitaryGoods).toMatchObject({ projectedRefillAmount: 0, refillEligible: false, refillReason: 'out_of_supply' });
  });

  it('uses two Fuel per allocated five power, leaves Fuel 1 for Unit refill, and never creates partial power', () => {
    const state = createInitialState(15304, config());
    const base = armyBase(state);
    for (const facilityState of state.facilities) {
      if (facilityState.id === 'capital' || facilityState.id === 'power-plant-1') continue;
      facilityState.workers = 0;
      facilityState.operationalStatus = facilityState.type === 'windPowerPlant' ? 'disabled' : 'stopped';
    }
    Object.assign(facility(state, 'capital'), { workers: 1, operationalStatus: 'operational' });
    Object.assign(facility(state, 'power-plant-1'), { workers: 2, operationalStatus: 'operational' });
    state.units = state.units.filter((unit) => unit.id === 'police-1');
    state.units[0]!.currentFuel = state.units[0]!.maxFuel - 1;

    for (const [fuel, available] of [[0, 0], [1, 0], [2, 5], [3, 5]] as const) {
      state.resources.fuel = fuel;
      expect(forecastEndTurn(state).electricity.availableGenerationCapacity).toBe(available);
    }
    state.resources.fuel = 3;
    expect(forecastEndTurn(state).fuel).toMatchObject({
      projectedPowerFuelDemand: 2,
      projectedPowerFuelUsed: 2,
      fuelAfterPower: 1,
      projectedUnitFuelRefilled: 1,
      projectedEndingFuel: 0,
    });
  });
});


describe('Army Base public query consistency', () => {
  it('publishes zero power demand without a reservation and the operational rejection reason', () => {
    const state = createInitialState(15301, config());
    const base = armyBase(state);
    const publicBase = createPublicFacilityProjection(base, state);
    expect(publicBase.production).toMatchObject({powerMode:'none', powerDemand:0, requiredPowerCapacity:0, requiresPower:false});
    expect(publicBase.recruitmentUnavailableReason).toBe('not_owned');
    Object.assign(base, {owner:'player',status:'owned',operationalStatus:'disabled'});
    expect(createPublicFacilityProjection(base, state).recruitmentUnavailableReason).toBe('disabled');
  });
});
