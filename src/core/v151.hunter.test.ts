import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from './config';
import { GameEngine } from './engine';
import { hexDistance, hexKey, hexNeighbors, hexWithinBounds } from './hex';
import { getTile } from './map';
import { findReachablePaths, findShortestPath } from './path';
import { effectiveMovementCost } from './terrain';
import { createInitialState, createUnit, synchronizePopulation } from './state';
import type { GameState, HexCoord, NoisePulse, UnitState } from './types';

function quietConfig() {
  return createDefaultConfig({
    economy: {
      initialZombieCount: 0,
      initialHunterCount: { min: 0, max: 0 },
      initialResources: {
        food: 10000,
        civilianGoods: 10000,
        fuel: 10000,
        militaryGoods: 10000,
      },
    },
    facilities: { windPowerPlant: { zombieTargetValue: 0 } },
    refugees: { arrivalIntervalMin: 99, arrivalIntervalMax: 99 },
    horde: {
      waves: [{
        turn: 100,
        directionCount: 1,
        compositionPerDirection: { hordeZombie: 1, zombie: 0 },
        final: true,
      }],
    },
  });
}

function load(engine: GameEngine, state: GameState): void {
  const result = engine.step({ type: 'LoadSnapshot', snapshot: state });
  expect(result.error?.message ?? null).toBeNull();
}

function openTile(state: GameState, blocked = new Set<string>()): HexCoord {
  const position = state.map.tiles.find((tile) =>
    tile.movementCost !== null
    && tile.playerOccupancyAllowed
    && !tile.facilityId
    && !blocked.has(tile.key),
  );
  if (!position) throw new Error('A free traversable tile is required by the fixture');
  return { q: position.q, r: position.r };
}

function addHunter(
  state: GameState,
  id: string,
  position: HexCoord,
  overrides: Partial<UnitState> = {},
): UnitState {
  const hunter = createUnit(state, id, 'hunterZombie', position);
  Object.assign(hunter, { canMove: true }, overrides);
  state.units.push(hunter);
  return hunter;
}

function addNoise(state: GameState, center: HexCoord, radius = 64): void {
  const pulse: NoisePulse = {
    id: 'noise-v151-test',
    center: { ...center },
    radius,
    sourceKind: 'humanCombat',
    sourceUnitType: 'police',
    emittedTurn: state.turn,
  };
  state.pendingNoisePulses.push(pulse);
}

function emptyEngine(): { engine: GameEngine; state: GameState } {
  const engine = new GameEngine(151, quietConfig());
  return { engine, state: engine.getState() as GameState };
}

function disableHumanAttacks(state: GameState): void {
  for (const unit of state.units.filter((candidate) => candidate.isPlayerUnit)) {
    unit.canAttack = false;
    unit.attackChargesRemaining = 0;
  }
}

describe('v1.5.1 Hunter and shared-charge rule coverage', () => {
  it('runs Hunter through the Normal AI idle branch when no population or Noise target is available', () => {
    const { engine, state } = emptyEngine();
    const blocked = new Set(state.units.map((unit) => hexKey(unit.position)));
    const hunterPosition = openTile(state, blocked);
    const hunter = addHunter(state, 'hunter-idle', hunterPosition, {
      vision: 0,
      movement: 0,
      attack: 0,
      canAttack: false,
    });
    disableHumanAttacks(state);
    load(engine, state);

    const result = engine.step({ type: 'EndTurn' });

    expect(result.error?.message ?? null).toBeNull();
    expect(result.events.some((event) => event.type === 'zombie_idle' && event.payload.zombieId === hunter.id)).toBe(true);
    expect(result.state.units.find((unit) => unit.id === hunter.id)?.position).toEqual(hunterPosition);
    expect(result.state.statistics.normalZombieIdleCount).toBe(1);
  });

  it('lets Hunter inherit the target selected by a visible Horde', () => {
    const { engine, state } = emptyEngine();
    const hunter = addHunter(state, 'hunter-inherited', { q: 20, r: 25 }, {
      vision: 2,
      movement: 0,
      attack: 0,
      canAttack: false,
    });
    const horde = createUnit(state, 'horde-inherited', 'hordeZombie', { q: 22, r: 25 });
    horde.spawnGroupId = 'periodic-inherited-test';
    horde.hordeKind = 'periodic';
    horde.movement = 0;
    horde.attack = 0;
    horde.canAttack = false;
    state.units.push(horde);
    load(engine, state);

    const result = engine.step({ type: 'EndTurn' });

    expect(result.error?.message ?? null).toBeNull();
    const inherited = result.state.units.find((unit) => unit.id === hunter.id);
    expect(inherited?.inheritedTarget).not.toBeNull();
    expect(result.events.some((event) => event.type === 'horde_target_inherited' && event.payload.zombieId === hunter.id)).toBe(true);
    expect(result.events.some((event) => event.type === 'zombie_idle' && event.payload.zombieId === hunter.id)).toBe(false);
  });

  it('acquires and retains a distant Noise target while using the 15 MP weighted path budget', () => {
    const { engine, state } = emptyEngine();
    const blocked = new Set(state.units.map((unit) => hexKey(unit.position)));
    const hunterPosition = openTile(state, blocked);
    const hunter = addHunter(state, 'hunter-noise', hunterPosition, {
      vision: 0,
      movement: 15,
      attack: 0,
      canAttack: false,
    });
    disableHumanAttacks(state);
    const movementBlocked = new Set(state.units.filter((unit) => unit.id !== hunter.id).map((unit) => hexKey(unit.position)));
    const resolveCost = (position: HexCoord): number | null => effectiveMovementCost(state, position);
    const candidates = findReachablePaths(state.map, hunter.position, 31, movementBlocked, resolveCost)
      .map((entry) => {
        let spent = 0;
        let moved = 0;
        for (const position of entry.path.slice(1)) {
          const cost = resolveCost(position);
          if (cost === null || spent + cost > hunter.movement) break;
          spent += cost;
          moved += 1;
        }
        return { target: entry.position, path: entry.path, spent, moved };
      })
      .filter((candidate) =>
        candidate.moved > 0
        && candidate.moved < candidate.path.length - 1
        && candidate.spent > candidate.moved,
      );
    const scenario = candidates[0];
    if (!scenario) throw new Error('The fixed map must provide a weighted path that exceeds Hunter movement 15');
    addNoise(state, scenario.target);
    load(engine, state);

    const result = engine.step({ type: 'EndTurn' });

    expect(result.error?.message ?? null).toBeNull();
    const moved = result.events.find((event) => event.type === 'unit_moved' && event.payload.unitId === hunter.id);
    expect(moved).toBeDefined();
    expect(moved?.payload.hexesMoved).toBe(scenario.moved);
    expect(moved?.payload.effectiveMovementCost).toBe(scenario.spent);
    expect(moved?.payload.effectiveMovementCost).toBeGreaterThan(moved?.payload.hexesMoved as number);
    expect(result.state.units.find((unit) => unit.id === hunter.id)?.noiseTarget).toEqual(scenario.target);
    expect(result.state.pendingNoisePulses).toEqual([]);
    expect(result.events.some((event) => event.type === 'noise_targeted' && event.payload.zombieId === hunter.id)).toBe(true);
  });

  it('stops Hunter at the first Human interception point during its movement', () => {
    const { engine, state } = emptyEngine();
    const police = state.units.find((unit) => unit.type === 'police')!;
    const guard = state.units.find((unit) => unit.type === 'nationalGuard')!;
    guard.canAttack = false;
    guard.attackChargesRemaining = 0;
    const fixedBlocked = new Set([hexKey(guard.position)]);
    const openTiles = state.map.tiles
      .filter((tile) => tile.movementCost !== null && tile.playerOccupancyAllowed && !tile.facilityId && !fixedBlocked.has(tile.key))
      .map((tile) => ({ q: tile.q, r: tile.r }));
    const routeTiles = openTiles
      .filter((position) => {
        const distance = hexDistance(position, { q: 25, r: 25 });
        return distance >= 5 && distance <= 15;
      })
      .slice(0, 80);
    const resolveCost = (position: HexCoord): number | null => effectiveMovementCost(state, position);
    let scenario: { origin: HexCoord; target: HexCoord; first: HexCoord; interceptor: HexCoord } | null = null;
    for (const origin of routeTiles) {
      if (scenario) break;
      for (const target of routeTiles) {
        if (hexKey(origin) === hexKey(target) || hexDistance(origin, target) < 3) continue;
        const path = findShortestPath(state.map, origin, target, fixedBlocked, resolveCost);
        if (!path || path.length < 3) continue;
        const first = path[1]!;
        for (const interceptor of hexNeighbors(first)) {
          const interceptorKey = hexKey(interceptor);
          if (!hexWithinBounds(interceptor, state.map.width, state.map.height)
            || interceptorKey === hexKey(origin)
            || interceptorKey === hexKey(target)
            || fixedBlocked.has(interceptorKey)
            || path.some((position) => hexKey(position) === interceptorKey)) continue;
          police.position = { ...interceptor };
          const blockedWithPolice = new Set([...fixedBlocked, interceptorKey]);
          const rerouted = findShortestPath(state.map, origin, target, blockedWithPolice, resolveCost);
          if (rerouted && rerouted.length >= 2 && hexKey(rerouted[1]!) === hexKey(first)) {
            scenario = { origin, target, first, interceptor };
            break;
          }
        }
        if (scenario) break;
      }
    }
    if (!scenario) throw new Error('A stable first-step interception scenario is required by the fixed map');
    police.position = { ...scenario.interceptor };
    police.canAttack = true;
    police.attackChargesRemaining = 1;
    police.currentMilitaryGoods = police.maxMilitaryGoods;
    const hunter = addHunter(state, 'hunter-intercepted', scenario.origin, {
      vision: 0,
      movement: 15,
      attack: 0,
      canAttack: false,
      attackChargesRemaining: 0,
    });
    addNoise(state, scenario.target);
    load(engine, state);

    const result = engine.step({ type: 'EndTurn' });

    expect(result.error?.message ?? null).toBeNull();
    const moved = result.events.find((event) => event.type === 'unit_moved' && event.payload.unitId === hunter.id);
    expect(moved?.payload.hexesMoved).toBe(1);
    expect(moved?.payload.effectiveMovementCost).toBeGreaterThanOrEqual(1);
    expect(result.events.some((event) => event.type === 'interception'
      && event.payload.attackerId === police.id
      && event.payload.defenderId === hunter.id)).toBe(true);
    expect(result.state.units.find((unit) => unit.id === hunter.id)?.position).toEqual(scenario.first);
    expect(result.state.units.find((unit) => unit.id === hunter.id)?.noiseTarget).toEqual(scenario.target);
  });

  it('credits a Regular Police direct kill of Hunter exactly once', () => {
    const { engine, state } = emptyEngine();
    const police = state.units.find((unit) => unit.type === 'police')!;
    const hunterPosition = { q: 23, r: 25 };
    police.position = { q: 24, r: 25 };
    police.canAttack = true;
    police.attackChargesRemaining = 1;
    police.currentMilitaryGoods = police.maxMilitaryGoods;
    const hunter = addHunter(state, 'hunter-kill-credit', hunterPosition, {
      hp: 1,
      maxHp: 1,
      canAttack: false,
      attackChargesRemaining: 0,
      movement: 0,
      vision: 0,
    });
    disableHumanAttacks(state);
    police.canAttack = true;
    police.attackChargesRemaining = 1;
    load(engine, state);

    const result = engine.step({ type: 'Attack', attackerId: police.id, targetId: hunter.id });

    expect(result.error?.message ?? null).toBeNull();
    expect(result.state.units.some((unit) => unit.id === hunter.id)).toBe(false);
    expect(result.state.units.find((unit) => unit.id === police.id)?.regularZombieKills).toBe(1);
    expect(result.state.statistics.hunterZombiesKilled).toBe(1);
    expect(result.events.some((event) => event.type === 'unit_kill_credited'
      && event.payload.unitId === police.id
      && event.payload.targetType === 'hunterZombie')).toBe(true);
  });

  it('shares Horde charge between Player-phase interception and its following Zombie attack', () => {
    const { engine, state } = emptyEngine();
    const police = state.units.find((unit) => unit.type === 'police')!;
    const guard = state.units.find((unit) => unit.type === 'nationalGuard')!;
    guard.canAttack = false;
    guard.attackChargesRemaining = 0;
    const fixedBlocked = new Set([hexKey(guard.position)]);
    const openTiles = state.map.tiles
      .filter((tile) => tile.movementCost !== null && tile.playerOccupancyAllowed && !tile.facilityId && !fixedBlocked.has(tile.key))
      .map((tile) => ({ q: tile.q, r: tile.r }));
    let scenario: { origin: HexCoord; destination: HexCoord; horde: HexCoord } | null = null;
    for (const hordePosition of openTiles) {
      if (scenario) break;
      for (const destination of hexNeighbors(hordePosition)) {
        if (!hexWithinBounds(destination, state.map.width, state.map.height)) continue;
        const destinationTile = getTile(state.map, destination);
        if (!destinationTile || destinationTile.movementCost === null || !destinationTile.playerOccupancyAllowed || destinationTile.facilityId) continue;
        const destinationKey = hexKey(destination);
        if (fixedBlocked.has(destinationKey)) continue;
        for (const origin of hexNeighbors(destination)) {
          const originTile = getTile(state.map, origin);
          if (!originTile || originTile.movementCost === null || !originTile.playerOccupancyAllowed || originTile.facilityId) continue;
          const originKey = hexKey(origin);
          const hordeKey = hexKey(hordePosition);
          if (originKey === destinationKey || originKey === hordeKey || fixedBlocked.has(originKey)) continue;
          scenario = { origin, destination, horde: hordePosition };
          break;
        }
        if (scenario) break;
      }
    }
    if (!scenario) throw new Error('A one-step Player movement into Horde range is required by the fixed map');
    police.position = { ...scenario.origin };
    police.canMove = true;
    police.canAttack = true;
    police.attackChargesRemaining = 1;
    police.currentMilitaryGoods = police.maxMilitaryGoods;
    const horde = createUnit(state, 'horde-interception-charge', 'hordeZombie', scenario.horde);
    horde.attack = 1;
    horde.movement = 0;
    horde.canMove = true;
    horde.canAttack = true;
    horde.attackChargesRemaining = 2;
    horde.maxAttackCharges = 2;
    horde.spawnGroupId = 'periodic-interception-charge';
    horde.hordeKind = 'periodic';
    state.units.push(horde);
    load(engine, state);

    const moved = engine.step({ type: 'Move', unitId: police.id, destination: scenario.destination });
    expect(moved.error?.message ?? null).toBeNull();
    expect(moved.events.some((event) => event.type === 'interception'
      && event.payload.attackerId === horde.id
      && event.payload.defenderId === police.id)).toBe(true);
    expect(moved.state.units.find((unit) => unit.id === horde.id)?.attackChargesRemaining).toBe(1);

    const ended = engine.step({ type: 'EndTurn' });

    expect(ended.error?.message ?? null).toBeNull();
    expect(ended.events.filter((event) => event.type === 'attack'
      && event.payload.attackerId === horde.id
      && !event.payload.counterattack)).toHaveLength(1);
    const hordeAttacks = ended.state.events.filter((event) =>
      (event.type === 'interception' || event.type === 'attack')
      && event.payload.attackerId === horde.id
      && !event.payload.counterattack,
    );
    expect(hordeAttacks).toHaveLength(2);
  });

  it.each([
    ['police', 8],
    ['riotPolice', 12],
  ] as const)('keeps %s suppression civilian damage at zero', (type, expectedAttack) => {
    const { engine, state } = emptyEngine();
    const facility = state.facilities.find((candidate) => candidate.id === 'farm-1')!;
    const unit = type === 'police'
      ? state.units.find((candidate) => candidate.type === 'police')!
      : createUnit(state, 'riot-suppression', 'riotPolice', facility.position, 'ready', 'regular');
    if (type === 'riotPolice') {
      state.units.push(unit);
      state.population.initialPopulation += unit.population;
    }
    facility.workers -= 6;
    facility.infected = 6;
    facility.operationalStatus = 'infected';
    unit.position = { ...facility.position };
    unit.attack = expectedAttack;
    unit.canAttack = true;
    unit.attackChargesRemaining = 1;
    unit.currentMilitaryGoods = 1;
    synchronizePopulation(state);
    const workersBefore = facility.workers;
    const lossesBefore = state.statistics.civilianLosses;
    load(engine, state);

    const result = engine.step({ type: 'EndTurn' });

    expect(result.error?.message ?? null).toBeNull();
    const after = result.state.facilities.find((candidate) => candidate.id === facility.id)!;
    expect(after.infected).toBe(0);
    expect(after.workers).toBe(workersBefore);
    expect(result.state.statistics.civilianLosses).toBe(lossesBefore);
    expect(result.events.some((event) => event.type === 'infection_suppressed'
      && event.payload.unitId === unit.id
      && event.payload.militaryGoodsCost === 1)).toBe(true);
  });

  it('uses National Guard attack 12 for suppression and preserves infection without Military Goods', () => {
    const withGoods = emptyEngine();
    const facilityWithGoods = withGoods.state.facilities.find((candidate) => candidate.id === 'farm-1')!;
    const guardWithGoods = createUnit(withGoods.state, 'ng-suppression-goods', 'nationalGuard', facilityWithGoods.position, 'ready', 'recruit');
    withGoods.state.units.push(guardWithGoods);
    withGoods.state.population.initialPopulation += guardWithGoods.population;
    facilityWithGoods.workers = 6;
    facilityWithGoods.infected = 20;
    withGoods.state.population.initialPopulation += 3;
    facilityWithGoods.operationalStatus = 'infected';
    guardWithGoods.position = { ...facilityWithGoods.position };
    guardWithGoods.attack = 12;
    guardWithGoods.canAttack = true;
    guardWithGoods.attackChargesRemaining = 1;
    guardWithGoods.currentMilitaryGoods = 1;
    synchronizePopulation(withGoods.state);
    load(withGoods.engine, withGoods.state);
    const supplied = withGoods.engine.step({ type: 'EndTurn' });

    expect(supplied.error?.message ?? null).toBeNull();
    const suppliedFacility = supplied.state.facilities.find((candidate) => candidate.id === 'farm-1')!;
    expect(suppliedFacility.infected).toBe(8);
    expect(suppliedFacility.workers).toBe(0);
    expect(supplied.state.statistics.civilianLosses).toBe(6);

    const withoutGoods = emptyEngine();
    const facilityWithoutGoods = withoutGoods.state.facilities.find((candidate) => candidate.id === 'farm-1')!;
    const guardWithoutGoods = createUnit(withoutGoods.state, 'ng-suppression-empty', 'nationalGuard', facilityWithoutGoods.position, 'ready', 'recruit');
    withoutGoods.state.units.push(guardWithoutGoods);
    withoutGoods.state.population.initialPopulation += guardWithoutGoods.population;
    facilityWithoutGoods.workers -= 6;
    facilityWithoutGoods.infected = 6;
    facilityWithoutGoods.operationalStatus = 'infected';
    guardWithoutGoods.position = { ...facilityWithoutGoods.position };
    guardWithoutGoods.attack = 12;
    guardWithoutGoods.canAttack = true;
    guardWithoutGoods.attackChargesRemaining = 1;
    guardWithoutGoods.currentMilitaryGoods = 0;
    withoutGoods.state.resources.militaryGoods = 0;
    synchronizePopulation(withoutGoods.state);
    load(withoutGoods.engine, withoutGoods.state);
    const contained = withoutGoods.engine.step({ type: 'EndTurn' });

    expect(contained.error?.message ?? null).toBeNull();
    const containedFacility = contained.state.facilities.find((candidate) => candidate.id === 'farm-1')!;
    const containedGuard = contained.state.units.find((unit) => unit.id === guardWithoutGoods.id)!;
    expect(containedFacility.infected).toBe(6);
    expect(containedFacility.workers).toBe(17);
    expect(contained.state.statistics.civilianLosses).toBe(0);
    expect(containedGuard.attackChargesRemaining).toBe(1);
    expect(contained.events.some((event) => event.type === 'infection_suppressed' && event.payload.unitId === containedGuard.id)).toBe(false);
  });
});
