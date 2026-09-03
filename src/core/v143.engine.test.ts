import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from './config';
import { GameEngine } from './engine';
import { hexDistance, hexKey, hexNeighbors, hexWithinBounds } from './hex';
import { getTile } from './map';
import { createInitialState, createUnit, populationLedgerTotal, synchronizePopulation } from './state';
import { singleFinalWave } from './testConfig';
import type { GameConfig, GameState, HexCoord, UnitState } from './types';

type MutableState = GameState;

function cloneState(state: Readonly<GameState>): MutableState {
  return JSON.parse(JSON.stringify(state)) as MutableState;
}

function quietConfig(overrides: Parameters<typeof createDefaultConfig>[0] = {}): GameConfig {
  return createDefaultConfig({
    horde: singleFinalWave(100),
    economy: {
      initialZombieCount: 0,
      initialResources: { food: 100_000, civilianGoods: 100_000, militaryGoods: 100_000, fuel: 100_000 },
    },
    refugees: {
      arrivalIntervalMin: 99,
      arrivalIntervalMax: 99,
      arrivalPeopleMin: 1,
      arrivalPeopleMax: 1,
    },
    units: {
      zombie: { movement: 0, attack: 0, vision: 0 },
      hordeZombie: { movement: 0, attack: 0, vision: 0 },
    },
    ...overrides,
  });
}

function load(engine: GameEngine, state: MutableState): void {
  const result = engine.step({ type: 'LoadSnapshot', snapshot: state });
  expect(result.error, result.error?.message).toBeNull();
}

function endTurn(engine: GameEngine): ReturnType<GameEngine['step']> {
  const result = engine.step({ type: 'EndTurn' });
  expect(result.error, result.error?.message).toBeNull();
  return result;
}

function rebalance(state: MutableState): void {
  synchronizePopulation(state);
  // These fixtures deliberately introduce an infected pool before the
  // action under test. Treat that pool as the scenario's starting ledger so
  // LoadSnapshot checks the subsequent conversion/death accounting.
  state.population.initialPopulation = populationLedgerTotal(state);
}

function addZombie(state: MutableState, id: string, position: HexCoord): UnitState {
  const zombie = createUnit(state, id, 'zombie', position);
  zombie.movement = 0;
  zombie.attack = 0;
  zombie.vision = 0;
  state.units.push(zombie);
  return zombie;
}

function adjacentPassable(state: Readonly<GameState>, origin: HexCoord): HexCoord[] {
  return hexNeighbors(origin)
    .filter((position) => hexWithinBounds(position, state.map.width, state.map.height))
    .filter((position) => getTile(state.map, position)?.movementCost !== null)
    .sort((left, right) => left.q - right.q || left.r - right.r);
}

function movePlayersAway(state: MutableState): void {
  const police = state.units.find((unit) => unit.type === 'police');
  const guard = state.units.find((unit) => unit.type === 'nationalGuard');
  if (police) police.position = { q: 1, r: 1 };
  if (guard) guard.position = { q: 2, r: 1 };
}

describe('v1.4.4 Core version, map, and initial state', () => {
  it('creates a v2.4.0 state on fixed-51x51-v1 with all 25 initial Normal Zombies', () => {
    const state = createInitialState(14301, createDefaultConfig());
    expect(state.gameVersion).toBe('2.4.0');
    expect(state.mapId).toBe('fixed-51x51-v1');
    expect(state.map.id).toBe('fixed-51x51-v1');
    const zombies = state.units.filter((unit) => unit.type === 'zombie');
    expect(zombies).toHaveLength(25);
    expect(zombies.map((unit) => unit.position)).toEqual(state.map.initialZombiePositions);
    expect(zombies.every((unit) => unit.hordeKind === null && unit.spawnGroupId === null)).toBe(true);
    expect(state.statistics.initialNormalZombies).toBe(25);
    expect(state.horde.totalSpawned).toBe(0);
  });
});

describe('v1.4.4 infection fall Spawn boundaries', () => {
  function infectionFall(infected: number, blockAllAdjacent = false): ReturnType<GameEngine['step']> {
    const engine = new GameEngine(14310 + infected, quietConfig());
    const state = cloneState(engine.getState());
    movePlayersAway(state);
    const farm = state.facilities.find((facility) => facility.id === 'farm-2')!;
    farm.workers = 0;
    farm.infected = infected;
    farm.operationalStatus = infected > 0 ? 'infected' : 'stopped';
    if (blockAllAdjacent) {
      for (const position of adjacentPassable(state, farm.position)) {
        addZombie(state, `block-${position.q}-${position.r}`, position);
      }
    }
    rebalance(state);
    load(engine, state);
    return endTurn(engine);
  }

  it.each([
    [0, 0],
    [1, 0],
    [4, 0],
    [5, 1],
    [9, 1],
    [10, 2],
    [14, 2],
    [15, 3],
    [20, 4],
    [25, 5],
    [29, 5],
    [30, 6],
    [31, 6],
    [60, 6],
  ] as const)('converts %i infected population into at most the configured six Spawn units', (infected, requested) => {
    const engine = new GameEngine(14400 + infected, quietConfig());
    const setup = cloneState(engine.getState());
    movePlayersAway(setup);
    // A Capital has the only fixed capacity large enough for the 31/60
    // boundary cases; its fall is intentionally allowed to finish the game.
    const siteId = infected > 30 ? 'capital' : 'farm-2';
    const farm = setup.facilities.find((facility) => facility.id === siteId)!;
    const eligible = adjacentPassable(setup, farm.position);
    expect(eligible.length).toBeGreaterThanOrEqual(6);
    farm.workers = 0;
    farm.infected = infected;
    farm.operationalStatus = infected > 0 ? 'infected' : 'stopped';
    rebalance(setup);
    load(engine, setup);
    const result = endTurn(engine);
    const fall = result.events.find((event) => event.type === 'site_fallen' && event.payload.siteId === farm.id);
    const spawned = result.events.find((event) => event.type === 'site_zombies_spawned' && event.payload.siteId === farm.id);
    const actual = Number(fall?.payload.actualSpawnCount ?? 0);
    expect(Number(fall?.payload.requestedSpawnCount ?? 0)).toBe(requested);
    expect(actual).toBe(Math.min(requested, eligible.length));
    expect(Number(fall?.payload.infectedAtFall ?? 0)).toBe(infected);
    expect(Number(fall?.payload.remainingInfected ?? 0)).toBe(infected - actual * 5);
    expect(result.state.facilities.find((facility) => facility.id === farm.id)).toMatchObject({
      status: infected === 0 ? (farm.status === 'unowned' ? 'unowned' : 'owned') : 'ruined',
      infected: infected - actual * 5,
    });
    if (actual > 0) {
      expect(spawned?.payload.spawnedUnitIds).toHaveLength(actual);
      const spawnedIds = new Set((spawned?.payload.spawnedUnitIds as string[]) ?? []);
      const spawnedUnits = result.state.units.filter((unit) => spawnedIds.has(unit.id));
      expect(spawnedUnits).toHaveLength(actual);
      expect(spawnedUnits.every((unit) =>
        unit.type === 'zombie' && unit.hordeKind === null && unit.spawnGroupId === null &&
        hexDistance(unit.position, farm.position) === 1,
      )).toBe(true);
    } else {
      expect(spawned).toBeUndefined();
    }
  });

  it('leaves infected population in a permanent ruined site when every adjacent hex is occupied', () => {
    const result = infectionFall(30, true);
    const fall = result.events.find((event) => event.type === 'site_fallen' && event.payload.siteId === 'farm-2');
    expect(fall?.payload).toMatchObject({
      infectedAtFall: 30,
      requestedSpawnCount: 6,
      actualSpawnCount: 0,
      remainingInfected: 30,
    });
    expect(result.events.some((event) => event.type === 'site_zombies_spawned' && event.payload.siteId === 'farm-2')).toBe(false);
    expect(result.state.facilities.find((facility) => facility.id === 'farm-2')).toMatchObject({ status: 'ruined', infected: 30 });
    expect(result.state.statistics.unspawnedInfectedPopulation).toBe(30);
  });

  it('never searches beyond the one-hex infection Spawn radius', () => {
    const engine = new GameEngine(14321, quietConfig());
    const state = cloneState(engine.getState());
    movePlayersAway(state);
    const farm = state.facilities.find((facility) => facility.id === 'farm-2')!;
    for (const position of adjacentPassable(state, farm.position)) addZombie(state, `radius-block-${hexKey(position)}`, position);
    farm.workers = 0;
    farm.infected = 5;
    farm.operationalStatus = 'infected';
    rebalance(state);
    load(engine, state);
    const result = endTurn(engine);
    expect(result.events.find((event) => event.type === 'site_fallen' && event.payload.siteId === farm.id)?.payload).toMatchObject({
      requestedSpawnCount: 1,
      actualSpawnCount: 0,
      remainingInfected: 5,
    });
    expect(result.state.units.some((unit) => unit.type === 'zombie' && hexDistance(unit.position, farm.position) === 2)).toBe(false);
  });
});

describe('v1.4.4 constructible and Wind Power Plant overrun behavior', () => {
  it('removes a constructible facility and counts only unspawned residual infection as deaths', () => {
    const engine = new GameEngine(14330, quietConfig());
    const candidate = engine.getConstructibleFacilityPositionCandidates('simpleFarm').find((entry) => entry.legal);
    expect(candidate).toBeDefined();
    const built = engine.step({ type: 'BuildConstructibleFacility', facilityType: 'simpleFarm', position: candidate!.position });
    expect(built.error).toBeNull();
    const setup = cloneState(engine.getState());
    const farm = setup.facilities.find((facility) => facility.constructible && facility.type === 'simpleFarm')!;
    const capital = setup.facilities.find((facility) => facility.id === 'capital')!;
    const infected = 10;
    farm.workers = 0;
    farm.infected = infected;
    farm.operationalStatus = 'infected';
    capital.workers -= infected;
    const eligible = adjacentPassable(setup, farm.position).filter((position) =>
      !setup.units.some((unit) => hexKey(unit.position) === hexKey(position)),
    );
    for (const position of eligible) addZombie(setup, `constructible-block-${hexKey(position)}`, position);
    rebalance(setup);
    load(engine, setup);
    const result = endTurn(engine);
    const fall = result.events.find((event) => event.type === 'site_fallen' && event.payload.siteId === farm.id);
    expect(fall?.payload).toMatchObject({
      siteKind: 'facility',
      siteType: 'simpleFarm',
      infectedAtFall: infected,
      requestedSpawnCount: 2,
      actualSpawnCount: 0,
      remainingInfected: 0,
      constructibleInfectedDeaths: infected,
    });
    const overrun = result.events.find((event) => event.type === 'facility_overrun' && event.payload.facilityId === farm.id);
    expect(overrun?.payload).toMatchObject({ constructibleDestroyed: true, constructibleInfectedDeaths: infected });
    expect(result.state.facilities.some((facility) => facility.id === farm.id)).toBe(false);
    expect(result.state.statistics.constructibleInfectedDeaths).toBe(infected);
    expect(result.state.population.cumulativeDeaths).toBe(infected);
  });

  it('disables Wind Power Plant occupancy without an infection pool or Spawn', () => {
    const engine = new GameEngine(14331, quietConfig());
    const setup = cloneState(engine.getState());
    setup.units = setup.units.filter((unit) => unit.isPlayerUnit);
    const wind = setup.facilities.find((facility) => facility.type === 'windPowerPlant')!;
    const zombie = addZombie(setup, 'wind-occupier', wind.position);
    zombie.attack = 0;
    zombie.movement = 0;
    zombie.vision = 0;
    rebalance(setup);
    load(engine, setup);
    const result = endTurn(engine);
    expect(result.state.facilities.find((facility) => facility.id === wind.id)).toMatchObject({
      status: 'owned',
      operationalStatus: 'disabled',
      infected: 0,
      workers: 0,
    });
    expect(result.events.some((event) => event.type === 'site_fallen' && event.payload.siteId === wind.id)).toBe(false);
    expect(result.events.some((event) => event.type === 'site_zombies_spawned' && event.payload.siteId === wind.id)).toBe(false);
    expect(result.state.statistics.infectedPopulationConvertedToZombies).toBe(0);
  });
});

describe('v1.4.4 generated Zombie immediate occupancy and FIFO chains', () => {
  it('processes generated occupancy immediately in generated-ID order and records chain origin/depth', () => {
    const engine = new GameEngine(14340, quietConfig());
    const setup = cloneState(engine.getState());
    movePlayersAway(setup);
    const source = setup.facilities.find((facility) => facility.id === 'farm-1')!;
    const capital = setup.facilities.find((facility) => facility.id === 'capital')!;
    const checkpointPosition = { q: 22, r: 25 };
    const checkpoint = {
      id: 'checkpoint-chain-test',
      position: checkpointPosition,
      direction: 'west' as const,
      branchId: 'west',
      status: 'operational' as const,
      waiting: 0,
      screening: 0,
      approved: 0,
      remainingTurns: 0,
      screeningPolicy: 'normal' as const,
      nextArrivalTurn: null,
      infected: 5,
      overrunProcessed: false,
    };
    setup.checkpoints.push(checkpoint);
    setup.roadBranches.find((branch) => branch.branchId === 'west')!.activeCheckpointId = checkpoint.id;
    source.workers = 0;
    source.infected = 10;
    source.operationalStatus = 'infected';
    capital.workers += 8;
    const sourceCandidates = adjacentPassable(setup, source.position);
    const openExtra = sourceCandidates.find((position) => hexKey(position) !== hexKey(checkpointPosition))!;
    for (const position of sourceCandidates) {
      if (hexKey(position) !== hexKey(checkpointPosition) && hexKey(position) !== hexKey(openExtra)) {
        addZombie(setup, `chain-block-${hexKey(position)}`, position);
      }
    }
    rebalance(setup);
    load(engine, setup);
    const result = endTurn(engine);
    const rootFall = result.events.find((event) => event.type === 'site_fallen' && event.payload.siteId === source.id);
    const rootSpawn = result.events.find((event) => event.type === 'site_zombies_spawned' && event.payload.siteId === source.id);
    const chainFall = result.events.find((event) => event.type === 'site_chain_fallen' && event.payload.siteId === checkpoint.id);
    expect(rootFall?.payload).toMatchObject({ requestedSpawnCount: 2, actualSpawnCount: 2, chainDepth: 0 });
    expect(rootSpawn?.payload.spawnedUnitIds).toHaveLength(2);
    expect(chainFall?.payload).toMatchObject({
      siteKind: 'checkpoint',
      cause: 'spawn_immediate_occupation',
      infectedAtFall: 5,
      requestedSpawnCount: 1,
      actualSpawnCount: 1,
      chainDepth: 1,
      chainOriginEventId: rootFall?.id,
    });
    expect(result.state.checkpoints.find((candidate) => candidate.id === checkpoint.id)).toMatchObject({
      status: 'ruined',
      infected: 0,
    });
    const rootIds = new Set((rootSpawn?.payload.spawnedUnitIds as string[]) ?? []);
    const rootUnits = result.state.units.filter((unit) => rootIds.has(unit.id));
    expect(rootUnits.map((unit) => unit.id)).toEqual([...rootIds].sort());
    expect(result.state.statistics.chainOverruns).toBeGreaterThanOrEqual(1);
  });

  it('does not move or attack a Zombie generated during the current infection resolution', () => {
    const engine = new GameEngine(14341, quietConfig({
      units: {
        zombie: { movement: 1, attack: 0, vision: 31 },
        hordeZombie: { movement: 0, attack: 0, vision: 0 },
      },
    }));
    const setup = cloneState(engine.getState());
    movePlayersAway(setup);
    const farm = setup.facilities.find((facility) => facility.id === 'farm-2')!;
    farm.workers = 0;
    farm.infected = 5;
    farm.operationalStatus = 'infected';
    rebalance(setup);
    load(engine, setup);
    const result = endTurn(engine);
    const spawn = result.events.find((event) => event.type === 'site_zombies_spawned' && event.payload.siteId === farm.id);
    const spawned = (spawn?.payload.spawnedUnitIds as string[]) ?? [];
    const positions = (spawn?.payload.spawnedPositions as Array<HexCoord>) ?? [];
    expect(spawned).toHaveLength(1);
    expect(result.state.units.find((unit) => unit.id === spawned[0])?.position).toEqual(positions[0]);
    expect(result.events.some((event) =>
      event.type === 'attack' && spawned.includes(String(event.payload.attackerId)),
    )).toBe(false);
  });
});

describe('v1.4.4 Combat Noise respawn', () => {
  it('respawns a nearby fallen permanent site after the full Guard attack, while hiding internal Noise fields', () => {
    const engine = new GameEngine(14350, quietConfig({
      units: {
        police: { vision: 0 },
        nationalGuard: { vision: 4 },
        zombie: { movement: 0, attack: 0, vision: 0 },
        hordeZombie: { movement: 0, attack: 0, vision: 0 },
      },
    }));
    const setup = cloneState(engine.getState());
    const guard = setup.units.find((unit) => unit.type === 'nationalGuard')!;
    const police = setup.units.find((unit) => unit.type === 'police')!;
    guard.position = { q: 24, r: 24 };
    guard.actionState = 'ready';
    guard.canAttack = true;
    guard.canMove = true;
    police.position = { q: 1, r: 1 };
    police.vision = 0;
    setup.units = setup.units.filter((unit) => unit.isPlayerUnit);
    const fallen = setup.facilities.find((facility) => facility.id === 'farm-1')!;
    const capital = setup.facilities.find((facility) => facility.id === 'capital')!;
    fallen.status = 'ruined';
    fallen.owner = 'none';
    fallen.operationalStatus = 'ruined';
    fallen.workers = 0;
    fallen.infected = 5;
    capital.workers += 13;
    const target = createUnit(setup, 'noise-combat-target', 'zombie', { q: 25, r: 24 });
    target.hp = 1;
    target.inheritedTarget = { q: 1, r: 1 };
    target.movement = 0;
    target.attack = 0;
    target.vision = 0;
    setup.units.push(target);
    rebalance(setup);
    load(engine, setup);
    const result = engine.step({ type: 'Attack', attackerId: guard.id, targetId: target.id });
    expect(result.error, result.error?.message).toBeNull();
    const noise = result.events.find((event) => event.type === 'noise_emitted');
    expect(noise?.payload).toMatchObject({
      sourceUnitId: guard.id,
      sourceUnitType: 'nationalGuard',
      q: 24,
      r: 24,
      noiseClass: 'large',
    });
    expect(noise?.payload).not.toHaveProperty('radius');
    expect(noise?.payload).not.toHaveProperty('affectedZombieIds');
    const respawn = result.events.find((event) => event.type === 'site_noise_respawn' && event.payload.siteId === fallen.id);
    expect(respawn?.payload).toMatchObject({
      siteKind: 'facility',
      siteType: 'farm',
      cause: 'combat_noise',
      infectedAtFall: 5,
      requestedSpawnCount: 1,
      actualSpawnCount: 1,
      remainingInfected: 0,
    });
    expect(result.state.facilities.find((facility) => facility.id === fallen.id)?.infected).toBe(0);
    expect(result.state.statistics.noisePulsesEmitted).toBe(1);
    expect(result.state.statistics.noiseRespawnAttempts).toBe(1);
    expect(result.state.statistics.noiseRespawnZombiesSpawned).toBe(1);
    const spawnedIds = (result.events.find((event) => event.type === 'site_zombies_spawned' && event.payload.siteId === fallen.id)?.payload.spawnedUnitIds as string[]) ?? [];
    expect(result.state.units.filter((unit) => spawnedIds.includes(unit.id)).every((unit) =>
      unit.type === 'zombie' && unit.hordeKind === null && unit.spawnGroupId === null,
    )).toBe(true);
  });
});
