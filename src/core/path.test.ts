import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from './config';
import { createInitialState } from './state';
import { effectiveMovementCost } from './terrain';
import { findReachableTiles, findShortestPath, pathMovementCost } from './path';

describe('v1.3 weighted terrain pathfinding', () => {
  it('uses stable weighted shortest paths rather than the fewest steps', () => {
    const state = createInitialState(1, createDefaultConfig());
    const path = findShortestPath(
      state.map,
      { q: 0, r: 0 },
      { q: 2, r: 0 },
      new Set(),
      (position) => position.q === 1 && position.r === 0 ? 9 : 1,
    );
    expect(path).not.toBeNull();
    expect(path).not.toContainEqual({ q: 1, r: 0 });
    expect(pathMovementCost(path!, (position) => position.q === 1 && position.r === 0 ? 9 : 1)).toBeLessThan(10);
  });

  it('charges destination terrain and lets road and urban overlays override it', () => {
    const state = createInitialState(1, createDefaultConfig());
    expect(effectiveMovementCost(state, { q: 4, r: 4 })).toBe(2);
    expect(effectiveMovementCost(state, { q: 1, r: 1 })).toBe(3);
    expect(effectiveMovementCost(state, { q: 7, r: 1 })).toBe(1);
    expect(effectiveMovementCost(state, { q: 7, r: 3 })).toBe(1);

    const reachable = findReachableTiles(
      state.map,
      { q: 4, r: 3 },
      1,
      new Set(),
      (position) => effectiveMovementCost(state, position),
    );
    expect(reachable).not.toContainEqual({ q: 4, r: 4 });
  });
});
