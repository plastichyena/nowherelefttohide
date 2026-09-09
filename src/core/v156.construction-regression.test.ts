import { expect, it } from 'vitest';
import { GameEngine, getConstructibleFacilityPositionCandidates } from './engine';
import { createInitialState } from './state';
import { createDefaultConfig } from './config';
import { validateInvariants } from './invariants';
import { getPlayerVisibleTileKeys } from './visibility';
import { hexKey } from './hex';
import type { GameAction, GameState } from './types';
import failure from '../testing/fixtures/v156-random69-construction-failure.json';

it('rejects the actual Random 69 unseen-wall build without leaking wall existence or changing state', () => {
  const initial = createInitialState(failure.seed, createDefaultConfig());
  const state = { ...initial, ...structuredClone(failure.state) } as unknown as GameState;
  const action = failure.action as GameAction & { position: { q: number; r: number } };
  expect(validateInvariants(state)).toEqual({ valid: true, errors: [] });
  expect(getPlayerVisibleTileKeys(state).has(hexKey(action.position))).toBe(false);
  expect(state.barbedWire.some(w => hexKey(w.position) === hexKey(action.position))).toBe(true);
  for (const hasWall of [true, false]) {
    const variant = structuredClone(state);
    if (!hasWall) variant.barbedWire = variant.barbedWire.filter(w => hexKey(w.position) !== hexKey(action.position));
    const engine = new GameEngine(failure.seed, initial.config);
    expect(engine.step({ type: 'LoadSnapshot', snapshot: variant }).error).toBeNull();
    const before = engine.getState();
    const candidate = getConstructibleFacilityPositionCandidates(before, 'simpleFarm').find(c => hexKey(c.position) === hexKey(action.position));
    expect(candidate).toMatchObject({ legal: false, reasonCode: 'constructible_not_visible' });
    expect(engine.getLegalActions()).not.toContainEqual(action);
    expect(engine.step(action).error?.code).toBe('constructible_not_visible');
    expect(engine.getState()).toEqual(before);
    expect(validateInvariants(engine.getState())).toEqual({ valid: true, errors: [] });
  }
}, 120000);
