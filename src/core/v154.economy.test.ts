import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from './config';
import { deriveCrisisSummary } from './crisis';
import {
  availableSupplyPopulation,
  calculateEconomyPlan,
  forecastEndTurn,
  forecastNextTurnPenalties,
} from './economy-query';
import { registerCommittedState } from './query-cache';
import { createCityPopulationSnapshot, createInitialState, synchronizePopulation } from './state';
import { getPlayerVisibleTileKeys } from './visibility';
import type { FacilityState, GameState, HexCoord } from './types';

const config = () => createDefaultConfig({
  economy: {
    initialZombieCount: 0,
    initialHunterCount: { min: 0, max: 0 },
    initialGasCount: { min: 0, max: 0 },
  },
});

function setup(): GameState {
  return createInitialState(15401, config());
}

function facility(state: GameState, id: string): FacilityState {
  return state.facilities.find((candidate) => candidate.id === id)!;
}

function addHousing(
  state: GameState,
  id: string,
  position: HexCoord,
  workers: number,
  operationalStatus: FacilityState['operationalStatus'] = 'operational',
): FacilityState {
  const housing: FacilityState = {
    id,
    type: 'temporaryHousing',
    nameKey: 'facility.temporaryHousing',
    position: { ...position },
    workerCapacity: 10,
    startingOwned: false,
    startingWorkers: 0,
    startingInfected: 0,
    owner: 'player',
    status: 'owned',
    operationalStatus,
    workers,
    infected: 0,
    securedOrder: 100 + state.facilities.length,
    lastAssignedOrder: 0,
    populationOperationalTurn: operationalStatus === 'building' ? state.turn + 1 : state.turn,
    powerSupplyEnabled: true,
    lastPowerSupplied: false,
    constructible: true,
    builtTurn: operationalStatus === 'building' ? state.turn : state.turn - 1,
    recoveryOperationalTurn: null,
  };
  state.facilities.push(housing);
  return housing;
}

function isolatePowerScenario(state: GameState): void {
  state.units = [];
  state.checkpoints.forEach((checkpoint) => {
    checkpoint.waiting = 0;
    checkpoint.screening = 0;
    checkpoint.approved = 0;
  });
  for (const candidate of state.facilities) {
    candidate.workers = 0;
    candidate.infected = 0;
    candidate.operationalStatus = candidate.type === 'windPowerPlant' ? 'disabled' : 'stopped';
  }
  state.resources.fuel = 100;
  synchronizePopulation(state);
}

describe('v1.5.4 housing economy and deterministic penalty forecast', () => {
  it('allocates occupied Housing after normal Cities and before production, while empty Housing stays in the final tier', () => {
    const state = setup();
    isolatePowerScenario(state);
    const capital = facility(state, 'capital');
    Object.assign(capital, { workers: 1, operationalStatus: 'operational' });
    const powerPlant = facility(state, 'power-plant-1');
    Object.assign(powerPlant, { workers: 1, operationalStatus: 'operational' });
    const farm = facility(state, 'farm-1');
    Object.assign(farm, { workers: 1, operationalStatus: 'operational', powerSupplyEnabled: true });
    const occupied = addHousing(state, 'housing-occupied', capital.position, 1);
    const empty = addHousing(state, 'housing-empty', capital.position, 0);

    const plan = calculateEconomyPlan(state);
    const byId = new Map(plan.facilities.map((entry) => [entry.facilityId, entry]));
    expect(plan.forecast.electricity).toMatchObject({
      availableGenerationCapacity: 15,
      requiredPowerDemand: 25,
      requiredPowerAllocated: 15,
    });
    expect(byId.get(capital.id)?.projectedPowerSupplied).toBe(true);
    expect(byId.get(occupied.id)?.projectedPowerSupplied).toBe(true);
    expect(byId.get(farm.id)?.projectedPowerSupplied).toBe(false);
    expect(byId.get(empty.id)?.projectedPowerSupplied).toBe(false);
    expect(plan.forecast.housingOutage).toMatchObject({ outageCount: 0, additionalFood: 0, additionalCivilianGoods: 0 });

    occupied.workers = 0;
    occupied.infected = 1;
    occupied.operationalStatus = 'infected';
    const infectedEmpty = calculateEconomyPlan(state);
    expect(infectedEmpty.facilities.find((entry) => entry.facilityId === occupied.id)?.projectedPowerRequested).toBe(true);
    expect(infectedEmpty.forecast.housingOutage.outageCount).toBe(0);
  });

  it('counts only occupied unpowered Housing and applies its ceil penalty independently from overcrowding', () => {
    const state = setup();
    isolatePowerScenario(state);
    const capital = facility(state, 'capital');
    Object.assign(capital, { workers: capital.workerCapacity, operationalStatus: 'operational' });
    const housing = addHousing(state, 'housing-overcrowded', capital.position, 20);
    synchronizePopulation(state);

    const forecast = forecastEndTurn(state);
    const normalFood = forecast.populationConsumers * state.config.economy.populationConsumption.food;
    const normalCivilian = forecast.populationConsumers * state.config.economy.populationConsumption.civilianGoods;
    expect(forecast.overcrowding).toMatchObject({
      cities: [{ facilityId: housing.id, excess: 10, softCap: 10 }],
      additionalFood: normalFood,
      additionalCivilianGoods: normalCivilian,
    });
    expect(forecast.housingOutage).toMatchObject({
      facilities: [{ facilityId: housing.id, reason: 'power_shortage' }],
      outageCount: 1,
      penaltyRatio: 0.01,
      additionalFood: Math.ceil(normalFood / 100),
      additionalCivilianGoods: Math.ceil(normalCivilian / 100),
    });
    expect(forecast.food.maintenanceRequired).toBe(normalFood + normalFood + Math.ceil(normalFood / 100));
    expect(forecast.civilianGoods.maintenanceRequired).toBe(normalCivilian + normalCivilian + Math.ceil(normalCivilian / 100));

    housing.infected = 1;
    housing.operationalStatus = 'infected';
    expect(forecastEndTurn(state).housingOutage).toMatchObject({
      facilities: [{ facilityId: housing.id, reason: 'power_shortage' }],
      outageCount: 1,
    });

    housing.workers = 0;
    expect(forecastEndTurn(state).housingOutage.outageCount).toBe(0);
  });

  it('labels an occupied disconnected Housing separately and excludes it from the supply population pool', () => {
    const state = setup();
    const capital = facility(state, 'capital');
    const housing = addHousing(state, 'housing-disconnected', { q: 0, r: 0 }, 4);
    createCityPopulationSnapshot(state);
    expect(availableSupplyPopulation(state)).toBe(capital.workers);
    expect(forecastEndTurn(state).housingOutage.facilities).toContainEqual({
      facilityId: housing.id,
      reason: 'supply_disconnected',
    });
  });

  it('includes completed Wind generation and approved-refugee Housing capacity, but no unresolved screening RNG', () => {
    const withWind = setup();
    isolatePowerScenario(withWind);
    const capital = facility(withWind, 'capital');
    Object.assign(capital, { workers: 1, operationalStatus: 'operational' });
    addHousing(withWind, 'housing-powered-next-turn', capital.position, 1);
    const wind = facility(withWind, 'wind-power-plant-1');
    Object.assign(wind, {
      constructible: true,
      builtTurn: withWind.turn,
      operationalStatus: 'building',
      owner: 'player',
      status: 'owned',
    });
    expect(forecastNextTurnPenalties(withWind).housingOutage.active).toBe(false);
    wind.operationalStatus = 'disabled';
    wind.builtTurn = withWind.turn - 1;
    expect(forecastNextTurnPenalties(withWind).housingOutage.active).toBe(true);

    const reception = setup();
    const receptionCapital = facility(reception, 'capital');
    receptionCapital.workers = receptionCapital.workerCapacity;
    const building = addHousing(reception, 'housing-building', receptionCapital.position, 0, 'building');
    reception.checkpoints.push({
      id: 'checkpoint-known-approved',
      position: { ...receptionCapital.position },
      direction: 'north',
      branchId: 'north',
      status: 'operational',
      waiting: 0,
      screening: 100,
      approved: 10,
      remainingTurns: 1,
      screeningPolicy: 'normal',
      nextArrivalTurn: null,
      infected: 0,
    });
    const completed = forecastNextTurnPenalties(reception);
    expect(completed.overcrowding.active).toBe(false);
    expect(completed.overcrowding.facilities).toEqual([]);
    reception.facilities = reception.facilities.filter((candidate) => candidate.id !== building.id);
    const withoutCapacity = forecastNextTurnPenalties(reception);
    expect(withoutCapacity.overcrowding.facilities).toEqual([
      { facilityId: receptionCapital.id, excess: 10, softCap: receptionCapital.workerCapacity },
    ]);
  });

  it('includes a no-infection screening outcome at its actual reception timing', () => {
    const currentReception = setup();
    const capital = facility(currentReception, 'capital');
    capital.workers = capital.workerCapacity;
    addHousing(currentReception, 'housing-completes-later', capital.position, 0, 'building');
    currentReception.checkpoints.push({
      id: 'checkpoint-deterministic-screening', position: { ...capital.position }, direction: 'north', branchId: 'north',
      status: 'operational', waiting: 0, screening: 10, approved: 0, remainingTurns: 1,
      screeningPolicy: 'strict', nextArrivalTurn: null, infected: 0,
    });
    const accepted = Math.floor(10 * currentReception.config.refugees.policies.strict.workerRate);
    expect(currentReception.config.refugees.policies.strict.infectionRate).toBe(0);
    expect(forecastNextTurnPenalties(currentReception).overcrowding.facilities).toContainEqual({
      facilityId: capital.id,
      excess: accepted,
      softCap: capital.workerCapacity,
    });

    // With no eligible current-snapshot recipient, the confirmed workers stay
    // approved and enter the Housing only after it completes next Player Turn.
    capital.infected = 1;
    capital.operationalStatus = 'infected';
    expect(forecastNextTurnPenalties(currentReception).overcrowding.active).toBe(false);

    const tied = setup();
    const tiedCapital = facility(tied, 'capital');
    const tiedCity = facility(tied, 'city-1');
    tiedCapital.workers = tiedCapital.workerCapacity;
    Object.assign(tiedCity, {
      owner: 'player', status: 'owned', operationalStatus: 'operational', infected: 0,
      workers: tiedCity.workerCapacity, populationOperationalTurn: tied.turn,
    });
    // Deliberately opposite to ID order: overflow ties must keep the existing
    // snapshot reception order used by the real EndTurn path.
    tied.cityPopulationSnapshot.reception = [
      { facilityId: tiedCity.id, population: tiedCity.workers, eligible: true },
      { facilityId: tiedCapital.id, population: tiedCapital.workers, eligible: true },
    ];
    tied.checkpoints.push({
      id: 'checkpoint-stable-tie', position: { ...tiedCapital.position }, direction: 'north', branchId: 'north',
      status: 'operational', waiting: 0, screening: 2, approved: 0, remainingTurns: 1,
      screeningPolicy: 'strict', nextArrivalTurn: null, infected: 0,
    });
    expect(forecastNextTurnPenalties(tied).overcrowding.facilities).toContainEqual({
      facilityId: tiedCity.id,
      excess: 1,
      softCap: tiedCity.workerCapacity,
    });
  });

  it('returns detached cached forecasts, creates and clears both crisis reasons, and keeps Housing vision without power or Supply', () => {
    const state = setup();
    isolatePowerScenario(state);
    const capital = facility(state, 'capital');
    Object.assign(capital, { workers: capital.workerCapacity, operationalStatus: 'operational' });
    const housing = addHousing(state, 'housing-public', { q: 0, r: 0 }, 20);
    synchronizePopulation(state);
    registerCommittedState(state);
    const first = forecastNextTurnPenalties(state);
    first.overcrowding.additionalFood = -1;
    expect(forecastNextTurnPenalties(state).overcrowding.additionalFood).toBeGreaterThan(0);
    expect(deriveCrisisSummary(state).map((entry) => entry.reasonCode)).toEqual(expect.arrayContaining([
      'overcrowding_forecast',
      'temporary_housing_outage_forecast',
    ]));
    expect(getPlayerVisibleTileKeys(state).has('0,0')).toBe(true);

    // A fresh committed State revision drops both warnings immediately.
    housing.workers = 0;
    registerCommittedState(state);
    expect(deriveCrisisSummary(state).map((entry) => entry.reasonCode)).not.toEqual(expect.arrayContaining([
      'overcrowding_forecast',
      'temporary_housing_outage_forecast',
    ]));
  });

  it('keeps the EndTurn-start power snapshot when refugee reception changes an empty Housing to occupied', () => {
    const state = setup();
    isolatePowerScenario(state);
    const capital = facility(state, 'capital');
    Object.assign(capital, { workers: 1, operationalStatus: 'operational' });
    const powerPlant = facility(state, 'power-plant-1');
    Object.assign(powerPlant, { workers: 1, operationalStatus: 'operational' });
    const farm = facility(state, 'farm-1');
    Object.assign(farm, { workers: 1, operationalStatus: 'operational', powerSupplyEnabled: true });
    const housing = addHousing(state, 'housing-snapshot', capital.position, 0);

    const endTurnStartPlan = calculateEconomyPlan(state);
    expect(endTurnStartPlan.facilities.find((entry) => entry.facilityId === housing.id)).toMatchObject({
      projectedPowerSupplied: false,
    });
    expect(endTurnStartPlan.forecast.housingOutage.outageCount).toBe(0);

    // Reception occurs after processEconomy. The already-created plan is the
    // fixed allocation used for that EndTurn even though occupancy changes.
    housing.workers = 1;
    expect(endTurnStartPlan.forecast.housingOutage.outageCount).toBe(0);
    expect(calculateEconomyPlan(state).forecast.housingOutage.outageCount).toBe(0);
    expect(calculateEconomyPlan(state).facilities.find((entry) => entry.facilityId === housing.id)?.projectedPowerSupplied).toBe(true);
  });
});
