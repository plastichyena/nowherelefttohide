import { expect, it } from 'vitest';
import { GameEngine, validateAction } from './engine';
import { createInitialState } from './state';
import { createDefaultConfig } from './config';
import { validateInvariants } from './invariants';
import { getPlayerVisibleTileKeys } from './visibility';
import { hexKey } from './hex';
import type { GameAction, GameState } from './types';

it('rejects the actual Random 69 unseen-wall build without leaking wall existence or changing state', () => {
  const seed = 69;
  const initial = createInitialState(seed, createDefaultConfig({
    economy: { initialZombieCount: 0, initialScreamerCount: 0, initialHunterCount: { min: 0, max: 0 } },
    units: { police: { vision: 0 }, nationalGuard: { vision: 0 }, riotPolice: { vision: 0 }, reconTeam: { vision: 0 } },
    vision: { capital: 0, ownedFacility: 0, operationalCheckpoint: 0 },
  }));
  const hidden = initial.map.tiles.find((tile) => validateAction(initial, {
    type: 'BuildConstructibleFacility', facilityType: 'simpleFarm', position: tile,
  })?.code === 'constructible_not_visible');
  expect(hidden).toBeDefined();
  const action: GameAction & { position: { q: number; r: number } } = {
    type: 'BuildConstructibleFacility',
    facilityType: 'simpleFarm',
    position: { q: hidden!.q, r: hidden!.r },
  };
  const state = structuredClone(initial) as GameState;
  state.barbedWire.push({ id: 'hidden-regression-wall', position: { ...action.position }, hp: 20, maxHp: 20, builtTurn: 1 });
  expect(validateInvariants(state)).toEqual({ valid: true, errors: [] });
  expect(getPlayerVisibleTileKeys(state).has(hexKey(action.position))).toBe(false);
  expect(state.barbedWire.some(w => hexKey(w.position) === hexKey(action.position))).toBe(true);
  for (const hasWall of [true, false]) {
    const variant = structuredClone(state);
    if (!hasWall) variant.barbedWire = variant.barbedWire.filter(w => hexKey(w.position) !== hexKey(action.position));
    const engine = new GameEngine(seed, initial.config);
    expect(engine.step({ type: 'LoadSnapshot', snapshot: variant }).error?.message).toBeUndefined();
    const before = engine.getState();
    expect(validateAction(before, action)?.code).toBe('constructible_not_visible');
    expect(engine.getLegalActions()).not.toContainEqual(action);
    expect(engine.step(action).error?.code).toBe('constructible_not_visible');
    expect(engine.getState()).toEqual(before);
    expect(validateInvariants(engine.getState())).toEqual({ valid: true, errors: [] });
  }
}, 120000);
