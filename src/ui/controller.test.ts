import { describe, expect, it, vi } from 'vitest';

// The controller imports the Phaser adapter, but these view-model helpers are
// intentionally testable without constructing a browser canvas.
vi.mock('phaser', () => ({
  default: {
    Scene: class Scene {},
    Game: class Game {},
  },
}));

import type { CheckpointPositionCandidate, CheckpointState, FacilityState, GameAction, GameEvent, GameState, UnitState } from '../core/types';
import { forecastEndTurn, GameEngine } from '../core/engine';
import { createAgentObservation } from '../agent/observation';
import { actionForCheckpointCandidate, boardLegendViewModel, branchPanelViewModel, checkpointCandidateViewModels, checkpointRoleFor, formatImportantEvent, importantEventToastText, importantEventViewModels, loadValidationError, localizeActionError, localizeSaveLoadError, noiseClassForUnit, phaseIndicatorViewModel, placeBoardContextUi, powerHudViewModel, projectImportantEvent, renderAttackPreview, renderBoardLegend, renderBranchPanel, renderEndTurnForecast, renderImportantEventHistory, renderMilitaryGoodsForecast, renderNoiseEventLog, renderUnitMilitaryGoodsDetails, resolveTileSelection, selectionShowsSupplyOverlay, shouldAutosaveAfterLoad, titleVersionLabel, unitActionAvailability, unitInteractionCancelStep } from './controller';
import { ASSET_REGISTRY } from './boardAssets';
import { createTranslator } from './i18n';
import { deriveDevelopmentNoiseDebug, renderNoiseDebugOverlay } from './noiseDebug';

function testState(units: Partial<UnitState>[], facilities: Partial<FacilityState>[] = []): GameState {
  return { units, facilities } as unknown as GameState;
}

function testUnit(id: string, q: number, r: number, isPlayerUnit = true): Partial<UnitState> {
  return { id, position: { q, r }, isPlayerUnit, actionState: 'ready' };
}

function testFacility(id: string, q: number, r: number): Partial<FacilityState> {
  return { id, position: { q, r } };
}

function siteEvent(
  id: string,
  type: Extract<GameEvent['type'], `site_${string}`>,
  payload: Record<string, unknown>,
): GameEvent {
  return {
    id,
    turn: 2,
    phase: 'zombie',
    type,
    payload: payload as GameEvent['payload'],
  };
}

describe('controller view models', () => {
  it('derives a visible title-screen version label from APP_VERSION', () => {
    expect(titleVersionLabel('ja')).toContain('1.4.4');
    expect(titleVersionLabel('en')).toContain('1.4.4');
    expect(createTranslator('ja')('appVersion')).not.toBe('appVersion');
    expect(createTranslator('en')('appVersion')).not.toBe('appVersion');
  });

  it('derives action-menu availability only from legal actions for the selected unit', () => {
    const actions = [
      { type: 'Move', unitId: 'police-1', destination: { q: 2, r: 3 } },
      { type: 'Attack', attackerId: 'guard-2', targetId: 'zombie-1' },
      { type: 'Wait', unitId: 'police-1' },
    ] as GameAction[];

    expect(unitActionAvailability(actions, 'police-1')).toEqual({ move: true, attack: false, wait: true });
    expect(unitActionAvailability(actions, 'guard-2')).toEqual({ move: false, attack: true, wait: false });
  });

  it('keeps board-side controls visible near every mobile edge', () => {
    const board = { width: 320, height: 420 };
    const menu = { width: 236, height: 64 };
    expect(placeBoardContextUi({ x: 8, y: 16 }, board, menu)).toEqual({ left: 8, top: 50, vertical: 'below' });
    expect(placeBoardContextUi({ x: 315, y: 410 }, board, menu)).toEqual({ left: 76, top: 312, vertical: 'above' });
  });

  it('cancels target, mode, and selection in that order', () => {
    expect(unitInteractionCancelStep('move', true, true)).toBe('target');
    expect(unitInteractionCancelStep('attack', false, true)).toBe('mode');
    expect(unitInteractionCancelStep(null, false, true)).toBe('selection');
    expect(unitInteractionCancelStep(null, false, false)).toBe('none');
  });

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

  it('does not auto-show Supply for the capital but keeps it for worker facilities', () => {
    const state = new GameEngine(1).getState();
    const capital = state.facilities.find((facility) => facility.type === 'capital')!;
    const city = state.facilities.find((facility) => facility.type === 'city')!;
    const farm = state.facilities.find((facility) => facility.type === 'farm')!;
    const overlayState = {
      facilities: state.facilities,
      checkpoints: [{ id: 'checkpoint-test' }] as GameState['checkpoints'],
    };

    expect(selectionShowsSupplyOverlay(overlayState, { kind: 'facility', id: capital.id })).toBe(false);
    expect(selectionShowsSupplyOverlay(overlayState, { kind: 'facility', id: city.id })).toBe(false);
    expect(selectionShowsSupplyOverlay(overlayState, { kind: 'facility', id: farm.id })).toBe(true);
    expect(selectionShowsSupplyOverlay(overlayState, { kind: 'checkpoint', id: 'checkpoint-test' })).toBe(true);
  });

  it('does not autosave a migrated snapshot until a later accepted action', () => {
    expect(shouldAutosaveAfterLoad(false)).toBe(true);
    expect(shouldAutosaveAfterLoad(true)).toBe(false);
  });

  it('reports unsupported v1.4.3-or-earlier saves in both UI languages', () => {
    const detail = 'version mismatch in v1.3.3 save';
    expect(localizeSaveLoadError(detail, 'ja')).toContain('読み込めません');
    expect(localizeSaveLoadError(detail, 'ja')).toContain('v1.4.3以前');
    expect(localizeSaveLoadError(detail, 'ja')).toContain('v1.4.4');
    expect(localizeSaveLoadError(detail, 'en')).toContain('cannot be loaded');
    expect(localizeSaveLoadError(detail, 'en')).toContain('v1.4.3 or earlier');
    expect(localizeSaveLoadError(detail, 'en')).toContain('v1.4.4');
    expect(localizeSaveLoadError('checksum mismatch', 'en')).toBe('checksum mismatch');
    expect(createTranslator('ja')('tipSave')).toContain('Game Rules 2.4.0');
    expect(createTranslator('ja')('tipSave')).toContain('Save Format 9');
    expect(createTranslator('en')('tipSave')).toContain('Game Rules 2.4.0');
    expect(createTranslator('en')('tipSave')).toContain('Save Format 9');
    for (const locale of ['ja', 'en'] as const) {
      const t = createTranslator(locale);
      expect(t('legacySaveNotice')).toContain(locale === 'ja' ? 'v1.4.3以前' : 'v1.4.3 or earlier');
      expect(t('legacySaveError')).toContain(locale === 'ja' ? 'v1.4.3以前' : 'v1.4.3 or earlier');
      expect(t('migrationSaveError')).toContain(locale === 'ja' ? 'v1.4.3以前' : 'v1.4.3-or-earlier');
      expect(t('migratedSaveNotice')).toContain(locale === 'ja' ? 'v1.4.3以前' : 'v1.4.3-or-earlier');
      expect(t('tipSave')).toContain(locale === 'ja' ? 'v1.4.3以前' : 'v1.4.3 or earlier');
    }
  });

  it('projects public site events without hidden spawn details', () => {
    const event = siteEvent('event-spawn', 'site_zombies_spawned', {
      siteKind: 'facility',
      siteId: 'farm-1',
      siteType: 'farm',
      q: 3,
      r: 4,
      cause: 'infection_fall',
      requestedSpawnCount: 6,
      actualSpawnCount: 2,
      remainingInfected: 1,
      chainOriginEventId: 'event-root',
      source: 'zombie-hidden',
      spawnedUnitIds: ['zombie-hidden'],
      spawnedPositions: [{ q: 9, r: 9 }],
      radius: 8,
      affectedZombieIds: ['zombie-hidden'],
    });
    const view = projectImportantEvent(event);
    expect(view).not.toBeNull();
    expect(view).toMatchObject({
      id: 'event-spawn',
      siteKind: 'facility',
      siteId: 'farm-1',
      siteType: 'farm',
      position: { q: 3, r: 4 },
      actualSpawnCount: 2,
      requestedSpawnCount: 6,
      remainingInfected: 1,
      chainOriginEventId: 'event-root',
    });
    const rendered = renderImportantEventHistory([event], 'en');
    expect(rendered).toContain('farm-1');
    expect(rendered).toContain('Spawned (actual/requested) 2/6');
    expect(rendered).toContain('Cause Infection fall');
    expect(rendered).toContain('Chain root event-root');
    expect(rendered).not.toContain('zombie-hidden');
    expect(rendered).not.toContain('spawnedUnitIds');
    expect(rendered).not.toContain('radius');
  });

  it('keeps only the newest 50 site events and aggregates one chain Toast', () => {
    const events = Array.from({ length: 51 }, (_, index) => siteEvent(`event-${index}`, 'site_fallen', {
      siteKind: 'facility',
      siteId: `farm-${index}`,
      siteType: 'farm',
      q: index,
      r: index + 1,
      cause: 'infection_fall',
      infectedAtFall: 5,
      requestedSpawnCount: 1,
      actualSpawnCount: 1,
      remainingInfected: 0,
      chainOriginEventId: null,
      chainDepth: 0,
    }));
    const history = importantEventViewModels(events, 50);
    expect(history).toHaveLength(50);
    expect(history[0]?.id).toBe('event-1');
    expect(renderImportantEventHistory(events, 'en')).not.toContain('farm-0');

    const chainEvents = [
      siteEvent('chain-a', 'site_chain_fallen', { siteKind: 'facility', siteId: 'farm-a', siteType: 'farm', q: 1, r: 1, chainOriginEventId: 'chain-root', chainDepth: 1 }),
      siteEvent('chain-b', 'site_chain_fallen', { siteKind: 'checkpoint', siteId: 'checkpoint-b', siteType: 'active', q: 2, r: 2, chainOriginEventId: 'chain-root', chainDepth: 2 }),
    ].map((event) => projectImportantEvent(event)!);
    const toast = importantEventToastText(chainEvents, 'en');
    expect(toast).toContain('2 sites');
    expect(toast).toContain('chain infection/falls aggregated');
    expect(toast).not.toContain('chain-a');
  });

  it('projects all checkpoint roles and branch fallback fields', () => {
    const state = JSON.parse(JSON.stringify(new GameEngine(1).getState())) as GameState;
    const branch = state.map.roadBranches[0]!;
    const branchState = state.roadBranches.find((candidate) => candidate.branchId === branch.id)!;
    const roadPosition = (index: number): { q: number; r: number } => ({ ...branch.roadTiles[index]! });
    const checkpoint = (id: string, status: CheckpointState['status'], q: number, r: number): CheckpointState => ({
      id,
      position: { q, r },
      direction: branch.direction,
      branchId: branch.id,
      status,
      waiting: 0,
      screening: 0,
      approved: 0,
      remainingTurns: 0,
      screeningPolicy: 'normal',
      nextArrivalTurn: null,
      infected: 0,
    });
    state.checkpoints = [
      checkpoint('cp-active', 'operational', roadPosition(5).q, roadPosition(5).r),
      checkpoint('cp-standby', 'operational', roadPosition(4).q, roadPosition(4).r),
      checkpoint('cp-dormant', 'operational', roadPosition(3).q, roadPosition(3).r),
      checkpoint('cp-remnant', 'remnant', roadPosition(2).q, roadPosition(2).r),
      checkpoint('cp-ruined', 'ruined', roadPosition(1).q, roadPosition(1).r),
      checkpoint('cp-abandoned', 'abandoned', roadPosition(0).q, roadPosition(0).r),
    ];
    branchState.activeCheckpointId = 'cp-active';
    branchState.standbyCheckpointIds = ['cp-standby'];
    branchState.currentPolicy = 'strict';

    expect(checkpointRoleFor(state, state.checkpoints[0]!)).toBe('active');
    expect(checkpointRoleFor(state, state.checkpoints[1]!)).toBe('standby');
    expect(checkpointRoleFor(state, state.checkpoints[2]!)).toBe('dormant');
    expect(checkpointRoleFor(state, state.checkpoints[3]!)).toBe('remnant');
    expect(checkpointRoleFor(state, state.checkpoints[4]!)).toBe('ruined');
    expect(checkpointRoleFor(state, state.checkpoints[5]!)).toBe('abandoned');

    const panel = branchPanelViewModel(state, branch.id)[0]!;
    expect(panel.activeCheckpointId).toBe('cp-active');
    expect(panel.standbyCheckpointIds).toEqual(['cp-standby']);
    expect(panel.dormantCheckpointIds).toEqual(['cp-dormant']);
    expect(panel.fallbackAvailable).toBe(true);
    expect(panel.currentPolicy).toBe('strict');
    expect(panel.preparedPostCount).toBe(2);
    expect(panel.preparedPostLimit).toBe(state.config.checkpoint.maxPreparedPostsPerDirection);
    const html = renderBranchPanel(state, 'en');
    expect(html).toContain('data-fallback-available="true"');
    expect(html).toContain('data-current-policy="strict"');
    expect(html).toContain('data-checkpoint-role="active"');
    expect(html).toContain('data-checkpoint-role="standby"');
    expect(html).toContain('data-checkpoint-role="dormant"');
  });

  it('keeps Noise Class public while isolating exact diagnostics to the debug helper', () => {
    expect(noiseClassForUnit('police')).toBe('medium');
    expect(noiseClassForUnit('nationalGuard')).toBe('large');
    expect(noiseClassForUnit('zombie')).toBeNull();
    const publicLog = renderNoiseEventLog({
      events: [{
        type: 'noise_emitted',
        payload: {
          sourceUnitId: 'police-1',
          sourceUnitType: 'police',
          noiseClass: 'medium',
          q: 2,
          r: 3,
          radius: 4,
          affectedNormalZombieIds: ['zombie-hidden'],
        },
      }],
    } as unknown as Pick<GameState, 'events'>, 'en');
    expect(publicLog).toContain('Medium');
    expect(publicLog).toContain('Police');
    expect(publicLog).toContain('2,3');
    expect(publicLog).not.toContain('zombie-hidden');
    expect(publicLog).not.toContain('Exact Radius');
    expect(renderNoiseEventLog({ events: [{ type: 'noise_emitted', payload: {} }] } as unknown as Pick<GameState, 'events'>, 'en', 0)).toBe('');
    const debug = renderNoiseDebugOverlay({
      center: { q: 2, r: 3 },
      radius: 4,
      radiusHexes: [{ q: 2, r: 3 }],
      affectedNormalZombieIds: ['zombie-hidden'],
      noiseTargets: [{ zombieId: 'zombie-hidden', target: { q: 2, r: 4 } }],
    }, 'en');
    expect(debug).toContain('4');
    expect(debug).toContain('zombie-hidden');
    const debugState = structuredClone(new GameEngine(99).getState());
    const hiddenZombie = debugState.units.find((unit) => unit.type === 'zombie')!;
    hiddenZombie.noiseTarget = { q: 2, r: 3 };
    debugState.events.push(
      { id: 'noise-public', turn: 1, phase: 'player', type: 'noise_emitted', payload: { sourceUnitId: 'police-1', sourceUnitType: 'police', q: 2, r: 3, noiseClass: 'medium' } },
      { id: 'noise-private', turn: 1, phase: 'player', type: 'noise_targeted', payload: { sourceUnitId: 'police-1', q: 2, r: 3, radius: 4, affectedZombieIds: [hiddenZombie.id] } },
    );
    expect(deriveDevelopmentNoiseDebug(debugState)).toMatchObject({
      center: { q: 2, r: 3 },
      radius: 4,
      affectedNormalZombieIds: [hiddenZombie.id],
      noiseTargets: expect.arrayContaining([{ zombieId: hiddenZombie.id, target: { q: 2, r: 3 } }]),
    });
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

  it('localizes v1.4.4 refugee and decommission action errors', () => {
    expect(localizeActionError('checkpoint_not_eligible_for_turn_away', 'ja')).toContain('Active');
    expect(localizeActionError('invalid_refugee_turn_away_count', 'en')).toContain('Waiting');
    expect(localizeActionError('facility_not_decommissionable', 'ja')).toContain('Civilian Drone Base');
    expect(localizeActionError('facility_zombie_occupied', 'en')).toContain('Zombie');
  });

  it('uses Core checkpoint candidates directly and localizes their reason without mutating input', () => {
    const candidates: CheckpointPositionCandidate[] = [
      { actionType: 'BuildCheckpoint', branchId: 'north', position: { q: 7, r: 4 }, legal: true, reasonCode: null, civilianGoodsCost: 5 },
      { actionType: 'RelocateCheckpoint', branchId: 'east', checkpointId: 'checkpoint-east', position: { q: 10, r: 7 }, legal: false, reasonCode: 'checkpoint_infection_blocked', civilianGoodsCost: 25 },
      { actionType: 'ActivateCheckpoint', branchId: 'east', checkpointId: 'checkpoint-east-2', position: { q: 9, r: 7 }, legal: true, reasonCode: null, civilianGoodsCost: 0 },
    ];
    const before = JSON.stringify(candidates);
    const views = checkpointCandidateViewModels(candidates, 'en');
    expect(views[0]!.reason).toBeNull();
    expect(views[1]!.reason).toContain('infect');
    expect(actionForCheckpointCandidate(candidates[0]!)).toEqual({ type: 'BuildCheckpoint', branchId: 'north', position: { q: 7, r: 4 } });
    expect(actionForCheckpointCandidate(candidates[1]!)).toEqual({ type: 'RelocateCheckpoint', checkpointId: 'checkpoint-east', branchId: 'east', position: { q: 10, r: 7 } });
    expect(actionForCheckpointCandidate(candidates[2]!)).toEqual({ type: 'ActivateCheckpoint', branchId: 'east', checkpointId: 'checkpoint-east-2' });
    expect(JSON.stringify(candidates)).toBe(before);
  });

  it('localizes every checkpoint candidate reason in both languages', () => {
    const codes = [
      'invalid_checkpoint_tile', 'invalid_checkpoint_branch', 'unknown_road_branch',
      'checkpoint_requires_relocation', 'unknown_operational_checkpoint', 'checkpoint_same_position',
      'checkpoint_wrong_branch', 'checkpoint_infection_blocked', 'checkpoint_branch_action_limit',
      'checkpoint_abandoned_forward_block', 'checkpoint_supply_zombie_blocked',
      'checkpoint_prepared_post_limit_reached', 'checkpoint_standby_requires_rear_position', 'checkpoint_not_activatable',
      'insufficient_civilian_goods', 'action_limit', 'wrong_phase', 'game_over',
    ];
    for (const code of codes) {
      expect(localizeActionError(code, 'ja')).not.toBe(createTranslator('ja')('invalidAction'));
      expect(localizeActionError(code, 'en')).not.toBe(createTranslator('en')('invalidAction'));
    }
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

  it('renders v1.4.1 carried Military Goods, attack, and Emergency Movement facts bilingually', () => {
    const state = new GameEngine(141).getState();
    const unit = createAgentObservation(state).units.find((candidate) => candidate.type === 'nationalGuard')!;
    for (const locale of ['ja', 'en'] as const) {
      const details = renderUnitMilitaryGoodsDetails(unit, locale, state.config.units.nationalGuard.militaryGoodsShortageAttackMultiplier);
      expect(details).toContain('data-unit-military-goods="true"');
      expect(details).toContain(`${unit.currentMilitaryGoods}/${unit.maxMilitaryGoods}`);
      expect(details).toContain(String(unit.emergencyMovementPoints));
      expect(details).toContain(createTranslator(locale)('unitStoresLostOnDestruction'));
      expect(details).toContain(createTranslator(locale)('guardRangeTwoMilitaryGoodsRule'));

      const attack = renderAttackPreview({
        targetUnitId: 'zombie-visible',
        distance: 1,
        militaryGoodsCost: 0,
        projectedMilitaryGoodsAfterAttack: 0,
        effectiveAttack: 1,
        projectedDamageBeforeTerrain: 1,
        projectedDamageAfterTerrain: 1,
      }, locale, 5);
      expect(attack).toContain(createTranslator(locale)('damageBeforeTerrain'));
      expect(attack).toContain(createTranslator(locale)('damageAfterTerrain'));
      expect(attack).toContain(createTranslator(locale)('militaryGoodsWeakAttackWarning'));
    }
  });

  it('renders the new Military Goods forecast totals and per-Unit sequence', () => {
    const forecast = forecastEndTurn(new GameEngine(142).getState()).militaryGoods;
    const html = renderMilitaryGoodsForecast(forecast, 'en');
    expect(html).toContain('data-forecast-resource="militaryGoods"');
    expect(html).toContain('Unfilled refill demand');
    expect(html).toContain('After suppression');
    expect(html).toContain('data-military-unit=');
    expect(html).not.toContain('Maintenance required');
  });

  it('has bilingual recovery, carried logistics, Emergency Movement, production, power, and policy help', () => {
    const keys = [
      'tipRecovery', 'tipSuppression', 'tipRange', 'tipProduction', 'tipPolicy',
      'tipMilitaryGoods', 'tipEmergencyMovement', 'carriedMilitaryGoods', 'emergencyMovement',
      'tipPower', 'tipPowerAllocation', 'tipProductionTiming', 'recoveryTiming', 'effectiveRange', 'projectedSuppression', 'powerRequirement', 'projectedPower', 'lastPowerSupplied', 'productionMultiplier', 'policyTradeoff', 'migratedSaveNotice', 'migrationSaveError',
      'tipRefugeeRejection', 'tipFinalArrivalStop', 'tipCheckpointQueueMaintenance', 'tipDecommission',
    ];
    for (const key of keys) {
      expect(createTranslator('ja')(key)).not.toBe(key);
      expect(createTranslator('en')(key)).not.toBe(key);
    }
  });

  it('has bilingual terrain, visibility, Horde, and victory labels', () => {
    const keys = [
      'finalWaveTurn', 'finalHordeWarning', 'spawnTurn', 'hordeStatusNotStarted', 'hordeSchedule', 'nextWave', 'directionCount', 'directions', 'composition', 'finalWave',
      'terrain', 'baseTerrain', 'terrainPlain', 'terrainForest', 'terrainMountain', 'terrainWater',
      'roadOverlay', 'urbanOverlay', 'effectiveMovementCost', 'defenseSource', 'damageMultiplier',
      'vision', 'visible', 'hidden', 'visionMode', 'visionGround', 'visionAerial', 'terrainLosBlocking', 'visionGroundRule', 'visionAerialRule', 'victoryProgress', 'finalHordeDefeated',
      'suppliedAreaZombieClear', 'suppliedAreaInfectionClear', 'tipTerrain', 'tipVision', 'tipInfectionEvents', 'tipHorde', 'tipVictory',
      'finalHordeSpawned', 'finalHordeKilled', 'normalZombiesKilled', 'hordeZombiesKilled', 'victoryTurn',
    ];
    for (const key of keys) {
      expect(createTranslator('ja')(key)).not.toBe(key);
      expect(createTranslator('en')(key)).not.toBe(key);
    }
    expect(createTranslator('ja')('finalWaveTurn')).toContain('Final Wave');
    expect(createTranslator('en')('finalHordeWarning')).toContain('FINAL HORDE');
  });

  it('has bilingual mixed-Horde composition and checkpoint explainability labels', () => {
    const keys = [
      'fixedHordeScheduleHint', 'hordeWarningLeadTurns', 'spawnReserve', 'spawnReserveReason',
      'screeningCapacity', 'screeningThroughput', 'checkpointCapacityRule', 'checkpointCandidateHint', 'newGameError',
    ];
    for (const key of keys) {
      expect(createTranslator('ja')(key)).not.toBe(key);
      expect(createTranslator('en')(key)).not.toBe(key);
    }
  });

  it('has bilingual fallback, activation, and Noise labels', () => {
    const keys = [
      'branchPanel', 'branchRoleLimit', 'activeCheckpoint', 'standbyCheckpoint', 'dormantCheckpoint',
      'fallbackAvailable', 'fallbackUnavailable', 'preparedPostCount', 'checkpointRole',
      'checkpointRole.active', 'checkpointRole.standby', 'checkpointRole.dormant',
      'checkpointRole.remnant', 'checkpointRole.ruined', 'checkpointRole.abandoned',
      'activateCheckpoint', 'activateCheckpointHint', 'branchPolicy', 'buildCandidate',
      'relocateCandidate', 'sameHexActions', 'tipCheckpointFallback', 'noise', 'noiseClass',
      'noiseClassMedium', 'noiseClassLarge', 'noiseCombatHint', 'noiseLog', 'noiseEmitted', 'noiseCenter', 'importantEventHistory', 'importantEventHistoryHint', 'importantEventToastPrefix', 'importantEventInfectionStarted', 'importantEventSiteFallen', 'importantEventChainFallen', 'importantEventZombiesSpawned', 'importantEventImmediateInfection', 'importantEventNoiseRespawn', 'infectedAmount', 'infectedAtFall', 'spawnCount', 'remainingInfected', 'remainingHealthy', 'constructibleInfectedDeaths', 'chainRoot', 'eventCause', 'eventCauseLatentInfection', 'eventCauseInfectionFall', 'eventCauseZombieOccupation', 'eventCauseEmptyZombieOccupation', 'eventCauseSpawnOccupation', 'eventCauseCombatNoise', 'tipNoise',
      'checkpointPreparedPostLimitReached', 'checkpointStandbyRequiresRearPosition', 'checkpointNotActivatable',
    ];
    for (const key of keys) {
      expect(createTranslator('ja')(key)).not.toBe(key);
      expect(createTranslator('en')(key)).not.toBe(key);
    }
  });

  it('has bilingual explicit action-mode labels', () => {
    const keys = [
      'unitActions', 'moveMode', 'attackMode', 'confirmMove', 'confirmAttack',
      'cancelTarget', 'cancelActionMode', 'clearSelection', 'selectUnitAction',
      'selectAttackTarget', 'confirmTargetNearby',
    ];
    for (const key of keys) {
      expect(createTranslator('ja')(key)).not.toBe(key);
      expect(createTranslator('en')(key)).not.toBe(key);
    }
  });

  it('formats the power HUD as projected demand over available supply', () => {
    const electricity = {
      physicalGenerationCapacity: 40,
      fuelLimitedGenerationCapacity: 20,
      availableGenerationCapacity: 20,
      requiredPowerDemand: 10,
      requiredPowerAllocated: 10,
      unpoweredFacilities: [],
      capacity: 20,
      required: 10,
      shortage: 3,
    } as const;
    const japanese = powerHudViewModel(electricity, 'ja');
    const english = powerHudViewModel(electricity, 'en');
    expect(japanese.display).toBe('10/20');
    expect(english.display).toBe('10/20');
    expect(japanese.isShortage).toBe(true);
    expect(japanese.tooltip).toContain('予測需要量: 10');
    expect(japanese.tooltip).toContain('不足: 3');
    expect(english.accessibleName).toContain('Projected demand 10');
  });

  it('keeps a zero-demand, zero-supply power HUD safe and uses Core shortage only', () => {
    const electricity = {
      physicalGenerationCapacity: 0,
      fuelLimitedGenerationCapacity: 0,
      availableGenerationCapacity: 0,
      requiredPowerDemand: 0,
      requiredPowerAllocated: 0,
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
    expect(english).toContain('Capital Ground Vision');
    expect(english).toContain('Ground Vision blocking Terrain');
    expect(english).toContain('Aerial Vision');
    expect(english).toContain('One Normal Zombie is requested per 5 infected people');
    expect(english).toContain('Wave 1');
    expect(english).toContain('Spawn Reserve');
    expect(english).toContain('Subsequent checkpoint construction Civilian Goods');
    expect(english).toContain('Checkpoint relocation Civilian Goods');
    expect(english).toContain('Screening Batch Capacity');
    expect(english).not.toContain('Industrial boost');
    expect(english).toContain('Mixed-Horde members');
    expect(english).toContain('HP 20');
    expect(english).toContain('Police Zombie');
    expect(english).toContain('Soldier Zombie');
    expect(english).toContain('0 / 3 / 6 / 9 / 12 / 15');
    expect(english).toContain('unit.policeZombie');
    const registryLegend = renderBoardLegend(null, 'en', ASSET_REGISTRY);
    expect(registryLegend).toContain('/assets/board/terrain/terrain_plain.png');
    expect(registryLegend).toContain('/assets/board/units/unit_police_zombie.png');
    expect(registryLegend).toContain('/assets/board/units/unit_soldier_zombie.png');
  });
});
