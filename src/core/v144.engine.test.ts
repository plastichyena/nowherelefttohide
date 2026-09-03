import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from './config';
import { forecastEndTurn, GameEngine, getCheckpointBuildCost } from './engine';
import { singleFinalWave } from './testConfig';
import {
  createInitialState,
  createUnit,
  populationLedgerTotal,
  synchronizePopulation,
} from './state';

type Snapshot = ReturnType<typeof createInitialState>;

function rebalance(state: Snapshot): void {
  synchronizePopulation(state);
  state.population.initialPopulation = populationLedgerTotal(state)
    - state.population.cumulativeArrivals
    - state.population.cumulativeDiscoveredInfected
    + state.population.cumulativeDepartures;
}

function load(engine: GameEngine, snapshot: Snapshot): void {
  const result = engine.step({ type: 'LoadSnapshot', snapshot });
  expect(result.error).toBeNull();
}

function noInitialZombies() {
  return createDefaultConfig({
    economy: {
      initialZombieCount: 0,
      initialResources: { food: 5_000, civilianGoods: 5_000, militaryGoods: 5_000, fuel: 5_000 },
    },
    vision: { capital: 30 },
  });
}

describe('v1.4.5 checkpoint and rejection rules', () => {
  it('does not build a sixth prepared post when a branch has no Active checkpoint', () => {
    const engine = new GameEngine(14408, noInitialZombies());
    const snapshot = engine.getState() as Snapshot;
    const branch = snapshot.roadBranches.find((item) => item.branchId === 'north')!;
    branch.activeCheckpointId = null;
    branch.standbyCheckpointIds = [];
    for (const [index, r] of [19, 18, 17, 16, 15].entries()) {
      const id = `checkpoint-north-prepared-${index + 1}`;
      snapshot.checkpoints.push({
        id,
        position: { q: 25, r },
        direction: 'north',
        branchId: 'north',
        status: 'operational',
        waiting: 0,
        screening: 0,
        approved: 0,
        remainingTurns: 0,
        screeningPolicy: 'normal',
        nextArrivalTurn: branch.nextArrivalTurn,
        infected: 0,
        overrunProcessed: false,
      });
      branch.standbyCheckpointIds.push(id);
    }
    load(engine, snapshot);
    const before = engine.getState();

    const result = engine.step({
      type: 'BuildCheckpoint',
      branchId: 'north',
      position: { q: 25, r: 14 },
    });

    expect(result.error).toMatchObject({ code: 'checkpoint_prepared_post_limit_reached' });
    expect(engine.getState()).toEqual(before);
  });

  it('charges 5 Civilian Goods for the first branch build and 25 forever after', () => {
    const engine = new GameEngine(14401, noInitialZombies());
    expect(getCheckpointBuildCost(engine.getState(), 'north')).toBe(5);
    const firstStock = engine.getState().resources.civilianGoods;
    expect(engine.step({ type: 'BuildCheckpoint', branchId: 'north', position: { q: 25, r: 19 } }).error).toBeNull();
    expect(engine.getState().resources.civilianGoods).toBe(firstStock - 5);
    expect(engine.getState().roadBranches.find((branch) => branch.branchId === 'north')?.hasBuiltCheckpoint).toBe(true);
    expect(getCheckpointBuildCost(engine.getState(), 'north')).toBe(25);

    expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
    const secondStock = engine.getState().resources.civilianGoods;
    expect(engine.step({ type: 'BuildCheckpoint', branchId: 'north', position: { q: 25, r: 21 } }).error).toBeNull();
    expect(engine.getState().resources.civilianGoods).toBe(secondStock - 25);
  });

  it('turns away waiting people only and records a future-Horde direction counter', () => {
    const engine = new GameEngine(14402, noInitialZombies());
    expect(engine.step({ type: 'BuildCheckpoint', branchId: 'north', position: { q: 25, r: 19 } }).error).toBeNull();
    const snapshot = engine.getState() as Snapshot;
    const checkpoint = snapshot.checkpoints[0]!;
    checkpoint.waiting = 7;
    checkpoint.screening = 2;
    checkpoint.approved = 3;
    rebalance(snapshot);
    load(engine, snapshot);

    const result = engine.step({ type: 'TurnAwayCheckpointRefugees', checkpointId: checkpoint.id, count: 4 });
    expect(result.error).toBeNull();
    expect(result.state.checkpoints[0]).toMatchObject({ waiting: 3, screening: 2, approved: 3 });
    expect(result.state.rejectedRefugeesByDirection.north.turnedAway).toBe(4);
    expect(result.state.statistics.refugeesTurnedAwayByDirection.north).toBe(4);
  });

  it('adds ceil(rejected/5) normal Zombies on the participating front, resets it, and ends arrivals', () => {
    const config = createDefaultConfig({
      economy: { initialZombieCount: 0 },
      horde: singleFinalWave(1, { hordeZombie: 1, zombie: 0 }, 1),
    });
    const engine = new GameEngine(14403, config);
    const snapshot = engine.getState() as Snapshot;
    for (const direction of ['north', 'east', 'south', 'west'] as const) {
      snapshot.rejectedRefugeesByDirection[direction].normalRejected = 6;
    }
    load(engine, snapshot);

    expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
    const state = engine.getState();
    expect(state.units.filter((unit) => unit.type === 'hordeZombie')).toHaveLength(1);
    expect(state.units.filter((unit) => unit.type === 'zombie')).toHaveLength(2);
    expect(Object.values(state.statistics.rejectedBonusZombiesByDirection).reduce((a, b) => a + b, 0)).toBe(2);
    expect(Object.values(state.statistics.rejectedCounterResetsByDirection).reduce((a, b) => a + b, 0)).toBe(1);
    expect(state.roadBranches.every((branch) => branch.nextArrivalTurn === null)).toBe(true);
  });
});

describe('v1.4.4 maintenance, decommission, and reanimation rules', () => {
  it('rejects a LoadSnapshot whose legal initial Zombie order does not match its seed', () => {
    const engine = new GameEngine(14407, createDefaultConfig());
    const before = engine.getState();
    const snapshot = engine.getState() as Snapshot;
    [snapshot.map.initialZombiePositions[0], snapshot.map.initialZombiePositions[1]] = [
      snapshot.map.initialZombiePositions[1]!,
      snapshot.map.initialZombiePositions[0]!,
    ];

    const result = engine.step({ type: 'LoadSnapshot', snapshot });

    expect(result.error).toMatchObject({ code: 'invalid_snapshot' });
    expect(result.error?.message).toMatch(/initial Zombie positions and order.*seed/i);
    expect(engine.getState()).toEqual(before);
  });

  it('includes healthy checkpoint queues in both Food and Civilian Goods maintenance', () => {
    const state = createInitialState(14404, noInitialZombies());
    const before = forecastEndTurn(state);
    state.checkpoints.push({
      id: 'checkpoint-north-test',
      position: { q: 25, r: 19 },
      direction: 'north',
      branchId: 'north',
      status: 'operational',
      waiting: 3,
      screening: 4,
      approved: 5,
      remainingTurns: 0,
      screeningPolicy: 'normal',
      nextArrivalTurn: state.roadBranches.find((branch) => branch.branchId === 'north')!.nextArrivalTurn,
      infected: 0,
      overrunProcessed: false,
    });
    state.roadBranches.find((branch) => branch.branchId === 'north')!.activeCheckpointId = 'checkpoint-north-test';
    rebalance(state);
    const after = forecastEndTurn(state);
    expect(after.populationConsumers - before.populationConsumers).toBe(12);
    expect(after.food.maintenanceRequired - before.food.maintenanceRequired).toBe(12);
    expect(after.civilianGoods.maintenanceRequired - before.civilianGoods.maintenanceRequired).toBe(12);
    const engine = new GameEngine(14404, noInitialZombies());
    load(engine, state);
    expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
    expect(engine.getState().statistics).toMatchObject({
      checkpointQueueFoodDemand: 12,
      checkpointQueueCivilianGoodsDemand: 12,
      checkpointQueueFoodConsumed: 12,
      checkpointQueueCivilianGoodsConsumed: 12,
    });
  });

  it('decommissions only a completed empty Drone Base and refunds 13 Civilian Goods', () => {
    const engine = new GameEngine(14405, noInitialZombies());
    const candidate = engine.getConstructibleFacilityPositionCandidates('civilianDroneBase').find((item) => item.legal)!;
    expect(engine.step({
      type: 'BuildConstructibleFacility',
      facilityType: 'civilianDroneBase',
      position: candidate.position,
    }).error).toBeNull();
    const droneId = engine.getState().facilities.find(
      (facility) => facility.constructible && facility.type === 'civilianDroneBase',
    )!.id;
    expect(engine.step({ type: 'DecommissionConstructibleFacility', facilityId: droneId }).error?.code).toBe('facility_building');
    expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
    const stock = engine.getState().resources.civilianGoods;
    expect(engine.step({ type: 'DecommissionConstructibleFacility', facilityId: droneId }).error).toBeNull();
    expect(engine.getState().facilities.some((facility) => facility.id === droneId)).toBe(false);
    expect(engine.getState().resources.civilianGoods).toBe(stock + 13);
    expect(engine.getState().statistics.civilianDroneBasesDecommissioned).toBe(1);
  });

  it('reanimates a killed Police unit as a same-hex Police Zombie that cannot act this phase', () => {
    const engine = new GameEngine(14406, noInitialZombies());
    const snapshot = engine.getState() as Snapshot;
    const police = snapshot.units.find((unit) => unit.type === 'police')!;
    police.hp = 1;
    const zombie = createUnit(snapshot, 'counter-zombie', 'zombie', { q: 24, r: 24 });
    zombie.hp = zombie.maxHp;
    snapshot.units.push(zombie);
    load(engine, snapshot);

    const result = engine.step({ type: 'Attack', attackerId: police.id, targetId: zombie.id });
    expect(result.error).toBeNull();
    expect(result.state.units.some((unit) => unit.id === police.id)).toBe(false);
    const reanimated = result.state.units.find((unit) => unit.type === 'policeZombie');
    expect(reanimated).toMatchObject({ position: police.position, canMove: false, canAttack: false, spawnGroupId: null });
    expect(result.state.statistics.policeReanimations).toBe(1);
    expect(result.state.statistics.policeZombiesSpawned).toBe(1);
  });
});
