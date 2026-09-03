import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from './config';
import { GameEngine, validateAction } from './engine';
import { hexDistance } from './hex';
import { createUnit } from './state';
import { singleFinalWave } from './testConfig';
import type { GameState } from './types';
import {
  getBlockingZombiesForCheckpoint,
  getBranchSupplyRadius,
  getSectorBranchIds,
  isHexSupplied,
  isHexSuppliedByBranch,
} from './supply';

function engineWithoutZombies(): GameEngine {
  const engine = new GameEngine(17);
  const snapshot = engine.getState() as GameState;
  snapshot.units = snapshot.units.filter((unit) => unit.type !== 'zombie');
  expect(engine.step({ type: 'LoadSnapshot', snapshot }).error).toBeNull();
  return engine;
}

describe('road branches and supply network', () => {
  it('defines four capital-outward branches and supplies radius five without checkpoints', () => {
    const state = new GameEngine(1).getState();
    expect(state.map.roadBranches.map((branch) => branch.id).sort()).toEqual([
      'east',
      'north',
      'south',
      'west',
    ]);
    expect(state.roadBranches).toHaveLength(4);
    expect(state.roadBranches.every((branch) => branch.nextArrivalTurn !== null && branch.nextArrivalTurn >= 3 && branch.nextArrivalTurn <= 5)).toBe(true);
    for (const tile of state.map.tiles) {
      const distance = hexDistance({ q: 25, r: 25 }, tile);
      if (distance <= 5) expect(isHexSupplied(state, tile)).toBe(true);
    }
    expect(isHexSupplied(state, { q: 25, r: 0 })).toBe(false);
    expect(getSectorBranchIds(state.map, { q: 28, r: 22 })).toEqual(expect.arrayContaining(['east', 'north']));
  });

  it('places an unsecured military factory inside the initial capital supply network', () => {
    const state = new GameEngine(1).getState();
    const unsecuredMilitaryFactories = state.facilities.filter(
      (facility) => facility.type === 'militaryFactory' && facility.owner !== 'player',
    );
    const nearbyFactory = unsecuredMilitaryFactories.find(
      (facility) => facility.id === 'military-factory-1',
    );

    expect(unsecuredMilitaryFactories.length).toBeGreaterThan(0);
    expect(nearbyFactory).toMatchObject({
      position: { q: 21, r: 25 },
      owner: 'none',
      status: 'unowned',
    });
    expect(isHexSupplied(state, nearbyFactory!.position)).toBe(true);
  });

  it('uses the candidate sector plus initial radius for zombie construction blockers', () => {
    const state = new GameEngine(1, createDefaultConfig({ units: { police: { vision: 10 } } })).getState();
    state.units.push(createUnit(state, 'zombie-checkpoint-blocker', 'zombie', { q: 24, r: 20 }));
    const blockers = getBlockingZombiesForCheckpoint(state, 'north', { q: 25, r: 19 });
    expect(blockers.length).toBeGreaterThan(0);
    expect(validateAction(state, { type: 'BuildCheckpoint', branchId: 'north', position: { q: 25, r: 19 } })?.code)
      .toBe('checkpoint_supply_zombie_blocked');
  });

  it('does not let another sector zombie block a branch inside the shared initial radius', () => {
    const state = new GameEngine(1).getState() as GameState;
    const otherSectorTile = state.map.tiles.find((tile) =>
      hexDistance({ q: 25, r: 25 }, tile) <= state.config.checkpoint.initialSupplyRadius &&
      !getSectorBranchIds(state.map, tile).includes('north'))!;
    expect(otherSectorTile).toBeDefined();
    expect(isHexSuppliedByBranch(state, otherSectorTile, 'north', { q: 25, r: 19 })).toBe(false);
    state.units = state.units.filter((unit) => unit.type !== 'zombie');
    state.units.push(createUnit(state, 'zombie-other-sector', 'zombie', otherSectorTile));
    expect(getBlockingZombiesForCheckpoint(state, 'north', { q: 25, r: 19 })).toEqual([]);
  });

  it('builds without police for five goods, extends supply, and keeps the branch arrival schedule', () => {
    const engine = engineWithoutZombies();
    const before = engine.getState();
    const schedule = before.roadBranches.find((branch) => branch.branchId === 'north')!.nextArrivalTurn;
    const goods = before.resources.civilianGoods;
    expect(engine.step({ type: 'BuildCheckpoint', branchId: 'north', position: { q: 25, r: 19 } }).error).toBeNull();
    const after = engine.getState();
    expect(after.resources.civilianGoods).toBe(goods - 5);
    expect(after.checkpoints[0]).toMatchObject({ branchId: 'north', status: 'operational' });
    expect(after.roadBranches.find((branch) => branch.branchId === 'north')!.currentPolicy).toBe('normal');
    expect(after.roadBranches.find((branch) => branch.branchId === 'north')).toMatchObject({
      nextArrivalTurn: schedule,
      checkpointActionsThisTurn: 1,
      activeCheckpointId: after.checkpoints[0]!.id,
    });
    expect(getBranchSupplyRadius(after, 'north')).toBe(6);
    expect(isHexSupplied(after, { q: 25, r: 19 })).toBe(true);
  });

  it('relocates once per branch and preserves non-empty old pools in a remnant', () => {
    const engine = engineWithoutZombies();
    expect(engine.step({ type: 'BuildCheckpoint', branchId: 'north', position: { q: 25, r: 19 } }).error).toBeNull();
    expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
    const snapshot = engine.getState();
    const source = snapshot.checkpoints.find((checkpoint) => checkpoint.status === 'operational')!;
    source.waiting = 3;
    snapshot.population.waitingRefugees = 3;
    snapshot.population.cumulativeArrivals += 3;
    expect(engine.step({ type: 'LoadSnapshot', snapshot }).error).toBeNull();
    expect(engine.step({
      type: 'RelocateCheckpoint',
      checkpointId: source.id,
      branchId: 'north',
      position: { q: 25, r: 18 },
    }).error).toBeNull();
    const after = engine.getState();
    expect(after.checkpoints.find((checkpoint) => checkpoint.id === source.id)).toMatchObject({
      status: 'remnant',
      waiting: 3,
    });
    const active = after.checkpoints.find((checkpoint) => checkpoint.status === 'operational')!;
    expect(after.roadBranches.find((branch) => branch.branchId === 'north')!.currentPolicy).toBe('normal');
    expect(engine.step({
      type: 'RelocateCheckpoint',
      checkpointId: active.id,
      branchId: 'north',
      position: { q: 25, r: 11 },
    }).error?.code).toBe('checkpoint_branch_action_limit');
  });

  it('processes all unmanaged road arrivals immediately without hidden checkpoint pools', () => {
    const config = createDefaultConfig({
      horde: singleFinalWave(3),
      economy: { initialZombieCount: 0 },
      refugees: {
        arrivalIntervalMin: 1,
        arrivalIntervalMax: 1,
        arrivalPeopleMin: 5,
        arrivalPeopleMax: 5,
        policies: { passThrough: { infectionRate: 0 } },
      },
    });
    const engine = new GameEngine(9, config);
    expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
    expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
    const state = engine.getState();
    expect(state.population.cumulativeArrivals).toBe(20);
    expect(state.statistics.unmanagedPassThrough).toBe(20);
    expect(state.checkpoints).toEqual([]);
    expect(state.population.waitingRefugees + state.population.screeningRefugees + state.population.approvedRefugees).toBe(0);
  });

  it('allows existing out-of-supply production but rejects worker increases and natural recovery', () => {
    const config = createDefaultConfig({ economy: { initialZombieCount: 0 }, horde: singleFinalWave(3) });
    const engine = new GameEngine(4, config);
    const snapshot = engine.getState();
    const power = snapshot.facilities.find((facility) => facility.id === 'power-plant-2')!;
    power.owner = 'player';
    power.status = 'owned';
    power.operationalStatus = 'stopped';
    power.populationOperationalTurn = 1;
    power.securedOrder = 6;
    snapshot.population.facilityWorkers.push({ facilityId: power.id, workers: 0 });
    snapshot.population.facilityWorkers.sort((a, b) => a.facilityId.localeCompare(b.facilityId));
    const police = snapshot.units.find((unit) => unit.type === 'police')!;
    police.position = { q: 1, r: 1 };
    police.hp = 10;
    expect(engine.step({ type: 'LoadSnapshot', snapshot }).error).toBeNull();
    expect(engine.step({ type: 'AssignWorkers', facilityId: power.id, workers: 1 }).error?.code)
      .toBe('facility_out_of_supply');
    expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
    expect(engine.getState().units.find((unit) => unit.id === police.id)!.hp).toBe(10);
  });

  it('ruins an empty occupied checkpoint and allows a forward replacement once the Zombie is cleared', () => {
    const config = createDefaultConfig({ economy: { initialZombieCount: 0 }, horde: singleFinalWave(4) });
    const engine = new GameEngine(5, config);
    expect(engine.step({ type: 'BuildCheckpoint', branchId: 'north', position: { q: 25, r: 19 } }).error).toBeNull();
    const occupied = engine.getState();
    const checkpoint = occupied.checkpoints[0]!;
    const zombie = createUnit(occupied, 'zombie-empty-checkpoint', 'zombie', checkpoint.position);
    zombie.movement = 0;
    occupied.units.push(zombie);
    expect(engine.step({ type: 'LoadSnapshot', snapshot: occupied }).error).toBeNull();
    expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
    const ruined = engine.getState().checkpoints.find((candidate) => candidate.id === checkpoint.id)!;
    expect(ruined.status).toBe('ruined');
    expect(engine.getState().roadBranches.find((branch) => branch.branchId === 'north')!.activeCheckpointId).toBeNull();

    const cleared = engine.getState() as GameState;
    cleared.units = cleared.units.filter((unit) => unit.type !== 'zombie');
    expect(engine.step({ type: 'LoadSnapshot', snapshot: cleared }).error).toBeNull();
    expect(engine.step({ type: 'BuildCheckpoint', branchId: 'north', position: { q: 25, r: 11 } }).error).toBeNull();
    expect(engine.getState().roadBranches.find((branch) => branch.branchId === 'north')!.activeCheckpointId)
      .not.toBe(checkpoint.id);
  });
});
