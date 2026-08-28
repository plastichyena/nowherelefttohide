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
import { loadValidationError, localizeActionError, localizeSaveLoadError, phaseIndicatorViewModel, resolveTileSelection, shouldAutosaveAfterLoad } from './controller';
import { createTranslator } from './i18n';

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

  it('does not autosave a migrated snapshot until a later accepted action', () => {
    expect(shouldAutosaveAfterLoad(false)).toBe(true);
    expect(shouldAutosaveAfterLoad(true)).toBe(false);
  });

  it('reports v1.2.5 migration rejection in both UI languages', () => {
    const detail = 'checksum mismatch in v1.2.5 save';
    expect(localizeSaveLoadError(detail, 'ja')).toContain('移行できません');
    expect(localizeSaveLoadError(detail, 'en')).toContain('could not be migrated');
    expect(localizeSaveLoadError('checksum mismatch', 'en')).toBe('checksum mismatch');
  });

  it('selects a checkpoint so its three population pools are inspectable', () => {
    const state = testState([], [],);
    state.checkpoints = [{ id: 'checkpoint-north-1', position: { q: 7, r: 5 } }] as GameState['checkpoints'];
    expect(resolveTileSelection(state, { q: 7, r: 5 }, 'map')).toEqual({ kind: 'checkpoint', id: 'checkpoint-north-1' });
    expect(resolveTileSelection(state, { q: 7, r: 5 }, 'domestic')).toEqual({ kind: 'checkpoint', id: 'checkpoint-north-1' });
  });

  it('localizes v1.2.6 supply and checkpoint action errors', () => {
    expect(localizeActionError('facility_out_of_supply', 'ja')).toContain('供給外');
    expect(localizeActionError('recruitment_out_of_supply', 'en')).toContain('outside the supply');
    expect(localizeActionError('checkpoint_supply_zombie_blocked', 'ja')).toContain('ゾンビ');
    expect(localizeActionError('checkpoint_branch_action_limit', 'en')).toContain('branch');
    expect(localizeActionError('invalid_action_input', 'ja')).toContain('合法');
    expect(localizeActionError('invalid_action_input', 'en')).toContain('legal action');
  });

  it('has bilingual v1.2.6 recovery, infection, range, production, and policy help', () => {
    const keys = [
      'tipRecovery', 'tipSuppression', 'tipRange', 'tipProduction', 'tipPolicy',
      'recoveryTiming', 'effectiveRange', 'projectedSuppression', 'powerRequirement', 'policyTradeoff', 'migratedSaveNotice', 'migrationSaveError',
    ];
    for (const key of keys) {
      expect(createTranslator('ja')(key)).not.toBe(key);
      expect(createTranslator('en')(key)).not.toBe(key);
    }
  });
});
