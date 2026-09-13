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
  // Recreate this regression under new rules; this is not Save migration.
  state.gameVersion = initial.gameVersion;
  state.mapId = initial.mapId;
  state.initialHunterPositions = structuredClone(initial.initialHunterPositions);
  state.initialGasPositions = structuredClone(initial.initialGasPositions);
  state.config.version = initial.config.version;
  state.config.units.hordeZombie.maxAttackCharges = 4;
  state.statistics = { ...initial.statistics, ...state.statistics };
  state.statistics.resourceShortageLossesTotal = state.statistics.resourceShortageLosses;
  state.statistics.finalEconomyResourceShortageLosses = 0;
  state.statistics.enemyKillsTotal = state.statistics.normalZombiesKilled + state.statistics.hordeZombiesKilled
    + state.statistics.policeZombiesKilled + state.statistics.soldierZombiesKilled
    + state.statistics.riotZombiesKilled + state.statistics.hunterZombiesKilled + state.statistics.gasZombiesKilled;
  const removed = new Set(['refinery-2', 'refinery-3', 'refinery-4', 'power-plant-2', 'power-plant-3']);
  state.facilities = state.facilities.filter((facility) => !removed.has(facility.id));
  for (const oilField of initial.facilities.filter((facility) => facility.type === 'oilField')) {
    if (!state.facilities.some((facility) => facility.id === oilField.id)) state.facilities.push(structuredClone(oilField));
  }
  for (const facility of state.facilities) {
    facility.firstCaptureRewardClaimed = facility.constructible || facility.owner === 'player';
  }
  state.barbedWire.forEach(w => { w.maxHp = 20; });
  state.units.filter(u => u.type === 'hordeZombie').forEach(u => { u.maxAttackCharges = 4; });
  const action = failure.action as GameAction & { position: { q: number; r: number } };
  expect(validateInvariants(state)).toEqual({ valid: true, errors: [] });
  expect(getPlayerVisibleTileKeys(state).has(hexKey(action.position))).toBe(false);
  expect(state.barbedWire.some(w => hexKey(w.position) === hexKey(action.position))).toBe(true);
  for (const hasWall of [true, false]) {
    const variant = structuredClone(state);
    if (!hasWall) variant.barbedWire = variant.barbedWire.filter(w => hexKey(w.position) !== hexKey(action.position));
    const engine = new GameEngine(failure.seed, initial.config);
    expect(engine.step({ type: 'LoadSnapshot', snapshot: variant }).error?.message).toBeUndefined();
    const before = engine.getState();
    const candidate = getConstructibleFacilityPositionCandidates(before, 'simpleFarm').find(c => hexKey(c.position) === hexKey(action.position));
    expect(candidate).toMatchObject({ legal: false, reasonCode: 'constructible_not_visible' });
    expect(engine.getLegalActions()).not.toContainEqual(action);
    expect(engine.step(action).error?.code).toBe('constructible_not_visible');
    expect(engine.getState()).toEqual(before);
    expect(validateInvariants(engine.getState())).toEqual({ valid: true, errors: [] });
  }
}, 120000);
