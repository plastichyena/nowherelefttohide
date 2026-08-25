import { describe, expect, it, vi } from 'vitest';

// The controller imports the Phaser adapter, but these view-model helpers are
// intentionally testable without constructing a browser canvas.
vi.mock('phaser', () => ({
  default: {
    Scene: class Scene {},
    Game: class Game {},
  },
}));

import type { FacilityState, GameState, UnitState } from '../core/types';
import { loadValidationError, phaseIndicatorViewModel, resolveTileSelection } from './controller';

function testState(units: Partial<UnitState>[], facilities: Partial<FacilityState>[] = []): GameState {
  return { units, facilities } as unknown as GameState;
}

function testUnit(id: string, q: number, r: number, isPlayerUnit = true): Partial<UnitState> {
  return { id, position: { q, r }, isPlayerUnit, actionState: 'ready' };
}

function testFacility(id: string, q: number, r: number): Partial<FacilityState> {
  return { id, position: { q, r } };
}

describe('controller view models', () => {
  it('keeps the raw phase in metadata while exposing a localized label separately', () => {
    expect(phaseIndicatorViewModel('player', 'ja')).toEqual({
      phase: 'player',
      shortLabel: '行動',
      label: 'フェーズ: 行動',
    });
    expect(phaseIndicatorViewModel('zombie', 'en')).toEqual({
      phase: 'zombie',
      shortLabel: 'Zombies',
      label: 'Phase: Zombies',
    });
    expect(phaseIndicatorViewModel('player', 'ja').label).not.toBe('player');
  });

  it('selects the first validation error and falls back only when no detail exists', () => {
    expect(loadValidationError({ valid: true, errors: [] }, 'Load failed')).toBeNull();
    expect(loadValidationError({ valid: false, errors: ['checksum mismatch'] }, 'Load failed')).toBe('checksum mismatch');
    expect(loadValidationError({ valid: false, errors: [] }, 'Load failed')).toBe('Load failed');
  });

  it('prioritizes a player unit over a co-located facility in map mode', () => {
    const state = testState([testUnit('police-1', 7, 7)], [testFacility('capital', 7, 7)]);

    expect(resolveTileSelection(state, { q: 7, r: 7 }, 'map')).toEqual({ kind: 'unit', id: 'police-1' });
  });

  it('prioritizes a co-located facility over a player unit in domestic mode', () => {
    const state = testState([testUnit('police-1', 7, 7)], [testFacility('capital', 7, 7)]);

    expect(resolveTileSelection(state, { q: 7, r: 7 }, 'domestic')).toEqual({ kind: 'facility', id: 'capital' });
  });

  it('does not select a unit-only tile in domestic mode', () => {
    const state = testState([testUnit('police-1', 4, 5)]);

    expect(resolveTileSelection(state, { q: 4, r: 5 }, 'domestic')).toBeNull();
  });

  it('selects a facility-only tile in map mode', () => {
    const state = testState([], [testFacility('farm-1', 2, 3)]);

    expect(resolveTileSelection(state, { q: 2, r: 3 }, 'map')).toEqual({ kind: 'facility', id: 'farm-1' });
  });
});
