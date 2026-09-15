import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from './config';
import { calculateEconomyPlan, forecastEndTurn } from './economy-query';
import { deriveCrisisSummary } from './crisis';
import { previewCoreAction } from './action-preview';
import { GameEngine } from './engine';
import { hexKey, hexNeighbors } from './hex';
import {
  FIXED_FACILITY_COUNT,
  FIXED_MAP,
  FIXED_MAP_ID,
} from './map';
import { createInitialState, createUnit, populationLedgerTotal, synchronizePopulation } from './state';
import { isHexSupplied } from './supply';
import type { DeepPartial, FacilityState, GameConfig, GameState, HexCoord, ResourceType, ZombieUnitType } from './types';

const NO_ENEMY_CONFIG: DeepPartial<GameConfig> = {
  checkpoint: { initialSupplyRadius: 20 },
  economy: {
    initialZombieCount: 0,
    initialHunterCount: { min: 0, max: 0 },
    initialGasCount: { min: 0, max: 0 },
    initialResources: { food: 10_000, civilianGoods: 10_000, militaryGoods: 10_000, fuel: 10_000 },
  },
  horde: {
    waves: [{ turn: 100, directionCount: 1, compositionPerDirection: { hordeZombie: 1, zombie: 0 }, final: true }],
  },
  refugees: { arrivalIntervalMin: 100, arrivalIntervalMax: 100 },
};

function testConfig(overrides: DeepPartial<GameConfig> = {}): GameConfig {
  return createDefaultConfig({
    ...NO_ENEMY_CONFIG,
    ...overrides,
  });
}

function testState(overrides: Partial<GameConfig> = {}): GameState {
  return createInitialState(16001, testConfig(overrides));
}

function facility(state: GameState, id: string): FacilityState {
  const value = state.facilities.find((candidate) => candidate.id === id);
  if (!value) throw new Error(`Missing facility: ${id}`);
  return value;
}

function setFacilityOperating(facilityState: FacilityState, workers: number): void {
  facilityState.owner = 'player';
  facilityState.status = 'owned';
  facilityState.operationalStatus = 'operational';
  facilityState.workers = workers;
  facilityState.infected = 0;
  facilityState.populationOperationalTurn = 1;
  facilityState.firstCaptureRewardClaimed = true;
}

function setFacilityStopped(facilityState: FacilityState): void {
  facilityState.operationalStatus = facilityState.type === 'windPowerPlant' ? 'operational' : 'stopped';
  facilityState.workers = 0;
  facilityState.infected = 0;
}

function approachPosition(state: GameState, target: HexCoord): HexCoord {
  const facilityKeys = new Set(state.facilities.map((candidate) => hexKey(candidate.position)));
  const unitKeys = new Set(state.units.map((candidate) => hexKey(candidate.position)));
  const position = hexNeighbors(target).find((candidate) => {
    const tile = state.map.tiles.find((entry) => entry.key === hexKey(candidate));
    return tile !== undefined
      && tile.playerOccupancyAllowed
      && tile.movementCost !== null
      && !facilityKeys.has(tile.key)
      && !unitKeys.has(tile.key);
  });
  if (!position) throw new Error(`No approach position for ${hexKey(target)}`);
  return position;
}

function captureFacility(engine: GameEngine, facilityId: string) {
  const snapshot = engine.getState() as GameState;
  const target = facility(snapshot, facilityId);
  const police = snapshot.units.find((unit) => unit.id === 'police-1');
  if (!police) throw new Error('Missing police-1');
  const approach = approachPosition(snapshot, target.position);
  police.position = approach;
  police.actionState = 'ready';
  police.canMove = true;
  police.canAttack = true;
  const load = engine.step({ type: 'LoadSnapshot', snapshot });
  if (load.error) throw new Error(`Could not load capture fixture: ${load.error.code}: ${load.error.message}`);
  return engine.step({ type: 'Move', unitId: 'police-1', destination: target.position });
}

function oilFixture(workers: number, remainingAllowance = 2_000): GameState {
  const state = testState();
  for (const candidate of state.facilities) setFacilityStopped(candidate);
  const powerPlant = facility(state, 'power-plant-1');
  setFacilityOperating(powerPlant, 3);
  const wind = facility(state, 'wind-power-plant-1');
  setFacilityOperating(wind, 0);
  const refinery = facility(state, 'refinery-1');
  setFacilityOperating(refinery, 10);
  refinery.powerSupplyEnabled = true;
  const oil = state.facilities.find((candidate) => candidate.type === 'oilField');
  if (!oil) throw new Error('Missing seed-selected Oil Field');
  setFacilityOperating(oil, workers);
  state.refineryAllowance = {
    initialAllowance: 2_000,
    oilCreditsEarned: 2_000 - remainingAllowance,
    fuelRefined: 0,
    remainingAllowance,
  };
  synchronizePopulation(state);
  return state;
}

describe('v1.6 Core acceptance', () => {
  it('uses the v6 facility set with one Oil Field, four branches, and its one-hex access spur', () => {
    expect(FIXED_MAP_ID).toBe('fixed-51x51-v6');
    expect(FIXED_MAP.facilities).toHaveLength(FIXED_FACILITY_COUNT);
    expect(FIXED_MAP.roadBranches).toHaveLength(4);
    const removed = ['refinery-2', 'refinery-3', 'refinery-4', 'power-plant-2', 'power-plant-3'];
    expect(FIXED_MAP.facilities.some((candidate) => removed.includes(candidate.id))).toBe(false);

    const oils = FIXED_MAP.facilities.filter((candidate) => candidate.type === 'oilField');
    expect(oils).toHaveLength(1);
    const oil = oils[0]!;
    expect(oil).toMatchObject({ startingOwned: false, startingWorkers: 0 });
    expect(FIXED_MAP.tiles.find((tile) => tile.key === hexKey(oil.position))).toMatchObject({
      terrain: 'plain',
      facilityId: oil.id,
    });
    const segment = FIXED_MAP.roads?.segments.find((candidate) => candidate.id === `access-${oil.id}`);
    expect(segment).toMatchObject({ role: 'access' });
    expect(segment?.path).toHaveLength(2);
    expect(segment?.path[0]).toEqual(oil.position);
    expect(FIXED_MAP.roadBranches.flatMap((branch) => branch.roadTiles).some((position) => hexKey(position) === hexKey(oil.position))).toBe(false);
  });

  it('charges Temporary Housing population at one Food and one Civilian Good per person', () => {
    const state = testState();
    state.units = [];
    for (const candidate of state.facilities) setFacilityStopped(candidate);
    const wind = facility(state, 'wind-power-plant-1');
    setFacilityOperating(wind, 0);
    const housing: FacilityState = {
      ...facility(state, 'capital'),
      id: 'temporary-housing-v160',
      type: 'temporaryHousing',
      nameKey: 'facility.temporaryHousing',
      position: { q: 24, r: 24 },
      workerCapacity: 10,
      startingOwned: false,
      startingWorkers: 0,
      startingInfected: 0,
      owner: 'player',
      status: 'owned',
      operationalStatus: 'operational',
      workers: 20,
      infected: 0,
      securedOrder: 100,
      lastAssignedOrder: 0,
      populationOperationalTurn: 1,
      powerSupplyEnabled: true,
      lastPowerSupplied: null,
      constructible: true,
      builtTurn: 1,
      recoveryOperationalTurn: null,
      firstCaptureRewardClaimed: true,
    };
    state.facilities.push(housing);
    synchronizePopulation(state);

    const forecast = forecastEndTurn(state);
    expect(forecast.populationConsumers).toBe(20);
    expect(forecast.maintenanceBreakdown.food.base).toBe(20);
    expect(forecast.maintenanceBreakdown.civilianGoods.base).toBe(20);
  });

  it('grants each first neutral capture resource reward immediately, including out of Supply', () => {
    const expected: Array<[string, Partial<Record<ResourceType, number>>]> = [
      ['city-1', { food: 100, civilianGoods: 100, fuel: 100 }],
      ['civilian-factory-2', { civilianGoods: 100 }],
      ['military-factory-1', { militaryGoods: 100 }],
      ['farm-2', { food: 100, fuel: 100 }],
      ['army-base-1', { food: 100, militaryGoods: 100 }],
    ];
    for (const [facilityId, reward] of expected) {
      const engine = new GameEngine(16002, testConfig());
      const before = engine.getState().resources;
      const target = (engine.getState() as GameState).facilities.find((candidate) => candidate.id === facilityId)!;
      const result = captureFacility(engine, facilityId);
      expect(result.error, facilityId).toBeNull();
      const after = result.state.resources;
      for (const resource of ['food', 'civilianGoods', 'militaryGoods', 'fuel'] as const) {
        expect(after[resource] - before[resource], `${facilityId}:${resource}`).toBe(reward[resource] ?? 0);
      }
      expect(result.state.facilities.find((candidate) => candidate.id === facilityId)?.firstCaptureRewardClaimed).toBe(true);
      if (facilityId === 'farm-2') expect(target.position.q).toBe(21);
    }
  });

  it('does not grant a first-capture reward again after a recapture', () => {
    const engine = new GameEngine(16003, testConfig());
    const first = captureFacility(engine, 'farm-2');
    expect(first.error).toBeNull();
    const firstResources = first.state.resources;
    const snapshot = first.state as GameState;
    const target = facility(snapshot, 'farm-2');
    const police = snapshot.units.find((unit) => unit.id === 'police-1')!;
    target.owner = 'none';
    target.status = 'unowned';
    target.operationalStatus = 'stopped';
    target.securedOrder = null;
    target.populationOperationalTurn = Number.MAX_SAFE_INTEGER;
    police.position = approachPosition(snapshot, target.position);
    police.actionState = 'ready';
    police.canMove = true;
    police.canAttack = true;
    synchronizePopulation(snapshot);
    const loaded = engine.step({ type: 'LoadSnapshot', snapshot });
    expect(loaded.error).toBeNull();
    const second = engine.step({ type: 'Move', unitId: 'police-1', destination: target.position });
    expect(second.error).toBeNull();
    expect(second.state.resources).toEqual(firstResources);
    expect(second.state.facilities.find((candidate) => candidate.id === 'farm-2')?.firstCaptureRewardClaimed).toBe(true);
  });

  it('stacks the Army Base unit and resource rewards through turn 10, then keeps only resources', () => {
    for (const turn of [10, 11]) {
      const engine = new GameEngine(16030 + turn, testConfig());
      const snapshot = engine.getState() as GameState;
      snapshot.turn = turn;
      snapshot.cityPopulationSnapshot.turn = turn;
      expect(engine.step({ type: 'LoadSnapshot', snapshot }).error?.message).toBeUndefined();
      const before = engine.getState();
      const guardCountBefore = before.units.filter((unit) => unit.type === 'nationalGuard').length;
      const result = captureFacility(engine, 'army-base-1');
      expect(result.error, `turn ${turn}`).toBeNull();
      expect(result.state.resources.food - before.resources.food).toBe(100);
      expect(result.state.resources.militaryGoods - before.resources.militaryGoods).toBe(100);
      const guardCountAfter = result.state.units.filter((unit) => unit.type === 'nationalGuard').length;
      expect(guardCountAfter - guardCountBefore).toBe(turn <= 10 ? 1 : 0);
    }
  });

  it('credits Oil workers and spends same-turn credits through the Refinery allowance', () => {
    for (const workers of [1, 5]) {
      const state = oilFixture(workers);
      const plan = calculateEconomyPlan(state);
      const oilId = state.facilities.find((candidate) => candidate.type === 'oilField')!.id;
      const oil = plan.facilities.find((projection) => projection.facilityId === oilId);
      expect(oil?.allowanceCredits, `${workers} workers`).toBe(workers * 100);
      expect(oil?.outputs, `${workers} workers`).toEqual({});
      expect(oil?.powerMode, `${workers} workers`).toBe('none');
      expect(oil?.projectedPowerRequested, `${workers} workers`).toBe(false);
      expect(plan.forecast.refineryAllowance.oilCreditsEarned, `${workers} workers`).toBe(workers * 100);
    }

    const sameTurn = oilFixture(5, 0);
    const sameTurnPlan = calculateEconomyPlan(sameTurn);
    expect(sameTurnPlan.forecast.refineryAllowance).toMatchObject({
      before: 0,
      oilCreditsEarned: 500,
      availableForRefining: 500,
      fuelRefined: 50,
      remaining: 450,
    });
    expect(sameTurnPlan.forecast.fuel.projectedProduction).toBe(50);
  });

  it('does not reserve Refinery electricity when the shared allowance is exhausted', () => {
    const state = oilFixture(0, 0);
    state.refineryAllowance = { initialAllowance: 2_000, oilCreditsEarned: 0, fuelRefined: 2_000, remainingAllowance: 0 };
    const plan = calculateEconomyPlan(state);
    const refinery = plan.facilities.find((projection) => projection.facilityId === 'refinery-1')!;
    expect(refinery.projectedPowerRequested).toBe(false);
    expect(refinery.projectedPowerSupplied).toBe(false);
    expect(plan.forecast.electricity.requiredPowerDemand).toBe(0);
    expect(plan.forecast.fuel.projectedProduction).toBe(0);
  });

  it('allows eight player-built Wind Power Plants and rejects the ninth', () => {
    const engine = new GameEngine(16004, testConfig({
      economy: {
        initialResources: { food: 10_000, civilianGoods: 2_000, militaryGoods: 10_000, fuel: 10_000 },
      },
    }));
    for (let index = 0; index < 8; index += 1) {
      const candidate = engine.getConstructibleFacilityPositionCandidates('windPowerPlant').find((entry) => entry.legal);
      expect(candidate, `Wind build ${index + 1}`).toBeDefined();
      const result = engine.step({ type: 'BuildConstructibleFacility', facilityType: 'windPowerPlant', position: candidate!.position });
      expect(result.error, `Wind build ${index + 1}`).toBeNull();
    }
    const state = engine.getState();
    expect(state.facilities.filter((candidate) => candidate.constructible && candidate.type === 'windPowerPlant')).toHaveLength(8);
    expect(state.facilities.find((candidate) => candidate.id === 'wind-power-plant-1')?.constructible).toBe(false);
    const ninth = engine.getConstructibleFacilityPositionCandidates('windPowerPlant').find((entry) => entry.reasonCode === 'constructible_facility_limit_reached');
    expect(ninth).toBeDefined();
    const rejected = engine.step({ type: 'BuildConstructibleFacility', facilityType: 'windPowerPlant', position: ninth!.position });
    expect(rejected.error?.code).toBe('constructible_facility_limit_reached');
  });

  it('previews the 150-goods Wind decision and rejects an unaffordable second build', () => {
    const state = testState();
    state.checkpoints = [];
    state.config.units.nationalGuard.population = 160;
    state.units = [createUnit(state, 'fixture-guard', 'nationalGuard', { q: 25, r: 25 })];
    for (const candidate of state.facilities) {
      candidate.owner = 'none';
      candidate.status = 'unowned';
      candidate.operationalStatus = 'stopped';
      candidate.workers = 0;
      candidate.infected = 0;
    }
    setFacilityOperating(facility(state, 'capital'), 37);
    setFacilityOperating(facility(state, 'farm-1'), 30);
    setFacilityOperating(facility(state, 'farm-2'), 30);
    setFacilityOperating(facility(state, 'farm-3'), 30);
    setFacilityOperating(facility(state, 'farm-4'), 10);
    setFacilityOperating(facility(state, 'wind-power-plant-1'), 0);
    state.resources.food = 10_000;
    state.resources.civilianGoods = 273;
    synchronizePopulation(state);
    state.population.initialPopulation = populationLedgerTotal(state);
    expect(state.population).toMatchObject({ healthyCivilians: 137, unitPopulation: 160 });

    const engine = new GameEngine(state.seed, state.config);
    expect(engine.step({ type: 'LoadSnapshot', snapshot: state }).error?.message).toBeUndefined();
    const firstCandidate = engine.getConstructibleFacilityPositionCandidates('windPowerPlant').find((candidate) => candidate.legal)!;
    const firstAction = { type: 'BuildConstructibleFacility', facilityType: 'windPowerPlant', position: firstCandidate.position } as const;
    const firstPreview = previewCoreAction(engine.getState(), firstAction, 219);
    expect(firstPreview.nextEndTurn.before).toMatchObject({ civilianGoods: 13, populationLoss: 0, projectedHealthyCivilians: 137 });
    expect(firstPreview.nextEndTurn.after).toMatchObject({ civilianGoods: 0, populationLoss: 137, projectedHealthyCivilians: 0, guaranteedDefeat: true });
    expect(engine.getState().resources.civilianGoods).toBe(273);

    expect(engine.step(firstAction).error).toBeNull();
    const secondCandidate = engine.getConstructibleFacilityPositionCandidates('windPowerPlant')
      .find((candidate) => candidate.reasonCode === 'insufficient_civilian_goods')!;
    const secondAction = { type: 'BuildConstructibleFacility', facilityType: 'windPowerPlant', position: secondCandidate.position } as const;
    const secondPreview = previewCoreAction(engine.getState(), secondAction, 220);
    expect(secondPreview.legal).toBe(false);
    expect(secondPreview.reasonCode).toBe('insufficient_civilian_goods');
    expect(forecastEndTurn(engine.getState()).civilianGoods.maintenanceShortage).toBe(137);
    expect(forecastEndTurn({ ...engine.getState(), resources: { ...engine.getState().resources, civilianGoods: 73 } }).civilianGoods.maintenanceShortage).toBe(187);
  });

  it.each(['zombie', 'hordeZombie', 'policeZombie', 'soldierZombie', 'riotZombie', 'hunterZombie', 'gasZombie'] as ZombieUnitType[])('counts %s in enemyKillsTotal', (type) => {
    const engine = new GameEngine(16005, testConfig());
    const snapshot = engine.getState() as GameState;
    const enemy = createUnit(snapshot, `test-${type}`, type, { q: 24, r: 24 });
    enemy.hp = 1;
    enemy.maxHp = 1;
    if (type === 'hordeZombie') {
      enemy.hordeKind = 'periodic';
      enemy.spawnGroupId = 'test-horde';
    }
    snapshot.units.push(enemy);
    const load = engine.step({ type: 'LoadSnapshot', snapshot });
    expect(load.error).toBeNull();
    const result = engine.step({ type: 'Attack', attackerId: 'police-1', targetId: enemy.id });
    expect(result.error).toBeNull();
    const statistics = result.state.statistics;
    const byType = statistics.normalZombiesKilled
      + statistics.hordeZombiesKilled
      + statistics.policeZombiesKilled
      + statistics.soldierZombiesKilled
      + statistics.riotZombiesKilled
      + statistics.hunterZombiesKilled
      + statistics.gasZombiesKilled;
    expect(statistics.enemyKillsTotal).toBe(byType);
    expect(statistics.enemyKillsTotal).toBe(1);
  });

  it('separates cumulative shortage deaths from the latest economy phase', () => {
    const engine = new GameEngine(16006, testConfig());
    const snapshot = engine.getState() as GameState;
    for (const candidate of snapshot.facilities) {
      candidate.operationalStatus = candidate.type === 'windPowerPlant' ? 'operational' : 'disabled';
    }
    snapshot.resources.food = 114;
    snapshot.resources.civilianGoods = 10_000;
    snapshot.resources.militaryGoods = 10_000;
    snapshot.resources.fuel = 10_000;
    synchronizePopulation(snapshot);
    const load = engine.step({ type: 'LoadSnapshot', snapshot });
    expect(load.error).toBeNull();
    const shortageTurn = engine.step({ type: 'EndTurn' });
    expect(shortageTurn.error).toBeNull();
    expect(shortageTurn.state.statistics.resourceShortageLossesTotal).toBeGreaterThan(0);
    expect(shortageTurn.state.statistics.resourceShortageLossesTotal).toBe(shortageTurn.state.statistics.resourceShortageLosses);
    expect(shortageTurn.state.statistics.finalEconomyResourceShortageLosses).toBeGreaterThan(0);

    const recovered = shortageTurn.state as GameState;
    recovered.resources.food = 10_000;
    recovered.resources.civilianGoods = 10_000;
    const reload = engine.step({ type: 'LoadSnapshot', snapshot: recovered });
    expect(reload.error).toBeNull();
    const coveredTurn = engine.step({ type: 'EndTurn' });
    expect(coveredTurn.error).toBeNull();
    expect(coveredTurn.state.statistics.resourceShortageLossesTotal).toBe(shortageTurn.state.statistics.resourceShortageLossesTotal);
    expect(coveredTurn.state.statistics.finalEconomyResourceShortageLosses).toBe(0);
  });

  it('keeps economy Query and EndTurn Forecast pure', () => {
    const state = testState();
    const before = structuredClone(state);
    calculateEconomyPlan(state);
    forecastEndTurn(state);
    expect(state).toEqual(before);
  });

  it('separates national Military Goods shortage from Supply disconnection', () => {
    const state = testState();
    state.resources.militaryGoods = 0;
    for (const candidate of state.facilities.filter((entry) => entry.type === 'militaryFactory')) {
      setFacilityStopped(candidate);
    }
    const supplied = state.units.find((unit) => unit.id === 'police-1')!;
    const disconnected = state.units.find((unit) => unit.id === 'national-guard-1')!;
    supplied.currentMilitaryGoods = 0;
    disconnected.currentMilitaryGoods = 0;
    const remote = state.map.tiles.find((tile) => tile.playerOccupancyAllowed && tile.movementCost !== null
      && !isHexSupplied(state, tile) && !state.facilities.some((entry) => entry.position.q === tile.q && entry.position.r === tile.r));
    expect(remote).toBeDefined();
    disconnected.position = { q: remote!.q, r: remote!.r };

    const alerts = deriveCrisisSummary(state);
    const national = alerts.find((entry) => entry.reasonCode === 'military_goods_national_shortage');
    const supply = alerts.find((entry) => entry.reasonCode === 'military_goods_supply_disconnected');
    expect(national?.entityIds).toContain(supplied.id);
    expect(national?.entityIds).not.toContain(disconnected.id);
    expect(national?.publicFacts.unfilledSuppliedDemand).toBeGreaterThan(0);
    expect(supply?.entityIds).toEqual([disconnected.id]);
    expect(supply?.publicFacts.nationalStockExcluded).toBe(true);
    expect(alerts.some((entry) => entry.reasonCode === 'resource_runway_risk'
      && entry.entityIds.includes('militaryGoods'))).toBe(true);
  });

  it('alerts on zero workers only for secured worker-based production facilities', () => {
    const state = testState();
    const farm = facility(state, 'farm-1');
    setFacilityOperating(farm, 0);
    const wind = facility(state, 'wind-power-plant-1');
    setFacilityOperating(wind, 0);
    const simpleFarm: FacilityState = {
      ...structuredClone(farm),
      id: 'simple-farm-worker-alert',
      type: 'simpleFarm',
      workerCapacity: 10,
      position: { q: 12, r: 12 },
    };
    setFacilityOperating(simpleFarm, 0);
    state.facilities.push(simpleFarm);
    const alerts = deriveCrisisSummary(state).filter((entry) => entry.reasonCode === 'facility_workers_zero');
    expect(alerts.some((entry) => entry.entityIds.includes(farm.id))).toBe(true);
    expect(alerts.some((entry) => entry.entityIds.includes(wind.id))).toBe(false);
    expect(alerts.find((entry) => entry.entityIds.includes(simpleFarm.id))?.publicFacts.stoppedWorkers).toBe(10);
    expect(alerts.every((entry) => state.facilities.find((candidate) => candidate.id === entry.entityIds[0])?.owner === 'player')).toBe(true);
  });

  it('previews legal and illegal actions without changing the caller state', () => {
    const engine = new GameEngine(16007, testConfig());
    const state = engine.getState();
    const before = JSON.stringify(state);
    const legalAction = engine.getLegalActions().find((action) => action.type !== 'EndTurn') ?? { type: 'EndTurn' as const };
    const legal = previewCoreAction(state, legalAction, 41);
    expect(legal.legal).toBe(true);
    expect(legal.baseRevision).toBe(41);
    expect(JSON.stringify(state)).toBe(before);

    const illegal = previewCoreAction(state, { type: 'AssignWorkers', facilityId: 'missing-facility', workers: 1 }, 41);
    expect(illegal.legal).toBe(false);
    expect(illegal.reasonCode).toBeTruthy();
    expect(JSON.stringify(state)).toBe(before);
  });
});
