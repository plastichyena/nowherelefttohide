import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from './config';
import { hexKey } from './hex';
import { SeededRng } from './rng';
import { createInitialState, createUnit } from './state';
import {
  createUnitLifecycle,
  type GasExplosionSiteTarget,
  type SpawnOccupancyEntry,
} from './unit-lifecycle';
import type { GameState, UnitState } from './types';

function freshState(seed = 15301): GameState {
  const state = createInitialState(seed, createDefaultConfig({
    economy: { initialWorkersByFacility: { 'army-base-1': 0 } },
  }));
  state.units = [];
  state.checkpoints = [];
  state.events = [];
  state.nextEventNumber = 1;
  return state;
}

function convertCheckpointPeople(state: GameState, target: GasExplosionSiteTarget, maximum: number): number {
  const checkpoint = state.checkpoints.find((candidate) => candidate.id === target.siteId);
  if (!checkpoint) return 0;
  let remaining = maximum;
  let converted = 0;
  for (const pool of ['waiting', 'screening', 'approved'] as const) {
    const amount = Math.min(checkpoint[pool], remaining);
    checkpoint[pool] -= amount;
    remaining -= amount;
    converted += amount;
  }
  checkpoint.infected += converted;
  return converted;
}

function createHarness(
  state: GameState,
  callbacks: {
    infection?: (target: GasExplosionSiteTarget, sourceGasId: string) => void;
    falls?: (targets: readonly GasExplosionSiteTarget[], sourceGasId: string) => void;
  } = {},
) {
  return createUnitLifecycle({
    applyGeneratedZombieOccupancy: () => {},
    processSpawnOccupancyQueue: (_state, _rng, _queue: SpawnOccupancyEntry[]) => {},
    applyGasExplosionSiteInfection: (_state, target, maximum, sourceGasId) => {
      callbacks.infection?.(target, sourceGasId);
      if (target.siteKind === 'checkpoint') return convertCheckpointPeople(state, target, maximum);
      const facility = state.facilities.find((candidate) => candidate.id === target.siteId);
      if (!facility) return 0;
      const converted = Math.min(maximum, facility.workers);
      facility.workers -= converted;
      facility.infected += converted;
      return converted;
    },
    resolveGasExplosionSiteFalls: (_state, targets, _rng, sourceGasId) => {
      callbacks.falls?.(targets, sourceGasId);
    },
  });
}

function pushUnit(state: GameState, id: string, type: UnitState['type'], q: number, r: number, hp?: number): UnitState {
  const unit = createUnit(state, id, type, { q, r });
  if (hp !== undefined) unit.hp = hp;
  state.units.push(unit);
  return unit;
}

describe('v1.5.3 Gas Zombie lifecycle', () => {
  it('snapshots only the six in-map neighbours and applies terrain damage plus both same-hex site effects', () => {
    const state = freshState();
    const center = { q: 10, r: 10 };
    const source = pushUnit(state, 'source', 'police', 4, 4);
    const gas = pushUnit(state, 'gas-root', 'gasZombie', center.q, center.r);
    const centerUnit = pushUnit(state, 'center-unit', 'zombie', center.q, center.r);
    const plain = pushUnit(state, 'plain-unit', 'hordeZombie', 11, 10);
    const forest = pushUnit(state, 'forest-zombie', 'hunterZombie', 11, 9);
    const humanInForest = pushUnit(state, 'forest-human', 'nationalGuard', 10, 9);
    const distanceTwo = pushUnit(state, 'distance-two', 'zombie', 12, 10);
    state.map.tiles.find((tile) => tile.key === hexKey(forest.position))!.terrain = 'forest';
    state.map.tiles.find((tile) => tile.key === hexKey(humanInForest.position))!.terrain = 'forest';

    const facility = state.facilities.find((candidate) => candidate.type === 'farm')!;
    facility.position = { q: 9, r: 10 };
    facility.workers = 40;
    facility.infected = 0;
    state.checkpoints.push({
      id: 'checkpoint-gas', position: { ...facility.position }, direction: 'north', branchId: 'north',
      status: 'operational', waiting: 12, screening: 11, approved: 10, remainingTurns: 1,
      screeningPolicy: 'normal', nextArrivalTurn: null, infected: 0,
    });

    const infectedTargets: string[] = [];
    const { dealDamage } = createHarness(state, {
      infection: (target) => infectedTargets.push(`${target.siteKind}:${target.siteId}`),
    });
    dealDamage(state, gas, gas.hp, source.id, 'attack', new SeededRng(7));

    expect(state.units.some((unit) => unit.id === gas.id)).toBe(false);
    expect(state.units.some((unit) => unit.id === plain.id)).toBe(true);
    expect(plain.hp).toBe(10);
    expect(forest.hp).toBe(5);
    expect(humanInForest.hp).toBe(20);
    expect(centerUnit.hp).toBe(centerUnit.maxHp);
    expect(distanceTwo.hp).toBe(distanceTwo.maxHp);
    expect(facility.workers).toBe(10);
    expect(facility.infected).toBe(30);
    expect(state.checkpoints[0]).toMatchObject({ waiting: 0, screening: 0, approved: 3, infected: 30 });
    expect(infectedTargets).toEqual([
      `checkpoint:${state.checkpoints[0]!.id}`,
      `facility:${facility.id}`,
    ]);
    expect(state.statistics.gasExplosions).toBe(1);
    expect(state.statistics.gasExplosionUnitDamage).toBe(30 + 15 + 30);
  });

  it('defers every death and fall until all direct effects finish, then resolves simultaneous Gas deaths in ID-stable FIFO order', () => {
    const state = freshState(15302);
    const root = pushUnit(state, 'gas-root', 'gasZombie', 10, 10);
    const gasZ = pushUnit(state, 'gas-z', 'gasZombie', 10, 9, 30);
    const gasA = pushUnit(state, 'gas-a', 'gasZombie', 11, 10, 30);
    const facility = state.facilities.find((candidate) => candidate.type === 'farm')!;
    facility.position = { q: 9, r: 10 };
    facility.workers = 1;
    facility.infected = 0;
    let spawnedDuringFall: UnitState | null = null;
    const observations: string[] = [];
    const { dealDamage } = createHarness(state, {
      infection: (_target, sourceId) => {
        if (sourceId !== root.id) return;
        observations.push(`infect:${gasA.hp}:${gasZ.hp}:${state.units.includes(gasA)}:${state.units.includes(gasZ)}`);
      },
      falls: (_targets, sourceId) => {
        if (sourceId !== root.id) return;
        observations.push(`fall:${state.units.includes(gasA)}:${state.units.includes(gasZ)}`);
        spawnedDuringFall = pushUnit(state, 'spawned-after-snapshot', 'zombie', 9, 11, 10);
      },
    });

    dealDamage(state, root, root.hp, 'external', 'attack', new SeededRng(8));

    expect(observations).toEqual(['infect:0:0:true:true', 'fall:false:false']);
    expect(spawnedDuringFall).not.toBeNull();
    expect((spawnedDuringFall as UnitState | null)?.hp).toBe(10);
    expect(state.events.filter((event) => event.type === 'gas_explosion').map((event) => event.payload.sourceUnitId))
      .toEqual(['gas-root', 'gas-a', 'gas-z']);
    expect(state.statistics.gasExplosions).toBe(3);
    expect(state.statistics.gasZombiesKilled).toBe(3);
  });

  it('includes valid edge neighbours, excludes off-map coordinates, and credits proficiency only for the directly killed Gas', () => {
    const state = freshState(15303);
    const source = pushUnit(state, 'regular-police', 'police', 5, 5);
    source.proficiency = 'regular';
    source.regularZombieKills = 0;
    const gas = pushUnit(state, 'edge-gas', 'gasZombie', 0, 0);
    const edgeNeighbour = pushUnit(state, 'edge-neighbour', 'zombie', 0, 1);
    const collateral = pushUnit(state, 'collateral', 'zombie', 1, 0);
    const { dealDamage } = createHarness(state);

    dealDamage(state, gas, gas.hp, source.id, 'attack', new SeededRng(9));

    expect(state.units.some((unit) => unit.id === edgeNeighbour.id)).toBe(false);
    expect(state.units.some((unit) => unit.id === collateral.id)).toBe(false);
    expect(source.regularZombieKills).toBe(1);
    expect(state.events.filter((event) => event.type === 'unit_kill_credited')).toHaveLength(1);
    expect(state.events.filter((event) => event.type === 'damage' && event.payload.cause === 'gas_explosion')).toHaveLength(2);
  });

  it('does not damage a reanimated unit created after the snapshot of the explosion that killed its Human Unit', () => {
    const state = freshState(15304);
    const gas = pushUnit(state, 'gas-root', 'gasZombie', 10, 10);
    const human = pushUnit(state, 'human-casualty', 'police', 11, 10, 25);
    const { dealDamage } = createHarness(state);

    dealDamage(state, gas, gas.hp, 'external', 'counterattack', new SeededRng(10));

    expect(state.units.some((unit) => unit.id === human.id)).toBe(false);
    const reanimated = state.units.find((unit) => unit.type === 'policeZombie');
    expect(reanimated).toMatchObject({ position: human.position, hp: state.config.units.policeZombie.hp });
    expect(state.events.filter((event) => event.type === 'damage' && event.payload.targetId === reanimated?.id)).toHaveLength(0);
  });

  it('allows a unit spawned after one snapshot to become a target of the next queued Gas explosion', () => {
    const state = freshState(15305);
    const root = pushUnit(state, 'gas-root', 'gasZombie', 10, 10);
    pushUnit(state, 'gas-next', 'gasZombie', 11, 10, 30);
    let spawned = false;
    const { dealDamage } = createHarness(state, {
      falls: (_targets, sourceId) => {
        if (sourceId !== root.id || spawned) return;
        spawned = true;
        pushUnit(state, 'spawned-between-explosions', 'zombie', 11, 9, 10);
      },
    });

    dealDamage(state, root, root.hp, 'external', 'attack', new SeededRng(11));

    expect(state.units.some((unit) => unit.id === 'spawned-between-explosions')).toBe(false);
    expect(state.events.some((event) =>
      event.type === 'damage' &&
      event.payload.sourceId === 'gas-next' &&
      event.payload.targetId === 'spawned-between-explosions'
    )).toBe(true);
  });
});
