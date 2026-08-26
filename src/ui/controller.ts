import { createDefaultConfig } from '../core/config';
import { forecastEndTurn, validateAction } from '../core/engine';
import Phaser from 'phaser';
import type {
  CardinalDirection,
  CheckpointPolicy,
  CheckpointState,
  FacilityState,
  GameAction,
  GameConfig,
  GamePhase,
  GameResult,
  GameState,
  HeadlessGame,
  HexCoord,
  UnitState,
} from '../core/types';
import {
  actionForCheckpointPolicy,
  actionForPopulationTransfer,
  actionForUnitProduction,
  actionForWorkerAssignment,
  clampInteger,
  findCheckpointAt,
  findFacilityAt,
  findUnit,
  findUnitAt,
  isLegalAction,
  legalActionsForUnit,
  legalAttackTargets,
  legalMoveDestinations,
  populationLocationTotals,
  projectCityTransfer,
  workerAssignmentBounds,
} from './actions';
import { createBoardGame, type BoardRenderState, type HexBoardScene } from './board';
import {
  createTranslator,
  getInitialLocale,
  persistLocale,
  toggleLocale,
  type Locale,
} from './i18n';
import {
  AutoSaveStore,
  decodeSaveCode,
  encodeSaveCode,
  exportSaveJson,
  importSaveJson,
} from '../persistence/save';

export interface MovePreview {
  path: HexCoord[];
  destination: HexCoord;
  interceptionRisk?: number | string;
  firstInterception?: HexCoord | null;
  [key: string]: unknown;
}

/** Narrow adapter expected from src/core/engine.ts. */
export interface UiGameEngine extends HeadlessGame {
  previewMove?: (unitId: string, destination: HexCoord) => MovePreview | unknown;
}

export type EngineFactory = () => UiGameEngine;

type Screen = 'title' | 'game';
type SheetState = 'collapsed' | 'standard' | 'expanded';
export type NavigationMode = 'map' | 'domestic';
export type Selection =
  | { kind: 'unit'; id: string }
  | { kind: 'facility'; id: string }
  | { kind: 'checkpoint'; id: string }
  | null;

/**
 * Resolve a tapped tile according to the active navigation mode.
 *
 * This is deliberately a pure view concern. It never changes GameState and
 * it keeps the map-mode priority (player unit, then facility/checkpoint)
 * separate from the domestic-mode priority (facility/checkpoint only).
 */
export function resolveTileSelection(
  state: Readonly<GameState>,
  position: HexCoord,
  mode: NavigationMode,
): Selection {
  const facility = findFacilityAt(state, position);
  const checkpoint = findCheckpointAt(state, position);
  if (mode === 'domestic') {
    if (facility) return { kind: 'facility', id: facility.id };
    return checkpoint ? { kind: 'checkpoint', id: checkpoint.id } : null;
  }

  const unit = state.units.find(
    (candidate) => candidate.actionState !== 'destroyed' && candidate.isPlayerUnit &&
      candidate.position.q === position.q && candidate.position.r === position.r,
  );
  if (unit) return { kind: 'unit', id: unit.id };
  if (facility) return { kind: 'facility', id: facility.id };
  return checkpoint ? { kind: 'checkpoint', id: checkpoint.id } : null;
}

function unselectedPrompt(mode: NavigationMode, locale: Locale): string {
  const t = createTranslator(locale);
  if (mode === 'domestic') return locale === 'ja' ? '施設を選択してください' : 'Select a facility';
  return t('selectUnit');
}

const PHASE_LABELS: Record<GamePhase, [string, string]> = {
  player: ['行動', 'Player'],
  economy: ['経済', 'Economy'],
  refugees: ['避難民', 'Refugees'],
  infection: ['感染', 'Infection'],
  zombie: ['ゾンビ', 'Zombies'],
  horde: ['Horde', 'Horde'],
  gameOver: ['終了', 'Game over'],
};

export interface PhaseIndicatorViewModel {
  phase: GamePhase;
  shortLabel: string;
  label: string;
}

/**
 * Keep the serialized phase value separate from the decorative dot's
 * presentation. The localized short label is rendered beside the dot so a
 * phase never becomes visible text inside the compact HUD indicator.
 */
export function phaseIndicatorViewModel(phase: GamePhase, locale: Locale): PhaseIndicatorViewModel {
  const translator = createTranslator(locale);
  const shortLabel = PHASE_LABELS[phase][locale === 'ja' ? 0 : 1];
  return {
    phase,
    shortLabel,
    label: `${translator('phase')}: ${shortLabel}`,
  };
}

export function loadValidationError(
  result: { valid: boolean; errors: readonly string[] },
  fallback: string,
): string | null {
  return result.valid ? null : result.errors[0] ?? fallback;
}

function isLegacySaveError(message: string): boolean {
  return /version|v1\.0|legacy|旧|互換/iu.test(message);
}

const SHEET_ORDER: SheetState[] = ['collapsed', 'standard', 'expanded'];

function sheetStateLabel(state: SheetState, locale: Locale): string {
  const t = createTranslator(locale);
  if (state === 'collapsed') return t('collapsed');
  if (state === 'expanded') return t('expanded');
  return t('standard');
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function numberValue(value: string | null | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formatDirection(direction: CardinalDirection, locale: Locale): string {
  if (locale === 'en') return direction;
  return ({ north: '北', east: '東', south: '南', west: '西' } as Record<CardinalDirection, string>)[direction];
}

function facilityLabel(type: string, locale: Locale): string {
  const names: Record<string, [string, string]> = {
    capital: ['州都', 'Capital'],
    city: ['地方都市', 'City'],
    farm: ['農場', 'Farm'],
    civilianFactory: ['民需工場', 'Civilian Factory'],
    militaryFactory: ['軍需工場', 'Military Factory'],
    refinery: ['製油所', 'Refinery'],
    powerPlant: ['発電所', 'Power Plant'],
  };
  return names[type]?.[locale === 'ja' ? 0 : 1] ?? type;
}

function unitLabel(type: UnitState['type'], locale: Locale): string {
  const names: Record<UnitState['type'], [string, string]> = {
    police: ['警察', 'Police'],
    nationalGuard: ['州兵', 'National Guard'],
    zombie: ['ゾンビ', 'Zombie'],
  };
  return names[type][locale === 'ja' ? 0 : 1];
}

function isCity(facility: Pick<FacilityState, 'type'>): boolean {
  return facility.type === 'capital' || facility.type === 'city';
}

function formatPercent(value: number, locale: Locale): string {
  return new Intl.NumberFormat(locale === 'ja' ? 'ja-JP' : 'en-US', {
    style: 'percent',
    maximumFractionDigits: 1,
  }).format(Math.max(0, value));
}

function localizeActionError(code: string | undefined, locale: Locale): string {
  const t = createTranslator(locale);
  const messages: Record<string, string> = {
    facility_not_yet_operational: t('facilityNotReady'),
    infected_facility: locale === 'ja' ? '感染中の施設では人口を変更できません。' : 'Population cannot be changed in an infected facility.',
    invalid_facility: locale === 'ja' ? '所有中の生産施設だけが対象です。' : 'Only an owned production facility can be changed.',
    invalid_workers: locale === 'ja' ? '労働者数が上限の範囲外です。' : 'Worker count is outside the facility capacity.',
    insufficient_city_population: locale === 'ja' ? '利用可能な都市住民が不足しています。' : 'Eligible city residents are insufficient.',
    no_safe_return_city: t('noSafeCity'),
    ineligible_city: locale === 'ja' ? '安全で操作可能な都市だけを選択してください。' : 'Both cities must be safe and eligible.',
    same_city: locale === 'ja' ? '移動元と移動先は別の都市にしてください。' : 'Choose two different cities.',
    invalid_population: locale === 'ja' ? '人数は1以上の整数で指定してください。' : 'People must be a positive integer.',
    no_change: t('noChangeAction'),
    wrong_phase: locale === 'ja' ? '現在はプレイヤーターンではありません。' : 'It is not the player turn.',
    action_limit: locale === 'ja' ? 'このターンのAction上限に達しています。' : 'The action limit for this turn has been reached.',
    game_over: locale === 'ja' ? 'ゲームは終了しています。' : 'The game is over.',
    invalid_target: locale === 'ja' ? '攻撃対象が合法ではありません。' : 'The attack target is not legal.',
    attack_not_legal: locale === 'ja' ? '射程外または攻撃権がありません。' : 'The target is out of range or this unit cannot attack.',
    cannot_wait: locale === 'ja' ? 'このユニットは待機できません。' : 'This unit cannot wait.',
    suppression_not_legal: locale === 'ja' ? '感染施設に駐留する人間ユニットが必要です。' : 'A human unit must be stationed at the infected facility.',
    invalid_checkpoint_tile: locale === 'ja' ? '空いている道路タイルが必要です。' : 'An empty road tile is required.',
    police_required: locale === 'ja' ? '行動権のある警察が必要です。' : 'A police unit with an available action is required.',
    checkpoint_limit: locale === 'ja' ? 'この方面には既に検問所があります。' : 'This approach already has a checkpoint.',
    ambiguous_direction: locale === 'ja' ? 'この道路タイルの方面を判定できません。' : 'The road tile does not belong to one cardinal approach.',
    unknown_checkpoint: locale === 'ja' ? '稼働中の検問所を選択してください。' : 'Select an operational checkpoint.',
    invalid_policy: locale === 'ja' ? '審査方針が不正です。' : 'The screening policy is invalid.',
    insufficient_civilian_goods: locale === 'ja' ? '民需品が不足しています。' : 'Civilian goods are insufficient.',
    insufficient_military_goods: locale === 'ja' ? '軍需品が不足しています。' : 'Military goods are insufficient.',
    invalid_unit_type: locale === 'ja' ? 'このユニットは編成できません。' : 'This unit type cannot be produced.',
    invalid_recruitment_hub: locale === 'ja' ? '警察は都市、州兵は操作可能な州都でのみ編成できます。' : 'Police require an eligible city; National Guard requires the eligible capital.',
    insufficient_production_cost: locale === 'ja' ? '都市住民または資源が不足しています。最後の健全民間人口を使う編成もできません。' : 'Eligible city residents or supplies are insufficient; recruitment cannot use the last healthy civilian.',
    city_busy: locale === 'ja' ? 'この都市には既に編成予約があります。' : 'This city already has a recruitment reservation.',
    no_production_city: locale === 'ja' ? '編成できる都市がありません。' : 'No eligible city can produce this unit.',
    no_change_policy: locale === 'ja' ? '審査方針は変更されていません。' : 'The screening policy is unchanged.',
  };
  return messages[code ?? ''] ?? t('invalidAction');
}

function actionReasonFor(state: Readonly<GameState>, action: GameAction, locale: Locale): string | null {
  try {
    const error = validateAction(state, action);
    return error ? localizeActionError(error.code, locale) : null;
  } catch {
    return null;
  }
}

function gameOverReasonLabel(reason: GameResult['reason'], locale: Locale): string {
  const t = createTranslator(locale);
  const labels: Record<string, string> = {
    capitalLost: locale === 'ja' ? '州都が陥落しました' : 'The capital fell',
    healthyCiviliansLost: locale === 'ja' ? '健全民間人口がなくなりました' : 'No healthy civilian population remains',
    maxTurnsSurvived: t('victory'),
    abandoned: locale === 'ja' ? '放棄しました' : 'Abandoned',
    error: locale === 'ja' ? '内部エラー' : 'Internal error',
  };
  return labels[reason] ?? reason;
}

function stateSummary(state: Readonly<GameState>, locale: Locale): string {
  const t = createTranslator(locale);
  const population = populationLocationTotals(state);
  return `${t('population')} ${population.total} · ${t('healthyCivilians')} ${population.healthyCivilians} · ${t('facilities')} ${state.facilities.filter((facility) => facility.owner === 'player' && facility.status === 'owned').length}/16`;
}

function asPreview(value: unknown, fallback: { unit: UnitState; destination: HexCoord }): MovePreview {
  if (value && typeof value === 'object') {
    const candidate = value as Partial<MovePreview>;
    if (Array.isArray(candidate.path) && candidate.path.length > 0) {
      const interception = candidate.interception;
      return {
        ...candidate,
        path: candidate.path as HexCoord[],
        destination: candidate.destination ?? fallback.destination,
        interceptionRisk: candidate.interceptionRisk ?? (interception ? 'high' : 'low'),
      };
    }
  }
  return { path: [fallback.unit.position, fallback.destination], destination: fallback.destination, interceptionRisk: 'unknown' };
}

export class GameUiController {
  private readonly root: HTMLElement;
  private readonly createEngine: EngineFactory;
  private readonly store: AutoSaveStore;
  private noticeTimer: ReturnType<typeof setTimeout> | null = null;
  private locale: Locale = getInitialLocale();
  private screen: Screen = 'title';
  private sheetState: SheetState = 'standard';
  private navMode: NavigationMode = 'map';
  private engine: UiGameEngine | null = null;
  private state: Readonly<GameState> | null = null;
  private boardGame: Phaser.Game | null = null;
  private boardScene: HexBoardScene | null = null;
  private selection: Selection = null;
  private pendingMove: MovePreview | null = null;
  private lastSaveCode: string | null = null;
  private toastMessage: string | null = null;
  private guideShown = false;
  private sheetPointerY: number | null = null;
  private sheetDragged = false;

  constructor(root: HTMLElement, createEngine: EngineFactory) {
    this.root = root;
    this.createEngine = createEngine;
    this.store = new AutoSaveStore({ onError: (message: string) => this.showToast(message) });
  }

  mount(): void {
    this.showTitle();
  }

  private translator(): (key: string, fallback?: string) => string {
    return createTranslator(this.locale);
  }

  private showTitle(): void {
    this.screen = 'title';
    this.state = null;
    this.engine = null;
    this.selection = null;
    this.pendingMove = null;
    this.destroyBoard();
    const t = this.translator();
    const canContinue = this.store.hasSave();
    this.root.className = 'app-shell title-screen';
    this.root.innerHTML = `
      <main class="title-card" aria-labelledby="title-heading">
        <div class="title-mark" aria-hidden="true">◇</div>
        <p class="eyebrow">${escapeHtml(t('subtitle'))}</p>
        <h1 id="title-heading">${escapeHtml(t('title'))}</h1>
        <p class="title-copy">${escapeHtml(t('guideBody'))}</p>
        <div class="title-actions">
          <button class="primary-button large-button" data-action="new-game">${escapeHtml(t('start'))}</button>
          <button class="secondary-button large-button" data-action="continue" ${canContinue ? '' : 'disabled'}>${escapeHtml(t('continue'))}</button>
          <button class="ghost-button large-button" data-action="load">${escapeHtml(t('load'))}</button>
          <button class="ghost-button large-button" data-action="options">${escapeHtml(t('options'))}</button>
          <button class="ghost-button large-button" data-action="help">${escapeHtml(t('help'))}</button>
          <button class="text-button" data-action="toggle-language">${escapeHtml(t('language'))}</button>
        </div>
        <p class="title-status" aria-live="polite">${canContinue ? escapeHtml(t('saved')) : ''}</p>
      </main>`;
    this.bindRootEvents();
    this.renderToast();
  }

  private beginNewGame(): void {
    const t = this.translator();
    this.root.className = 'app-shell modal-screen';
    this.root.innerHTML = `
      <section class="modal-card" aria-labelledby="new-game-heading">
        <button class="icon-button modal-close" aria-label="${escapeHtml(t('back'))}" data-action="title">×</button>
        <p class="eyebrow">${escapeHtml(t('options'))}</p>
        <h2 id="new-game-heading">${escapeHtml(t('newGame'))}</h2>
        <form data-form="new-game" class="settings-form">
          <label>${escapeHtml(t('newSeed'))}<input name="seed" type="number" inputmode="numeric" value="${Date.now() % 2147483647}" /></label>
          <label>${escapeHtml(t('maxTurns'))}<input name="maxTurns" type="number" min="1" max="999" value="30" /></label>
          <label>${escapeHtml(t('hordeCycle'))}<input name="hordeCycle" type="number" min="1" value="5" /></label>
          <label>${escapeHtml(t('hordeInitial'))}<input name="hordeInitial" type="number" min="0" value="2" /></label>
          <label>${escapeHtml(t('hordeIncrement'))}<input name="hordeIncrement" type="number" min="0" value="2" /></label>
          <label>${escapeHtml(t('hordeWarningStart'))}<input name="hordeWarningStart" type="number" min="1" value="1" /></label>
          <label>${escapeHtml(t('refugeeIntervalMin'))}<input name="refugeeIntervalMin" type="number" min="1" value="2" /></label>
          <label>${escapeHtml(t('refugeeIntervalMax'))}<input name="refugeeIntervalMax" type="number" min="1" value="4" /></label>
          <label>${escapeHtml(t('refugeePeopleMin'))}<input name="refugeePeopleMin" type="number" min="1" value="5" /></label>
          <label>${escapeHtml(t('refugeePeopleMax'))}<input name="refugeePeopleMax" type="number" min="1" value="10" /></label>
          <label>${escapeHtml(t('screeningCapacity'))}<input name="screeningCapacity" type="number" min="1" value="10" /></label>
          <label>${escapeHtml(t('resourceMultiplier'))}<input name="resourceMultiplier" type="number" min="0.25" max="4" step="0.25" value="1" /></label>
          <label>${escapeHtml(t('infectionMultiplier'))}<input name="infectionMultiplier" type="number" min="0.25" max="4" step="0.25" value="1" /></label>
          <div class="modal-actions"><button class="primary-button" type="submit">${escapeHtml(t('start'))}</button><button class="ghost-button" type="button" data-action="title">${escapeHtml(t('cancel'))}</button></div>
        </form>
      </section>`;
    this.bindRootEvents();
    const form = this.root.querySelector<HTMLFormElement>('[data-form="new-game"]');
    form?.addEventListener('submit', (event) => {
      event.preventDefault();
      const values = new FormData(form);
      const refugeeIntervalMin = Math.max(1, Math.floor(numberValue(values.get('refugeeIntervalMin')?.toString(), 2)));
      const refugeeIntervalMax = Math.max(refugeeIntervalMin, Math.floor(numberValue(values.get('refugeeIntervalMax')?.toString(), 4)));
      const refugeePeopleMin = Math.max(1, Math.floor(numberValue(values.get('refugeePeopleMin')?.toString(), 5)));
      const refugeePeopleMax = Math.max(refugeePeopleMin, Math.floor(numberValue(values.get('refugeePeopleMax')?.toString(), 10)));
      const config = createDefaultConfig({
        maxTurns: Math.max(1, Math.floor(numberValue(values.get('maxTurns')?.toString(), 30))),
        horde: {
          cycle: Math.max(1, Math.floor(numberValue(values.get('hordeCycle')?.toString(), 5))),
          initialCount: Math.max(0, Math.floor(numberValue(values.get('hordeInitial')?.toString(), 2))),
          increment: Math.max(0, Math.floor(numberValue(values.get('hordeIncrement')?.toString(), 2))),
          warningStartTurn: Math.max(1, Math.floor(numberValue(values.get('hordeWarningStart')?.toString(), 1))),
        },
        refugees: {
          arrivalIntervalMin: refugeeIntervalMin,
          arrivalIntervalMax: refugeeIntervalMax,
          arrivalPeopleMin: refugeePeopleMin,
          arrivalPeopleMax: refugeePeopleMax,
          screeningCapacity: Math.max(1, Math.floor(numberValue(values.get('screeningCapacity')?.toString(), 10))),
        },
      });
      const resourceMultiplier = Math.min(4, Math.max(0.25, numberValue(values.get('resourceMultiplier')?.toString(), 1)));
      const infectionMultiplier = Math.min(4, Math.max(0.25, numberValue(values.get('infectionMultiplier')?.toString(), 1)));
      for (const resource of ['food', 'civilianGoods', 'militaryGoods', 'fuel'] as const) {
        config.economy.initialResources[resource] = Math.round(config.economy.initialResources[resource] * resourceMultiplier);
      }
      for (const facility of Object.values(config.facilities)) {
        for (const resource of Object.keys(facility.production.outputs) as Array<keyof typeof facility.production.outputs>) {
          const value = facility.production.outputs[resource];
          if (value !== undefined) facility.production.outputs[resource] = Math.max(0, Math.round(value * resourceMultiplier));
        }
      }
      config.infection.facilitySpreadPerTurn = Math.max(1, Math.round(config.infection.facilitySpreadPerTurn * infectionMultiplier));
      config.infection.fallBackInfectionRate = Math.min(1, config.infection.fallBackInfectionRate * infectionMultiplier);
      for (const policy of Object.values(config.refugees.policies)) {
        policy.infectionRate = Math.min(1, policy.infectionRate * infectionMultiplier);
        policy.infectionPopulationRate = Math.min(1, policy.infectionPopulationRate * infectionMultiplier);
      }
      const seed = Math.trunc(numberValue(values.get('seed')?.toString(), Date.now()));
      this.startGame(seed, config);
    });
  }

  private startGame(seed: number, config: GameConfig): void {
    try {
      this.engine = this.createEngine();
      this.state = this.engine.reset(seed, config);
      this.screen = 'game';
      this.sheetState = 'standard';
      this.navMode = 'map';
      this.selection = null;
      this.pendingMove = null;
      this.guideShown = !this.hasSeenGuide();
      this.renderGame();
      this.autosave();
      if (this.guideShown) this.showGuide();
    } catch (error) {
      this.showToast(`ゲームを開始できません: ${error instanceof Error ? error.message : String(error)}`);
      this.showTitle();
    }
  }

  private hasSeenGuide(): boolean {
    try {
      return globalThis.localStorage?.getItem('nowhere-left-to-hide:guide:v1') === 'seen';
    } catch {
      return false;
    }
  }

  private markGuideSeen(): void {
    try {
      globalThis.localStorage?.setItem('nowhere-left-to-hide:guide:v1', 'seen');
    } catch {
      // The guide can be shown again on the next visit if storage is blocked.
    }
  }

  private renderGame(): void {
    if (!this.state || !this.engine) return;
    const t = this.translator();
    const phaseIndicator = phaseIndicatorViewModel(this.state.phase, this.locale);
    this.root.className = 'app-shell game-screen';
    this.root.innerHTML = `
      <header class="top-hud">
        <div class="hud-brand"><span class="hud-glyph">◇</span><span>${escapeHtml(t('title'))}</span></div>
        <div class="hud-turn"><span data-bind="turn">—</span><small>${escapeHtml(t('turn'))}</small><span class="phase-dot" data-bind="phase" data-phase="${escapeHtml(phaseIndicator.phase)}" aria-hidden="true"></span><span class="phase-label" data-bind="phase-label" title="${escapeHtml(phaseIndicator.label)}">${escapeHtml(phaseIndicator.shortLabel)}</span></div>
        <div class="hud-pop"><span data-bind="population">—</span><small>${escapeHtml(t('population'))}</small></div>
        <button class="icon-button" aria-label="${escapeHtml(t('help'))}" data-action="help">?</button>
      </header>
      <section class="resource-strip" aria-label="${escapeHtml(t('resources'))}">
        <span class="resource-pill food-pill">◉ <b data-bind="food">0</b><small>${escapeHtml(t('food'))}</small></span>
        <span class="resource-pill civ-pill">▣ <b data-bind="civilianGoods">0</b><small>${escapeHtml(t('civilianGoods'))}</small></span>
        <span class="resource-pill mil-pill">✦ <b data-bind="militaryGoods">0</b><small>${escapeHtml(t('militaryGoods'))}</small></span>
        <span class="resource-pill fuel-pill">◌ <b data-bind="fuel">0</b><small>${escapeHtml(t('fuel'))}</small></span>
        <span class="resource-pill power-pill">⚡ <b data-bind="power">0/0</b><small>${escapeHtml(t('electricity'))}</small></span>
        <span class="resource-pill civilian-pill">♙ <b data-bind="healthy-civilians">0</b><small>${escapeHtml(t('healthyCivilians'))}</small></span>
        <span class="resource-pill infected-pill">☣ <b data-bind="infected">0</b><small>${escapeHtml(t('infected'))}</small></span>
      </section>
      <section class="horde-card" aria-live="polite"><div><strong>${escapeHtml(t('horde'))}</strong><span data-bind="horde-direction">—</span></div><b><span data-bind="horde-remaining">—</span> <small>${escapeHtml(t('remaining'))}</small></b></section>
      <main class="board-region"><div id="board-canvas" class="board-canvas" aria-label="${escapeHtml(t('map'))}"></div><div id="toast" class="toast" role="status" aria-live="polite"></div></main>
      <section class="bottom-sheet" data-sheet="standard" aria-label="${escapeHtml(t('selected'))}">
        <button class="sheet-handle" type="button" data-action="sheet-toggle"><span></span><span class="sr-only">${escapeHtml(t('selected'))}</span></button>
        <div class="sheet-header" data-action="sheet-toggle"><div><strong data-bind="selection-title">${escapeHtml(t('selectUnit'))}</strong><small data-bind="selection-summary">${escapeHtml(stateSummary(this.state, this.locale))}</small></div><span data-bind="sheet-state">${escapeHtml(sheetStateLabel(this.sheetState, this.locale))}</span></div>
        <div class="sheet-body" data-bind="sheet-body"></div>
      </section>
      <nav class="bottom-nav" aria-label="${escapeHtml(t('map'))}"><button data-nav="map" class="${this.navMode === 'map' ? 'active' : ''}" aria-current="${this.navMode === 'map' ? 'page' : 'false'}" aria-pressed="${this.navMode === 'map'}">▦<span>${escapeHtml(t('map'))}</span></button><button data-nav="domestic" class="${this.navMode === 'domestic' ? 'active' : ''}" aria-current="${this.navMode === 'domestic' ? 'page' : 'false'}" aria-pressed="${this.navMode === 'domestic'}">⌂<span>${escapeHtml(t('domestic'))}</span></button><button data-action="end-turn" class="nav-end">▶<span>${escapeHtml(t('endTurn'))}</span></button><button data-action="save">▤<span>${escapeHtml(t('saveCode'))}</span></button></nav>`;
    this.bindRootEvents();
    this.createBoard();
    this.updateView();
  }

  private createBoard(): void {
    const parent = this.root.querySelector<HTMLElement>('#board-canvas');
    if (!parent) return;
    this.destroyBoard();
    this.boardGame = createBoardGame(parent, { onTileTap: (position) => this.onTileTap(position) });
    const game = this.boardGame;
    const resolveScene = (): void => {
      const scene = game.scene.getScene('hex-board');
      if (scene instanceof Object && 'updateState' in scene) {
        this.boardScene = scene as HexBoardScene;
        this.updateBoard();
      }
    };
    game.events.once('ready', resolveScene);
    window.setTimeout(resolveScene, 100);
  }

  private destroyBoard(): void {
    this.boardScene = null;
    if (this.boardGame) {
      this.boardGame.destroy(true);
      this.boardGame = null;
    }
  }

  private bindRootEvents(): void {
    this.root.onclick = (event) => {
      const target = event.target as HTMLElement;
      const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
      const nav = target.closest<HTMLElement>('[data-nav]')?.dataset.nav;
      if (action && !(action === 'sheet-toggle' && this.sheetDragged)) this.onAction(action, target.closest<HTMLElement>('[data-action]') ?? target);
      this.sheetDragged = false;
      if (nav) this.onNav(nav);
    };
    this.root.onpointerdown = (event) => {
      if ((event.target as HTMLElement).closest('.sheet-handle')) {
        this.sheetPointerY = event.clientY;
        this.sheetDragged = false;
      }
    };
    this.root.onpointerup = (event) => {
      if (this.sheetPointerY === null) return;
      const delta = event.clientY - this.sheetPointerY;
      this.sheetPointerY = null;
      if (Math.abs(delta) < 20) return;
      const index = SHEET_ORDER.indexOf(this.sheetState);
      this.sheetState = SHEET_ORDER[Math.max(0, Math.min(SHEET_ORDER.length - 1, index + (delta < 0 ? 1 : -1)))]!;
      this.sheetDragged = true;
      this.updateView();
    };
    this.root.oninput = (event) => this.onInput(event);
    this.root.onchange = (event) => this.onInput(event);
  }

  private onAction(action: string, element: HTMLElement): void {
    switch (action) {
      case 'new-game': this.beginNewGame(); break;
      case 'continue': this.loadAutosave(); break;
      case 'load': this.showLoadModal(); break;
      case 'options': this.beginNewGame(); break;
      case 'toggle-language': this.locale = toggleLocale(this.locale); persistLocale(this.locale); this.screen === 'game' ? this.renderGame() : this.showTitle(); break;
      case 'title': this.showTitle(); break;
      case 'help': this.showHelp(); break;
      case 'sheet-toggle': this.toggleSheet(); break;
      case 'confirm-move': this.confirmMove(); break;
      case 'cancel-move': this.pendingMove = null; this.updateView(); break;
      case 'wait': this.waitSelected(); break;
      case 'suppress': this.suppressSelected(); break;
      case 'end-turn': this.endTurn(); break;
      case 'end-turn-confirm': this.dismissModal(); this.commitEndTurn(); break;
      case 'save': this.showSaveModal(); break;
      case 'copy-code': this.copySaveCode(element); break;
      case 'download-json': this.downloadJson(); break;
      case 'file-import': this.readJsonFile(element); break;
      case 'dismiss-modal': this.dismissModal(); break;
      case 'guide-close': this.markGuideSeen(); this.dismissModal(); break;
      case 'assign-workers': this.assignWorkers(); break;
      case 'transfer-population': this.transferPopulation(); break;
      case 'produce-police': this.produce('police'); break;
      case 'produce-guard': this.produce('nationalGuard'); break;
      case 'build-checkpoint': this.buildCheckpoint(); break;
      default: break;
    }
  }

  private onNav(nav: string): void {
    if (nav !== 'domestic' && nav !== 'map') return;
    const mode = nav as NavigationMode;
    const selected = this.selectedPosition();
    this.navMode = mode;
    this.pendingMove = null;
    if (this.state && selected) this.selection = resolveTileSelection(this.state, selected, mode);
    else if (mode === 'domestic' && this.selection?.kind === 'unit') this.selection = null;
    this.sheetState = mode === 'domestic' ? 'expanded' : 'standard';
    this.updateView();
  }

  private onInput(event: Event): void {
    const target = event.target as HTMLInputElement | HTMLSelectElement;
    if (target.dataset.action === 'file-import' && event.type === 'change') this.readJsonFile(target);
    if (target.dataset.workerControl === 'true') this.syncWorkerControls(target as HTMLInputElement, event.type === 'change');
    if (target.dataset.transferPeople === 'true') this.syncTransferControls(target as HTMLInputElement);
    if (target.dataset.transferTarget === 'true') this.updateTransferPreview();
    if (target.dataset.policy && event.type === 'change') this.setPolicy(target.dataset.policy, target.value as CheckpointPolicy);
  }

  private toggleSheet(): void {
    const index = SHEET_ORDER.indexOf(this.sheetState);
    this.sheetState = SHEET_ORDER[(index + 1) % SHEET_ORDER.length]!;
    this.updateView();
  }

  private updateView(): void {
    if (!this.state || !this.engine || this.screen !== 'game') return;
    this.updateHud();
    this.renderSheetBody();
    this.updateBoard();
    const sheet = this.root.querySelector<HTMLElement>('.bottom-sheet');
    sheet?.setAttribute('data-sheet', this.sheetState);
    const sheetState = this.root.querySelector<HTMLElement>('[data-bind="sheet-state"]');
    if (sheetState) sheetState.textContent = sheetStateLabel(this.sheetState, this.locale);
    this.updateNavigation();
    this.renderToast();
  }

  private updateNavigation(): void {
    this.root.querySelectorAll<HTMLButtonElement>('[data-nav]').forEach((button) => {
      const active = button.dataset.nav === this.navMode;
      button.classList.toggle('active', active);
      button.setAttribute('aria-current', active ? 'page' : 'false');
      button.setAttribute('aria-pressed', String(active));
    });
  }

  private updateHud(): void {
    if (!this.state) return;
    const population = populationLocationTotals(this.state);
    const hordeVisible = this.state.turn >= this.state.config.horde.warningStartTurn;
    const phaseIndicator = phaseIndicatorViewModel(this.state.phase, this.locale);
    const phaseDot = this.root.querySelector<HTMLElement>('[data-bind="phase"]');
    if (phaseDot) {
      phaseDot.dataset.phase = phaseIndicator.phase;
      phaseDot.textContent = '';
    }
    const phaseLabel = this.root.querySelector<HTMLElement>('[data-bind="phase-label"]');
    if (phaseLabel) {
      phaseLabel.textContent = phaseIndicator.shortLabel;
      phaseLabel.title = phaseIndicator.label;
    }
    const bindings: Record<string, string> = {
      turn: `${this.state.turn}/${this.state.maxTurns}`,
      population: String(population.total),
      food: String(this.state.resources.food),
      civilianGoods: String(this.state.resources.civilianGoods),
      militaryGoods: String(this.state.resources.militaryGoods),
      fuel: String(this.state.resources.fuel),
      power: `${this.state.resources.electricityCapacity}/${this.state.resources.electricityRequired}`,
      'horde-direction': hordeVisible ? formatDirection(this.state.horde.nextDirection, this.locale) : this.translator()('warningPending'),
      'horde-remaining': hordeVisible ? String(this.state.horde.turnsRemaining) : '—',
      'healthy-civilians': String(population.healthyCivilians),
      infected: String(population.infected),
    };
    for (const [key, value] of Object.entries(bindings)) {
      const element = this.root.querySelector<HTMLElement>(`[data-bind="${key}"]`);
      if (element) element.textContent = value;
    }
  }

  private updateBoard(): void {
    if (!this.state || !this.boardScene) return;
    const render: BoardRenderState = {
      state: this.state,
      selectedPosition: this.selectedPosition(),
      selectedUnitId: this.selection?.kind === 'unit' ? this.selection.id : null,
      legalDestinations: this.selectedUnitLegalMoves(),
      attackTargetIds: this.selectedUnitAttackTargets(),
      pendingPath: this.pendingMove?.path,
      hordeDirection: this.state.turn >= this.state.config.horde.warningStartTurn ? this.state.horde.nextDirection : undefined,
    };
    this.boardScene.updateState(render);
  }

  private selectedPosition(): HexCoord | null {
    if (!this.state || !this.selection) return null;
    if (this.selection.kind === 'unit') return findUnit(this.state, this.selection.id)?.position ?? null;
    if (this.selection.kind === 'facility') return this.state.facilities.find((facility) => facility.id === this.selection?.id)?.position ?? null;
    return this.state.checkpoints.find((checkpoint) => checkpoint.id === this.selection?.id)?.position ?? null;
  }

  private legalActions(): GameAction[] {
    try {
      return this.engine?.getLegalActions() ?? [];
    } catch {
      return [];
    }
  }

  private selectedUnitLegalMoves(): HexCoord[] {
    if (!this.selection || this.selection.kind !== 'unit') return [];
    return legalMoveDestinations(this.legalActions(), this.selection.id);
  }

  private selectedUnitAttackTargets(): string[] {
    if (!this.selection || this.selection.kind !== 'unit') return [];
    return legalAttackTargets(this.legalActions(), this.selection.id);
  }

  private onTileTap(position: HexCoord): void {
    if (!this.state || !this.engine) return;
    if (this.navMode === 'domestic') {
      this.pendingMove = null;
      this.selection = resolveTileSelection(this.state, position, this.navMode);
      this.updateView();
      return;
    }
    const unit = findUnitAt(this.state, position);
    if (this.pendingMove && this.selection?.kind === 'unit' && this.pendingMove.destination.q === position.q && this.pendingMove.destination.r === position.r) {
      this.updateView();
      return;
    }
    if (this.selection?.kind === 'unit') {
      const targets = this.selectedUnitAttackTargets();
      if (unit && targets.includes(unit.id)) {
        this.apply({ type: 'Attack', attackerId: this.selection.id, targetId: unit.id });
        return;
      }
      const move = this.selectedUnitLegalMoves().find((candidate) => candidate.q === position.q && candidate.r === position.r);
      if (move) {
        this.pendingMove = this.preview(this.selection.id, move);
        this.sheetState = 'standard';
        this.updateView();
        return;
      }
    }
    const resolved = resolveTileSelection(this.state, position, this.navMode);
    if (resolved) {
      this.selection = resolved;
      this.pendingMove = null;
      this.updateView();
    } else {
      this.selection = null;
      this.pendingMove = null;
      this.updateView();
    }
  }

  private preview(unitId: string, destination: HexCoord): MovePreview {
    const unit = this.state ? findUnit(this.state, unitId) : undefined;
    if (!unit) return { path: [destination], destination, interceptionRisk: 'unknown' };
    let result: unknown;
    try {
      result = this.engine?.previewMove?.(unitId, destination);
    } catch (error) {
      this.showToast(`プレビューを取得できません: ${error instanceof Error ? error.message : String(error)}`);
    }
    return asPreview(result, { unit, destination });
  }

  private confirmMove(): void {
    if (!this.pendingMove || !this.selection || this.selection.kind !== 'unit') return;
    const action: GameAction = { type: 'Move', unitId: this.selection.id, destination: this.pendingMove.destination };
    this.pendingMove = null;
    this.apply(action);
  }

  private waitSelected(): void {
    if (this.selection?.kind !== 'unit') return;
    this.apply({ type: 'Wait', unitId: this.selection.id });
  }

  private suppressSelected(): void {
    if (!this.selection || this.selection.kind !== 'unit' || !this.state) return;
    const unit = findUnit(this.state, this.selection.id);
    if (!unit) return;
    const facility = this.state.facilities.find((candidate) => candidate.position.q === unit.position.q && candidate.position.r === unit.position.r && candidate.infected > 0);
    if (!facility) return;
    this.apply({ type: 'SuppressInfection', unitId: unit.id, facilityId: facility.id });
  }

  private endTurn(): void {
    if (!this.state) return;
    const forecast = forecastEndTurn(this.state);
    const shortages = [
      ['food', forecast.food.shortage],
      ['civilianGoods', forecast.civilianGoods.shortage],
      ['militaryGoods', forecast.militaryGoods.shortage],
      ['fuel', forecast.fuel.shortage],
      ['electricity', forecast.electricity.shortage],
    ] as const;
    const projected = shortages.filter(([, amount]) => amount > 0);
    if (projected.length > 0) {
      const t = this.translator();
      const details = projected
        .map(([resource, amount]) => `<li>${escapeHtml(t(resource))}: <b>${amount}</b></li>`)
        .join('');
      const overcrowding = forecast.overcrowding;
      const crowdDetails = overcrowding.cities.length > 0
        ? `<p class="muted">${escapeHtml(t('overcrowding'))}: ${escapeHtml(formatPercent(overcrowding.cities.reduce((total, city) => total + city.excess / Math.max(1, city.softCap), 0), this.locale))} · ${escapeHtml(t('additionalFood'))} ${overcrowding.additionalFood} · ${escapeHtml(t('additionalCivilianGoods'))} ${overcrowding.additionalCivilianGoods}</p>`
        : '';
      this.root.insertAdjacentHTML('beforeend', `<div class="modal-backdrop" data-modal="shortage"><section class="modal-card floating-card" aria-labelledby="shortage-heading"><h2 id="shortage-heading">${escapeHtml(t('shortageWarning'))}</h2><p>${escapeHtml(t('shortageWarningBody'))}</p>${crowdDetails}<ul class="warning-list">${details}</ul><div class="modal-actions"><button class="primary-button" data-action="end-turn-confirm">${escapeHtml(t('proceedAnyway'))}</button><button class="ghost-button" data-action="dismiss-modal">${escapeHtml(t('back'))}</button></div></section></div>`);
      return;
    }
    this.commitEndTurn();
  }

  private commitEndTurn(): void {
    const result = this.apply({ type: 'EndTurn' });
    if (result && this.state?.gameOver) this.showStatistics(this.state.result);
  }

  private assignWorkers(): void {
    if (!this.selection || this.selection.kind !== 'facility' || !this.state) return;
    const input = this.root.querySelector<HTMLInputElement>('[data-worker-number="true"]');
    const facility = this.state.facilities.find((candidate) => candidate.id === this.selection?.id);
    if (!input || !facility) return;
    const bounds = workerAssignmentBounds(this.state, facility);
    const workers = clampInteger(input.value, bounds.minimum, bounds.maximum, bounds.current);
    const requested: Extract<GameAction, { type: 'AssignWorkers' }> = {
      type: 'AssignWorkers',
      facilityId: facility.id,
      workers,
    };
    const action = actionForWorkerAssignment(this.legalActions(), facility.id, workers) ?? requested;
    const reason = actionReasonFor(this.state, action, this.locale);
    if (reason) {
      this.showToast(reason);
      this.updateWorkerControlReason(reason);
      return;
    }
    this.apply(action);
  }

  private syncWorkerControls(source: HTMLInputElement, commit: boolean): void {
    if (!this.state || !this.selection || this.selection.kind !== 'facility') return;
    const facility = this.state.facilities.find((candidate) => candidate.id === this.selection?.id);
    if (!facility || isCity(facility)) {
      // A city editor is handled by transfer controls; production facilities
      // are the only facilities whose worker controls are rendered here.
      return;
    }
    if (isCity(facility)) return;
    const bounds = workerAssignmentBounds(this.state, facility);
    const workers = clampInteger(source.value, bounds.minimum, bounds.maximum, bounds.current);
    const slider = this.root.querySelector<HTMLInputElement>('[data-worker-slider="true"]');
    const number = this.root.querySelector<HTMLInputElement>('[data-worker-number="true"]');
    if (slider) slider.value = String(workers);
    if (number) number.value = String(workers);
    const output = this.root.querySelector<HTMLOutputElement>('[data-worker-output="true"]');
    if (output) output.textContent = `${workers}/${bounds.maximum}`;
    const action: Extract<GameAction, { type: 'AssignWorkers' }> = { type: 'AssignWorkers', facilityId: facility.id, workers };
    const reason = actionReasonFor(this.state, action, this.locale);
    const button = this.root.querySelector<HTMLButtonElement>('[data-action="assign-workers"]');
    const changed = workers !== facility.workers;
    if (button) {
      button.disabled = !changed || Boolean(reason);
      button.title = reason ?? (changed ? '' : this.translator()('noChangeAction'));
    }
    this.updateWorkerControlReason(reason);
    if (commit && !reason) this.assignWorkers();
  }

  private updateWorkerControlReason(reason: string | null): void {
    const element = this.root.querySelector<HTMLElement>('[data-worker-reason="true"]');
    if (!element) return;
    element.hidden = !reason;
    element.textContent = reason ?? '';
  }

  private syncTransferControls(source: HTMLInputElement): void {
    if (!this.state) return;
    const from = this.selectedCity();
    if (!from) return;
    const max = Math.max(0, from.workers);
    const people = clampInteger(source.value, 0, max, 0);
    const slider = this.root.querySelector<HTMLInputElement>('[data-transfer-slider="true"]');
    const number = this.root.querySelector<HTMLInputElement>('[data-transfer-number="true"]');
    if (slider) slider.value = String(people);
    if (number) number.value = String(people);
    this.updateTransferPreview();
  }

  private selectedCity(): FacilityState | undefined {
    if (!this.state || !this.selection || this.selection.kind !== 'facility') return undefined;
    const facility = this.state.facilities.find((candidate) => candidate.id === this.selection?.id);
    return facility && isCity(facility) ? facility : undefined;
  }

  private eligibleCities(): FacilityState[] {
    if (!this.state) return [];
    const snapshot = this.state.cityPopulationSnapshot;
    if (snapshot.turn !== this.state.turn) return [];
    const eligible = new Set(snapshot.supply.filter((entry) => entry.eligible).map((entry) => entry.facilityId));
    return this.state.facilities
      .filter((facility) => isCity(facility) && facility.owner === 'player' && facility.status === 'owned' && facility.infected === 0 && eligible.has(facility.id))
      .sort((left, right) => left.id.localeCompare(right.id));
  }

  private updateTransferPreview(): void {
    const from = this.selectedCity();
    if (!from || !this.state) return;
    const toInput = this.root.querySelector<HTMLSelectElement>('[data-transfer-target="true"]');
    const number = this.root.querySelector<HTMLInputElement>('[data-transfer-number="true"]');
    const max = Math.max(0, from.workers);
    const people = clampInteger(number?.value, 0, max, 0);
    const toId = toInput?.value ?? '';
    const output = this.root.querySelector<HTMLElement>('[data-transfer-preview="true"]');
    if (!output) return;
    const t = this.translator();
    const peopleOutput = this.root.querySelector<HTMLOutputElement>('[data-transfer-output="true"]');
    if (peopleOutput) peopleOutput.textContent = String(people);
    const forecast = forecastEndTurn(this.state);
    const projection = toId ? projectCityTransfer(this.state, from.id, toId, people, forecast) : null;
    if (!toId) {
      output.innerHTML = `<p class="warning-text">${escapeHtml(t('noTransferTarget'))}</p>`;
      return;
    }
    if (!projection) {
      output.innerHTML = `<p class="warning-text">${escapeHtml(t('invalidAction'))}</p>`;
      return;
    }
    output.innerHTML = `<dl class="transfer-preview-grid"><div><dt>${escapeHtml(t('fromCity'))}</dt><dd>${projection.fromPopulation} → <b>${projection.fromAfter}</b></dd></div><div><dt>${escapeHtml(t('toCity'))}</dt><dd>${projection.toPopulation} → <b>${projection.toAfter}</b></dd></div><div><dt>${escapeHtml(t('projectedOvercrowding'))}</dt><dd>${escapeHtml(formatPercent(projection.overcrowdingRate, this.locale))}</dd></div><div><dt>${escapeHtml(t('additionalFood'))}</dt><dd>${projection.additionalFood}</dd></div><div><dt>${escapeHtml(t('additionalCivilianGoods'))}</dt><dd>${projection.additionalCivilianGoods}</dd></div></dl>`;
    const action: Extract<GameAction, { type: 'TransferPopulation' }> = { type: 'TransferPopulation', fromFacilityId: from.id, toFacilityId: toId, people };
    const reason = people <= 0 ? t('noPopulationToTransfer') : actionReasonFor(this.state, action, this.locale);
    const button = this.root.querySelector<HTMLButtonElement>('[data-action="transfer-population"]');
    if (button) {
      button.disabled = Boolean(reason);
      button.title = reason ?? '';
    }
    const reasonElement = this.root.querySelector<HTMLElement>('[data-transfer-reason="true"]');
    if (reasonElement) {
      reasonElement.hidden = !reason;
      reasonElement.textContent = reason ?? '';
    }
  }

  private transferPopulation(): void {
    const from = this.selectedCity();
    if (!from || !this.state) return;
    const to = this.root.querySelector<HTMLSelectElement>('[data-transfer-target="true"]')?.value ?? '';
    const max = Math.max(0, from.workers);
    const people = clampInteger(this.root.querySelector<HTMLInputElement>('[data-transfer-number="true"]')?.value, 0, max, 0);
    const requested: Extract<GameAction, { type: 'TransferPopulation' }> = {
      type: 'TransferPopulation',
      fromFacilityId: from.id,
      toFacilityId: to,
      people,
    };
    const action = actionForPopulationTransfer(this.legalActions(), from.id, to, people) ?? requested;
    const reason = people <= 0 ? this.translator()('noPopulationToTransfer') : actionReasonFor(this.state, action, this.locale);
    if (reason) {
      this.showToast(reason);
      this.updateTransferPreview();
      return;
    }
    this.apply(action);
  }

  private setPolicy(checkpointId: string, policy: CheckpointPolicy): void {
    const action = actionForCheckpointPolicy(this.legalActions(), checkpointId, policy) ?? { type: 'SetCheckpointPolicy', checkpointId, policy } as const;
    const reason = this.state ? actionReasonFor(this.state, action, this.locale) : this.translator()('invalidAction');
    if (reason) this.showToast(reason);
    else this.apply(action);
  }

  private produce(unitType: 'police' | 'nationalGuard'): void {
    const facility = this.selectedCity();
    const destination = facility?.position;
    const action = facility ? actionForUnitProduction(this.legalActions(), unitType, destination) : undefined;
    if (action) {
      this.apply(action);
      return;
    }
    const requested: Extract<GameAction, { type: 'ProduceUnit' }> = {
      type: 'ProduceUnit',
      unitType,
      ...(destination ? { destination } : {}),
    };
    const reason = actionReasonFor(this.state!, requested, this.locale) ??
      (unitType === 'police' ? this.translator()('policeRecruitmentRule') : this.translator()('guardRecruitmentRule'));
    this.showToast(reason);
    this.updateRecruitmentReasons();
  }

  private buildCheckpoint(): void {
    const selected = this.selectedPosition();
    const candidates = this.legalActions().filter((action): action is Extract<GameAction, { type: 'BuildCheckpoint' }> => action.type === 'BuildCheckpoint');
    const action = candidates.find((candidate) => !selected || (candidate.position.q === selected.q && candidate.position.r === selected.r)) ?? candidates[0];
    if (action) {
      this.apply(action);
      return;
    }
    this.showToast(this.locale === 'ja' ? '道路上の行動権がある警察が必要です。' : 'An active police unit on a road is required.');
  }

  private updateRecruitmentReasons(): void {
    if (!this.state) return;
    const city = this.selectedCity();
    const destination = city?.position;
    for (const unitType of ['police', 'nationalGuard'] as const) {
      const button = this.root.querySelector<HTMLButtonElement>(`[data-action="produce-${unitType === 'police' ? 'police' : 'guard'}"]`);
      if (!button) continue;
      const requested: Extract<GameAction, { type: 'ProduceUnit' }> = { type: 'ProduceUnit', unitType, ...(destination ? { destination } : {}) };
      const reason = !city
        ? (unitType === 'police' ? this.translator()('policeRecruitmentRule') : this.translator()('guardRecruitmentRule'))
        : actionReasonFor(this.state, requested, this.locale) ?? (unitType === 'police' ? this.translator()('policeRecruitmentRule') : this.translator()('guardRecruitmentRule'));
      const legal = Boolean(city && actionForUnitProduction(this.legalActions(), unitType, destination));
      button.disabled = !legal;
      button.title = legal ? '' : reason;
      const reasonElement = this.root.querySelector<HTMLElement>(`[data-recruitment-reason="${unitType}"]`);
      if (reasonElement) {
        reasonElement.hidden = legal;
        reasonElement.textContent = legal ? '' : reason;
      }
    }
  }

  private apply(action: GameAction): boolean {
    if (!this.engine || !this.state) return false;
    const listed = isLegalAction(this.legalActions(), action);
    const reason = actionReasonFor(this.state, action, this.locale);
    // Legal-action enumeration intentionally stays compact for population
    // controls (it need not list every possible transfer amount). Validate the
    // requested atomic action with the same core validator before submitting.
    if (reason || (!listed && action.type !== 'EndTurn' && action.type !== 'AssignWorkers' && action.type !== 'TransferPopulation')) {
      this.showToast(reason ?? this.translator()('invalidAction'));
      return false;
    }
    const result = this.engine.step(action);
    if (result.error) {
      this.showToast(localizeActionError(result.error.code, this.locale));
      return false;
    }
    this.state = result.state;
    this.autosave();
    this.updateView();
    if (result.gameOver && result.result) this.showStatistics(result.result);
    return true;
  }

  private autosave(): void {
    if (!this.state) return;
    const result = this.store.save(this.state);
    if (result.ok) this.lastSaveCode = result.code;
  }

  private loadAutosave(): void {
    const loaded = this.store.load();
    if (!loaded.valid || !loaded.state) {
      const message = loaded.errors[0] ?? this.translator()('loadError');
      this.showToast(isLegacySaveError(message) ? this.translator()('legacySaveError') : message);
      return;
    }
    this.loadState(loaded.state);
  }

  private loadState(snapshot: GameState): void {
    try {
      this.engine = this.createEngine();
      this.engine.reset(snapshot.seed, snapshot.config);
      const result = this.engine.step({ type: 'LoadSnapshot', snapshot });
      if (result.error) throw new Error(result.error.message);
      this.state = result.state;
      this.screen = 'game';
      this.navMode = 'map';
      this.selection = null;
      this.pendingMove = null;
      this.renderGame();
      this.autosave();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const message = isLegacySaveError(detail)
        ? this.translator()('legacySaveError')
        : `${this.translator()('loadError')}: ${detail}`;
      if (this.root.querySelector('[data-load-error]')) this.showLoadModalError(message);
      else this.showToast(message);
    }
  }

  private showLoadModal(): void {
    const t = this.translator();
    this.root.className = 'app-shell modal-screen';
    this.root.innerHTML = `<section class="modal-card" aria-labelledby="load-heading"><button class="icon-button modal-close" data-action="title">×</button><h2 id="load-heading">${escapeHtml(t('load'))}</h2><p class="muted legacy-save-notice">${escapeHtml(t('legacySaveNotice'))}</p><p class="warning-text load-error" data-load-error role="alert" aria-live="assertive" hidden></p><label>${escapeHtml(t('saveCode'))}<textarea data-input="save-code" rows="5" spellcheck="false" placeholder="Base64URL …"></textarea></label><div class="modal-actions"><button class="primary-button" data-action="load-code">${escapeHtml(t('load'))}</button><button class="ghost-button" data-action="title">${escapeHtml(t('cancel'))}</button></div><hr/><label>${escapeHtml(t('import'))}<input type="file" accept="application/json,.json" data-action="file-import" /></label></section>`;
    this.bindRootEvents();
    this.root.querySelector('[data-action="load-code"]')?.addEventListener('click', () => {
      const code = this.root.querySelector<HTMLTextAreaElement>('[data-input="save-code"]')?.value ?? '';
      const decoded = decodeSaveCode(code);
      const error = loadValidationError(decoded, t('loadError'));
      if (error || !decoded.state) {
        const message = error ?? t('loadError');
        this.showLoadModalError(isLegacySaveError(message) ? t('legacySaveError') : message);
      }
      else this.loadState(decoded.state);
    });
  }

  private showSaveModal(): void {
    if (!this.state) return;
    const t = this.translator();
    const code = this.lastSaveCode ?? encodeSaveCode(this.state);
    this.lastSaveCode = code;
    this.root.insertAdjacentHTML('beforeend', `<div class="modal-backdrop" data-modal="save"><section class="modal-card floating-card" aria-labelledby="save-heading"><button class="icon-button modal-close" data-action="dismiss-modal">×</button><h2 id="save-heading">${escapeHtml(t('saveCode'))}</h2><textarea data-input="save-code" rows="7" spellcheck="false" readonly>${escapeHtml(code)}</textarea><div class="modal-actions"><button class="primary-button" data-action="copy-code">${escapeHtml(t('copy'))}</button><button class="secondary-button" data-action="download-json">${escapeHtml(t('download'))}</button><button class="ghost-button" data-action="dismiss-modal">${escapeHtml(t('close'))}</button></div></section></div>`);
  }

  private copySaveCode(_element?: HTMLElement): void {
    const code = this.lastSaveCode;
    if (!code) return;
    void navigator.clipboard?.writeText(code).then(() => this.showToast(this.translator()('copy'))).catch(() => this.showToast(code));
  }

  private downloadJson(): void {
    if (!this.state) return;
    const blob = new Blob([exportSaveJson(this.state)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `nowhere-left-to-hide-turn-${this.state.turn}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  private readJsonFile(element: HTMLElement): void {
    const input = element as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    void file.text().then((text) => {
      const loaded = importSaveJson(text);
      const error = loadValidationError(loaded, this.translator()('loadError'));
      if (error || !loaded.state) {
        const message = error ?? this.translator()('loadError');
        this.showLoadModalError(isLegacySaveError(message) ? this.translator()('legacySaveError') : message);
      }
      else this.loadState(loaded.state);
    }).catch((error: unknown) => {
      this.showLoadModalError(`${this.translator()('loadError')}: ${error instanceof Error ? error.message : String(error)}`);
    });
  }

  private showLoadModalError(message: string): void {
    const error = this.root.querySelector<HTMLElement>('[data-load-error]');
    if (!error) return;
    error.hidden = false;
    error.textContent = message;
  }

  private dismissModal(): void {
    this.root.querySelector('[data-modal]')?.remove();
  }

  private showGuide(): void {
    const t = this.translator();
    this.root.insertAdjacentHTML('beforeend', `<div class="modal-backdrop" data-modal="guide"><section class="modal-card floating-card guide-card" aria-labelledby="guide-heading"><div class="guide-icon">◇</div><h2 id="guide-heading">${escapeHtml(t('guideTitle'))}</h2><p>${escapeHtml(t('guideBody'))}</p><p>${escapeHtml(t('guideSteps'))}</p><button class="primary-button" data-action="guide-close">${escapeHtml(t('confirm'))}</button></section></div>`);
  }

  private showHelp(): void {
    const t = this.translator();
    const tips = ['tipPopulation', 'tipReturn', 'tipOvercrowding', 'tipNextTurn', 'tipRecruitment', 'tipCheckpoint', 'tipSave']
      .map((key) => `<li>${escapeHtml(t(key))}</li>`)
      .join('');
    this.root.insertAdjacentHTML('beforeend', `<div class="modal-backdrop" data-modal="help"><section class="modal-card floating-card" aria-labelledby="help-heading"><button class="icon-button modal-close" data-action="dismiss-modal">×</button><h2 id="help-heading">${escapeHtml(t('help'))}</h2><p>${escapeHtml(t('helpBody'))}</p><h3>${escapeHtml(t('move'))}</h3><p>${escapeHtml(t('guideSteps'))}</p><h3>${escapeHtml(t('tipsTitle'))}</h3><ul class="tips-list">${tips}</ul><button class="ghost-button" data-action="dismiss-modal">${escapeHtml(t('close'))}</button></section></div>`);
  }

  private showStatistics(result: GameResult | null): void {
    if (!result || this.root.querySelector('[data-modal="statistics"]')) return;
    const t = this.translator();
    const stats = result.statistics;
    const finalPopulation = this.state ? populationLocationTotals(this.state).total : 0;
    const finalFacilities = this.state?.facilities.filter((facility) => facility.owner === 'player' && facility.status === 'owned').length ?? 0;
    this.root.insertAdjacentHTML('beforeend', `<div class="modal-backdrop" data-modal="statistics"><section class="modal-card floating-card" aria-labelledby="statistics-heading"><p class="eyebrow">${escapeHtml(t('gameOver'))}</p><h2 id="statistics-heading">${escapeHtml(result.outcome === 'won' ? t('victory') : t('defeat'))}</h2><div class="stats-grid"><span>${escapeHtml(t('survivedTurns'))}<b>${result.turn}</b></span><span>${escapeHtml(t('finalPopulation'))}<b>${finalPopulation}</b></span><span>${escapeHtml(t('maxPopulation'))}<b>${stats.maxPopulation}</b></span><span>${escapeHtml(t('finalFacilities'))}<b>${finalFacilities}</b></span><span>${escapeHtml(t('maxFacilities'))}<b>${stats.maxSecuredFacilities}</b></span><span>${escapeHtml(t('civilianLosses'))}<b>${stats.civilianLosses}</b></span><span>${escapeHtml(t('unitLosses'))}<b>${stats.unitLosses}</b></span><span>${escapeHtml(t('infectionLosses'))}<b>${stats.infectionLosses}</b></span><span>${escapeHtml(t('shortageLosses'))}<b>${stats.resourceShortageLosses}</b></span><span>${escapeHtml(t('hordeInterceptions'))}<b>${stats.hordeInterceptions}</b></span><span>${escapeHtml(t('defeatReason'))}<b>${escapeHtml(gameOverReasonLabel(result.reason, this.locale))}</b></span></div><div class="modal-actions"><button class="primary-button" data-action="title">${escapeHtml(t('reset'))}</button><button class="ghost-button" data-action="dismiss-modal">${escapeHtml(t('close'))}</button></div></section></div>`);
  }

  private renderSheetBody(): void {
    if (!this.state) return;
    const body = this.root.querySelector<HTMLElement>('[data-bind="sheet-body"]');
    const title = this.root.querySelector<HTMLElement>('[data-bind="selection-title"]');
    const summary = this.root.querySelector<HTMLElement>('[data-bind="selection-summary"]');
    if (!body || !title || !summary) return;
    const t = this.translator();
    if (!this.selection) {
      const prompt = unselectedPrompt(this.navMode, this.locale);
      const population = populationLocationTotals(this.state);
      const forecast = forecastEndTurn(this.state);
      const overcrowdingRate = forecast.overcrowding.cities.reduce((total, city) => total + city.excess / Math.max(1, city.softCap), 0);
      title.textContent = prompt;
      summary.textContent = stateSummary(this.state, this.locale);
      body.innerHTML = `<div class="population-overview"><div class="empty-state"><span class="empty-glyph">⌖</span><p>${escapeHtml(prompt)}</p></div><h3>${escapeHtml(t('populationLocations'))}</h3><dl class="location-grid"><div><dt>${escapeHtml(t('cityResidents'))}</dt><dd>${population.cityResidents}</dd></div><div><dt>${escapeHtml(t('productionWorkers'))}</dt><dd>${population.productionWorkers}</dd></div><div><dt>${escapeHtml(t('unitPopulation'))}</dt><dd>${population.unitPopulation}</dd></div><div><dt>${escapeHtml(t('waiting'))}</dt><dd>${population.waitingRefugees}</dd></div><div><dt>${escapeHtml(t('screening'))}</dt><dd>${population.screeningRefugees}</dd></div><div><dt>${escapeHtml(t('approved'))}</dt><dd>${population.approvedRefugees}</dd></div><div><dt>${escapeHtml(t('infected'))}</dt><dd>${population.infected}</dd></div><div><dt>${escapeHtml(t('population'))}</dt><dd>${population.total}</dd></div></dl><section class="forecast-card"><h3>${escapeHtml(t('endTurnForecast'))}</h3><p class="muted">${escapeHtml(t('overcrowding'))}: ${escapeHtml(formatPercent(overcrowdingRate, this.locale))} · ${escapeHtml(t('additionalFood'))} ${forecast.overcrowding.additionalFood} · ${escapeHtml(t('additionalCivilianGoods'))} ${forecast.overcrowding.additionalCivilianGoods}</p><p class="muted">${escapeHtml(t('food'))}: ${forecast.food.required}/${forecast.food.available} · ${escapeHtml(t('civilianGoods'))}: ${forecast.civilianGoods.required}/${forecast.civilianGoods.available}</p></section><p class="muted">${escapeHtml(t('tipPopulation'))}</p></div>`;
      return;
    }
    if (this.selection.kind === 'unit') {
      const unit = findUnit(this.state, this.selection.id);
      if (!unit) return;
      const actions = legalActionsForUnit(this.state, this.legalActions(), unit.id);
      title.textContent = `${unitLabel(unit.type, this.locale)} · ${unit.id}`;
      summary.textContent = `HP ${unit.hp}/${unit.maxHp} · ${t('move')} ${unit.movement} · ${t('attack')} ${unit.attack}`;
      const risk = this.pendingMove?.interceptionRisk;
      const riskText = typeof risk === 'number' ? risk <= 0.2 ? t('low') : risk <= 0.5 ? t('medium') : t('high') : String(risk ?? t('none'));
      const canWait = actions.some((action) => action.type === 'Wait');
      const canSuppress = actions.some((action) => action.type === 'SuppressInfection');
      body.innerHTML = `${this.pendingMove ? `<div class="preview-card"><strong>${escapeHtml(t('preview'))}</strong><p>${escapeHtml(t('path'))}: ${this.pendingMove.path.length} <span>→ ${this.pendingMove.destination.q},${this.pendingMove.destination.r}</span></p><p>${escapeHtml(t('interceptionRisk'))}: <b class="risk-${riskText.toLowerCase()}">${escapeHtml(riskText)}</b></p><div class="action-row"><button class="primary-button" data-action="confirm-move">${escapeHtml(t('confirm'))}</button><button class="ghost-button" data-action="cancel-move">${escapeHtml(t('cancel'))}</button></div></div>` : ''}<div class="action-row">${canWait ? `<button class="secondary-button" data-action="wait">${escapeHtml(t('wait'))}</button>` : ''}${canSuppress ? `<button class="secondary-button" data-action="suppress">${escapeHtml(t('infected'))}</button>` : ''}</div><p class="muted">${escapeHtml(t('selectDestination'))}</p>`;
      return;
    }
    if (this.selection.kind === 'checkpoint') {
      const checkpoint = this.state.checkpoints.find((candidate) => candidate.id === this.selection?.id);
      if (!checkpoint) return;
      this.renderCheckpointSheet(checkpoint, body, title, summary);
      return;
    }
    const facility = this.state.facilities.find((candidate) => candidate.id === this.selection?.id);
    if (!facility) return;
    title.textContent = facilityLabel(facility.type, this.locale);
    const owned = facility.owner === 'player' && facility.status === 'owned';
    const statusText = facility.status === 'ruined' ? t('ruined') : facility.owner === 'player' ? t('owned') : t('unowned');
    const operationText = facility.infected > 0 ? t('infected') : facility.operationalStatus === 'operational' ? t('operational') : facility.operationalStatus === 'stopped' ? t('stopped') : t('ruined');
    summary.textContent = `${statusText} · ${operationText} · ${t('location')} ${facility.position.q},${facility.position.r}`;
    const city = isCity(facility);
    const bounds = workerAssignmentBounds(this.state, facility);
    const canOperatePopulation = owned && facility.infected === 0 && facility.populationOperationalTurn <= this.state.turn;
    const workerAction = actionForWorkerAssignment(this.legalActions(), facility.id, facility.workers);
    const workerReason = !owned
      ? t('invalidAction')
      : facility.infected > 0
        ? t('infected')
        : facility.populationOperationalTurn > this.state.turn
          ? t('facilityNotReady')
          : !workerAction
            ? t('noChangeAction')
            : null;
    const eligibleCities = city ? this.eligibleCities().filter((candidate) => candidate.id !== facility.id) : [];
    const fromEligible = city && canOperatePopulation && this.eligibleCities().some((candidate) => candidate.id === facility.id);
    const transferDefault = Math.min(1, Math.max(0, facility.workers));
    const cityCap = isCity(facility) ? this.state.config.facilities[facility.type].workerCapacity : null;
    const cityExcess = cityCap === null ? 0 : Math.max(0, facility.workers - cityCap);
    const cityTransfer = city && owned
      ? `<section class="population-editor" aria-labelledby="transfer-heading"><h3 id="transfer-heading">${escapeHtml(t('transferPopulation'))}</h3><p class="muted">${escapeHtml(t('assignWorkersHint'))}</p><label>${escapeHtml(t('toCity'))}<select data-transfer-target="true" ${eligibleCities.length > 0 && fromEligible ? '' : 'disabled'}>${eligibleCities.length > 0 ? eligibleCities.map((candidate) => `<option value="${escapeHtml(candidate.id)}">${escapeHtml(facilityLabel(candidate.type, this.locale))} · ${candidate.workers}/${this.state!.config.facilities[candidate.type].workerCapacity}</option>`).join('') : `<option value="">${escapeHtml(t('noSafeCity'))}</option>`}</select></label><label>${escapeHtml(t('people'))}<output data-transfer-output="true">${transferDefault}</output><input type="range" min="0" max="${Math.max(0, facility.workers)}" step="1" value="${transferDefault}" data-transfer-people="true" data-transfer-slider="true" /></label><input class="numeric-input" type="number" min="0" max="${Math.max(0, facility.workers)}" step="1" value="${transferDefault}" inputmode="numeric" aria-label="${escapeHtml(t('people'))}" data-transfer-people="true" data-transfer-number="true" /><div class="transfer-preview" data-transfer-preview="true"></div><p class="warning-text" data-transfer-reason="true" ${fromEligible && eligibleCities.length > 0 && facility.workers > 0 ? 'hidden' : ''}>${fromEligible && eligibleCities.length > 0 && facility.workers > 0 ? '' : escapeHtml(facility.populationOperationalTurn > this.state.turn ? t('facilityNotReady') : facility.infected > 0 ? t('infected') : t('noSafeCity'))}</p><button class="secondary-button" data-action="transfer-population" ${eligibleCities.length > 0 && fromEligible && facility.workers > 0 ? '' : 'disabled'}>${escapeHtml(t('transferPopulation'))}</button></section>`
      : '';
    const workerEditor = owned && !city
      ? `<section class="population-editor facility-editor" aria-labelledby="workers-heading"><h3 id="workers-heading">${escapeHtml(t('workers'))}</h3><p class="muted">${escapeHtml(t('assignWorkersHint'))}</p><label>${escapeHtml(t('workers'))}<output data-worker-output="true">${bounds.current}/${bounds.maximum}</output><input type="range" min="${bounds.minimum}" max="${bounds.maximum}" step="1" value="${bounds.current}" data-worker-control="true" data-worker-input="true" data-worker-slider="true" aria-label="${escapeHtml(t('workers'))}" /></label><input class="numeric-input" type="number" min="${bounds.minimum}" max="${bounds.maximum}" step="1" value="${bounds.current}" inputmode="numeric" aria-label="${escapeHtml(t('workers'))}" data-worker-control="true" data-worker-input="true" data-worker-number="true" /><p class="warning-text" data-worker-reason="true" ${workerReason ? '' : 'hidden'}>${workerReason ? escapeHtml(workerReason) : ''}</p><button class="secondary-button" data-action="assign-workers" ${workerAction && canOperatePopulation ? '' : 'disabled'}>${escapeHtml(t('assignWorkers'))}</button></section>`
      : '';
    const recruitment = `<section class="recruitment-editor"><h3>${escapeHtml(t('population'))}</h3><p class="muted">${escapeHtml(city ? t('tipRecruitment') : t('recruitmentDisabled'))}</p><div class="action-row"><button class="secondary-button" data-action="produce-police">${escapeHtml(t('producePolice'))}</button><button class="secondary-button" data-action="produce-guard">${escapeHtml(t('produceGuard'))}</button></div><p class="warning-text" data-recruitment-reason="police" hidden></p><p class="warning-text" data-recruitment-reason="nationalGuard" hidden></p></section>`;
    const checkpoint = this.state.checkpoints.find((candidate) => candidate.position.q === facility.position.q && candidate.position.r === facility.position.r);
    body.innerHTML = `<section class="location-card"><dl class="location-grid"><div><dt>${escapeHtml(city ? t('cityResidents') : t('workers'))}</dt><dd>${facility.workers}${cityCap === null ? `/${facility.workerCapacity}` : `/${cityCap}`}</dd></div>${cityCap !== null ? `<div><dt>${escapeHtml(t('overcrowding'))}</dt><dd>${cityExcess > 0 ? escapeHtml(formatPercent(cityExcess / Math.max(1, cityCap), this.locale)) : '0%'}</dd></div>` : ''}<div><dt>${escapeHtml(t('infected'))}</dt><dd>${facility.infected}</dd></div></dl>${facility.infected > 0 ? `<p class="warning-text">${escapeHtml(t('infected'))}: ${facility.infected}</p>` : ''}${city && facility.populationOperationalTurn > this.state.turn ? `<p class="warning-text">${escapeHtml(t('facilityNotReady'))}</p>` : ''}</section>${workerEditor}${cityTransfer}${recruitment}${checkpoint ? `<section class="checkpoint-editor"><h3>${escapeHtml(t('checkpoint'))}</h3><p class="muted">${escapeHtml(t('waiting'))}: ${checkpoint.waiting} · ${escapeHtml(t('screening'))}: ${checkpoint.screening} · ${escapeHtml(t('approved'))}: ${checkpoint.approved} · ${escapeHtml(t('infected'))}: ${checkpoint.infected}</p></section>` : ''}<div class="action-row"><button class="secondary-button" data-action="build-checkpoint">${escapeHtml(t('buildCheckpoint'))}</button></div>`;
    this.updateTransferPreview();
    this.updateRecruitmentReasons();
  }

  private renderCheckpointSheet(checkpoint: CheckpointState, body: HTMLElement, title: HTMLElement, summary: HTMLElement): void {
    const t = this.translator();
    title.textContent = `${t('checkpoint')} · ${checkpoint.id}`;
    summary.textContent = `${checkpoint.status === 'operational' ? t('operational') : t('ruined')} · ${formatDirection(checkpoint.direction, this.locale)}`;
    const policies: CheckpointPolicy[] = ['passThrough', 'normal', 'strict'];
    const policyOptions = policies.map((policy) => `<option value="${policy}" ${checkpoint.currentPolicy === policy ? 'selected' : ''}>${escapeHtml(t(policy))}</option>`).join('');
    const policyActionAvailable = this.legalActions().some((action) => action.type === 'SetCheckpointPolicy' && action.checkpointId === checkpoint.id);
    const policyReason = checkpoint.status !== 'operational' ? t('invalidAction') : policyActionAvailable ? null : t('invalidAction');
    body.innerHTML = `<section class="checkpoint-card"><dl class="location-grid"><div><dt>${escapeHtml(t('waiting'))}</dt><dd>${checkpoint.waiting}</dd></div><div><dt>${escapeHtml(t('screening'))}</dt><dd>${checkpoint.screening}</dd></div><div><dt>${escapeHtml(t('approved'))}</dt><dd>${checkpoint.approved}</dd></div><div><dt>${escapeHtml(t('infected'))}</dt><dd>${checkpoint.infected}</dd></div></dl><p class="muted">${escapeHtml(t('tipCheckpoint'))}</p><label>${escapeHtml(t('checkpointPolicy'))}<select data-policy="${escapeHtml(checkpoint.id)}" ${checkpoint.status === 'operational' ? '' : 'disabled'}>${policyOptions}</select></label>${policyReason ? `<p class="warning-text">${escapeHtml(policyReason)}</p>` : ''}</section>`;
  }

  private showToast(message: string): void {
    this.toastMessage = message;
    this.renderToast();
    if (this.noticeTimer) clearTimeout(this.noticeTimer);
    const timer = setTimeout(() => {
      this.toastMessage = null;
      this.renderToast();
    }, 4500);
    this.noticeTimer = timer;
  }

  private renderToast(): void {
    const toast = this.root.querySelector<HTMLElement>('#toast');
    if (toast) {
      toast.textContent = this.toastMessage ?? '';
      toast.classList.toggle('visible', Boolean(this.toastMessage));
    }
    const status = this.root.querySelector<HTMLElement>('.title-status');
    if (status && this.toastMessage) status.textContent = this.toastMessage;
  }
}
