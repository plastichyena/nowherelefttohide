import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from './config';
import { forecastEndTurn, GameEngine, previewMove } from './engine';
import { validateInvariants } from './invariants';
import { findNearestOpenTiles } from './path';
import {
  createCityPopulationSnapshot,
  createInitialState,
  createUnit,
  populationLedgerTotal,
  synchronizePopulation as synchronizeDerivedPopulation,
} from './state';

function synchronizePopulation(state: ReturnType<typeof createInitialState>): void {
  synchronizeDerivedPopulation(state);
  state.population.initialPopulation =
    populationLedgerTotal(state) -
    state.population.cumulativeArrivals -
    state.population.cumulativeDiscoveredInfected +
    state.population.cumulativeDepartures;
}

describe('GameEngine', () => {
  it('creates a complete deterministic initial state', () => {
    const config = createDefaultConfig();
    const first = createInitialState(42, config);
    const second = createInitialState(42, config);
    expect(first).toEqual(second);
    expect(first.facilities).toHaveLength(16);
    expect(first.facilities.filter((facility) => facility.status === 'owned')).toHaveLength(5);
    expect(first.population.healthyCivilians).toBe(100);
    expect(first.facilities.find((facility) => facility.id === 'capital')?.workers).toBe(41);
    expect(first.map.initialZombiePositions).toEqual([
      { q: 4, r: 4 }, { q: 11, r: 3 }, { q: 3, r: 11 }, { q: 11, r: 10 },
    ]);
    expect(first.units.filter((unit) => unit.isPlayerUnit)).toHaveLength(2);
    expect(validateInvariants(first)).toEqual({ valid: true, errors: [] });
  });

  it('does not mutate the state for an invalid action', () => {
    const engine = new GameEngine(7, createDefaultConfig());
    const before = engine.getState();
    const result = engine.step({ type: 'Move', unitId: 'police-1', destination: { q: 99, r: 99 } });
    expect(result.error?.code).toBe('outside_map');
    expect(engine.getState()).toEqual(before);
  });

  it('rejects snapshots with a broken fixed map or stale derived population', () => {
    const engine = new GameEngine(71, createDefaultConfig());
    const before = engine.getState();
    const brokenMap = engine.getState() as ReturnType<typeof createInitialState>;
    brokenMap.map.tiles = [];
    expect(engine.step({ type: 'LoadSnapshot', snapshot: brokenMap }).error?.code).toBe('invalid_snapshot');
    expect(engine.getState()).toEqual(before);

    const brokenFacilityLink = engine.getState() as ReturnType<typeof createInitialState>;
    brokenFacilityLink.map.tiles.find((tile) => tile.q === 7 && tile.r === 7)!.facilityId = null;
    expect(engine.step({ type: 'LoadSnapshot', snapshot: brokenFacilityLink }).error?.code).toBe('invalid_snapshot');
    expect(engine.getState()).toEqual(before);

    const stalePopulation = engine.getState() as ReturnType<typeof createInitialState>;
    stalePopulation.population.facilityWorkers = [];
    expect(engine.step({ type: 'LoadSnapshot', snapshot: stalePopulation }).error?.code).toBe('invalid_snapshot');
    expect(engine.getState()).toEqual(before);
  });

  it('detects an unexplained population change in the conservation ledger', () => {
    const state = createInitialState(70, createDefaultConfig());
    state.facilities.find((facility) => facility.id === 'capital')!.workers += 1;
    synchronizeDerivedPopulation(state);
    const result = validateInvariants(state);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Population conservation ledger is out of balance');
  });

  it('provides an interception preview and stops movement on interception', () => {
    const engine = new GameEngine(7, createDefaultConfig());
    const snapshot = engine.getState() as ReturnType<typeof createInitialState>;
    snapshot.units.find((unit) => unit.type === 'zombie')!.position = { q: 7, r: 5 };
    expect(engine.step({ type: 'LoadSnapshot', snapshot }).error).toBeNull();
    const preview = previewMove(engine.getState(), 'police-1', { q: 7, r: 6 });
    expect(preview.legal).toBe(true);
    expect(preview.interception).not.toBeNull();
    const result = engine.step({ type: 'Move', unitId: 'police-1', destination: { q: 7, r: 6 } });
    expect(result.error).toBeNull();
    const police = result.state.units.find((unit) => unit.id === 'police-1');
    expect(police?.position).toEqual({ q: 7, r: 6 });
    expect(result.events.some((event) => event.type === 'interception')).toBe(true);
  });

  it('captures an empty disconnected facility by entering it', () => {
    const engine = new GameEngine(8, createDefaultConfig());
    const snapshot = engine.getState() as ReturnType<typeof createInitialState>;
    snapshot.units.find((unit) => unit.id === 'police-1')!.position = { q: 7, r: 4 };
    expect(engine.step({ type: 'LoadSnapshot', snapshot }).error).toBeNull();
    const result = engine.step({ type: 'Move', unitId: 'police-1', destination: { q: 7, r: 3 } });
    expect(result.error).toBeNull();
    expect(result.state.facilities.find((facility) => facility.id === 'city-1')?.status).toBe('owned');
    expect(result.events.some((event) => event.type === 'facility_captured')).toBe(true);
  });

  it('processes a complete end turn, spawns the Final Horde, and continues', () => {
    const config = createDefaultConfig({ finalHordeTurn: 1, horde: { cycle: 5 } });
    const engine = new GameEngine(11, config);
    const result = engine.step({ type: 'EndTurn' });
    expect(result.error).toBeNull();
    expect(result.gameOver).toBe(false);
    expect(result.result).toBeNull();
    expect(result.state).toMatchObject({ turn: 2, finalHordeTurn: 1, horde: { finalHordeStatus: 'active' } });
  });

  it('uses the same engine path for headless legal actions', () => {
    const engine = new GameEngine(99, createDefaultConfig({ finalHordeTurn: 2 }));
    let steps = 0;
    while (!engine.isGameOver() && steps < 40) {
      const action = engine.getLegalActions().find((candidate) => candidate.type === 'EndTurn')!;
      const result = engine.step(action);
      expect(result.error).toBeNull();
      expect(validateInvariants(result.state as ReturnType<typeof createInitialState>)).toEqual({ valid: true, errors: [] });
      steps += 1;
    }
    expect(engine.isGameOver()).toBe(true);
  });

  it('reserves units and completes them at the following player turn start', () => {
    const engine = new GameEngine(31, createDefaultConfig({ finalHordeTurn: 3 }));
    const before = engine.getState();
    expect(engine.step({ type: 'ProduceUnit', unitType: 'police', destination: { q: 7, r: 7 } }).error).toBeNull();
    expect(engine.getState().pendingUnitProductions).toHaveLength(1);
    expect(engine.getState().population.healthyCivilians).toBe(before.population.healthyCivilians - 5);
    expect(engine.getState().population.unitPopulation).toBe(before.population.unitPopulation + 5);
    expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
    expect(engine.getState().units.filter((unit) => unit.type === 'police')).toHaveLength(2);
  });

  it('uses configured unit populations for recruitment, legal actions, and completion', () => {
    const engine = new GameEngine(32, createDefaultConfig({
      finalHordeTurn: 3,
      units: {
        police: { population: 6 },
        nationalGuard: { population: 11 },
      },
      economy: {
        initialZombieCount: 0,
        initialResources: { food: 5000, civilianGoods: 5000, militaryGoods: 5000, fuel: 5000 },
      },
    }));
    const initialLedger = populationLedgerTotal(engine.getState() as ReturnType<typeof createInitialState>);
    expect(engine.getLegalActions()).toEqual(expect.arrayContaining([
      { type: 'ProduceUnit', unitType: 'police', destination: { q: 7, r: 7 } },
      { type: 'ProduceUnit', unitType: 'nationalGuard', destination: { q: 7, r: 7 } },
    ]));

    expect(engine.step({ type: 'ProduceUnit', unitType: 'police', destination: { q: 7, r: 7 } }).error).toBeNull();
    expect(engine.getState().pendingUnitProductions[0]?.population).toBe(6);
    expect(engine.getState().population.healthyCivilians).toBe(94);
    expect(engine.getState().population.unitPopulation).toBe(23);
    expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
    expect(engine.getState().units.filter((unit) => unit.type === 'police').map((unit) => unit.population)).toEqual([6, 6]);

    expect(engine.step({ type: 'ProduceUnit', unitType: 'nationalGuard', destination: { q: 7, r: 7 } }).error).toBeNull();
    expect(engine.getState().pendingUnitProductions[0]?.population).toBe(11);
    expect(engine.getState().population.healthyCivilians).toBe(83);
    expect(engine.getState().population.unitPopulation).toBe(34);
    expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
    expect(engine.getState().units.filter((unit) => unit.type === 'nationalGuard').map((unit) => unit.population)).toEqual([11, 11]);
    expect(populationLedgerTotal(engine.getState() as ReturnType<typeof createInitialState>)).toBe(initialLedger);
    expect(validateInvariants(engine.getState() as ReturnType<typeof createInitialState>)).toEqual({ valid: true, errors: [] });
  });

  it('does not expose recruitment when configured population exceeds eligible city supply', () => {
    const engine = new GameEngine(33, createDefaultConfig({
      units: { police: { population: 42 } },
      economy: { initialZombieCount: 0 },
    }));
    expect(engine.getLegalActions().some((action) => action.type === 'ProduceUnit' && action.unitType === 'police')).toBe(false);
    const before = engine.getState();
    expect(engine.step({ type: 'ProduceUnit', unitType: 'police', destination: { q: 7, r: 7 } }).error?.code).toBe('insufficient_production_cost');
    expect(engine.getState()).toEqual(before);
  });

  it('builds a cardinal road checkpoint and resolves pass-through refugees', () => {
    const config = createDefaultConfig({
      finalHordeTurn: 3,
      refugees: { arrivalIntervalMin: 1, arrivalIntervalMax: 1, arrivalPeopleMin: 2, arrivalPeopleMax: 2, screeningCapacity: 2 },
    });
    const engine = new GameEngine(12, config);
    const snapshot = engine.getState() as ReturnType<typeof createInitialState>;
    snapshot.units = snapshot.units.filter((unit) => unit.type !== 'zombie');
    expect(engine.step({ type: 'LoadSnapshot', snapshot }).error).toBeNull();
    expect(engine.step({ type: 'BuildCheckpoint', position: { q: 7, r: 6 } }).error).toBeNull();
    const checkpointId = engine.getState().checkpoints[0]!.id;
    expect(engine.step({ type: 'SetCheckpointPolicy', checkpointId, policy: 'passThrough' }).error).toBeNull();
    const residents = engine.getState().population.cityResidents;
    expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
    expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
    expect(engine.getState().population.cityResidents).toBeGreaterThanOrEqual(residents + 2);
  });

  it('uses same-turn food and civilian production before maintenance shortages', () => {
    const engine = new GameEngine(3, createDefaultConfig());
    const snapshot = engine.getState() as ReturnType<typeof createInitialState>;
    snapshot.resources.food = 0;
    snapshot.resources.civilianGoods = 0;
    expect(engine.step({ type: 'LoadSnapshot', snapshot }).error).toBeNull();
    const result = engine.step({ type: 'EndTurn' });
    expect(result.error).toBeNull();
    expect(result.result).toBeNull();
    expect(result.events.some((event) => event.type === 'resource_shortage')).toBe(false);
  });

  it('spawns a periodic Horde before the distinct Final Horde', () => {
    const engine = new GameEngine(55, createDefaultConfig({
      finalHordeTurn: 6,
      refugees: { arrivalIntervalMin: 99, arrivalIntervalMax: 99 },
    }));
    const snapshot = engine.getState() as ReturnType<typeof createInitialState>;
    snapshot.units = snapshot.units.filter((unit) => unit.isPlayerUnit);
    synchronizePopulation(snapshot);
    expect(engine.step({ type: 'LoadSnapshot', snapshot }).error).toBeNull();
    for (let turn = 0; turn < 5; turn += 1) {
      expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
    }
    expect(engine.getState().horde.spawnedCount).toBe(1);
    expect(engine.getState().units.filter((unit) => unit.type === 'hordeZombie')).toHaveLength(2);
    expect(engine.step({ type: 'EndTurn' }).result).toBeNull();
    expect(engine.getState().horde.spawnedCount).toBe(1);
    expect(engine.getState().horde).toMatchObject({ finalHordeStatus: 'active', finalSpawnedCount: 12, totalSpawned: 14 });
  });

  it('stops infection spread for a facility after stationed suppression, even with infected people remaining', () => {
    const engine = new GameEngine(101, createDefaultConfig({ finalHordeTurn: 3 }));
    const snapshot = engine.getState() as ReturnType<typeof createInitialState>;
    snapshot.units = snapshot.units.filter((unit) => unit.isPlayerUnit);
    snapshot.units.find((unit) => unit.id === 'police-1')!.position = { q: 5, r: 7 };
    snapshot.units.find((unit) => unit.id === 'national-guard-1')!.position = { q: 2, r: 2 };
    const farm = snapshot.facilities.find((facility) => facility.id === 'farm-1')!;
    farm.workers = 15;
    farm.infected = 10;
    synchronizePopulation(snapshot);
    expect(engine.step({ type: 'LoadSnapshot', snapshot }).error).toBeNull();
    expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
    const updated = engine.getState().facilities.find((facility) => facility.id === 'farm-1')!;
    expect(updated.infected).toBe(5);
    expect(updated.workers).toBe(15);
  });

  it('stops checkpoint infection spread for a stationed suppressing unit', () => {
    const engine = new GameEngine(102, createDefaultConfig({ finalHordeTurn: 3 }));
    const snapshot = engine.getState() as ReturnType<typeof createInitialState>;
    snapshot.units = snapshot.units.filter((unit) => unit.isPlayerUnit);
    snapshot.units.find((unit) => unit.id === 'police-1')!.position = { q: 7, r: 6 };
    snapshot.units.find((unit) => unit.id === 'national-guard-1')!.position = { q: 2, r: 2 };
    snapshot.checkpoints.push({
      id: 'checkpoint-north-1',
      position: { q: 7, r: 6 },
      direction: 'north',
      status: 'operational',
      waiting: 5,
      screening: 0,
      approved: 0,
      remainingTurns: 0,
      screeningPolicy: 'normal',
      currentPolicy: 'normal',
      nextArrivalTurn: null,
      infected: 10,
    });
    synchronizePopulation(snapshot);
    expect(engine.step({ type: 'LoadSnapshot', snapshot }).error).toBeNull();
    expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
    const checkpoint = engine.getState().checkpoints[0]!;
    expect(checkpoint.infected).toBe(5);
    expect(checkpoint.waiting + checkpoint.screening + checkpoint.approved).toBe(5);
    expect(checkpoint.status).toBe('operational');
  });

  it('does not overrun a safely emptied facility merely because a zombie stands on it', () => {
    const config = createDefaultConfig({ finalHordeTurn: 3, units: { zombie: { movement: 0 } } });
    const engine = new GameEngine(103, config);
    const snapshot = engine.getState() as ReturnType<typeof createInitialState>;
    const zombie = snapshot.units.find((unit) => unit.type === 'zombie')!;
    snapshot.units = snapshot.units.filter((unit) => unit.isPlayerUnit || unit.id === zombie.id);
    zombie.position = { q: 7, r: 7 };
    snapshot.facilities.find((facility) => facility.id === 'capital')!.workers = 0;
    snapshot.units.find((unit) => unit.id === 'police-1')!.position = { q: 5, r: 7 };
    snapshot.units.find((unit) => unit.id === 'national-guard-1')!.position = { q: 2, r: 2 };
    synchronizePopulation(snapshot);
    expect(engine.step({ type: 'LoadSnapshot', snapshot }).error).toBeNull();
    expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
    const capital = engine.getState().facilities.find((facility) => facility.id === 'capital')!;
    expect(capital.status).toBe('owned');
    expect(capital.infected).toBe(0);
  });

  it('resolves counterattacks, prevents a counter from a destroyed defender, and blocks post-attack movement', () => {
    const engine = new GameEngine(104, createDefaultConfig({ finalHordeTurn: 3, economy: { initialZombieCount: 0 } }));
    const snapshot = engine.getState() as ReturnType<typeof createInitialState>;
    const zombie = createUnit(snapshot, 'zombie-test', 'zombie', { q: 7, r: 6 });
    snapshot.units = snapshot.units.filter((unit) => unit.isPlayerUnit);
    snapshot.units.push(zombie);
    synchronizePopulation(snapshot);
    expect(engine.step({ type: 'LoadSnapshot', snapshot }).error).toBeNull();

    const exchange = engine.step({ type: 'Attack', attackerId: 'police-1', targetId: zombie.id });
    expect(exchange.error).toBeNull();
    expect(exchange.state.units.find((unit) => unit.id === zombie.id)?.hp).toBe(5);
    expect(exchange.state.units.find((unit) => unit.id === 'police-1')?.hp).toBe(22);
    expect(engine.step({ type: 'Move', unitId: 'police-1', destination: { q: 7, r: 5 } }).error?.code).toBe('unit_cannot_move');

    const killSnapshot = engine.getState() as ReturnType<typeof createInitialState>;
    const target = killSnapshot.units.find((unit) => unit.id === zombie.id)!;
    target.hp = 5;
    const police = killSnapshot.units.find((unit) => unit.id === 'police-1')!;
    police.actionState = 'ready';
    police.canMove = true;
    police.canAttack = true;
    police.hp = 25;
    police.activity = { moved: false, attacked: false, intercepted: false, suppressed: false };
    expect(engine.step({ type: 'LoadSnapshot', snapshot: killSnapshot }).error).toBeNull();
    const killed = engine.step({ type: 'Attack', attackerId: police.id, targetId: target.id });
    expect(killed.state.units.find((unit) => unit.id === target.id)).toBeUndefined();
    expect(killed.state.units.find((unit) => unit.id === police.id)?.hp).toBe(25);
  });

  it('uses Config rest-recovery rounding after a non-combat turn', () => {
    const config = createDefaultConfig({
      finalHordeTurn: 3,
      economy: { initialZombieCount: 0, initialResources: { food: 2000, civilianGoods: 2000, militaryGoods: 2000, fuel: 2000 } },
      naturalRecovery: { combatRate: 0.1, restRate: 0.2, rounding: 'floor' },
    });
    const engine = new GameEngine(105, config);
    const snapshot = engine.getState() as ReturnType<typeof createInitialState>;
    snapshot.units.find((unit) => unit.id === 'police-1')!.hp = 10;
    snapshot.units = snapshot.units.filter((unit) => unit.isPlayerUnit);
    synchronizePopulation(snapshot);
    expect(engine.step({ type: 'LoadSnapshot', snapshot }).error).toBeNull();
    expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
    expect(engine.getState().units.find((unit) => unit.id === 'police-1')?.hp).toBe(15);
  });

  it('rejects both worker assignment directions at an infected facility', () => {
    const engine = new GameEngine(106, createDefaultConfig());
    const snapshot = engine.getState() as ReturnType<typeof createInitialState>;
    const farm = snapshot.facilities.find((facility) => facility.id === 'farm-1')!;
    farm.workers = 22;
    farm.infected = 1;
    synchronizePopulation(snapshot);
    expect(engine.step({ type: 'LoadSnapshot', snapshot }).error).toBeNull();
    expect(engine.step({ type: 'AssignWorkers', facilityId: farm.id, workers: 23 }).error?.code).toBe('infected_facility');
    expect(engine.step({ type: 'AssignWorkers', facilityId: farm.id, workers: 21 }).error?.code).toBe('infected_facility');
  });

  it('forecasts and resolves fuel-backed power allocation without mutation', () => {
    const config = createDefaultConfig({ finalHordeTurn: 3, economy: { initialZombieCount: 0 } });
    const engine = new GameEngine(107, config);
    const snapshot = engine.getState() as ReturnType<typeof createInitialState>;
    snapshot.units = snapshot.units.filter((unit) => unit.isPlayerUnit);
    snapshot.resources.fuel = 5;
    synchronizePopulation(snapshot);
    const before = JSON.stringify(snapshot);
    const forecast = forecastEndTurn(snapshot);
    expect(JSON.stringify(snapshot)).toBe(before);
    expect(forecast.fuel).toMatchObject({ available: 5, generationFuelDemand: 3, projectedFuelUsed: 3 });
    expect(forecast.electricity).toMatchObject({ physicalGenerationCapacity: 30, required: 15, shortage: 0 });
    expect(engine.step({ type: 'LoadSnapshot', snapshot }).error).toBeNull();
    const result = engine.step({ type: 'EndTurn' });
    expect(result.state.resources.fuel).toBe(52);
    expect(result.events.some((event) => event.type === 'resource_produced' && event.payload.resource === 'food' && event.payload.amount === 230)).toBe(true);
    expect(result.events.some((event) => event.type === 'resource_produced' && event.payload.resource === 'civilianGoods' && event.payload.amount === 271)).toBe(true);

    const noPower = engine.getState() as ReturnType<typeof createInitialState>;
    noPower.turn = 1;
    noPower.phase = 'player';
    noPower.gameOver = false;
    noPower.result = null;
    noPower.resources.fuel = 100;
    noPower.facilities.find((facility) => facility.id === 'power-plant-1')!.workers = 0;
    synchronizePopulation(noPower);
    createCityPopulationSnapshot(noPower);
    expect(engine.step({ type: 'LoadSnapshot', snapshot: noPower }).error).toBeNull();
    const unpowered = forecastEndTurn(engine.getState());
    expect(unpowered.electricity).toMatchObject({ capacity: 0, required: 15, shortage: 15 });
    expect(unpowered.fuel.projectedFuelUsed).toBe(0);
  });

  it('lowers every national-guard effective range when military goods are short', () => {
    const config = createDefaultConfig({
      finalHordeTurn: 3,
      economy: { initialZombieCount: 0, initialResources: { food: 2000, civilianGoods: 2000, militaryGoods: 0, fuel: 2000 } },
    });
    const engine = new GameEngine(108, config);
    const initial = engine.getState() as ReturnType<typeof createInitialState>;
    initial.units = initial.units.filter((unit) => unit.isPlayerUnit);
    synchronizePopulation(initial);
    expect(engine.step({ type: 'LoadSnapshot', snapshot: initial }).error).toBeNull();
    expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
    const snapshot = engine.getState() as ReturnType<typeof createInitialState>;
    snapshot.units.push(createUnit(snapshot, 'zombie-range', 'zombie', { q: 10, r: 7 }));
    expect(engine.step({ type: 'LoadSnapshot', snapshot }).error).toBeNull();
    expect(engine.getState().resources.militarySupplyAvailable).toBe(false);
    expect(engine.getLegalActions().some((action) => action.type === 'Attack' && action.attackerId === 'national-guard-1' && action.targetId === 'zombie-range')).toBe(false);
  });

  it('keeps a started screening batch on its original policy and resolves all three policies', () => {
    const config = createDefaultConfig({
      finalHordeTurn: 8,
      economy: { initialZombieCount: 0, initialResources: { food: 5000, civilianGoods: 5000, militaryGoods: 5000, fuel: 5000 } },
      refugees: { arrivalIntervalMin: 8, arrivalIntervalMax: 8, arrivalPeopleMin: 1, arrivalPeopleMax: 1, screeningCapacity: 4 },
    });
    const engine = new GameEngine(109, config);
    const snapshot = engine.getState() as ReturnType<typeof createInitialState>;
    snapshot.units = snapshot.units.filter((unit) => unit.isPlayerUnit);
    snapshot.checkpoints.push({
      id: 'checkpoint-north-1', position: { q: 7, r: 6 }, direction: 'north', status: 'operational',
      waiting: 0, screening: 4, approved: 0, remainingTurns: 1, screeningPolicy: 'normal', currentPolicy: 'strict', nextArrivalTurn: null, infected: 0,
    });
    synchronizePopulation(snapshot);
    expect(engine.step({ type: 'LoadSnapshot', snapshot }).error).toBeNull();
    const beforeNormal = engine.getState().population.cityResidents;
    expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
    expect(engine.getState().population.cityResidents).toBe(beforeNormal + 3);

    const passThrough = engine.getState() as ReturnType<typeof createInitialState>;
    const checkpoint = passThrough.checkpoints[0]!;
    checkpoint.waiting = 4;
    checkpoint.screening = 0;
    checkpoint.currentPolicy = 'passThrough';
    checkpoint.nextArrivalTurn = null;
    synchronizePopulation(passThrough);
    expect(engine.step({ type: 'LoadSnapshot', snapshot: passThrough }).error).toBeNull();
    const beforePass = engine.getState().population.cityResidents;
    expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
    expect(engine.getState().population.cityResidents).toBe(beforePass + 4);

    const strict = engine.getState() as ReturnType<typeof createInitialState>;
    strict.checkpoints[0]!.waiting = 4;
    strict.checkpoints[0]!.screening = 0;
    strict.checkpoints[0]!.currentPolicy = 'strict';
    strict.checkpoints[0]!.nextArrivalTurn = null;
    synchronizePopulation(strict);
    expect(engine.step({ type: 'LoadSnapshot', snapshot: strict }).error).toBeNull();
    const beforeStrict = engine.getState().population.cityResidents;
    for (let turn = 0; turn < 6; turn += 1) expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
    expect(engine.getState().population.cityResidents).toBe(beforeStrict + 2);
  });

  it('overruns and recovers a facility through infection, and loses immediately when the capital falls', () => {
    const config = createDefaultConfig({
      finalHordeTurn: 4,
      economy: { initialZombieCount: 0, initialResources: { food: 5000, civilianGoods: 5000, militaryGoods: 5000, fuel: 5000 } },
      units: { zombie: { movement: 0 } },
    });
    const engine = new GameEngine(110, config);
    const snapshot = engine.getState() as ReturnType<typeof createInitialState>;
    snapshot.units = snapshot.units.filter((unit) => unit.isPlayerUnit);
    snapshot.units.find((unit) => unit.id === 'police-1')!.position = { q: 2, r: 2 };
    snapshot.units.find((unit) => unit.id === 'national-guard-1')!.position = { q: 3, r: 2 };
    const farm = snapshot.facilities.find((facility) => facility.id === 'farm-1')!;
    farm.workers = 1;
    farm.infected = 1;
    synchronizePopulation(snapshot);
    expect(engine.step({ type: 'LoadSnapshot', snapshot }).error).toBeNull();
    expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
    expect(engine.getState().facilities.find((facility) => facility.id === farm.id)).toMatchObject({ owner: 'none', status: 'ruined' });

    const recovery = engine.getState() as ReturnType<typeof createInitialState>;
    recovery.units = recovery.units.filter((unit) => unit.isPlayerUnit);
    recovery.units.find((unit) => unit.id === 'national-guard-1')!.position = { ...farm.position };
    expect(engine.step({ type: 'LoadSnapshot', snapshot: recovery }).error).toBeNull();
    expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
    expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
    expect(engine.getState().facilities.find((facility) => facility.id === farm.id)).toMatchObject({ owner: 'player', status: 'owned', workers: 0, infected: 0 });

    const capitalLoss = engine.getState() as ReturnType<typeof createInitialState>;
    capitalLoss.units = capitalLoss.units.filter((unit) => unit.isPlayerUnit);
    capitalLoss.units.find((unit) => unit.id === 'police-1')!.position = { q: 2, r: 2 };
    capitalLoss.units.find((unit) => unit.id === 'national-guard-1')!.position = { q: 3, r: 2 };
    const capital = capitalLoss.facilities.find((facility) => facility.id === 'capital')!;
    capital.workers = 1;
    capital.infected = 1;
    synchronizePopulation(capitalLoss);
    expect(engine.step({ type: 'LoadSnapshot', snapshot: capitalLoss }).error).toBeNull();
    expect(engine.step({ type: 'EndTurn' }).result?.reason).toBe('capitalLost');
  });

  it('preserves the road arrival schedule after a ruined checkpoint is recovered', () => {
    const engine = new GameEngine(114, createDefaultConfig({
      finalHordeTurn: 10,
      economy: { initialZombieCount: 0, initialResources: { food: 5000, civilianGoods: 5000, militaryGoods: 5000, fuel: 5000 } },
    }));
    const snapshot = engine.getState() as ReturnType<typeof createInitialState>;
    const position = { q: 7, r: 6 };
    snapshot.units.find((unit) => unit.id === 'police-1')!.position = position;
    snapshot.checkpoints.push({
      id: 'checkpoint-north-1', position, direction: 'north', status: 'ruined',
      waiting: 0, screening: 0, approved: 0, remainingTurns: 0,
      screeningPolicy: 'normal', currentPolicy: 'normal', nextArrivalTurn: 1, infected: 1,
    });
    const scheduledTurn = snapshot.roadBranches.find((branch) => branch.branchId === 'north')!.nextArrivalTurn;
    synchronizePopulation(snapshot);
    expect(engine.step({ type: 'LoadSnapshot', snapshot }).error).toBeNull();
    expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
    const recovered = engine.getState().checkpoints[0]!;
    expect(recovered.status).toBe('operational');
    expect(recovered.nextArrivalTurn).toBe(scheduledTurn);
    while (!engine.isGameOver() && engine.getState().turn <= scheduledTurn) {
      expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
    }
    expect(engine.getState().events.some(
      (event) => event.type === 'refugees_arrived' && event.payload.checkpointId === recovered.id,
    )).toBe(true);
    expect(engine.getState().checkpoints[0]!.nextArrivalTurn).toBeGreaterThan(scheduledTurn);
  });

  it('applies fixed and seeded disconnected-facility population Config without treating it as player workers', () => {
    const config = createDefaultConfig({
      initialFacilityPopulation: {
        'farm-2': { survivors: 7, infected: 3 },
        'city-1': { survivorRange: { min: 4, max: 4 }, infectedRange: { min: 2, max: 2 } },
      },
    });
    const first = createInitialState(111, config);
    const second = createInitialState(111, config);
    const farm = first.facilities.find((facility) => facility.id === 'farm-2')!;
    const city = first.facilities.find((facility) => facility.id === 'city-1')!;
    expect(first).toEqual(second);
    expect(farm).toMatchObject({ owner: 'none', status: 'unowned', workers: 7, infected: 3, operationalStatus: 'infected' });
    expect(city).toMatchObject({ owner: 'none', status: 'unowned', workers: 4, infected: 2, operationalStatus: 'infected' });
    expect(first.population.healthyCivilians).toBe(100);
    expect(validateInvariants(first)).toEqual({ valid: true, errors: [] });
  });

  it('uses the seeded RNG when a production order has multiple nearest spawn tiles', () => {
    const config = createDefaultConfig({
      finalHordeTurn: 3,
      economy: { initialZombieCount: 0, initialResources: { food: 2000, civilianGoods: 2000, militaryGoods: 2000, fuel: 2000 } },
      horde: { cycle: 10 },
    });
    const engine = new GameEngine(112, config);
    const snapshot = engine.getState() as ReturnType<typeof createInitialState>;
    snapshot.units = snapshot.units.filter((unit) => unit.isPlayerUnit);
    snapshot.pendingUnitProductions.push({ id: 'production-tie', cityFacilityId: 'capital', unitType: 'police', population: 5, readyTurn: 2 });
    const nearest = findNearestOpenTiles(snapshot.map, { q: 7, r: 7 }, new Set(snapshot.units.map((unit) => `${unit.position.q},${unit.position.r}`)));
    const callsBefore = snapshot.rngState.calls;
    synchronizePopulation(snapshot);
    expect(nearest.length).toBeGreaterThan(1);
    expect(engine.step({ type: 'LoadSnapshot', snapshot }).error).toBeNull();
    expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
    expect(engine.getState().rngState.calls).toBe(callsBefore + 1);
    expect(engine.getState().units.some((unit) => unit.id === 'police-2' && nearest.some((position) => position.q === unit.position.q && position.r === unit.position.r))).toBe(true);
  });

  it('spawns increasing periodic Hordes followed by the configured Final Horde', () => {
    const config = createDefaultConfig({
      finalHordeTurn: 3,
      economy: { initialZombieCount: 0, initialResources: { food: 5000, civilianGoods: 5000, militaryGoods: 5000, fuel: 5000 } },
      horde: { cycle: 1, initialCount: 2, increment: 2 },
      units: { zombie: { movement: 0 }, hordeZombie: { movement: 0 } },
    });
    const engine = new GameEngine(113, config);
    expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
    expect(engine.getState().horde).toMatchObject({ spawnedCount: 1, totalSpawned: 2 });
    expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
    expect(engine.getState().horde).toMatchObject({ spawnedCount: 2, totalSpawned: 6 });
    expect(engine.step({ type: 'EndTurn' }).result).toBeNull();
    expect(engine.getState().horde).toMatchObject({ totalSpawned: 18, finalHordeStatus: 'active', finalSpawnedCount: 12 });
  });

  it('freezes deterministic supply and reception rankings for the whole player turn', () => {
    const engine = new GameEngine(201, createDefaultConfig({ economy: { initialZombieCount: 0 } }));
    const snapshot = engine.getState() as ReturnType<typeof createInitialState>;
    for (const [id, workers] of [['city-1', 20], ['city-2', 20]] as const) {
      const city = snapshot.facilities.find((facility) => facility.id === id)!;
      city.owner = 'player';
      city.status = 'owned';
      city.workers = workers;
      city.infected = 0;
      city.populationOperationalTurn = 1;
      city.securedOrder = id === 'city-1' ? 5 : 6;
    }
    synchronizePopulation(snapshot);
    createCityPopulationSnapshot(snapshot);
    expect(snapshot.cityPopulationSnapshot.supply.map((entry) => entry.facilityId).slice(0, 3)).toEqual([
      'capital', 'city-1', 'city-2',
    ]);
    expect(snapshot.cityPopulationSnapshot.reception.map((entry) => entry.facilityId).slice(0, 3)).toEqual([
      'city-1', 'city-2', 'capital',
    ]);
    expect(engine.step({ type: 'LoadSnapshot', snapshot }).error).toBeNull();
    expect(engine.step({ type: 'TransferPopulation', fromFacilityId: 'capital', toFacilityId: 'city-2', people: 10 }).error).toBeNull();
    expect(engine.getState().cityPopulationSnapshot).toEqual(snapshot.cityPopulationSnapshot);
    const beforeInvalid = engine.getState();
    expect(engine.step({ type: 'TransferPopulation', fromFacilityId: 'city-1', toFacilityId: 'city-2', people: 99 }).error?.code).toBe('insufficient_city_population');
    expect(engine.getState()).toEqual(beforeInvalid);
  });

  it('moves production workers atomically through frozen city supply and reception order', () => {
    const engine = new GameEngine(202, createDefaultConfig({ economy: { initialZombieCount: 0 } }));
    const before = engine.getState();
    const ledgerBefore = populationLedgerTotal(before as ReturnType<typeof createInitialState>);
    expect(engine.step({ type: 'AssignWorkers', facilityId: 'farm-1', workers: 30 }).error).toBeNull();
    expect(engine.getState().facilities.find((facility) => facility.id === 'capital')?.workers).toBe(34);
    expect(engine.getState().population.healthyCivilians).toBe(before.population.healthyCivilians);
    expect(populationLedgerTotal(engine.getState() as ReturnType<typeof createInitialState>)).toBe(ledgerBefore);
    expect(engine.step({ type: 'AssignWorkers', facilityId: 'farm-1', workers: 20 }).error).toBeNull();
    expect(engine.getState().facilities.find((facility) => facility.id === 'capital')?.workers).toBe(44);
    const unchanged = engine.getState();
    const rejected = engine.step({ type: 'AssignWorkers', facilityId: 'farm-1', workers: 99 });
    expect(rejected.error?.code).toBe('invalid_workers');
    expect(engine.getState()).toEqual(unchanged);
  });

  it('fills reception cities to their soft caps, then distributes excess round-robin', () => {
    const engine = new GameEngine(209, createDefaultConfig({ economy: { initialZombieCount: 0 } }));
    const snapshot = engine.getState() as ReturnType<typeof createInitialState>;
    const populations: Record<string, number> = { capital: 100, 'city-1': 49, 'city-2': 50 };
    for (const [id, workers] of Object.entries(populations)) {
      const city = snapshot.facilities.find((facility) => facility.id === id)!;
      city.owner = 'player';
      city.status = 'owned';
      city.workers = workers;
      city.populationOperationalTurn = 1;
      city.securedOrder ??= id === 'city-1' ? 5 : 6;
    }
    snapshot.facilities.find((facility) => facility.id === 'farm-1')!.workers = 5;
    synchronizePopulation(snapshot);
    createCityPopulationSnapshot(snapshot);
    expect(engine.step({ type: 'LoadSnapshot', snapshot }).error).toBeNull();
    expect(engine.step({ type: 'AssignWorkers', facilityId: 'farm-1', workers: 0 }).error).toBeNull();
    expect(engine.getState().facilities.find((facility) => facility.id === 'city-1')!.workers).toBe(52);
    expect(engine.getState().facilities.find((facility) => facility.id === 'city-2')!.workers).toBe(51);
    expect(engine.getState().facilities.find((facility) => facility.id === 'capital')!.workers).toBe(101);
  });

  it('keeps newly secured production facilities unavailable until the next player turn', () => {
    const engine = new GameEngine(203, createDefaultConfig({ finalHordeTurn: 3, economy: { initialZombieCount: 0 } }));
    const snapshot = engine.getState() as ReturnType<typeof createInitialState>;
    snapshot.units.find((unit) => unit.id === 'police-1')!.position = { q: 6, r: 5 };
    expect(engine.step({ type: 'LoadSnapshot', snapshot }).error).toBeNull();
    expect(engine.step({ type: 'Move', unitId: 'police-1', destination: { q: 6, r: 4 } }).error).toBeNull();
    expect(engine.step({ type: 'AssignWorkers', facilityId: 'farm-2', workers: 1 }).error?.code).toBe('facility_not_yet_operational');
    expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
    expect(engine.step({ type: 'AssignWorkers', facilityId: 'farm-2', workers: 1 }).error).toBeNull();
  });

  it('applies city soft caps to production and exact overcrowding forecasts', () => {
    const config = createDefaultConfig({
      finalHordeTurn: 2,
      economy: {
        initialZombieCount: 0,
        initialResources: { food: 5000, civilianGoods: 5000, militaryGoods: 5000, fuel: 5000 },
      },
    });
    const engine = new GameEngine(204, config);
    const snapshot = engine.getState() as ReturnType<typeof createInitialState>;
    for (const facility of snapshot.facilities) {
      if (facility.owner === 'player') facility.workers = 0;
    }
    const city = snapshot.facilities.find((facility) => facility.id === 'city-1')!;
    city.owner = 'player';
    city.status = 'owned';
    city.workers = 51;
    city.populationOperationalTurn = 1;
    city.securedOrder = 5;
    snapshot.facilities.find((facility) => facility.id === 'power-plant-1')!.workers = 1;
    synchronizePopulation(snapshot);
    createCityPopulationSnapshot(snapshot);
    expect(engine.step({ type: 'LoadSnapshot', snapshot }).error).toBeNull();
    const forecast = forecastEndTurn(engine.getState());
    expect(forecast.overcrowding).toMatchObject({ additionalFood: 2, additionalCivilianGoods: 2 });
    const result = engine.step({ type: 'EndTurn' });
    expect(result.events.some((event) => event.type === 'resource_produced' && event.payload.resource === 'civilianGoods' && event.payload.amount === 50)).toBe(true);
  });

  it('adds exact overcrowding fractions from multiple cities without a rate cap', () => {
    const engine = new GameEngine(210, createDefaultConfig({ economy: { initialZombieCount: 0 } }));
    const snapshot = engine.getState() as ReturnType<typeof createInitialState>;
    snapshot.facilities.find((facility) => facility.id === 'capital')!.workers = 110;
    for (const id of ['city-1', 'city-2']) {
      const city = snapshot.facilities.find((facility) => facility.id === id)!;
      city.owner = 'player';
      city.status = 'owned';
      city.workers = 55;
      city.populationOperationalTurn = 1;
      city.securedOrder = id === 'city-1' ? 5 : 6;
    }
    synchronizePopulation(snapshot);
    createCityPopulationSnapshot(snapshot);
    expect(engine.step({ type: 'LoadSnapshot', snapshot }).error).toBeNull();
    const forecast = forecastEndTurn(engine.getState());
    expect(forecast.overcrowding.cities).toHaveLength(3);
    expect(forecast.overcrowding.additionalFood).toBe(Math.ceil(forecast.populationConsumers * 0.3));
    expect(forecast.overcrowding.additionalCivilianGoods).toBe(Math.ceil(forecast.populationConsumers * 0.3));
  });

  it('enforces recruitment hubs, supply-order conscription, and the last-civilian guard', () => {
    const engine = new GameEngine(205, createDefaultConfig({ economy: { initialZombieCount: 0 } }));
    expect(engine.step({ type: 'ProduceUnit', unitType: 'police', destination: { q: 5, r: 7 } }).error?.code).toBe('invalid_recruitment_hub');
    expect(engine.step({ type: 'ProduceUnit', unitType: 'nationalGuard', destination: { q: 7, r: 7 } }).error).toBeNull();
    expect(engine.getState().facilities.find((facility) => facility.id === 'capital')?.workers).toBe(31);

    const last = engine.getState() as ReturnType<typeof createInitialState>;
    last.pendingUnitProductions = [];
    for (const facility of last.facilities) if (facility.owner === 'player') facility.workers = 0;
    last.facilities.find((facility) => facility.id === 'capital')!.workers = 5;
    synchronizePopulation(last);
    createCityPopulationSnapshot(last);
    expect(engine.step({ type: 'LoadSnapshot', snapshot: last }).error).toBeNull();
    const before = engine.getState();
    expect(engine.step({ type: 'ProduceUnit', unitType: 'police', destination: { q: 7, r: 7 } }).error?.code).toBe('insufficient_production_cost');
    expect(engine.getState()).toEqual(before);
  });

  it('uses the specified three-pool infection orders and auto-places approved refugees', () => {
    const config = createDefaultConfig({
      finalHordeTurn: 3,
      economy: { initialZombieCount: 0, initialResources: { food: 5000, civilianGoods: 5000, militaryGoods: 5000, fuel: 5000 } },
      units: { zombie: { movement: 0 } },
    });
    const engine = new GameEngine(206, config);
    const snapshot = engine.getState() as ReturnType<typeof createInitialState>;
    snapshot.checkpoints.push({
      id: 'checkpoint-north-1', position: { q: 7, r: 6 }, direction: 'north', status: 'operational',
      waiting: 2, screening: 2, approved: 2, remainingTurns: 2, screeningPolicy: 'normal', currentPolicy: 'normal', nextArrivalTurn: null, infected: 0,
    });
    snapshot.units.push(createUnit(snapshot, 'zombie-pools', 'zombie', { q: 7, r: 6 }));
    synchronizePopulation(snapshot);
    expect(engine.step({ type: 'LoadSnapshot', snapshot }).error).toBeNull();
    expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
    const attacked = engine.getState().checkpoints[0]!;
    expect(attacked).toMatchObject({ waiting: 0, screening: 0, approved: 0, infected: 5, status: 'operational' });
    expect(engine.getState().facilities.find((facility) => facility.id === 'capital')!.workers).toBe(42);

    const placement = engine.getState() as ReturnType<typeof createInitialState>;
    placement.units = placement.units.filter((unit) => unit.isPlayerUnit);
    placement.checkpoints[0]!.waiting = 0;
    placement.checkpoints[0]!.screening = 0;
    placement.checkpoints[0]!.approved = 3;
    placement.checkpoints[0]!.infected = 0;
    synchronizePopulation(placement);
    expect(engine.step({ type: 'LoadSnapshot', snapshot: placement }).error).toBeNull();
    const capitalBefore = placement.facilities.find((facility) => facility.id === 'capital')!.workers;
    expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
    expect(engine.getState().checkpoints[0]!.approved).toBe(0);
    expect(engine.getState().facilities.find((facility) => facility.id === 'capital')!.workers).toBe(capitalBefore + 3);
  });

  it('converts latent infection at a blocked checkpoint in approved-first order and overruns immediately', () => {
    const config = createDefaultConfig({
      finalHordeTurn: 2,
      economy: { initialZombieCount: 0, initialResources: { food: 5000, civilianGoods: 5000, militaryGoods: 5000, fuel: 5000 } },
      refugees: { policies: { passThrough: { infectionRate: 1, infectionPopulationRate: 1 } } },
    });
    const engine = new GameEngine(207, config);
    const snapshot = engine.getState() as ReturnType<typeof createInitialState>;
    snapshot.cityPopulationSnapshot.supply.forEach((entry) => { entry.eligible = false; });
    snapshot.cityPopulationSnapshot.reception.forEach((entry) => { entry.eligible = false; });
    snapshot.checkpoints.push({
      id: 'checkpoint-north-1', position: { q: 7, r: 6 }, direction: 'north', status: 'operational',
      waiting: 2, screening: 0, approved: 0, remainingTurns: 0, screeningPolicy: 'passThrough', currentPolicy: 'passThrough', nextArrivalTurn: null, infected: 0,
    });
    synchronizePopulation(snapshot);
    expect(engine.step({ type: 'LoadSnapshot', snapshot }).error).toBeNull();
    expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
    expect(engine.getState().checkpoints[0]).toMatchObject({ waiting: 0, screening: 0, approved: 0, status: 'ruined' });
    expect(engine.getState().checkpoints[0]!.infected).toBeGreaterThan(0);
  });

  it('spreads checkpoint internal infection waiting-first while same-turn food production prevents losses', () => {
    const config = createDefaultConfig({
      finalHordeTurn: 1,
      economy: { initialZombieCount: 0, initialResources: { food: 100, civilianGoods: 5000, militaryGoods: 5000, fuel: 5000 } },
    });
    const engine = new GameEngine(208, config);
    const snapshot = engine.getState() as ReturnType<typeof createInitialState>;
    snapshot.checkpoints.push({
      id: 'checkpoint-north-1', position: { q: 7, r: 6 }, direction: 'north', status: 'operational',
      waiting: 1, screening: 2, approved: 3, remainingTurns: 2, screeningPolicy: 'normal', currentPolicy: 'normal', nextArrivalTurn: null, infected: 2,
    });
    synchronizePopulation(snapshot);
    expect(engine.step({ type: 'LoadSnapshot', snapshot }).error).toBeNull();
    expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
    expect(engine.getState().checkpoints[0]).toMatchObject({ waiting: 0, screening: 1, approved: 0, infected: 4 });
    expect(engine.getState().facilities.find((facility) => facility.id === 'capital')!.workers).toBe(44);
    expect(engine.getState().facilities.find((facility) => facility.id === 'farm-1')!.workers).toBe(23);
  });
});
