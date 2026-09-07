import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from './config';
import { GameEngine } from './engine';
import { hexDistance, hexKey, hexNeighbors } from './hex';
import { findReachablePaths, findShortestPath, pathMovementCost } from './path';
import { createCityPopulationSnapshot, createUnit, synchronizePopulation } from './state';
import { effectiveMovementCost } from './terrain';
import type { GameState } from './types';

const config = () => createDefaultConfig({
  economy: {
    initialZombieCount: 0,
    initialHunterCount: { min: 0, max: 0 },
    initialGasCount: { min: 0, max: 0 },
    initialResources: { food: 100000, civilianGoods: 100000, militaryGoods: 100000, fuel: 100000 },
  },
  horde: { waves: [{ turn: 99, directionCount: 1, compositionPerDirection: { hordeZombie: 1, zombie: 0 }, final: true }] },
});

function setup(fallbackTargetMatches: boolean) {
  const engine = new GameEngine(1544, config());
  const state = engine.getState() as GameState;
  const moverPosition = { q: 20, r: 20 };
  const target = { q: 5, r: 5 };
  const openFallback = hexNeighbors(moverPosition)[3]!;
  const mover = createUnit(state, 'a-fallback-mover', 'zombie', moverPosition);
  mover.canMove = true;
  mover.movement = 1;
  mover.noiseTarget = target;
  mover.previousFallbackPosition = { ...openFallback };
  mover.fallbackTarget = fallbackTargetMatches ? { ...target } : { q: 6, r: 6 };
  state.units.push(mover);
  const occupied = [
    ...hexNeighbors(moverPosition).filter((position) => position.q !== openFallback.q || position.r !== openFallback.r),
    ...hexNeighbors(target),
  ];
  for (const [index, position] of occupied.entries()) {
    state.units.push(createUnit(state, `z-blocker-${index}`, 'zombie', position));
  }
  synchronizePopulation(state);
  createCityPopulationSnapshot(state);
  expect(engine.step({ type: 'LoadSnapshot', snapshot: state }).error).toBeNull();
  return { engine, moverPosition, openFallback, moverId: mover.id };
}

function blockPositions(state: GameState, positions: ReadonlyArray<{ q: number; r: number }>, prefix: string): void {
  const occupied = new Set(state.units.map((unit) => hexKey(unit.position)));
  let index = 0;
  for (const position of positions) {
    const key = hexKey(position);
    if (occupied.has(key)) continue;
    const blocker = createUnit(state, `${prefix}-${index++}`, 'zombie', position);
    blocker.canMove = false;
    blocker.canAttack = false;
    blocker.attackChargesRemaining = 0;
    state.units.push(blocker);
    occupied.add(key);
  }
}

function load(engine: GameEngine, state: GameState): void {
  synchronizePopulation(state);
  createCityPopulationSnapshot(state);
  expect(engine.step({ type: 'LoadSnapshot', snapshot: state }).error?.message ?? null).toBeNull();
}

describe('v1.5.4 Zombie congestion fallback', () => {
  it('stops instead of immediately returning to the previous lateral fallback Hex', () => {
    const { engine, moverPosition, moverId } = setup(true);
    const result = engine.step({ type: 'EndTurn' });
    expect(result.error).toBeNull();
    expect(result.state.units.find((unit) => unit.id === moverId)?.position).toEqual(moverPosition);
  });

  it('clears the return exclusion when the target changes and can use that only open Hex', () => {
    const { engine, openFallback, moverId } = setup(false);
    const result = engine.step({ type: 'EndTurn' });
    expect(result.error).toBeNull();
    expect(result.state.units.find((unit) => unit.id === moverId)?.position).toEqual(openFallback);
  });

  it('orders every reachable fallback endpoint by terrain-only weighted distance and stable coordinate', () => {
    const engine = new GameEngine(1548, config());
    const state = engine.getState() as GameState;
    const moverPosition = { q: 14, r: 10 };
    const target = { q: 10, r: 13 };
    const tiles = new Map(state.map.tiles.map((tile) => [tile.key, tile]));
    const terrainCost = (position: { q: number; r: number }) => {
      const tile = tiles.get(hexKey(position));
      return tile ? state.config.terrain.movementCost[tile.terrain] : null;
    };
    const distance = (from: { q: number; r: number }, target: { q: number; r: number }) => {
      const path = findShortestPath(state.map, from, target, new Set(), terrainCost);
      return path ? pathMovementCost(path, terrainCost) : Number.POSITIVE_INFINITY;
    };
    const mover = createUnit(state, 'a-weighted-fallback', 'zombie', moverPosition);
    mover.noiseTarget = target;
    state.units.push(mover);
    blockPositions(state, hexNeighbors(target), 'weighted-blocker');
    const occupied = new Set(state.units.filter((unit) => unit.id !== mover.id).map((unit) => hexKey(unit.position)));
    const currentDistance = distance(moverPosition, target);
    const reachable = findReachablePaths(
      state.map, moverPosition, mover.movement, occupied, (position) => effectiveMovementCost(state, position),
    ).map((entry) => ({
      ...entry,
      targetDistance: distance(entry.position, target),
      movementCost: effectiveMovementCost(state, entry.position)!,
    }));
    const closer = reachable.filter((entry) => entry.targetDistance < currentDistance);
    const pool = closer.length > 0 ? closer : reachable.filter((entry) => entry.targetDistance === currentDistance);
    const expected = pool.sort((left, right) => left.targetDistance - right.targetDistance || left.movementCost - right.movementCost
      || left.position.q - right.position.q || left.position.r - right.position.r)[0]!;
    expect(currentDistance).toBe(5);
    expect(pool.some((entry) => entry.targetDistance === 4)).toBe(true);
    expect(expected).toMatchObject({ position: { q: 11, r: 11 }, targetDistance: 3, movementCost: 1, cost: 3 });
    load(engine, state);

    const result = engine.step({ type: 'EndTurn' });
    expect(result.error).toBeNull();
    expect(result.state.units.find((unit) => unit.id === mover.id)?.position).toEqual(expected.position);
  });

  it('does not choose the only open neighbor when its terrain distance is farther from the target', () => {
    const engine = new GameEngine(1549, config());
    const state = engine.getState() as GameState;
    const moverPosition = { q: 20, r: 20 };
    const target = { q: 5, r: 5 };
    const farther = { q: 21, r: 20 };
    const mover = createUnit(state, 'a-no-farther-fallback', 'zombie', moverPosition);
    mover.noiseTarget = target;
    state.units.push(mover);
    blockPositions(state, [
      ...hexNeighbors(moverPosition).filter((position) => hexKey(position) !== hexKey(farther)),
      ...hexNeighbors(farther).filter((position) => hexKey(position) !== hexKey(moverPosition)),
      ...hexNeighbors(target),
    ], 'farther-blocker');
    load(engine, state);

    const result = engine.step({ type: 'EndTurn' });
    expect(result.error).toBeNull();
    expect(result.state.units.find((unit) => unit.id === mover.id)?.position).toEqual(moverPosition);
  });

  it('clears fallback memory after actual normal-route progress', () => {
    const engine = new GameEngine(1550, config());
    const state = engine.getState() as GameState;
    const moverPosition = { q: 20, r: 20 };
    const target = { q: 5, r: 5 };
    const mover = createUnit(state, 'a-normal-route-memory', 'zombie', moverPosition);
    mover.noiseTarget = target;
    mover.previousFallbackPosition = { q: 21, r: 20 };
    mover.fallbackTarget = { ...target };
    state.units.push(mover);
    load(engine, state);

    const result = engine.step({ type: 'EndTurn' });
    const after = result.state.units.find((unit) => unit.id === mover.id)!;
    expect(result.error).toBeNull();
    expect(after.position).not.toEqual(moverPosition);
    expect(after).toMatchObject({ previousFallbackPosition: null, fallbackTarget: null });
  });

  it('uses the actual intercepted fallback destination to clear memory when it is closer', () => {
    const engine = new GameEngine(1551, config());
    const state = engine.getState() as GameState;
    const moverPosition = { q: 12, r: 12 };
    const target = { q: 10, r: 10 };
    const closer = { q: 11, r: 12 };
    const mover = createUnit(state, 'a-intercepted-fallback', 'zombie', moverPosition);
    mover.vision = 0;
    mover.noiseTarget = target;
    mover.previousFallbackPosition = { q: 13, r: 12 };
    mover.fallbackTarget = { ...target };
    state.units.push(mover);
    const interceptor = state.units.find((unit) => unit.type === 'police')!;
    interceptor.position = { q: 10, r: 12 };
    blockPositions(state, [
      ...hexNeighbors(moverPosition).filter((position) => hexKey(position) !== hexKey(closer)),
      ...hexNeighbors(target),
    ], 'intercept-blocker');
    load(engine, state);

    const result = engine.step({ type: 'EndTurn' });
    const after = result.state.units.find((unit) => unit.id === mover.id)!;
    expect(result.events.some((event) => event.type === 'interception' && event.payload.defenderId === mover.id)).toBe(true);
    expect(after.position).toEqual(closer);
    expect(after).toMatchObject({ previousFallbackPosition: null, fallbackTarget: null });
  });

  it('keeps a Wave Capital Anchor while visible population overrides it, then resumes it', () => {
    const engine = new GameEngine(1552, config());
    const state = engine.getState() as GameState;
    const capital = { q: 25, r: 25 };
    const mover = createUnit(state, 'a-wave-anchor', 'zombie', { q: 20, r: 20 });
    mover.hordeKind = 'periodic';
    mover.spawnGroupId = 'periodic-anchor-test';
    mover.waveCapitalAnchor = { ...capital };
    state.units.push(mover);
    const visibleHuman = state.units.find((unit) => unit.type === 'police')!;
    visibleHuman.position = { q: 18, r: 20 };
    visibleHuman.canAttack = false;
    visibleHuman.attackChargesRemaining = 0;
    load(engine, state);

    const overridden = engine.step({ type: 'EndTurn' });
    const afterOverride = overridden.state.units.find((unit) => unit.id === mover.id)!;
    expect(afterOverride.position.q).toBeLessThan(mover.position.q);
    expect(afterOverride.waveCapitalAnchor).toEqual(capital);

    const resumedState = overridden.state as GameState;
    resumedState.units.find((unit) => unit.id === visibleHuman.id)!.position = { q: 5, r: 5 };
    load(engine, resumedState);
    const beforeDistance = hexDistance(afterOverride.position, capital);
    const resumed = engine.step({ type: 'EndTurn' });
    const afterResume = resumed.state.units.find((unit) => unit.id === mover.id)!;
    expect(hexDistance(afterResume.position, capital)).toBeLessThan(beforeDistance);
    expect(afterResume.waveCapitalAnchor).toEqual(capital);
  });

  it('retains the return exclusion when target reason changes but its coordinate does not', () => {
    const engine = new GameEngine(1553, config());
    const state = engine.getState() as GameState;
    const moverPosition = { q: 20, r: 20 };
    const capital = { q: 25, r: 25 };
    const excluded = { q: 21, r: 20 };
    const mover = createUnit(state, 'a-same-coordinate-target', 'zombie', moverPosition);
    mover.hordeKind = 'periodic';
    mover.spawnGroupId = 'periodic-same-target';
    mover.waveCapitalAnchor = { ...capital };
    mover.noiseTarget = { ...capital };
    mover.previousFallbackPosition = { ...excluded };
    mover.fallbackTarget = { ...capital };
    state.units.push(mover);
    blockPositions(state, [
      ...hexNeighbors(moverPosition).filter((position) => hexKey(position) !== hexKey(excluded)),
      ...hexNeighbors(capital),
    ], 'same-target-blocker');
    load(engine, state);

    const result = engine.step({ type: 'EndTurn' });
    expect(result.error).toBeNull();
    expect(result.state.units.find((unit) => unit.id === mover.id)).toMatchObject({
      position: moverPosition,
      previousFallbackPosition: excluded,
      fallbackTarget: capital,
    });
  });
});
