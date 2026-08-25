import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from './config';
import { forecastEndTurn, GameEngine, previewMove } from './engine';
import { validateInvariants } from './invariants';
import { findNearestOpenTiles } from './path';
import { createInitialState, createUnit, synchronizePopulation } from './state';

describe('GameEngine', () => {
  it('creates a complete deterministic initial state', () => {
    const config = createDefaultConfig();
    const first = createInitialState(42, config);
    const second = createInitialState(42, config);
    expect(first).toEqual(second);
    expect(first.facilities).toHaveLength(16);
    expect(first.facilities.filter((facility) => facility.status === 'owned')).toHaveLength(5);
    expect(first.population.employed + first.population.unemployed).toBe(100);
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

  it('provides an interception preview and stops movement on interception', () => {
    const engine = new GameEngine(7, createDefaultConfig());
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

  it('processes a complete end turn and forbids post-game actions', () => {
    const config = createDefaultConfig({ maxTurns: 1, horde: { cycle: 5 } });
    const engine = new GameEngine(11, config);
    const result = engine.step({ type: 'EndTurn' });
    expect(result.error).toBeNull();
    expect(result.gameOver).toBe(true);
    expect(result.result?.reason).toBe('maxTurnsSurvived');
    const after = engine.getState();
    const blocked = engine.step({ type: 'EndTurn' });
    expect(blocked.error?.code).toBe('game_over');
    expect(engine.getState()).toEqual(after);
  });

  it('uses the same engine path for headless legal actions', () => {
    const engine = new GameEngine(99, createDefaultConfig({ maxTurns: 2 }));
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
    const engine = new GameEngine(31, createDefaultConfig({ maxTurns: 3 }));
    const before = engine.getState();
    expect(engine.step({ type: 'ProduceUnit', unitType: 'police', destination: { q: 7, r: 7 } }).error).toBeNull();
    expect(engine.getState().pendingUnitProductions).toHaveLength(1);
    expect(engine.getState().population.unemployed).toBe(before.population.unemployed - 5);
    expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
    expect(engine.getState().units.filter((unit) => unit.type === 'police')).toHaveLength(2);
  });

  it('builds a cardinal road checkpoint and resolves pass-through refugees', () => {
    const config = createDefaultConfig({
      maxTurns: 3,
      refugees: { arrivalIntervalMin: 1, arrivalIntervalMax: 1, arrivalPeopleMin: 2, arrivalPeopleMax: 2, screeningCapacity: 2 },
    });
    const engine = new GameEngine(12, config);
    const snapshot = engine.getState() as ReturnType<typeof createInitialState>;
    snapshot.units.find((unit) => unit.id === 'police-1')!.position = { q: 7, r: 6 };
    expect(engine.step({ type: 'LoadSnapshot', snapshot }).error).toBeNull();
    expect(engine.step({ type: 'BuildCheckpoint', position: { q: 7, r: 6 } }).error).toBeNull();
    const checkpointId = engine.getState().checkpoints[0]!.id;
    expect(engine.step({ type: 'SetCheckpointPolicy', checkpointId, policy: 'passThrough' }).error).toBeNull();
    const unemployed = engine.getState().population.unemployed;
    expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
    expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
    expect(engine.getState().population.unemployed).toBeGreaterThanOrEqual(unemployed + 2);
  });

  it('applies combined food and civilian shortages before production', () => {
    const engine = new GameEngine(3, createDefaultConfig());
    const snapshot = engine.getState() as ReturnType<typeof createInitialState>;
    snapshot.resources.food = 0;
    snapshot.resources.civilianGoods = 0;
    expect(engine.step({ type: 'LoadSnapshot', snapshot }).error).toBeNull();
    const result = engine.step({ type: 'EndTurn' });
    expect(result.error).toBeNull();
    expect(result.result?.reason).toBe('workersLost');
    expect(result.events.some((event) => event.type === 'resource_shortage')).toBe(true);
  });

  it('previews Horde spawning deterministically and never spawns on the final turn', () => {
    const engine = new GameEngine(55, createDefaultConfig({ maxTurns: 6 }));
    const snapshot = engine.getState() as ReturnType<typeof createInitialState>;
    snapshot.units = snapshot.units.filter((unit) => unit.isPlayerUnit);
    synchronizePopulation(snapshot);
    expect(engine.step({ type: 'LoadSnapshot', snapshot }).error).toBeNull();
    for (let turn = 0; turn < 5; turn += 1) {
      expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
    }
    expect(engine.getState().horde.spawnedCount).toBe(1);
    expect(engine.getState().units.filter((unit) => unit.type === 'zombie')).toHaveLength(2);
    expect(engine.step({ type: 'EndTurn' }).result?.reason).toBe('maxTurnsSurvived');
    expect(engine.getState().horde.spawnedCount).toBe(1);
  });

  it('stops infection spread for a facility after stationed suppression, even with infected people remaining', () => {
    const engine = new GameEngine(101, createDefaultConfig({ maxTurns: 3 }));
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
    const engine = new GameEngine(102, createDefaultConfig({ maxTurns: 3 }));
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
    expect(checkpoint.waiting + checkpoint.screening).toBe(5);
    expect(checkpoint.status).toBe('operational');
  });

  it('does not overrun a safely emptied facility merely because a zombie stands on it', () => {
    const config = createDefaultConfig({ maxTurns: 3, units: { zombie: { movement: 0 } } });
    const engine = new GameEngine(103, config);
    const snapshot = engine.getState() as ReturnType<typeof createInitialState>;
    const zombie = snapshot.units.find((unit) => unit.type === 'zombie')!;
    snapshot.units = snapshot.units.filter((unit) => unit.isPlayerUnit || unit.id === zombie.id);
    zombie.position = { q: 7, r: 7 };
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
    const engine = new GameEngine(104, createDefaultConfig({ maxTurns: 3, economy: { initialZombieCount: 0 } }));
    const snapshot = engine.getState() as ReturnType<typeof createInitialState>;
    const zombie = createUnit(snapshot, 'zombie-test', 'zombie', { q: 7, r: 6 });
    snapshot.units = snapshot.units.filter((unit) => unit.isPlayerUnit);
    snapshot.units.push(zombie);
    synchronizePopulation(snapshot);
    expect(engine.step({ type: 'LoadSnapshot', snapshot }).error).toBeNull();

    const exchange = engine.step({ type: 'Attack', attackerId: 'police-1', targetId: zombie.id });
    expect(exchange.error).toBeNull();
    expect(exchange.state.units.find((unit) => unit.id === zombie.id)?.hp).toBe(5);
    expect(exchange.state.units.find((unit) => unit.id === 'police-1')?.hp).toBe(20);
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

  it('uses Config natural-recovery rounding after an inactive turn', () => {
    const config = createDefaultConfig({
      maxTurns: 3,
      economy: { initialZombieCount: 0, initialResources: { food: 2000, civilianGoods: 2000, militaryGoods: 2000, fuel: 2000 } },
      naturalRecovery: { rate: 0.1, rounding: 'floor' },
    });
    const engine = new GameEngine(105, config);
    const snapshot = engine.getState() as ReturnType<typeof createInitialState>;
    snapshot.units.find((unit) => unit.id === 'police-1')!.hp = 10;
    snapshot.units = snapshot.units.filter((unit) => unit.isPlayerUnit);
    synchronizePopulation(snapshot);
    expect(engine.step({ type: 'LoadSnapshot', snapshot }).error).toBeNull();
    expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
    expect(engine.getState().units.find((unit) => unit.id === 'police-1')?.hp).toBe(12);
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

  it('forecasts and resolves electricity, prior-stock fuel input, and partial fuel operation without mutation', () => {
    const config = createDefaultConfig({ maxTurns: 3, economy: { initialZombieCount: 0 } });
    const engine = new GameEngine(107, config);
    const snapshot = engine.getState() as ReturnType<typeof createInitialState>;
    snapshot.units = snapshot.units.filter((unit) => unit.isPlayerUnit);
    snapshot.resources.fuel = 5;
    synchronizePopulation(snapshot);
    const before = JSON.stringify(snapshot);
    const forecast = forecastEndTurn(snapshot);
    expect(JSON.stringify(snapshot)).toBe(before);
    expect(forecast.fuel).toMatchObject({ available: 5, productionInputRequired: 46, shortage: 41 });
    expect(forecast.electricity).toMatchObject({ capacity: 15, required: 10, shortage: 0 });
    expect(engine.step({ type: 'LoadSnapshot', snapshot }).error).toBeNull();
    const result = engine.step({ type: 'EndTurn' });
    expect(result.state.resources.fuel).toBe(50);
    expect(result.events.some((event) => event.type === 'resource_produced' && event.payload.resource === 'food' && event.payload.amount === 25)).toBe(true);
    expect(result.events.some((event) => event.type === 'resource_produced' && event.payload.resource === 'civilianGoods')).toBe(false);

    const noPower = engine.getState() as ReturnType<typeof createInitialState>;
    noPower.turn = 1;
    noPower.phase = 'player';
    noPower.gameOver = false;
    noPower.result = null;
    noPower.resources.fuel = 100;
    noPower.facilities.find((facility) => facility.id === 'power-plant-1')!.workers = 0;
    synchronizePopulation(noPower);
    expect(engine.step({ type: 'LoadSnapshot', snapshot: noPower }).error).toBeNull();
    const unpowered = forecastEndTurn(engine.getState());
    expect(unpowered.electricity).toMatchObject({ capacity: 0, required: 10, shortage: 10 });
    expect(unpowered.fuel.productionInputRequired).toBe(0);
  });

  it('lowers every national-guard effective range when military goods are short', () => {
    const config = createDefaultConfig({
      maxTurns: 3,
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
      maxTurns: 8,
      economy: { initialZombieCount: 0, initialResources: { food: 5000, civilianGoods: 5000, militaryGoods: 5000, fuel: 5000 } },
      refugees: { arrivalIntervalMin: 8, arrivalIntervalMax: 8, arrivalPeopleMin: 1, arrivalPeopleMax: 1, screeningCapacity: 4 },
    });
    const engine = new GameEngine(109, config);
    const snapshot = engine.getState() as ReturnType<typeof createInitialState>;
    snapshot.units = snapshot.units.filter((unit) => unit.isPlayerUnit);
    snapshot.checkpoints.push({
      id: 'checkpoint-north-1', position: { q: 7, r: 6 }, direction: 'north', status: 'operational',
      waiting: 0, screening: 4, remainingTurns: 1, screeningPolicy: 'normal', currentPolicy: 'strict', nextArrivalTurn: null, infected: 0,
    });
    synchronizePopulation(snapshot);
    expect(engine.step({ type: 'LoadSnapshot', snapshot }).error).toBeNull();
    const beforeNormal = engine.getState().population.unemployed;
    expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
    expect(engine.getState().population.unemployed).toBe(beforeNormal + 3);

    const passThrough = engine.getState() as ReturnType<typeof createInitialState>;
    const checkpoint = passThrough.checkpoints[0]!;
    checkpoint.waiting = 4;
    checkpoint.screening = 0;
    checkpoint.currentPolicy = 'passThrough';
    checkpoint.nextArrivalTurn = null;
    synchronizePopulation(passThrough);
    expect(engine.step({ type: 'LoadSnapshot', snapshot: passThrough }).error).toBeNull();
    const beforePass = engine.getState().population.unemployed;
    expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
    expect(engine.getState().population.unemployed).toBe(beforePass + 4);

    const strict = engine.getState() as ReturnType<typeof createInitialState>;
    strict.checkpoints[0]!.waiting = 4;
    strict.checkpoints[0]!.screening = 0;
    strict.checkpoints[0]!.currentPolicy = 'strict';
    strict.checkpoints[0]!.nextArrivalTurn = null;
    synchronizePopulation(strict);
    expect(engine.step({ type: 'LoadSnapshot', snapshot: strict }).error).toBeNull();
    const beforeStrict = engine.getState().population.unemployed;
    for (let turn = 0; turn < 6; turn += 1) expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
    expect(engine.getState().population.unemployed).toBe(beforeStrict + 2);
  });

  it('overruns and recovers a facility through infection, and loses immediately when the capital falls', () => {
    const config = createDefaultConfig({
      maxTurns: 4,
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
    expect(engine.getState().facilities.find((facility) => facility.id === farm.id)?.status).toBe('ruined');

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
    expect(first.population.employed).toBe(59);
    expect(validateInvariants(first)).toEqual({ valid: true, errors: [] });
  });

  it('uses the seeded RNG when a production order has multiple nearest spawn tiles', () => {
    const config = createDefaultConfig({
      maxTurns: 3,
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

  it('spawns increasing Hordes on schedule and skips a final-turn spawn', () => {
    const config = createDefaultConfig({
      maxTurns: 3,
      economy: { initialZombieCount: 0, initialResources: { food: 5000, civilianGoods: 5000, militaryGoods: 5000, fuel: 5000 } },
      horde: { cycle: 1, initialCount: 2, increment: 2 },
      units: { zombie: { movement: 0 } },
    });
    const engine = new GameEngine(113, config);
    expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
    expect(engine.getState().horde).toMatchObject({ spawnedCount: 1, totalSpawned: 2 });
    expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
    expect(engine.getState().horde).toMatchObject({ spawnedCount: 2, totalSpawned: 6 });
    expect(engine.step({ type: 'EndTurn' }).result?.reason).toBe('maxTurnsSurvived');
    expect(engine.getState().horde.totalSpawned).toBe(6);
  });
});
