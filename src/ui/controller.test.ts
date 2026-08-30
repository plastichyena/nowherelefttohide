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
import { forecastEndTurn, GameEngine } from '../core/engine';
import { boardLegendViewModel, loadValidationError, localizeActionError, localizeSaveLoadError, phaseIndicatorViewModel, powerHudViewModel, renderBoardLegend, renderEndTurnForecast, resolveTileSelection, shouldAutosaveAfterLoad } from './controller';
import { ASSET_REGISTRY } from './boardAssets';
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

  it('never selects an enemy-only tile through the human selection resolver', () => {
    const state = testState([testUnit('zombie-1', 4, 5, false)]);

    expect(resolveTileSelection(state, { q: 4, r: 5 }, 'map')).toBeNull();
  });

  it('selects a facility-only tile in map mode', () => {
    const state = testState([], [testFacility('farm-1', 2, 3)]);

    expect(resolveTileSelection(state, { q: 2, r: 3 }, 'map')).toEqual({ kind: 'facility', id: 'farm-1' });
  });

  it('does not autosave a migrated snapshot until a later accepted action', () => {
    expect(shouldAutosaveAfterLoad(false)).toBe(true);
    expect(shouldAutosaveAfterLoad(true)).toBe(false);
  });

  it('reports unsupported pre-v1.3 saves in both UI languages', () => {
    const detail = 'checksum mismatch in v1.2.5 save';
    expect(localizeSaveLoadError(detail, 'ja')).toContain('サポートしていないため読み込めません');
    expect(localizeSaveLoadError(detail, 'en')).toContain('does not support migration');
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

  it('localizes Power Supply action errors', () => {
    expect(localizeActionError('power_supply_not_applicable', 'ja')).toContain('Farm');
    expect(localizeActionError('power_supply_unavailable', 'en')).toContain('owned');
    expect(localizeActionError('invalid_power_supply', 'en')).toContain('ON or OFF');
  });

  it('renders the detailed End Turn forecast in both UI languages', () => {
    const forecast = forecastEndTurn(new GameEngine(127).getState());
    const japanese = renderEndTurnForecast(forecast, 'ja');
    const english = renderEndTurnForecast(forecast, 'en');
    for (const [html, locale] of [[japanese, 'ja'], [english, 'en']] as const) {
      expect(html).toContain('forecast-detail-grid');
      expect(html).toContain(createTranslator(locale)('productionInputShortage'));
      expect(html).toContain(createTranslator(locale)('generationFuelShortage'));
      expect(html).toContain(createTranslator(locale)('requiredPowerAllocated'));
    }
    expect(japanese).toContain('開始時備蓄');
    expect(english).toContain('Starting stock');
  });

  it('has bilingual v1.2.7 recovery, infection, range, production, power, and policy help', () => {
    const keys = [
      'tipRecovery', 'tipSuppression', 'tipRange', 'tipProduction', 'tipPolicy',
      'tipPower', 'tipPowerAllocation', 'tipProductionTiming', 'recoveryTiming', 'effectiveRange', 'projectedSuppression', 'powerRequirement', 'projectedPower', 'lastPowerSupplied', 'productionMultiplier', 'policyTradeoff', 'migratedSaveNotice', 'migrationSaveError',
    ];
    for (const key of keys) {
      expect(createTranslator('ja')(key)).not.toBe(key);
      expect(createTranslator('en')(key)).not.toBe(key);
    }
  });

  it('has bilingual v1.3 terrain, visibility, Horde, and victory labels', () => {
    const keys = [
      'finalHordeTurn', 'finalHordeWarning', 'spawnTurn', 'hordeStatusNotStarted',
      'terrain', 'baseTerrain', 'terrainPlain', 'terrainForest', 'terrainMountain', 'terrainWater',
      'roadOverlay', 'urbanOverlay', 'effectiveMovementCost', 'defenseSource', 'damageMultiplier',
      'vision', 'visible', 'hidden', 'victoryProgress', 'finalHordeDefeated',
      'suppliedAreaZombieClear', 'suppliedAreaInfectionClear', 'tipTerrain', 'tipVision', 'tipHorde', 'tipVictory',
      'finalHordeSpawned', 'finalHordeKilled', 'normalZombiesKilled', 'hordeZombiesKilled', 'victoryTurn',
    ];
    for (const key of keys) {
      expect(createTranslator('ja')(key)).not.toBe(key);
      expect(createTranslator('en')(key)).not.toBe(key);
    }
    expect(createTranslator('ja')('finalHordeTurn')).toContain('Final Horde');
    expect(createTranslator('en')('finalHordeWarning')).toContain('FINAL HORDE');
  });

  it('formats the power HUD as projected demand over available supply', () => {
    const electricity = {
      physicalGenerationCapacity: 40,
      fuelLimitedGenerationCapacity: 20,
      availableGenerationCapacity: 20,
      requiredPowerDemand: 10,
      industrialBoostDemand: 5,
      requiredPowerAllocated: 10,
      industrialBoostAllocated: 2,
      unpoweredFacilities: [],
      capacity: 20,
      required: 10,
      shortage: 3,
    } as const;
    const japanese = powerHudViewModel(electricity, 'ja');
    const english = powerHudViewModel(electricity, 'en');
    expect(japanese.display).toBe('15/20');
    expect(english.display).toBe('15/20');
    expect(japanese.isShortage).toBe(true);
    expect(japanese.tooltip).toContain('予測需要量: 15');
    expect(japanese.tooltip).toContain('不足: 3');
    expect(english.accessibleName).toContain('Projected demand 15');
  });

  it('keeps a zero-demand, zero-supply power HUD safe and uses Core shortage only', () => {
    const electricity = {
      physicalGenerationCapacity: 0,
      fuelLimitedGenerationCapacity: 0,
      availableGenerationCapacity: 0,
      requiredPowerDemand: 0,
      industrialBoostDemand: 0,
      requiredPowerAllocated: 0,
      industrialBoostAllocated: 0,
      unpoweredFacilities: [],
      capacity: 0,
      required: 0,
      shortage: 0,
    } as const;
    const view = powerHudViewModel(electricity, 'en');
    expect(view.display).toBe('0/0');
    expect(view.isShortage).toBe(false);
    expect(view.accessibleName).toContain('Shortage 0');
  });

  it('renders a bilingual collapsible board legend with config provenance', () => {
    const standard = boardLegendViewModel(null, 'ja');
    const state = new GameEngine(9).getState();
    const current = boardLegendViewModel(state.config, 'en');
    expect(standard.configSource).toBe('standard');
    expect(current.configSource).toBe('current');
    const japanese = renderBoardLegend(null, 'ja');
    const english = renderBoardLegend(current.config, 'en');
    expect(japanese).toContain('標準Config（ゲーム開始前）');
    expect(japanese).toContain('平地');
    expect(japanese).toContain('盤面と同じAsset Registry');
    expect(english).toContain('Current GameState Config');
    expect(english).toContain('Periodic Horde');
    expect(english).toContain('data-legend-section="dynamic"');
    expect(english).toContain('Secured + stopped');
    expect(english).toContain('Forest Movement Cost');
    expect(renderBoardLegend(null, 'en', ASSET_REGISTRY)).toContain('/assets/board/terrain/terrain_plain.png');
  });
});
