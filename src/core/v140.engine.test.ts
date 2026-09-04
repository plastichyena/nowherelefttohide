import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from './config';
import {
  deriveVictoryProgress,
  forecastEndTurn,
  forecastFacilityProduction,
  forecastUnitRefills,
  GameEngine,
  getConstructibleFacilityPositionCandidates,
  previewMove,
  unitMoveFuelCost,
} from './engine';
import { deriveStrategicForecast, getQueuePressureClass } from './forecast';
import { hexDistance, hexKey } from './hex';
import { createCityPopulationSnapshot, createInitialState, createUnit, facilityZombieTargetValue, synchronizePopulation } from './state';
import { getPlayerVisibleTileKeys } from './visibility';
import { isHexSupplied } from './supply';
import { singleFinalWave } from './testConfig';
import type { GameConfig, GameState, HexCoord } from './types';

const CENTER: HexCoord = { q: 25, r: 25 };

function safeConfig(overrides: Parameters<typeof createDefaultConfig>[0] = {}): GameConfig {
  return createDefaultConfig({
    horde: singleFinalWave(100),
    economy: {
      initialZombieCount: 0,
      initialResources: {
        food: 100_000,
        civilianGoods: 100_000,
        militaryGoods: 100_000,
        fuel: 100_000,
      },
    },
    refugees: { arrivalIntervalMin: 99, arrivalIntervalMax: 99 },
    ...overrides,
  });
}

function cloneState(state: Readonly<GameState>): GameState {
  return JSON.parse(JSON.stringify(state)) as GameState;
}

function syncScenario(state: GameState): void {
  synchronizePopulation(state);
  createCityPopulationSnapshot(state);
}

function loadScenario(engine: GameEngine, state: GameState): void {
  syncScenario(state);
  expect(engine.step({ type: 'LoadSnapshot', snapshot: state }).error).toBeNull();
}

function firstBuildable(engine: GameEngine, facilityType: 'simpleFarm' | 'civilianDroneBase'): HexCoord {
  const candidate = engine.getConstructibleFacilityPositionCandidates(facilityType).find((entry) => entry.legal);
  if (!candidate) throw new Error(`No ${facilityType} candidate`);
  return { ...candidate.position };
}

function facilityAt(state: Readonly<GameState>, id: string) {
  const facility = state.facilities.find((entry) => entry.id === id);
  if (!facility) throw new Error(`Missing facility ${id}`);
  return facility;
}

describe('v1.4 Unit Fuel and deterministic refuel', () => {
  it('uses the Hex-count Fuel table independently from weighted Terrain Cost', () => {
    expect([0, 1, 2, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map((distance) => unitMoveFuelCost('police', distance)))
      .toEqual([0, 1, 1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect([0, 1, 2, 5, 6, 7, 8, 9, 10].map((distance) => unitMoveFuelCost('nationalGuard', distance)))
      .toEqual([0, 1, 1, 1, 3, 5, 7, 9, 11]);
    const state = createInitialState(1401, safeConfig());
    expect(state.units.find((unit) => unit.type === 'police')).toMatchObject({ currentFuel: 12, maxFuel: 12, movement: 15 });
    expect(state.units.find((unit) => unit.type === 'nationalGuard')).toMatchObject({ currentFuel: 22, maxFuel: 22, movement: 10 });
  });

  it('rejects a Move whose planned Fuel exceeds the Unit pool without changing State or PRNG', () => {
    const config = safeConfig({ units: { police: { vision: 0 }, nationalGuard: { vision: 0 } } });
    const engine = new GameEngine(1402, config);
    const snapshot = cloneState(engine.getState());
    const police = snapshot.units.find((unit) => unit.type === 'police')!;
    const guard = snapshot.units.find((unit) => unit.type === 'nationalGuard')!;
    guard.position = { q: 1, r: 1 };
    police.currentFuel = 1;
    loadScenario(engine, snapshot);
    const before = engine.getState();
    const result = engine.step({ type: 'Move', unitId: police.id, destination: { q: 20, r: 15 } });
    expect(result.error?.code).toBe('insufficient_unit_fuel');
    expect(engine.getState()).toEqual(before);
  });

  it('stops at a hidden Enemy encountered midway and charges Fuel for entered Hexes only', () => {
    const config = safeConfig({
      checkpoint: { initialSupplyRadius: 0 },
      units: { police: { vision: 0 }, nationalGuard: { vision: 0 } },
      vision: { capital: 0, ownedFacility: 0, operationalCheckpoint: 0 },
    });
    const engine = new GameEngine(1403, config);
    const snapshot = cloneState(engine.getState());
    const police = snapshot.units.find((unit) => unit.type === 'police')!;
    const guard = snapshot.units.find((unit) => unit.type === 'nationalGuard')!;
    guard.position = { q: 1, r: 1 };
    police.currentFuel = 12;
    const hidden = createUnit(snapshot, 'hidden-fuel-blocker', 'zombie', { q: 31, r: 25 });
    hidden.movement = 0;
    hidden.attack = 0;
    hidden.vision = 0;
    snapshot.units.push(hidden);
    loadScenario(engine, snapshot);
    expect(engine.getLegalActions()).toContainEqual({ type: 'Move', unitId: police.id, destination: { q: 32, r: 25 } });
    const preview = previewMove(engine.getState(), police.id, { q: 32, r: 25 });
    expect(preview.legal).toBe(true);
    expect(preview.interception).toBeNull();
    const result = engine.step({ type: 'Move', unitId: police.id, destination: { q: 32, r: 25 } });
    expect(result.error).toBeNull();
    expect(result.events.some((event) => event.type === 'interception')).toBe(true);
    const movedPolice = result.state.units.find((unit) => unit.id === police.id)!;
    expect(movedPolice.position).not.toEqual({ q: 32, r: 25 });
    const moveEvent = result.events.find((event) => event.type === 'unit_moved');
    expect(moveEvent).toBeDefined();
    const hexesMoved = Number(moveEvent?.payload.hexesMoved);
    const fuelUsed = Number(moveEvent?.payload.fuelUsed);
    expect(hexesMoved).toBeGreaterThan(0);
    expect(fuelUsed).toBe(unitMoveFuelCost('police', hexesMoved));
    expect(movedPolice.currentFuel).toBe(12 - fuelUsed);
    expect(result.state.units.find((unit) => unit.id === hidden.id)).toBeDefined();
  });

  it('resolves Power Fuel before Unit refuel, skips Supply-out Units, and uses ID-order Round Robin', () => {
    const config = safeConfig({
      economy: {
        initialResources: { fuel: 5 },
        initialWorkersByFacility: { 'refinery-1': 0 },
      },
    });
    const engine = new GameEngine(1404, config);
    const snapshot = cloneState(engine.getState());
    facilityAt(snapshot, 'wind-power-plant-1').operationalStatus = 'disabled';
    const police = snapshot.units.find((unit) => unit.type === 'police')!;
    const guard = snapshot.units.find((unit) => unit.type === 'nationalGuard')!;
    police.currentFuel = 10;
    guard.currentFuel = 20;
    guard.position = { q: 1, r: 1 };
    loadScenario(engine, snapshot);
    const before = engine.getState();
    const forecast = forecastEndTurn(before);
    expect(forecast.fuel).toMatchObject({
      turnStartFuel: 5,
      projectedPowerFuelDemand: 3,
      projectedPowerFuelUsed: 3,
      fuelAfterPower: 2,
      projectedUnitRefillDemand: 2,
      projectedUnitFuelRefilled: 2,
      projectedEndingFuel: 0,
    });
    expect(forecastUnitRefills(before)).toEqual(expect.arrayContaining([
      { unitId: 'police-1', demand: 2, amount: 2 },
      { unitId: 'national-guard-1', demand: 2, amount: 0 },
    ]));
    const beforeJson = JSON.stringify(before);
    expect(JSON.stringify(forecastEndTurn(before))).not.toBe(beforeJson);
    expect(JSON.stringify(engine.getState())).toBe(beforeJson);
    const result = engine.step({ type: 'EndTurn' });
    expect(result.error).toBeNull();
    expect(result.state.resources.fuel).toBe(0);
    expect(result.state.units.find((unit) => unit.id === 'police-1')?.currentFuel).toBe(12);
    expect(result.state.units.find((unit) => unit.id === 'national-guard-1')?.currentFuel).toBe(20);
    expect(result.events).toContainEqual(expect.objectContaining({
      type: 'resource_consumed',
      payload: expect.objectContaining({ resource: 'fuel', amount: 3, reason: 'power_generation' }),
    }));
  });
});

describe('v1.4 Wind Power Plant', () => {
  it('rejects Workers, supplies 15 Electricity at Fuel 0, and has no Supply-source effect', () => {
    const config = safeConfig({
      checkpoint: { initialSupplyRadius: 0 },
      units: { police: { vision: 0 }, nationalGuard: { vision: 0 } },
      vision: { ownedFacility: 0, operationalCheckpoint: 0 },
      economy: { initialResources: { fuel: 0 } },
    });
    const engine = new GameEngine(1410, config);
    const wind = facilityAt(engine.getState(), 'wind-power-plant-1');
    const before = engine.getState();
    expect(engine.step({ type: 'AssignWorkers', facilityId: wind.id, workers: 1 }).error).not.toBeNull();
    expect(engine.getState()).toEqual(before);
    const forecast = forecastEndTurn(before);
    expect(forecast.fuel.projectedPowerFuelUsed).toBe(0);
    expect(forecast.fuel.windPowerAvailable).toBe(15);
    expect(forecast.electricity.availableGenerationCapacity).toBe(15);
    const outside = before.map.tiles.find((tile) => hexDistance(CENTER, tile) > 0 && !isHexSupplied(before, tile));
    expect(outside).toBeDefined();
    expect(isHexSupplied(before, { q: 16, r: 14 })).toBe(false);
  });

  it('uses Wind before Power Plant Fuel when demand exceeds Wind capacity', () => {
    const config = safeConfig({ economy: { initialResources: { fuel: 1 } } });
    const engine = new GameEngine(1411, config);
    const snapshot = cloneState(engine.getState());
    const city = facilityAt(snapshot, 'city-1');
    city.owner = 'player';
    city.status = 'owned';
    city.operationalStatus = 'operational';
    city.populationOperationalTurn = 1;
    city.securedOrder = 6;
    city.workers = 1;
    facilityAt(snapshot, 'capital').workers -= 1;
    loadScenario(engine, snapshot);
    const forecast = forecastEndTurn(engine.getState());
    expect(forecast.electricity.requiredPowerDemand).toBe(25);
    expect(forecast.fuel.windPowerAvailable).toBe(15);
    expect(forecast.fuel.projectedPowerFuelDemand).toBe(2);
    expect(forecast.fuel.projectedPowerFuelUsed).toBe(1);
  });

  it('disables on Zombie occupation and recovers on Human entry at the next Player Turn', () => {
    const config = safeConfig({ units: { zombie: { movement: 0, attack: 1, vision: 0 } } });
    const engine = new GameEngine(1412, config);
    const snapshot = cloneState(engine.getState());
    const wind = facilityAt(snapshot, 'wind-power-plant-1');
    snapshot.units.push(createUnit(snapshot, 'wind-occupier', 'zombie', wind.position));
    loadScenario(engine, snapshot);
    expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
    expect(facilityAt(engine.getState(), wind.id)).toMatchObject({ operationalStatus: 'disabled', workers: 0, infected: 0 });

    const cleared = cloneState(engine.getState());
    cleared.units = cleared.units.filter((unit) => unit.id !== 'wind-occupier');
    const guard = cleared.units.find((unit) => unit.type === 'nationalGuard')!;
    guard.position = { q: 25, r: 24 };
    loadScenario(engine, cleared);
    expect(engine.step({ type: 'Move', unitId: guard.id, destination: wind.position }).error).toBeNull();
    expect(facilityAt(engine.getState(), wind.id).operationalStatus).toBe('recovering');
    expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
    expect(facilityAt(engine.getState(), wind.id).operationalStatus).toBe('operational');
  });
});

describe('v1.4 Constructible Facility, Simple Farm, and Drone Base', () => {
  it('never publishes AssignWorkers for building, disabled, or recovering production facilities', () => {
    for (const operationalStatus of ['building', 'disabled', 'recovering'] as const) {
      const engine = new GameEngine(1419, safeConfig());
      const position = firstBuildable(engine, 'civilianDroneBase');
      expect(engine.step({ type: 'BuildConstructibleFacility', facilityType: 'civilianDroneBase', position }).error).toBeNull();
      const scenario = cloneState(engine.getState());
      const drone = scenario.facilities.find((facility) => facility.constructible && facility.type === 'civilianDroneBase')!;
      drone.populationOperationalTurn = scenario.turn;
      drone.operationalStatus = operationalStatus;
      loadScenario(engine, scenario);

      expect(engine.getLegalActions()).not.toContainEqual(expect.objectContaining({
        type: 'AssignWorkers',
        facilityId: drone.id,
      }));
      expect(engine.step({ type: 'AssignWorkers', facilityId: drone.id, workers: 1 }).error?.code)
        .toBe('facility_not_operational');
    }
  });

  it('builds a Simple Farm in a Core candidate, keeps Build Turn inactive, and unlocks next turn', () => {
    const engine = new GameEngine(1420, safeConfig());
    const position = firstBuildable(engine, 'simpleFarm');
    const before = engine.getState();
    const result = engine.step({ type: 'BuildConstructibleFacility', facilityType: 'simpleFarm', position });
    expect(result.error).toBeNull();
    const built = engine.getState().facilities.find((facility) => facility.constructible && facility.type === 'simpleFarm')!;
    expect(built).toMatchObject({
      position,
      operationalStatus: 'building',
      workers: 0,
      builtTurn: before.turn,
      populationOperationalTurn: before.turn + 1,
      powerSupplyEnabled: false,
    });
    expect(engine.getState().resources.civilianGoods).toBe(before.resources.civilianGoods - 15);
    expect(engine.getState().actionsTakenThisTurn).toBe(before.actionsTakenThisTurn + 1);
    expect(engine.step({ type: 'AssignWorkers', facilityId: built.id, workers: 1 }).error?.code).toBe('facility_not_yet_operational');
    expect(engine.step({ type: 'SetPowerSupply', facilityId: built.id, enabled: false }).error).not.toBeNull();
    expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
    expect(engine.step({ type: 'AssignWorkers', facilityId: built.id, workers: 1 }).error).toBeNull();
    expect(facilityAt(engine.getState(), built.id).workers).toBe(1);
  });

  it('enforces independent per-Type limits and does not count a destroyed facility', () => {
    const engine = new GameEngine(1421, safeConfig());
    const farms: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      const position = firstBuildable(engine, 'simpleFarm');
      expect(engine.step({ type: 'BuildConstructibleFacility', facilityType: 'simpleFarm', position }).error).toBeNull();
      farms.push(engine.getState().facilities.find((facility) => facility.constructible && facility.type === 'simpleFarm' && !farms.includes(facility.id))!.id);
    }
    const fifth = engine.getConstructibleFacilityPositionCandidates('simpleFarm')
      .find((candidate) => candidate.reasonCode === 'constructible_facility_limit_reached');
    expect(fifth).toBeDefined();
    expect(engine.step({ type: 'BuildConstructibleFacility', facilityType: 'simpleFarm', position: fifth!.position }).error?.code)
      .toBe('constructible_facility_limit_reached');
    const dronePosition = firstBuildable(engine, 'civilianDroneBase');
    expect(engine.step({ type: 'BuildConstructibleFacility', facilityType: 'civilianDroneBase', position: dronePosition }).error).toBeNull();
    expect(engine.getState().facilities.filter((facility) => facility.constructible && facility.type === 'civilianDroneBase')).toHaveLength(1);
  });

  it('runs Simple Farm at Food 5 per Worker without Electricity and reports Worker target value', () => {
    const engine = new GameEngine(1422, safeConfig());
    const position = firstBuildable(engine, 'simpleFarm');
    expect(engine.step({ type: 'BuildConstructibleFacility', facilityType: 'simpleFarm', position }).error).toBeNull();
    expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
    const farm = engine.getState().facilities.find((facility) => facility.constructible && facility.type === 'simpleFarm')!;
    expect(engine.step({ type: 'AssignWorkers', facilityId: farm.id, workers: 10 }).error).toBeNull();
    const staffed = engine.getState();
    const projection = forecastFacilityProduction(staffed).find((entry) => entry.facilityId === farm.id)!;
    expect(projection).toMatchObject({ operatingWorkers: 10, powerMode: 'none', projectedPowerSupplied: false, outputs: { food: 50 } });
    expect(facilityZombieTargetValue(staffed, facilityAt(staffed, farm.id))).toBe(10);
    const beforeToggle = engine.getState();
    expect(engine.step({ type: 'SetPowerSupply', facilityId: farm.id, enabled: true }).error?.code).toBe('power_supply_not_applicable');
    expect(engine.getState()).toEqual(beforeToggle);
    expect(forecastFacilityProduction(engine.getState()).find((entry) => entry.facilityId === farm.id)?.outputs).toEqual({ food: 50 });
  });

  it('gives a powered Drone Base Vision workers*3 without extending Supply, and stops on Power OFF', () => {
    const config = safeConfig({
      units: { police: { vision: 0 }, nationalGuard: { vision: 0 } },
      vision: { ownedFacility: 0, operationalCheckpoint: 0 },
    });
    const engine = new GameEngine(1423, config);
    const position = firstBuildable(engine, 'civilianDroneBase');
    expect(engine.step({ type: 'BuildConstructibleFacility', facilityType: 'civilianDroneBase', position }).error).toBeNull();
    expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
    const drone = engine.getState().facilities.find((facility) => facility.constructible && facility.type === 'civilianDroneBase')!;
    expect(engine.step({ type: 'AssignWorkers', facilityId: drone.id, workers: 5 }).error).toBeNull();
    expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
    const powered = engine.getState();
    const staffedDrone = facilityAt(powered, drone.id);
    expect(staffedDrone.lastPowerSupplied).toBe(true);
    expect(facilityZombieTargetValue(powered, staffedDrone)).toBe(5);
    const frontier = powered.map.tiles.find((tile) =>
      hexDistance(staffedDrone.position, tile) === 15 && hexDistance(CENTER, tile) > 5,
    );
    expect(frontier).toBeDefined();
    expect(getPlayerVisibleTileKeys(powered).has(frontier!.key)).toBe(true);
    expect(isHexSupplied(powered, { q: frontier!.q, r: frontier!.r })).toBe(false);
    expect(engine.step({ type: 'SetPowerSupply', facilityId: drone.id, enabled: false }).error).toBeNull();
    expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
    const unpowered = engine.getState();
    expect(facilityAt(unpowered, drone.id).lastPowerSupplied).toBe(false);
    expect(getPlayerVisibleTileKeys(unpowered).has(frontier!.key)).toBe(false);
  });
});

describe('v1.4 Strategic Forecast and Queue Pressure', () => {
  it('distinguishes a Food Single Point of Failure from an already-short resource', () => {
    const state = createInitialState(1430, safeConfig({ economy: { initialResources: { food: 0 } } }));
    const strategic = deriveStrategicForecast(state);
    expect(strategic.resources.food).toMatchObject({
      largestContributorFacilityId: 'farm-1',
      currentlyShort: false,
      singlePointOfFailure: true,
      projectedSupplyWithoutLargestContributor: 0,
    });
    const short = cloneState(state);
    facilityAt(short, 'farm-1').workers = 0;
    syncScenario(short);
    const currentlyShort = deriveStrategicForecast(short).resources.food;
    expect(currentlyShort.currentlyShort).toBe(true);
    expect(currentlyShort.singlePointOfFailure).toBe(false);
  });

  it('predicts Guaranteed Defeat in Food-before-Civilian-Goods order from public economy only', () => {
    const foodState = createInitialState(1431, safeConfig({ economy: { initialResources: { food: 0, civilianGoods: 0 } } }));
    for (const facility of foodState.facilities) if (facility.owner === 'player') facility.workers = 0;
    facilityAt(foodState, 'capital').workers = 1;
    syncScenario(foodState);
    const food = deriveStrategicForecast(foodState).guaranteedDefeat;
    expect(food).toMatchObject({ guaranteed: true, causeResource: 'food', defeatReason: 'healthyCiviliansLost', projectedHealthyCivilians: 0 });

    const goodsState = createInitialState(1432, safeConfig({ economy: { initialResources: { food: 100, civilianGoods: 0 } } }));
    for (const facility of goodsState.facilities) if (facility.owner === 'player') facility.workers = 0;
    facilityAt(goodsState, 'capital').workers = 1;
    syncScenario(goodsState);
    const civilianGoods = deriveStrategicForecast(goodsState).guaranteedDefeat;
    expect(civilianGoods).toMatchObject({ guaranteed: true, causeResource: 'civilianGoods', defeatReason: 'healthyCiviliansLost', projectedHealthyCivilians: 0 });

    const hidden = cloneState(goodsState);
    hidden.units.push(createUnit(hidden, 'hidden-forecast-zombie', 'zombie', { q: 0, r: 0 }));
    syncScenario(hidden);
    expect(deriveStrategicForecast(hidden).guaranteedDefeat).toEqual(civilianGoods);
  });

  it('uses the exact Queue Pressure boundaries 0 / 20 / 21 / 40 / 41', () => {
    expect(getQueuePressureClass(0, 20)).toBe('none');
    expect(getQueuePressureClass(1, 20)).toBe('low');
    expect(getQueuePressureClass(20, 20)).toBe('low');
    expect(getQueuePressureClass(21, 20)).toBe('medium');
    expect(getQueuePressureClass(40, 20)).toBe('medium');
    expect(getQueuePressureClass(41, 20)).toBe('high');
  });

  it('keeps Forecast and Candidate Queries pure, detached, and deterministic', () => {
    const engine = new GameEngine(1433, safeConfig());
    const state = engine.getState();
    const before = JSON.stringify(state);
    const first = deriveStrategicForecast(state);
    expect(JSON.stringify(deriveStrategicForecast(state))).toBe(JSON.stringify(first));
    expect(JSON.stringify(engine.getState())).toBe(before);
    const checkpointCandidates = engine.getCheckpointPositionCandidates();
    const buildCandidate = checkpointCandidates.find((candidate) => candidate.actionType === 'BuildCheckpoint' && candidate.legal);
    expect(buildCandidate).toBeDefined();
    expect(buildCandidate).toMatchObject({
      currentBranchRadius: 5,
      projectedBranchRadius: expect.any(Number),
      newlySuppliedHexCount: expect.any(Number),
      newlyUnsuppliedHexCount: expect.any(Number),
      suppliedFacilityDelta: expect.any(Number),
      newlyBuildableConstructibleHexCount: expect.any(Number),
    });
    expect(JSON.stringify(engine.getState())).toBe(before);
    const constructible = getConstructibleFacilityPositionCandidates(state, 'simpleFarm');
    expect(constructible.length).toBe(51 * 51);
    expect(JSON.stringify(engine.getState())).toBe(before);
  });
});
