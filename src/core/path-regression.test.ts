import { describe, expect, it } from 'vitest';
import * as legacy from '../testing/fixtures/v151-path-reference';
import * as current from './path';
import { createFixedMap } from './map';
import { createMapReference, getTile } from './map-reference';
import { createDefaultConfig } from './config';
import { createInitialState } from './state';
import { createMovementCostResolver, effectiveMovementCost } from './terrain';
import { SeededRng } from './rng';
import { hexKey } from './hex';
import type { FixedMap, HexCoord } from './types';

describe('v1.5.1 path differential fixtures', () => {
  it('preserves complete paths, costs and coordinate order for weighted and tied alternatives', () => {
    const source = createFixedMap();
    for (const seed of [1, 2, 17, 12345]) {
      const rng = new SeededRng(seed);
      const map: FixedMap = { ...source, width: 12, height: 12,
        tiles: source.tiles.filter((tile) => tile.q < 12 && tile.r < 12).reverse().map((tile) => ({
          ...tile, movementCost: rng.nextInt(0, 7) === 0 ? null : rng.nextInt(1, 3),
        })),
      };
      const blocked = new Set(map.tiles.filter(() => rng.nextInt(0, 9) === 0).map(hexKey));
      for (const start of [{ q: 0, r: 0 }, { q: 5, r: 5 }, { q: 11, r: 11 }]) {
        for (const budget of [0, 1, 5, 15, 40]) {
          expect(current.findReachablePaths(map, start, budget, blocked)).toEqual(
            legacy.findReachablePaths(map, start, budget, blocked),
          );
        }
        for (const destination of [{ q: 0, r: 0 }, { q: 9, r: 10 }, { q: 11, r: 11 }, { q: -1, r: 0 }]) {
          expect(current.findShortestPath(map, start, destination, blocked)).toEqual(
            legacy.findShortestPath(map, start, destination, blocked),
          );
        }
      }
    }
  });

  it('recomputes paths after occupancy and terrain change, including blocked destinations', () => {
    const map = createFixedMap();
    const start = { q: 24, r: 25 };
    const destination = { q: 27, r: 25 };
    const blocked = new Set<string>();
    const uniform = () => 1;
    const check = () => expect(current.findShortestPath(map, start, destination, blocked, uniform))
      .toEqual(legacy.findShortestPath(map, start, destination, blocked, uniform));
    check();
    blocked.add('25,25'); check();
    blocked.add(hexKey(destination)); check();
    blocked.clear(); check();
    map.tiles = map.tiles.filter((tile) => tile.q < 8 && tile.r < 8).reverse();
    const before = current.findReachablePaths(map, { q: 3, r: 3 }, 5);
    map.tiles.find((tile) => tile.q === 4 && tile.r === 3)!.movementCost = null;
    const after = current.findReachablePaths(map, { q: 3, r: 3 }, 5);
    expect(after).toEqual(legacy.findReachablePaths(map, { q: 3, r: 3 }, 5));
    expect(after).not.toEqual(before);
    expect(current.findNearestOpenTiles(map, start, new Set([hexKey(start)])))
      .toEqual(legacy.findNearestOpenTiles(map, start, new Set([hexKey(start)])));
  });

  it('uses current urban/checkpoint/reserve rules without assuming tile array order', () => {
    const state = createInitialState(17, createDefaultConfig());
    state.map.tiles.reverse();
    const reference = createMapReference(state.map);
    const indexedCost = createMovementCostResolver(state);
    const playerCost = createMovementCostResolver(state, true);
    for (const tile of state.map.tiles) {
      expect(reference.getTile(tile)).toBe(getTile(state.map, tile));
      expect(indexedCost(tile)).toBe(effectiveMovementCost(state, tile));
      expect(playerCost(tile)).toBe(state.map.hordeSpawnReserve.some((position) => hexKey(position) === hexKey(tile))
        ? null : effectiveMovementCost(state, tile));
    }
    for (const position of [{ q: -1, r: 0 }, { q: 51, r: 0 }]) expect(indexedCost(position)).toBeNull();
    const start = state.units[0]!.position;
    expect(current.findReachablePaths(state.map, start, 15, new Set(), indexedCost)).toEqual(
      legacy.findReachablePaths(state.map, start, 15, new Set(), (position) => effectiveMovementCost(state, position)),
    );
    const changed: HexCoord = { q: 4, r: 4 };
    const previousCost = indexedCost(changed);
    state.facilities.push({ ...state.facilities[0]!, id: 'test-overlay', position: changed });
    expect(createMovementCostResolver(state)(changed)).toBe(1);
    expect(previousCost).toBe(2);
  });

  it('retains sparse and duplicate first-match lookup semantics and observes replaced arrays', () => {
    const map = createFixedMap();
    const tile = { ...map.tiles[0]!, q: 3, r: 4, movementCost: 3 };
    map.tiles = [tile, { ...tile, movementCost: 1 }];
    expect(createMapReference(map).getTile(tile)).toBe(tile);
    expect(getTile(map, { q: 0, r: 0 })).toBeUndefined();
    map.tiles = [map.tiles[1]!];
    expect(createMapReference(map).getTile(tile)?.movementCost).toBe(1);
  });
});
