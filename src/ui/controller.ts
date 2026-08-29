import { createDefaultConfig } from '../core/config';
import { forecastEndTurn, validateAction } from '../core/engine';
import { createAgentObservation } from '../agent/observation';
import type {
  AgentCheckpointObservation,
  AgentFacilityObservation,
  AgentUnitObservation,
} from '../agent/types';
import {
  deriveSupplySnapshot,
  getBlockingZombiesForCheckpoint,
  getBranchSupplyRadius,
  getRoadBranch,
  getSuppliedTileKeys,
  isHexSupplied,
} from '../core/supply';
import Phaser from 'phaser';
import type {
  CardinalDirection,
  CheckpointPolicy,
  CheckpointState,
  EndTurnForecast,
  FacilityState,
  GameAction,
  GameConfig,
  GamePhase,
  GameResult,
  GameState,
  HeadlessGame,
  HexCoord,
  ResourceType,
  PowerSupplyReason,
  RoadBranchId,
  UnitState,
} from '../core/types';
import {
  actionForCheckpointPolicy,
  actionForPopulationTransfer,
  actionForUnitProduction,
  actionForPowerSupply,
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
type CheckpointPlacement = {
  mode: 'build' | 'relocate';
  checkpointId?: string;
  branchId?: RoadBranchId;
};
type CheckpointPreviewTarget = { branchId: RoadBranchId; position: HexCoord };
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

/** A migrated snapshot stays read-only until the user accepts a new action. */
export function shouldAutosaveAfterLoad(migrated: boolean): boolean {
  return !migrated;
}

function isLegacySaveError(message: string): boolean {
  return /version|v1\.0|legacy|旧|互換/iu.test(message);
}

/** Localize version and v1.2.5 migration failures without hiding generic diagnostics. */
export function localizeSaveLoadError(message: string, locale: Locale): string {
  const t = createTranslator(locale);
  if (/v1\.2\.5|migrat/iu.test(message)) return t('migrationSaveError');
  if (isLegacySaveError(message)) return t('legacySaveError');
  return message;
}

const SHEET_ORDER: SheetState[] = ['collapsed', 'standard', 'expanded'];

function sheetStateLabel(state: SheetState, locale: Locale): string {
  const t = createTranslator(locale);
  if (state === 'collapsed') return t('collapsed');
  if (state === 'expanded') return t('expanded');
  return t('standard');
}

function escapeHtml(value: string | null | undefined): string {
  if (value === null || value === undefined) return '';
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

function isPowerSupplyFacility(facility: Pick<FacilityState, 'type'>): boolean {
  return facility.type === 'farm' || facility.type === 'civilianFactory' || facility.type === 'militaryFactory';
}

function formatPercent(value: number, locale: Locale): string {
  return new Intl.NumberFormat(locale === 'ja' ? 'ja-JP' : 'en-US', {
    style: 'percent',
    maximumFractionDigits: 1,
  }).format(Math.max(0, value));
}

function samePosition(left: HexCoord, right: HexCoord): boolean {
  return left.q === right.q && left.r === right.r;
}

function formatResourceAmounts(
  values: Partial<Record<ResourceType, number>> | undefined,
  locale: Locale,
  includeZero = false,
): string {
  const t = createTranslator(locale);
  const entries = Object.entries(values ?? {})
    .filter(([, amount]) => typeof amount === 'number' && (includeZero ? amount >= 0 : amount > 0))
    .sort(([left], [right]) => left.localeCompare(right));
  return entries.length > 0
    ? entries.map(([resource, amount]) => `${t(resource)} ${amount}`).join(' / ')
    : t('none');
}

function powerModeLabel(mode: AgentFacilityObservation['production']['powerMode'], locale: Locale): string {
  const t = createTranslator(locale);
  if (mode === 'required') return t('powerModeRequired');
  if (mode === 'boost') return t('powerModeBoost');
  return t('powerModeNone');
}

function powerReasonLabel(reason: PowerSupplyReason | string | null | undefined, locale: Locale): string {
  const t = createTranslator(locale);
  const labels: Record<string, string> = {
    supplied: t('powerReasonSupplied'),
    physical_capacity_shortage: t('powerReasonPhysical'),
    fuel_shortage: t('powerReasonFuel'),
    allocation_priority: t('powerReasonPriority'),
    power_supply_off: t('powerReasonOff'),
    no_population: t('powerReasonNoPopulation'),
    not_eligible: t('powerReasonNotEligible'),
    production_input_unavailable: t('powerReasonInput'),
    not_applicable: t('powerReasonNone'),
  };
  return reason ? labels[reason] ?? reason : '';
}

function formatForecastAmount(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

function forecastResourceCard(
  resource: 'food' | 'civilianGoods' | 'militaryGoods' | 'fuel',
  detail: EndTurnForecast['food'] | EndTurnForecast['civilianGoods'] | EndTurnForecast['militaryGoods'] | EndTurnForecast['fuel'],
  locale: Locale,
): string {
  const t = createTranslator(locale);
  let rows: Array<[string, string]>;
  if (resource === 'civilianGoods') {
    const civilian = detail as EndTurnForecast['civilianGoods'];
    rows = [
      [t('startingStock'), String(civilian.startingStock)],
      [t('projectedProduction'), formatForecastAmount(civilian.projectedProduction)],
      [t('maintenanceRequired'), `-${civilian.maintenanceRequired}`],
      [t('productionInputDemand'), String(civilian.productionInputDemand)],
      [t('productionInputAllocated'), String(civilian.productionInputAllocated)],
      [t('productionInputShortage'), String(civilian.productionInputShortage)],
      [t('endingStock'), String(civilian.endingStock)],
      [t('maintenanceShortage'), String(civilian.maintenanceShortage)],
    ];
  } else if (resource === 'fuel') {
    const fuel = detail as EndTurnForecast['fuel'];
    rows = [
      [t('startingStock'), String(fuel.startingStock)],
      [t('generationFuelDemand'), String(fuel.generationFuelDemand)],
      [t('projectedFuelUsed'), String(fuel.projectedFuelUsed)],
      [t('generationFuelShortage'), String(fuel.generationFuelShortage)],
      [t('projectedProduction'), formatForecastAmount(fuel.projectedProduction)],
      [t('endingStock'), String(fuel.endingStock)],
    ];
  } else {
    rows = [
      [t('startingStock'), String(detail.startingStock)],
      [t('projectedProduction'), formatForecastAmount(detail.projectedProduction)],
      [t('maintenanceRequired'), `-${detail.maintenanceRequired}`],
      [t('endingStock'), String(detail.endingStock)],
      [t('shortage'), String(detail.shortage)],
    ];
  }
  return `<section class="forecast-card resource-forecast-card"><h4>${escapeHtml(t(resource))}</h4><dl class="forecast-detail-grid">${rows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl></section>`;
}

/** Render the complete public EndTurn forecast for the human-facing sheet. */
export function renderEndTurnForecast(forecast: EndTurnForecast, locale: Locale): string {
  const t = createTranslator(locale);
  const electricity = forecast.electricity;
  const totalDemand = electricity.requiredPowerDemand + electricity.industrialBoostDemand;
  const unpowered = electricity.unpoweredFacilities.length > 0
    ? `<p class="warning-text"><strong>${escapeHtml(t('unpoweredFacilities'))}</strong>: ${electricity.unpoweredFacilities.map((entry) => `${escapeHtml(entry.facilityId)} · ${escapeHtml(powerReasonLabel(entry.reason, locale))}`).join(' / ')}</p>`
    : `<p class="muted">${escapeHtml(t('unpoweredFacilities'))}: ${escapeHtml(t('none'))}</p>`;
  return `<section class="forecast-card end-turn-forecast"><h3>${escapeHtml(t('endTurnForecast'))}</h3><p class="muted">${escapeHtml(t('overcrowding'))}: ${escapeHtml(formatPercent(forecast.overcrowding.cities.reduce((total, city) => total + city.excess / Math.max(1, city.softCap), 0), locale))} · ${escapeHtml(t('additionalFood'))} ${forecast.overcrowding.additionalFood} · ${escapeHtml(t('additionalCivilianGoods'))} ${forecast.overcrowding.additionalCivilianGoods}</p>${forecastResourceCard('food', forecast.food, locale)}${forecastResourceCard('civilianGoods', forecast.civilianGoods, locale)}${forecastResourceCard('militaryGoods', forecast.militaryGoods, locale)}${forecastResourceCard('fuel', forecast.fuel, locale)}<section class="forecast-card power-forecast"><h4>${escapeHtml(t('electricity'))}</h4><dl class="forecast-detail-grid"><div><dt>${escapeHtml(t('physicalGenerationCapacity'))}</dt><dd>${electricity.physicalGenerationCapacity}</dd></div><div><dt>${escapeHtml(t('fuelLimitedGenerationCapacity'))}</dt><dd>${electricity.fuelLimitedGenerationCapacity}</dd></div><div><dt>${escapeHtml(t('availableGenerationCapacity'))}</dt><dd>${electricity.availableGenerationCapacity}</dd></div><div><dt>${escapeHtml(t('requiredPowerDemand'))}</dt><dd>${electricity.requiredPowerDemand}</dd></div><div><dt>${escapeHtml(t('industrialBoostDemand'))}</dt><dd>${electricity.industrialBoostDemand}</dd></div><div><dt>${escapeHtml(t('requiredPowerAllocated'))}</dt><dd>${electricity.requiredPowerAllocated}</dd></div><div><dt>${escapeHtml(t('industrialBoostAllocated'))}</dt><dd>${electricity.industrialBoostAllocated}</dd></div><div><dt>${escapeHtml(t('shortage'))}</dt><dd>${electricity.shortage}</dd></div></dl><p class="muted">${escapeHtml(t('availableGenerationCapacity'))} ${electricity.availableGenerationCapacity} / ${totalDemand}</p>${unpowered}</section></section>`;
}

function recoveryClassLabel(recoveryClass: AgentUnitObservation['recoveryClassIfTurnEndsNow'], locale: Locale): string {
  const t = createTranslator(locale);
  if (recoveryClass === 'combat') return t('recoveryCombat');
  if (recoveryClass === 'rest') return t('recoveryRest');
  if (recoveryClass === 'outOfSupply') return t('recoveryOutOfSupply');
  return t('unavailable');
}

function stoppedReasonLabel(reason: string | null | undefined, locale: Locale): string {
  const t = createTranslator(locale);
  const labels: Record<string, string> = {
    ruined: t('stopReasonRuined'),
    infection: t('stopReasonInfection'),
    no_workers: t('stopReasonNoWorkers'),
    power_unavailable: t('stopReasonPower'),
    input_shortage: t('stopReasonInput'),
    not_owned: t('stopReasonNotOwned'),
    stopped: t('stopReasonStopped'),
    supplied: t('powerReasonSupplied'),
    physical_capacity_shortage: t('powerReasonPhysical'),
    fuel_shortage: t('powerReasonFuel'),
    allocation_priority: t('powerReasonPriority'),
    power_supply_off: t('powerReasonOff'),
    no_population: t('powerReasonNoPopulation'),
    not_eligible: t('powerReasonNotEligible'),
    production_input_unavailable: t('powerReasonInput'),
    not_applicable: t('powerReasonNone'),
  };
  return reason ? labels[reason] ?? reason : '';
}

function checkpointPolicyDetails(
  policies: Readonly<Record<CheckpointPolicy, {
    turns: number;
    workerRate: number;
    infectionRate: number;
    infectionPopulationRate: number;
  }>>,
  locale: Locale,
): string {
  const t = createTranslator(locale);
  return (['passThrough', 'normal', 'strict'] as const).map((policy) => {
    const config = policies[policy];
    return `<li><strong>${escapeHtml(t(policy))}</strong>: ${escapeHtml(t('policyTurns'))} ${config.turns} · ${escapeHtml(t('policyAcceptance'))} ${escapeHtml(formatPercent(config.workerRate, locale))} · ${escapeHtml(t('policyInfection'))} ${escapeHtml(formatPercent(config.infectionRate, locale))} · ${escapeHtml(t('policyInfectedPopulation'))} ${escapeHtml(formatPercent(config.infectionPopulationRate, locale))}</li>`;
  }).join('');
}

export function localizeActionError(code: string | undefined, locale: Locale): string {
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
    facility_out_of_supply: locale === 'ja' ? '供給外の施設には労働者を追加できません。' : 'Workers cannot be added to a facility outside the supply network.',
    recruitment_out_of_supply: locale === 'ja' ? '供給外では新しいユニットを編成できません。' : 'New units cannot be recruited outside the supply network.',
    recovery_out_of_supply: locale === 'ja' ? '供給外では自然回復しません。' : 'Natural recovery does not occur outside the supply network.',
    invalid_action_input: locale === 'ja' ? '公開されている合法な操作だけを指定してください。' : 'Specify one public legal action from the current action list.',
    population_move_failed: locale === 'ja' ? '人口移動を完了できませんでした。' : 'The population move could not be completed.',
    checkpoint_supply_zombie_blocked: t('blockedZombie'),
    checkpoint_branch_action_limit: t('checkpointActionLimit'),
    checkpoint_infection_blocked: t('checkpointInfected'),
    checkpoint_requires_relocation: locale === 'ja' ? 'この方面には稼働中の検問所があります。移設を選択してください。' : 'This branch has an operational checkpoint. Choose relocation.',
    invalid_checkpoint_branch: locale === 'ja' ? '指定した道路タイルは有効な方面に属していません。' : 'The selected road tile does not belong to a valid branch.',
    unknown_road_branch: locale === 'ja' ? '道路方面を確認できません。' : 'The road branch is unknown.',
    checkpoint_wrong_branch: locale === 'ja' ? '検問所は現在の方面内だけで移設できます。' : 'A checkpoint can only relocate within its current branch.',
    checkpoint_same_position: locale === 'ja' ? '別の道路タイルを選択してください。' : 'Choose a different road tile.',
    unknown_operational_checkpoint: locale === 'ja' ? '移設できる稼働中の検問所を選択してください。' : 'Select an operational checkpoint to relocate.',
    checkpoint_abandoned_forward_block: t('abandonedForwardBlock'),
    power_supply_not_applicable: locale === 'ja' ? '電力供給を変更できるのはFarm・民需工場・軍需工場だけです。' : 'Power Supply can only be changed for Farms, Civilian Factories, and Military Factories.',
    power_supply_unavailable: locale === 'ja' ? '所有中で安全かつ操作可能な産業施設だけ変更できます。' : 'Only an owned, safe, and available industrial facility can change Power Supply.',
    invalid_power_supply: locale === 'ja' ? 'Power SupplyはONまたはOFFで指定してください。' : 'Power Supply must be ON or OFF.',
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
  private checkpointPlacement: CheckpointPlacement | null = null;
  private checkpointPreviewTarget: CheckpointPreviewTarget | null = null;
  private supplyOverlay = false;
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
    this.checkpointPlacement = null;
    this.checkpointPreviewTarget = null;
    this.supplyOverlay = false;
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
      this.checkpointPlacement = null;
      this.checkpointPreviewTarget = null;
      this.supplyOverlay = false;
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
        <button class="icon-button supply-toggle" aria-label="${escapeHtml(t('supplyOverlay'))}" aria-pressed="${this.supplyOverlay}" data-action="toggle-supply" title="${escapeHtml(this.supplyOverlay ? t('supplyOn') : t('supplyOff'))}">◎</button>
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
    const previewCandidate = (event: Event): void => {
      const element = (event.target as HTMLElement).closest<HTMLElement>('.checkpoint-candidate');
      if (element) this.previewCheckpointCandidate(element);
    };
    this.root.onpointerover = previewCandidate;
    (this.root as HTMLElement & { onfocusin: ((event: FocusEvent) => void) | null }).onfocusin = previewCandidate;
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
      case 'toggle-supply': this.supplyOverlay = !this.supplyOverlay; this.updateView(); break;
      case 'sheet-toggle': this.toggleSheet(); break;
      case 'confirm-move': this.confirmMove(); break;
      case 'cancel-move': this.pendingMove = null; this.updateView(); break;
      case 'wait': this.waitSelected(); break;
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
      case 'toggle-power-supply': this.setPowerSupply(element); break;
      case 'produce-police': this.produce('police'); break;
      case 'produce-guard': this.produce('nationalGuard'); break;
      case 'build-checkpoint': this.buildCheckpoint(); break;
      case 'relocate-checkpoint': this.startRelocation(); break;
      case 'checkpoint-place-cancel': this.checkpointPlacement = null; this.checkpointPreviewTarget = null; this.updateView(); break;
      case 'checkpoint-build-at': this.buildCheckpointAt(element); break;
      case 'checkpoint-relocate-at': this.relocateCheckpointAt(element); break;
      default: break;
    }
  }

  private onNav(nav: string): void {
    if (nav !== 'domestic' && nav !== 'map') return;
    const mode = nav as NavigationMode;
    const selected = this.selectedPosition();
    this.navMode = mode;
    this.pendingMove = null;
    this.checkpointPlacement = null;
    this.checkpointPreviewTarget = null;
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
    const sheetBody = this.root.querySelector<HTMLElement>('[data-bind="sheet-body"]');
    if (this.selection?.kind === 'facility') this.updateFacilitySupplementalControls();
    if (sheetBody && !this.selection) sheetBody.insertAdjacentHTML('beforeend', this.renderBranchFlow());
    if (sheetBody && this.checkpointPlacement) sheetBody.insertAdjacentHTML('beforeend', this.renderCheckpointPlacement());
    this.updateBoard();
    const sheet = this.root.querySelector<HTMLElement>('.bottom-sheet');
    sheet?.setAttribute('data-sheet', this.sheetState);
    const sheetState = this.root.querySelector<HTMLElement>('[data-bind="sheet-state"]');
    if (sheetState) sheetState.textContent = sheetStateLabel(this.sheetState, this.locale);
    const supplyToggle = this.root.querySelector<HTMLButtonElement>('[data-action="toggle-supply"]');
    if (supplyToggle) {
      supplyToggle.setAttribute('aria-pressed', String(this.supplyOverlay));
      supplyToggle.title = this.translator()(this.supplyOverlay ? 'supplyOn' : 'supplyOff');
    }
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
    const forecast = forecastEndTurn(this.state);
    const forecastPower = forecast.electricity;
    const forecastPowerDemand = forecastPower.requiredPowerDemand + forecastPower.industrialBoostDemand;
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
      power: `${forecastPower.availableGenerationCapacity}/${forecastPowerDemand}`,
      'horde-direction': hordeVisible ? formatDirection(this.state.horde.nextDirection, this.locale) : this.translator()('warningPending'),
      'horde-remaining': hordeVisible ? String(this.state.horde.turnsRemaining) : '—',
      'healthy-civilians': String(population.healthyCivilians),
      infected: String(population.infected),
    };
    for (const [key, value] of Object.entries(bindings)) {
      const element = this.root.querySelector<HTMLElement>(`[data-bind="${key}"]`);
      if (element) element.textContent = value;
    }
    const powerElement = this.root.querySelector<HTMLElement>('[data-bind="power"]');
    if (powerElement) {
      powerElement.title = `${this.translator()('projectedPower')}: ${forecastPower.availableGenerationCapacity}/${forecastPowerDemand} · ${this.translator()('requiredPowerAllocated')} ${forecastPower.requiredPowerAllocated} · ${this.translator()('industrialBoostAllocated')} ${forecastPower.industrialBoostAllocated}`;
    }
  }

  private updateBoard(): void {
    if (!this.state || !this.boardScene) return;
    const supply = deriveSupplySnapshot(this.state);
    const supplyContext = this.supplyOverlay || Boolean(this.checkpointPlacement) || this.selection?.kind === 'facility' || this.selection?.kind === 'checkpoint';
    const preview = this.checkpointPreview();
    const previewTarget = this.checkpointPlacement ? this.checkpointPreviewTarget : null;
    const suppliedTileKeys = previewTarget
      ? getSuppliedTileKeys(this.state, { branchId: previewTarget.branchId, checkpointPosition: previewTarget.position })
      : supply.suppliedTileKeys;
    const branchRadii = previewTarget
      ? supply.branchRadii.map((entry) => entry.branchId === previewTarget.branchId
        ? { ...entry, radius: getBranchSupplyRadius(this.state!, entry.branchId, previewTarget.position) }
        : entry)
      : supply.branchRadii;
    const render: BoardRenderState = {
      state: this.state,
      selectedPosition: this.selectedPosition(),
      selectedUnitId: this.selection?.kind === 'unit' ? this.selection.id : null,
      legalDestinations: this.selectedUnitLegalMoves(),
      attackTargetIds: this.selectedUnitAttackTargets(),
      pendingPath: this.pendingMove?.path,
      hordeDirection: this.state.turn >= this.state.config.horde.warningStartTurn ? this.state.horde.nextDirection : undefined,
      supplyOverlay: supplyContext,
      suppliedTileKeys,
      branchRadii,
      checkpointPreviewPositions: preview.positions,
      blockedZombieIds: preview.blockedZombieIds,
      checkpointPreviewSelected: previewTarget?.position,
    };
    this.boardScene.updateState(render);
  }

  private checkpointPreview(): { positions: HexCoord[]; blockedZombieIds: string[] } {
    if (!this.state || !this.checkpointPlacement) return { positions: [], blockedZombieIds: [] };
    const branchIds = this.checkpointPlacement.branchId
      ? [this.checkpointPlacement.branchId]
      : this.state.map.roadBranches.map((branch) => branch.id);
    const positions: HexCoord[] = [];
    for (const branchId of branchIds) {
      const branch = getRoadBranch(this.state.map, branchId);
      if (!branch) continue;
      for (const position of branch.roadTiles) {
        positions.push({ ...position });
      }
    }
    const blockedZombieIds = this.checkpointPreviewTarget
      ? getBlockingZombiesForCheckpoint(
        this.state,
        this.checkpointPreviewTarget.branchId,
        this.checkpointPreviewTarget.position,
      ).map((zombie) => zombie.id)
      : [];
    return { positions, blockedZombieIds };
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
    if (this.checkpointPlacement) {
      const branch = this.state.map.roadBranches.find((candidate) =>
        candidate.roadTiles.some((tile) => tile.q === position.q && tile.r === position.r),
      );
      const action = this.legalActions().find((candidate) => {
        if (this.checkpointPlacement?.mode === 'build' && candidate.type !== 'BuildCheckpoint') return false;
        if (this.checkpointPlacement?.mode === 'relocate' && candidate.type !== 'RelocateCheckpoint') return false;
        if (candidate.type === 'BuildCheckpoint') {
          return candidate.branchId === branch?.id && candidate.position.q === position.q && candidate.position.r === position.r;
        }
        if (candidate.type === 'RelocateCheckpoint') {
          return candidate.checkpointId === this.checkpointPlacement?.checkpointId &&
            candidate.branchId === branch?.id &&
            candidate.position.q === position.q &&
            candidate.position.r === position.r;
        }
        return false;
      });
      if (action && this.apply(action)) {
        this.checkpointPlacement = null;
        this.checkpointPreviewTarget = null;
        this.supplyOverlay = true;
        this.updateView();
      } else if (!action) {
        this.showToast(this.checkpointActionReason(this.checkpointPlacement.mode, this.checkpointPlacement.checkpointId));
      }
      return;
    }
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

  private endTurn(): void {
    if (!this.state) return;
    const forecast = forecastEndTurn(this.state);
    const t = this.translator();
    const projected: Array<[string, number]> = [];
    if (forecast.food.shortage > 0) projected.push([t('food'), forecast.food.shortage]);
    if (forecast.civilianGoods.maintenanceShortage > 0) {
      projected.push([`${t('civilianGoods')} · ${t('maintenanceShortage')}`, forecast.civilianGoods.maintenanceShortage]);
    }
    if (forecast.civilianGoods.productionInputShortage > 0) {
      projected.push([t('productionInputWarning'), forecast.civilianGoods.productionInputShortage]);
    }
    if (forecast.militaryGoods.shortage > 0) projected.push([t('militaryGoods'), forecast.militaryGoods.shortage]);
    if (forecast.fuel.generationFuelShortage > 0) {
      projected.push([t('generationFuelWarning'), forecast.fuel.generationFuelShortage]);
    }
    if (forecast.electricity.shortage > 0) projected.push([t('powerShortageWarning'), forecast.electricity.shortage]);
    if (projected.length > 0) {
      const details = projected
        .map(([resource, amount]) => `<li>${escapeHtml(resource)}: <b>${amount}</b></li>`)
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

  private setPowerSupply(element: HTMLElement): void {
    if (!this.state) return;
    const facilityId = element.dataset.facilityId ?? (this.selection?.kind === 'facility' ? this.selection.id : '');
    if (!facilityId) return;
    const enabled = element.dataset.enabled === 'true';
    const requested: Extract<GameAction, { type: 'SetPowerSupply' }> = {
      type: 'SetPowerSupply',
      facilityId,
      enabled,
    };
    const action = actionForPowerSupply(this.legalActions(), facilityId, enabled) ?? requested;
    const reason = actionReasonFor(this.state, action, this.locale);
    if (reason) {
      this.showToast(reason);
      this.updateFacilitySupplementalControls();
      return;
    }
    this.apply(action);
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
    const projectedForecast = projection.forecast;
    output.innerHTML = `<dl class="transfer-preview-grid"><div><dt>${escapeHtml(t('fromCity'))}</dt><dd>${projection.fromPopulation} → <b>${projection.fromAfter}</b></dd></div><div><dt>${escapeHtml(t('toCity'))}</dt><dd>${projection.toPopulation} → <b>${projection.toAfter}</b></dd></div><div><dt>${escapeHtml(t('projectedOvercrowding'))}</dt><dd>${escapeHtml(formatPercent(projection.overcrowdingRate, this.locale))}</dd></div><div><dt>${escapeHtml(t('additionalFood'))}</dt><dd>${projection.additionalFood}</dd></div><div><dt>${escapeHtml(t('additionalCivilianGoods'))}</dt><dd>${projection.additionalCivilianGoods}</dd></div></dl><section class="forecast-card transfer-forecast"><h4>${escapeHtml(t('endTurnForecast'))}</h4><p class="muted">${escapeHtml(t('food'))}: ${projectedForecast.food.startingStock} → ${projectedForecast.food.endingStock} · ${escapeHtml(t('shortage'))} ${projectedForecast.food.shortage}</p><p class="muted">${escapeHtml(t('civilianGoods'))}: ${projectedForecast.civilianGoods.startingStock} → ${projectedForecast.civilianGoods.endingStock} · ${escapeHtml(t('maintenanceShortage'))} ${projectedForecast.civilianGoods.maintenanceShortage} · ${escapeHtml(t('productionInputShortage'))} ${projectedForecast.civilianGoods.productionInputShortage}</p><p class="muted">${escapeHtml(t('electricity'))}: ${projectedForecast.electricity.availableGenerationCapacity} / ${projectedForecast.electricity.requiredPowerDemand + projectedForecast.electricity.industrialBoostDemand}</p></section>`;
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
    const candidates = this.legalActions().filter((action): action is Extract<GameAction, { type: 'BuildCheckpoint' }> => action.type === 'BuildCheckpoint');
    if (candidates.length === 0) {
      this.showToast(this.checkpointActionReason('build'));
      return;
    }
    this.checkpointPlacement = { mode: 'build' };
    const first = candidates[0]!;
    this.checkpointPreviewTarget = first.branchId
      ? { branchId: first.branchId, position: { ...first.position } }
      : null;
    this.supplyOverlay = true;
    this.sheetState = 'standard';
    this.updateView();
  }

  private startRelocation(): void {
    if (!this.state || this.selection?.kind !== 'checkpoint') {
      this.showToast(this.translator()('unknownOperationalCheckpoint'));
      return;
    }
    const checkpoint = this.state.checkpoints.find((candidate) => candidate.id === this.selection?.id);
    if (!checkpoint || checkpoint.status !== 'operational') {
      this.showToast(this.translator()('unknownOperationalCheckpoint'));
      return;
    }
    const candidates = this.legalActions().filter((action): action is Extract<GameAction, { type: 'RelocateCheckpoint' }> => action.type === 'RelocateCheckpoint' && action.checkpointId === checkpoint.id);
    if (candidates.length === 0) {
      this.showToast(this.checkpointActionReason('relocate', checkpoint.id));
      return;
    }
    this.checkpointPlacement = {
      mode: 'relocate',
      checkpointId: checkpoint.id,
      branchId: checkpoint.branchId ?? checkpoint.direction,
    };
    const first = candidates[0]!;
    this.checkpointPreviewTarget = first.branchId
      ? { branchId: first.branchId, position: { ...first.position } }
      : null;
    this.supplyOverlay = true;
    this.sheetState = 'standard';
    this.updateView();
  }

  private checkpointActionReason(mode: 'build' | 'relocate', checkpointId?: string): string {
    if (!this.state) return this.translator()('invalidAction');
    const branchIds = this.state.map.roadBranches.map((branch) => branch.id);
    for (const branchId of branchIds) {
      const branch = getRoadBranch(this.state.map, branchId);
      if (!branch) continue;
      for (const position of branch.roadTiles) {
        const action: GameAction = mode === 'build'
          ? { type: 'BuildCheckpoint', branchId, position: { ...position } }
          : checkpointId
            ? { type: 'RelocateCheckpoint', checkpointId, branchId, position: { ...position } }
            : { type: 'BuildCheckpoint', branchId, position: { ...position } };
        const reason = actionReasonFor(this.state, action, this.locale);
        if (reason) return reason;
      }
    }
    return this.translator()('invalidAction');
  }

  private buildCheckpointAt(element: HTMLElement): void {
    if (!this.state) return;
    const branchId = element.dataset.branchId;
    const q = numberValue(element.dataset.q, NaN);
    const r = numberValue(element.dataset.r, NaN);
    if (!branchId || !Number.isInteger(q) || !Number.isInteger(r)) return;
    const action = this.legalActions().find(
      (candidate): candidate is Extract<GameAction, { type: 'BuildCheckpoint' }> =>
        candidate.type === 'BuildCheckpoint' &&
        candidate.branchId === branchId &&
        candidate.position.q === q &&
        candidate.position.r === r,
    );
    if (!action) {
      const requested: Extract<GameAction, { type: 'BuildCheckpoint' }> = {
        type: 'BuildCheckpoint',
        branchId,
        position: { q, r },
      };
      this.showToast(actionReasonFor(this.state, requested, this.locale) ?? this.checkpointActionReason('build'));
      return;
    }
    if (this.apply(action)) {
      this.checkpointPlacement = null;
      this.checkpointPreviewTarget = null;
      this.supplyOverlay = true;
      this.updateView();
    }
  }

  private relocateCheckpointAt(element: HTMLElement): void {
    if (!this.state || !this.checkpointPlacement?.checkpointId) return;
    const branchId = element.dataset.branchId;
    const q = numberValue(element.dataset.q, NaN);
    const r = numberValue(element.dataset.r, NaN);
    if (!branchId || !Number.isInteger(q) || !Number.isInteger(r)) return;
    const action = this.legalActions().find(
      (candidate): candidate is Extract<GameAction, { type: 'RelocateCheckpoint' }> =>
        candidate.type === 'RelocateCheckpoint' &&
        candidate.checkpointId === this.checkpointPlacement?.checkpointId &&
        candidate.branchId === branchId &&
        candidate.position.q === q &&
        candidate.position.r === r,
    );
    if (!action) {
      const requested: Extract<GameAction, { type: 'RelocateCheckpoint' }> = {
        type: 'RelocateCheckpoint',
        checkpointId: this.checkpointPlacement.checkpointId,
        branchId,
        position: { q, r },
      };
      this.showToast(actionReasonFor(this.state, requested, this.locale) ?? this.checkpointActionReason('relocate', requested.checkpointId));
      return;
    }
    if (this.apply(action)) {
      this.checkpointPlacement = null;
      this.checkpointPreviewTarget = null;
      this.supplyOverlay = true;
      this.updateView();
    }
  }

  private previewCheckpointCandidate(element: HTMLElement): void {
    if (!this.state || !this.checkpointPlacement) return;
    const branchId = element.dataset.branchId;
    const q = numberValue(element.dataset.q, NaN);
    const r = numberValue(element.dataset.r, NaN);
    if (!branchId || !Number.isInteger(q) || !Number.isInteger(r)) return;
    if (!this.state.map.roadBranches.some((branch) => branch.id === branchId)) return;
    const current = this.checkpointPreviewTarget;
    if (current?.branchId === branchId && current.position.q === q && current.position.r === r) return;
    this.checkpointPreviewTarget = { branchId, position: { q, r } };
    this.updateBoard();
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
      this.showToast(localizeSaveLoadError(message, this.locale));
      return;
    }
    this.loadState(loaded.state, Boolean(loaded.migrated));
  }

  private loadState(snapshot: GameState, migrated = false): void {
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
      this.checkpointPlacement = null;
      this.checkpointPreviewTarget = null;
      this.lastSaveCode = null;
      this.renderGame();
      if (shouldAutosaveAfterLoad(migrated)) this.autosave();
      else this.showToast(this.translator()('migratedSaveNotice'));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      const localized = localizeSaveLoadError(detail, this.locale);
      const message = localized === detail ? `${this.translator()('loadError')}: ${detail}` : localized;
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
        this.showLoadModalError(localizeSaveLoadError(message, this.locale));
      }
      else this.loadState(decoded.state, Boolean(decoded.migrated));
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
        this.showLoadModalError(localizeSaveLoadError(message, this.locale));
      }
      else this.loadState(loaded.state, Boolean(loaded.migrated));
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
    const tips = ['tipPopulation', 'tipReturn', 'tipOvercrowding', 'tipNextTurn', 'tipRecruitment', 'tipCheckpoint', 'tipRoadBranches', 'tipSupply', 'tipCheckpointMove', 'tipRecovery', 'tipSuppression', 'tipRange', 'tipProduction', 'tipPower', 'tipPowerAllocation', 'tipProductionTiming', 'tipPolicy', 'tipSave']
      .map((key) => `<li>${escapeHtml(t(key))}</li>`)
      .join('');
    this.root.insertAdjacentHTML('beforeend', `<div class="modal-backdrop" data-modal="help"><section class="modal-card floating-card" aria-labelledby="help-heading"><button class="icon-button modal-close" data-action="dismiss-modal">×</button><h2 id="help-heading">${escapeHtml(t('help'))}</h2><p>${escapeHtml(t('helpBody'))}</p><h3>${escapeHtml(t('move'))}</h3><p>${escapeHtml(t('guideSteps'))}</p><h3>${escapeHtml(t('tipsTitle'))}</h3><ul class="tips-list">${tips}</ul><button class="ghost-button" data-action="dismiss-modal">${escapeHtml(t('close'))}</button></section></div>`);
  }

  private updateFacilitySupplementalControls(): void {
    if (!this.state || this.selection?.kind !== 'facility') return;
    const facility = this.state.facilities.find((candidate) => candidate.id === this.selection?.id);
    const body = this.root.querySelector<HTMLElement>('[data-bind="sheet-body"]');
    if (!facility || !body) return;
    const t = this.translator();
    const supplied = getSuppliedTileKeys(this.state).includes(String(facility.position.q) + ',' + String(facility.position.r));
    const locationCard = body.querySelector<HTMLElement>('.location-card');
    if (locationCard) {
      locationCard.querySelector('[data-facility-supply-status="true"]')?.remove();
      locationCard.insertAdjacentHTML('afterbegin', '<p class="supply-status ' + (supplied ? 'is-supplied' : 'is-out-of-supply') + '">' +
        escapeHtml(supplied ? t('supplied') : t('outOfSupply')) + '</p>');
      locationCard.querySelector<HTMLElement>('.supply-status')?.setAttribute('data-facility-supply-status', 'true');
    }
    const powerEditor = body.querySelector<HTMLElement>('[data-power-supply-editor="true"]');
    if (powerEditor && isPowerSupplyFacility(facility)) {
      const targetEnabled = !facility.powerSupplyEnabled;
      const requested: Extract<GameAction, { type: 'SetPowerSupply' }> = {
        type: 'SetPowerSupply',
        facilityId: facility.id,
        enabled: targetEnabled,
      };
      const actionAvailable = Boolean(actionForPowerSupply(this.legalActions(), facility.id, targetEnabled));
      const reason = actionAvailable ? null : actionReasonFor(this.state, requested, this.locale) ?? t('invalidAction');
      const stateElement = powerEditor.querySelector<HTMLElement>('[data-power-supply-state="true"]');
      if (stateElement) stateElement.textContent = facility.powerSupplyEnabled ? t('powerOn') : t('powerOff');
      const button = powerEditor.querySelector<HTMLButtonElement>('[data-action="toggle-power-supply"]');
      if (button) {
        button.dataset.enabled = String(targetEnabled);
        button.disabled = !actionAvailable;
        button.textContent = t('powerSupply') + ': ' + (targetEnabled ? t('powerOn') : t('powerOff'));
        button.title = reason ?? '';
      }
      const reasonElement = powerEditor.querySelector<HTMLElement>('[data-power-supply-reason="true"]');
      if (reasonElement) {
        reasonElement.hidden = !reason;
        reasonElement.textContent = reason ?? '';
      }
    }
    const buildButton = body.querySelector<HTMLButtonElement>('[data-action="build-checkpoint"]');
    const buildCandidates = this.legalActions().some((action) => action.type === 'BuildCheckpoint');
    if (buildButton) {
      buildButton.disabled = !buildCandidates;
      buildButton.title = buildCandidates ? '' : this.checkpointActionReason('build');
    }
  }

  private showStatistics(result: GameResult | null): void {
    if (!result || this.root.querySelector('[data-modal="statistics"]')) return;
    const t = this.translator();
    const stats = result.statistics;
    const finalPopulation = this.state ? populationLocationTotals(this.state).total : 0;
    const finalFacilities = this.state?.facilities.filter((facility) => facility.owner === 'player' && facility.status === 'owned').length ?? 0;
    this.root.insertAdjacentHTML('beforeend', `<div class="modal-backdrop" data-modal="statistics"><section class="modal-card floating-card" aria-labelledby="statistics-heading"><p class="eyebrow">${escapeHtml(t('gameOver'))}</p><h2 id="statistics-heading">${escapeHtml(result.outcome === 'won' ? t('victory') : t('defeat'))}</h2><div class="stats-grid"><span>${escapeHtml(t('survivedTurns'))}<b>${result.turn}</b></span><span>${escapeHtml(t('finalPopulation'))}<b>${finalPopulation}</b></span><span>${escapeHtml(t('maxPopulation'))}<b>${stats.maxPopulation}</b></span><span>${escapeHtml(t('finalFacilities'))}<b>${finalFacilities}</b></span><span>${escapeHtml(t('maxFacilities'))}<b>${stats.maxSecuredFacilities}</b></span><span>${escapeHtml(t('civilianLosses'))}<b>${stats.civilianLosses}</b></span><span>${escapeHtml(t('unitLosses'))}<b>${stats.unitLosses}</b></span><span>${escapeHtml(t('infectionLosses'))}<b>${stats.infectionLosses}</b></span><span>${escapeHtml(t('shortageLosses'))}<b>${stats.resourceShortageLosses}</b></span><span>${escapeHtml(t('hordeInterceptions'))}<b>${stats.hordeInterceptions}</b></span><span>${escapeHtml(t('defeatReason'))}<b>${escapeHtml(gameOverReasonLabel(result.reason, this.locale))}</b></span></div><div class="modal-actions"><button class="primary-button" data-action="title">${escapeHtml(t('reset'))}</button><button class="ghost-button" data-action="dismiss-modal">${escapeHtml(t('close'))}</button></div></section></div>`);
  }

  private renderBranchFlow(): string {
    if (!this.state) return '';
    const t = this.translator();
    const branches = [...this.state.map.roadBranches].sort((left, right) => left.id.localeCompare(right.id));
    const supply = deriveSupplySnapshot(this.state);
    const cards = branches.map((branch) => {
      const branchState = this.state!.roadBranches.find((candidate) => candidate.branchId === branch.id);
      const checkpoint = this.state!.checkpoints.find((candidate) =>
        candidate.status === 'operational' && (candidate.branchId ?? candidate.direction) === branch.id,
      );
      const policy = checkpoint
        ? this.state!.config.refugees.policies[checkpoint.currentPolicy]
        : this.state!.config.refugees.policies.passThrough;
      const remaining = branchState ? Math.max(0, branchState.nextArrivalTurn - this.state!.turn) : 0;
      const range = String(this.state!.config.refugees.arrivalPeopleMin) + '–' + String(this.state!.config.refugees.arrivalPeopleMax);
      const destination = checkpoint ? t('checkpoint') + ' · ' + checkpoint.id : t('noCheckpoint');
      const policyText = formatPercent(policy.workerRate, this.locale) + ' / ' + formatPercent(policy.infectionRate, this.locale);
      const radius = supply.branchRadii.find((entry) => entry.branchId === branch.id)?.radius ?? this.state!.config.checkpoint.initialSupplyRadius;
      return '<article class="branch-flow-card"><div class="branch-flow-heading"><strong>' +
        escapeHtml(formatDirection(branch.direction, this.locale)) + ' · ' + escapeHtml(branch.id) +
        '</strong><span class="status-chip">' + escapeHtml(destination) + '</span></div><dl class="branch-flow-grid"><div><dt>' +
        escapeHtml(t('nextArrival')) + '</dt><dd>' + escapeHtml(t('arrivalIn')) + ' ' + String(remaining) +
        '</dd></div><div><dt>' + escapeHtml(t('arrivalRange')) + '</dt><dd>' + escapeHtml(range) +
        '</dd></div><div><dt>' + escapeHtml(t('screeningProbability')) + '</dt><dd>' + escapeHtml(policyText) +
        '</dd></div><div><dt>' + escapeHtml(t('supplyRadius')) + '</dt><dd>' + String(radius) +
        '</dd></div></dl>' + (!checkpoint ? '<p class="muted">' + escapeHtml(t('unmanagedPassThrough')) + '</p>' : '') + '</article>';
    }).join('');
    return '<section class="branch-flow-section" aria-labelledby="branch-flow-heading"><h3 id="branch-flow-heading">' +
      escapeHtml(t('arrivalSchedule')) + '</h3>' + cards + '</section>';
  }

  private renderCheckpointPlacement(): string {
    if (!this.state || !this.checkpointPlacement) return '';
    const t = this.translator();
    const branchIds = this.checkpointPlacement.branchId
      ? [this.checkpointPlacement.branchId]
      : this.state.map.roadBranches.map((branch) => branch.id);
    const actions = branchIds.flatMap((branchId) => {
      const branch = getRoadBranch(this.state!.map, branchId);
      if (!branch) return [];
      return branch.roadTiles.map((position): Extract<GameAction, { type: 'BuildCheckpoint' | 'RelocateCheckpoint' }> =>
        this.checkpointPlacement?.mode === 'relocate' && this.checkpointPlacement.checkpointId
          ? { type: 'RelocateCheckpoint', checkpointId: this.checkpointPlacement.checkpointId, branchId, position: { ...position } }
          : { type: 'BuildCheckpoint', branchId, position: { ...position } },
      );
    });
    const actionName = this.checkpointPlacement.mode === 'build' ? t('buildPreview') : t('relocatePreview');
    const hint = this.checkpointPlacement.mode === 'build' ? t('buildCheckpointHint') : t('relocateCheckpointHint');
    const buttons = actions.map((action) => {
      const branchId = action.branchId ?? '';
      const direction = this.state!.map.roadBranches.find((branch) => branch.id === branchId)?.direction ?? 'north';
      const invalidReason = actionReasonFor(this.state!, action, this.locale);
      return '<button class="checkpoint-candidate' + (invalidReason ? ' invalid' : '') + '" data-action="' +
        (this.checkpointPlacement?.mode === 'build' ? 'checkpoint-build-at' : 'checkpoint-relocate-at') +
        '" data-branch-id="' + escapeHtml(branchId) + '" data-q="' + String(action.position.q) +
        '" data-r="' + String(action.position.r) + '" aria-invalid="' + String(Boolean(invalidReason)) + '"' +
        (invalidReason ? ' title="' + escapeHtml(invalidReason) + '"' : '') + '>' +
        escapeHtml(formatDirection(direction, this.locale)) + ' · ' + String(action.position.q) + ',' +
        String(action.position.r) + (invalidReason ? ' ×' : '') + '</button>';
    }).join('');
    return '<section class="checkpoint-placement" aria-labelledby="checkpoint-placement-heading"><div class="section-heading"><h3 id="checkpoint-placement-heading">' +
      escapeHtml(actionName) + '</h3><button class="ghost-button compact-button" data-action="checkpoint-place-cancel">' +
      escapeHtml(t('cancelPlacement')) + '</button></div><p class="muted">' + escapeHtml(hint) +
      '</p><div class="checkpoint-candidates">' + (buttons || '<p class="warning-text">' + escapeHtml(t('invalidAction')) + '</p>') +
      '</div><p class="muted">' + escapeHtml(t('blockedZombie')) + '</p></section>';
  }

  private renderSheetBody(): void {
    if (!this.state) return;
    const body = this.root.querySelector<HTMLElement>('[data-bind="sheet-body"]');
    const title = this.root.querySelector<HTMLElement>('[data-bind="selection-title"]');
    const summary = this.root.querySelector<HTMLElement>('[data-bind="selection-summary"]');
    if (!body || !title || !summary) return;
    const t = this.translator();
    const observation = createAgentObservation(this.state);
    if (!this.selection) {
      const prompt = unselectedPrompt(this.navMode, this.locale);
      const population = populationLocationTotals(this.state);
      const forecast = forecastEndTurn(this.state);
      title.textContent = prompt;
      summary.textContent = stateSummary(this.state, this.locale);
      body.innerHTML = `<div class="population-overview"><div class="empty-state"><span class="empty-glyph">⌖</span><p>${escapeHtml(prompt)}</p></div><h3>${escapeHtml(t('populationLocations'))}</h3><dl class="location-grid"><div><dt>${escapeHtml(t('cityResidents'))}</dt><dd>${population.cityResidents}</dd></div><div><dt>${escapeHtml(t('productionWorkers'))}</dt><dd>${population.productionWorkers}</dd></div><div><dt>${escapeHtml(t('unitPopulation'))}</dt><dd>${population.unitPopulation}</dd></div><div><dt>${escapeHtml(t('waiting'))}</dt><dd>${population.waitingRefugees}</dd></div><div><dt>${escapeHtml(t('screening'))}</dt><dd>${population.screeningRefugees}</dd></div><div><dt>${escapeHtml(t('approved'))}</dt><dd>${population.approvedRefugees}</dd></div><div><dt>${escapeHtml(t('infected'))}</dt><dd>${population.infected}</dd></div><div><dt>${escapeHtml(t('population'))}</dt><dd>${population.total}</dd></div></dl>${renderEndTurnForecast(forecast, this.locale)}<p class="muted">${escapeHtml(t('tipPopulation'))}</p></div>`;
      return;
    }
    if (this.selection.kind === 'unit') {
      const unit = findUnit(this.state, this.selection.id);
      if (!unit) return;
      const actions = legalActionsForUnit(this.state, this.legalActions(), unit.id);
      const publicUnit = observation.units.find((candidate) => candidate.id === unit.id);
      title.textContent = `${unitLabel(unit.type, this.locale)} · ${unit.id}`;
      summary.textContent = `HP ${unit.hp}/${unit.maxHp} · ${t('move')} ${unit.movement} · ${t('attack')} ${unit.attack} · ${t('effectiveRange')} ${publicUnit?.effectiveRange ?? unit.range}`;
      const risk = this.pendingMove?.interceptionRisk;
      const riskText = typeof risk === 'number' ? risk <= 0.2 ? t('low') : risk <= 0.5 ? t('medium') : t('high') : String(risk ?? t('none'));
      const canWait = actions.some((action) => action.type === 'Wait');
      const supplied = isHexSupplied(this.state, unit.position);
      const supplyReason = supplied ? '' : localizeActionError('recovery_out_of_supply', this.locale);
      body.innerHTML = this.renderUnitSheet(unit, publicUnit, actions, riskText, supplied, supplyReason);
      return;
    }
    if (this.selection.kind === 'checkpoint') {
      const checkpoint = this.state.checkpoints.find((candidate) => candidate.id === this.selection?.id);
      if (!checkpoint) return;
      const publicCheckpoint = observation.checkpoints.find((candidate) => candidate.id === checkpoint.id);
      this.renderCheckpointSheet(checkpoint, body, title, summary, publicCheckpoint);
      return;
    }
    const facility = this.state.facilities.find((candidate) => candidate.id === this.selection?.id);
    if (!facility) return;
    const publicFacility = observation.facilities.find((candidate) => candidate.id === facility.id);
    title.textContent = facilityLabel(facility.type, this.locale);
    const owned = facility.owner === 'player' && facility.status === 'owned';
    const statusText = facility.status === 'ruined' ? t('ruined') : facility.owner === 'player' ? t('owned') : t('unowned');
    const projectedProduction = publicFacility?.production;
    const projectedPowerUnavailable = projectedProduction?.powerMode === 'required' && !projectedProduction.projectedPowerSupplied;
    const operationText = facility.infected > 0
      ? t('infected')
      : facility.status === 'ruined'
        ? t('ruined')
        : facility.workers <= 0
          ? t('stopped')
          : projectedPowerUnavailable
            ? t('powerNotSupplied')
            : facility.operationalStatus === 'operational' ? t('operational') : t('stopped');
    summary.textContent = `${statusText} · ${operationText} · ${t('location')} ${facility.position.q},${facility.position.r}`;
    const city = isCity(facility);
    const powerSupplyEditor = isPowerSupplyFacility(facility)
      ? (() => {
        const targetEnabled = !facility.powerSupplyEnabled;
        const requested: Extract<GameAction, { type: 'SetPowerSupply' }> = {
          type: 'SetPowerSupply',
          facilityId: facility.id,
          enabled: targetEnabled,
        };
        const availableAction = actionForPowerSupply(this.legalActions(), facility.id, targetEnabled);
        const unavailableReason = availableAction ? null : actionReasonFor(this.state!, requested, this.locale) ?? t('invalidAction');
        const currentPower = facility.powerSupplyEnabled ? t('powerOn') : t('powerOff');
        const projectedPower = projectedProduction?.projectedPowerSupplied ? t('powerSupplied') : t('powerNotSupplied');
        return `<section class="population-editor power-supply-editor" data-power-supply-editor="true"><h3>${escapeHtml(t('powerSupply'))}</h3><dl class="forecast-detail-grid"><div><dt>${escapeHtml(t('powerSupply'))}</dt><dd data-power-supply-state="true">${escapeHtml(currentPower)}</dd></div><div><dt>${escapeHtml(t('powerMode'))}</dt><dd>${escapeHtml(powerModeLabel(projectedProduction?.powerMode ?? 'boost', this.locale))}</dd></div><div><dt>${escapeHtml(t('projectedPower'))}</dt><dd data-projected-power="true">${escapeHtml(projectedPower)}</dd></div></dl><button class="secondary-button" data-action="toggle-power-supply" data-facility-id="${escapeHtml(facility.id)}" data-enabled="${String(targetEnabled)}" ${availableAction ? '' : 'disabled'}>${escapeHtml(t('powerSupply'))}: ${escapeHtml(targetEnabled ? t('powerOn') : t('powerOff'))}</button>${unavailableReason ? `<p class="warning-text" data-power-supply-reason="true">${escapeHtml(unavailableReason)}</p>` : '<p class="muted" data-power-supply-reason="true"></p>'}</section>`;
      })()
      : '';
    const bounds = workerAssignmentBounds(this.state, facility);
    const canOperatePopulation = owned && facility.infected === 0 && facility.populationOperationalTurn <= this.state.turn;
    const workerAction = actionForWorkerAssignment(this.legalActions(), facility.id, facility.workers);
    const workerProbe = facility.workers < bounds.maximum ? facility.workers + 1 : facility.workers > 0 ? facility.workers - 1 : 0;
    const workerProbeAction: Extract<GameAction, { type: 'AssignWorkers' }> = { type: 'AssignWorkers', facilityId: facility.id, workers: workerProbe };
    const workerReason = !owned
      ? t('invalidAction')
      : facility.infected > 0
        ? t('infected')
        : facility.populationOperationalTurn > this.state.turn
          ? t('facilityNotReady')
          : !workerAction
            ? actionReasonFor(this.state, workerProbeAction, this.locale) ?? t('noChangeAction')
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
    body.innerHTML = `${powerSupplyEditor}<section class="location-card"><dl class="location-grid"><div><dt>${escapeHtml(city ? t('cityResidents') : t('workers'))}</dt><dd>${facility.workers}${cityCap === null ? `/${facility.workerCapacity}` : `/${cityCap}`}</dd></div>${cityCap !== null ? `<div><dt>${escapeHtml(t('overcrowding'))}</dt><dd>${cityExcess > 0 ? escapeHtml(formatPercent(cityExcess / Math.max(1, cityCap), this.locale)) : '0%'}</dd></div>` : ''}<div><dt>${escapeHtml(t('infected'))}</dt><dd>${facility.infected}</dd></div></dl>${facility.infected > 0 ? `<p class="warning-text">${escapeHtml(t('infected'))}: ${facility.infected}</p>` : ''}${city && projectedPowerUnavailable ? `<p class="warning-text">${escapeHtml(t('powerNotSupplied'))}: ${escapeHtml(t('powerReason'))} · ${escapeHtml(powerReasonLabel(projectedProduction?.projectedPowerReason, this.locale))}</p>` : ''}${city && facility.populationOperationalTurn > this.state.turn ? `<p class="warning-text">${escapeHtml(t('facilityNotReady'))}</p>` : ''}</section>${workerEditor}${cityTransfer}${recruitment}${checkpoint ? `<section class="checkpoint-editor"><h3>${escapeHtml(t('checkpoint'))}</h3><p class="muted">${escapeHtml(t('waiting'))}: ${checkpoint.waiting} · ${escapeHtml(t('screening'))}: ${checkpoint.screening} · ${escapeHtml(t('approved'))}: ${checkpoint.approved} · ${escapeHtml(t('infected'))}: ${checkpoint.infected}</p></section>` : ''}<div class="action-row"><button class="secondary-button" data-action="build-checkpoint">${escapeHtml(t('buildCheckpoint'))}</button></div>`;
    body.insertAdjacentHTML('afterbegin', this.renderFacilityForecast(publicFacility));
    this.updateTransferPreview();
    this.updateRecruitmentReasons();
  }

  private renderUnitSheet(
    unit: UnitState,
    publicUnit: AgentUnitObservation | undefined,
    actions: readonly GameAction[],
    riskText: string,
    supplied: boolean,
    supplyReason: string,
  ): string {
    const t = this.translator();
    const canWait = actions.some((action) => action.type === 'Wait');
    const recoveryClass = publicUnit?.recoveryClassIfTurnEndsNow ?? (supplied ? 'rest' : 'outOfSupply');
    const recoveryRate = publicUnit?.recoveryRateIfTurnEndsNow ?? (
      recoveryClass === 'combat'
        ? this.state?.config.naturalRecovery.combatRate ?? 0
        : recoveryClass === 'rest'
          ? this.state?.config.naturalRecovery.restRate ?? 0
          : 0
    );
    const recoveryBaseAmount = publicUnit?.recoveryBaseAmountIfTurnEndsNow ?? 0;
    const recoveryTiming = publicUnit?.recoveryTiming === 'nextPlayerTurnStart'
      ? t('nextPlayerTurnStart')
      : t('unavailable');
    const baseRange = publicUnit?.baseRange ?? unit.range;
    const effectiveRange = publicUnit?.effectiveRange ?? unit.range;
    const rangeReason = publicUnit?.rangeModifierReason === 'military_supply_shortage'
      ? t('militarySupplyShortage')
      : '';
    const infectedFacility = this.state?.facilities.find((facility) =>
      facility.infected > 0 && samePosition(facility.position, unit.position));
    const infectedCheckpoint = this.state?.checkpoints.find((checkpoint) =>
      checkpoint.infected > 0 && samePosition(checkpoint.position, unit.position));
    const infectedTarget = infectedFacility ?? infectedCheckpoint;
    const infectionSection = infectedTarget
      ? `<section class="infection-forecast"><h3>${escapeHtml(t('infectionForecast'))}</h3><p class="${publicUnit?.infectionContainmentCapable ? 'is-contained' : 'warning-text'}">${escapeHtml(publicUnit?.infectionContainmentCapable ? t('infectionContained') : t('infectionNotContained'))}</p>${publicUnit?.suppressionAvailableIfTurnEndsNow ? `<p class="muted">${escapeHtml(t('automaticSuppression'))}: ${escapeHtml(t('projectedSuppression'))} ${Math.min(infectedTarget.infected, publicUnit.suppressionPower)} · ${escapeHtml(t('suppressionPower'))} ${publicUnit.suppressionPower}</p>${publicUnit.suppressionCivilianDamage > 0 ? `<p class="warning-text">${escapeHtml(t('projectedCivilianDamage'))}: ${publicUnit.suppressionCivilianDamage}</p>` : `<p class="muted">${escapeHtml(t('noCivilianDamage'))}</p>`}` : `<p class="muted">${escapeHtml(t('automaticSuppressionUnavailable'))}</p>`}<p class="muted">${escapeHtml(t('tipSuppression'))}</p></section>`
      : '';
    const preview = this.pendingMove
      ? `<div class="preview-card"><strong>${escapeHtml(t('preview'))}</strong><p>${escapeHtml(t('path'))}: ${this.pendingMove.path.length} <span>→ ${this.pendingMove.destination.q},${this.pendingMove.destination.r}</span></p><p>${escapeHtml(t('interceptionRisk'))}: <b class="risk-${riskText.toLowerCase()}">${escapeHtml(riskText)}</b></p><div class="action-row"><button class="primary-button" data-action="confirm-move">${escapeHtml(t('confirm'))}</button><button class="ghost-button" data-action="cancel-move">${escapeHtml(t('cancel'))}</button></div></div>`
      : '';
    return `<p class="supply-status ${supplied ? 'is-supplied' : 'is-out-of-supply'}">${escapeHtml(t(supplied ? 'supplied' : 'outOfSupply'))}${supplyReason ? ` · ${escapeHtml(supplyReason)}` : ''}</p><section class="unit-forecast"><h3>${escapeHtml(t('recoveryForecast'))}</h3><p class="recovery-status recovery-${escapeHtml(recoveryClass)}"><strong>${escapeHtml(recoveryClassLabel(recoveryClass, this.locale))}</strong> · ${escapeHtml(formatPercent(recoveryRate, this.locale))} · +${recoveryBaseAmount} HP</p><dl class="forecast-detail-grid"><div><dt>${escapeHtml(t('recoveryTiming'))}</dt><dd>${escapeHtml(recoveryTiming)}</dd></div><div><dt>${escapeHtml(t('recoveryBaseAmount'))}</dt><dd>+${recoveryBaseAmount} HP</dd></div></dl><p class="muted">${escapeHtml(t('recoveryConditions'))}: ${escapeHtml(t('recoverySurvivalRequired'))} · ${escapeHtml(t('recoverySupplyRequired'))}</p><p class="muted">${escapeHtml(t('tipRecovery'))}</p></section><section class="range-forecast"><h3>${escapeHtml(t('range'))}</h3><p><span>${escapeHtml(t('baseRange'))} ${baseRange}</span> · <strong>${escapeHtml(t('effectiveRange'))} ${effectiveRange}</strong>${rangeReason ? ` · ${escapeHtml(rangeReason)}` : ''}</p></section>${infectionSection}${preview}<div class="action-row">${canWait ? `<button class="secondary-button" data-action="wait">${escapeHtml(t('wait'))}</button>` : ''}</div><p class="muted">${escapeHtml(t('selectDestination'))}</p>`;
  }

  private renderFacilityForecast(publicFacility: AgentFacilityObservation | undefined): string {
    if (!publicFacility) return '';
    const t = this.translator();
    const production = publicFacility.production;
    const powerMode = production.powerMode ?? (production.requiresPower ? 'required' : 'none');
    const powerRequirement = powerMode !== 'none' && production.requiredPowerCapacity > 0
      ? String(production.requiredPowerCapacity)
      : t('none');
    const powerGeneration = production.estimatedPowerGeneration > 0
      ? `${production.estimatedPowerGeneration} (${production.powerGenerationPerWorker} / ${t('perWorker')})`
      : t('none');
    const baseProduction = production.baseProduction ?? production.estimatedOutput;
    const projectedProduction = production.projectedProduction ?? production.estimatedOutput;
    const projectedInput = production.estimatedInputConsumption;
    const projectedPower = powerMode === 'none'
      ? t('none')
      : production.projectedPowerSupplied ? t('powerSupplied') : t('powerNotSupplied');
    const powerSupply = isPowerSupplyFacility(publicFacility)
      ? production.powerSupplyEnabled ? t('powerOn') : t('powerOff')
      : t('none');
    const powerReason = powerMode === 'none'
      ? ''
      : powerReasonLabel(production.projectedPowerReason, this.locale);
    const lastPower = powerMode === 'none'
      ? t('none')
      : production.lastPowerSupplied === null
        ? t('unavailable')
        : production.lastPowerSupplied ? t('powerSupplied') : t('powerNotSupplied');
    const stopped = production.stoppedReason
      ? `<p class="warning-text"><strong>${escapeHtml(t('stoppedReason'))}</strong>: ${escapeHtml(stoppedReasonLabel(production.stoppedReason, this.locale))}</p>`
      : '';
    const powerWarning = powerMode !== 'none' && !production.projectedPowerSupplied
      ? `<p class="warning-text"><strong>${escapeHtml(t('powerNotSupplied'))}</strong>: ${escapeHtml(powerReason || t('powerReason'))}</p>`
      : '';
    const infection = publicFacility.infectedPopulation > 0
      ? `<section class="infection-forecast"><h3>${escapeHtml(t('infectionForecast'))}</h3><p class="${publicFacility.infectionContained ? 'is-contained' : 'warning-text'}">${escapeHtml(publicFacility.infectionContained ? t('infectionContained') : t('infectionNotContained'))}</p><p class="muted">${escapeHtml(t('automaticSuppression'))}: ${publicFacility.projectedSuppression > 0 ? publicFacility.projectedSuppression : t('automaticSuppressionUnavailable')}</p>${publicFacility.projectedCivilianDamage > 0 ? `<p class="warning-text">${escapeHtml(t('projectedCivilianDamage'))}: ${publicFacility.projectedCivilianDamage}</p>` : `<p class="muted">${escapeHtml(t('noCivilianDamage'))}</p>`}</section>`
      : '';
    return `<section class="production-forecast"><h3>${escapeHtml(t('productionForecast'))}</h3><dl class="forecast-detail-grid"><div><dt>${escapeHtml(t('powerMode'))}</dt><dd>${escapeHtml(powerModeLabel(powerMode, this.locale))}</dd></div><div><dt>${escapeHtml(t('powerSupply'))}</dt><dd>${escapeHtml(powerSupply)}</dd></div><div><dt>${escapeHtml(t('projectedPower'))}</dt><dd>${escapeHtml(projectedPower)}</dd></div><div><dt>${escapeHtml(t('powerReason'))}</dt><dd>${escapeHtml(powerReason || t('none'))}</dd></div><div><dt>${escapeHtml(t('lastPowerSupplied'))}</dt><dd>${escapeHtml(lastPower)}</dd></div><div><dt>${escapeHtml(t('productionMultiplier'))}</dt><dd>×${production.projectedProductionMultiplier ?? 1}</dd></div><div><dt>${escapeHtml(t('baseProduction'))}</dt><dd>${escapeHtml(formatResourceAmounts(baseProduction, this.locale, true))}</dd></div><div><dt>${escapeHtml(t('projectedProduction'))}</dt><dd>${escapeHtml(formatResourceAmounts(projectedProduction, this.locale, true))}</dd></div><div><dt>${escapeHtml(t('projectedInput'))}</dt><dd>${escapeHtml(formatResourceAmounts(projectedInput, this.locale, true))}</dd></div><div><dt>${escapeHtml(t('powerRequirement'))}</dt><dd>${escapeHtml(powerRequirement)}</dd></div><div><dt>${escapeHtml(t('powerGeneration'))}</dt><dd>${escapeHtml(powerGeneration)}</dd></div></dl><p class="muted">${escapeHtml(t('perWorker'))}: ${escapeHtml(t('currentProduction'))} ${escapeHtml(formatResourceAmounts(production.outputsPerWorker, this.locale))} · ${escapeHtml(t('inputConsumption'))} ${escapeHtml(formatResourceAmounts(production.inputsPerWorker, this.locale))}</p>${powerWarning}${stopped}<p class="muted">${escapeHtml(t('projectedLoss'))}: ${escapeHtml(formatResourceAmounts(production.projectedOutputLossIfInfectedOrOverrun, this.locale))} · ${escapeHtml(t('powerGeneration'))} ${production.projectedPowerLossIfInfectedOrOverrun}</p></section>${infection}`;
  }

  private renderCheckpointSheet(
    checkpoint: CheckpointState,
    body: HTMLElement,
    title: HTMLElement,
    summary: HTMLElement,
    publicCheckpoint?: AgentCheckpointObservation,
  ): void {
    const t = this.translator();
    const statusLabel = t(checkpoint.status);
    const branchId = checkpoint.branchId ?? checkpoint.direction;
    const branch = this.state?.map.roadBranches.find((candidate) => candidate.id === branchId);
    const branchState = this.state?.roadBranches.find((candidate) => candidate.branchId === branchId);
    const supplied = this.state ? getSuppliedTileKeys(this.state).includes(String(checkpoint.position.q) + ',' + String(checkpoint.position.r)) : false;
    const policyEditable = checkpoint.status === 'operational' || checkpoint.status === 'remnant';
    const newPolicyActionAvailable = this.legalActions().some((action) => action.type === 'SetCheckpointPolicy' && action.checkpointId === checkpoint.id);
    const requestedPolicy: Extract<GameAction, { type: 'SetCheckpointPolicy' }> = {
      type: 'SetCheckpointPolicy',
      checkpointId: checkpoint.id,
      policy: checkpoint.currentPolicy === 'normal' ? 'strict' : 'normal',
    };
    const newPolicyReason = !policyEditable
      ? t('invalidAction')
      : newPolicyActionAvailable
        ? null
        : actionReasonFor(this.state!, requestedPolicy, this.locale) ?? t('invalidAction');
    const newRelocationAvailable = checkpoint.status === 'operational' && this.legalActions().some((action) =>
      action.type === 'RelocateCheckpoint' && action.checkpointId === checkpoint.id,
    );
    const statusSummary = statusLabel + ' · ' + formatDirection(checkpoint.direction, this.locale);
    title.textContent = t('checkpoint') + ' · ' + checkpoint.id;
    summary.textContent = statusSummary;
    const branchText = branch ? formatDirection(branch.direction, this.locale) + ' · ' + branch.id : branchId;
    const arrivalText = branchState ? t('arrivalIn') + ' ' + String(Math.max(0, branchState.nextArrivalTurn - this.state!.turn)) : t('unavailable');
    const newPolicies: CheckpointPolicy[] = ['passThrough', 'normal', 'strict'];
    const newPolicyOptions = newPolicies.map((policy) => '<option value="' + policy + '" ' + (checkpoint.currentPolicy === policy ? 'selected' : '') + '>' + escapeHtml(t(policy)) + '</option>').join('');
    const policyDetails = checkpointPolicyDetails(this.state!.config.refugees.policies, this.locale);
    const infectionSection = checkpoint.infected > 0
      ? '<section class="infection-forecast"><h3>' + escapeHtml(t('infectionForecast')) + '</h3><p class="' + (publicCheckpoint?.infectionContained ? 'is-contained' : 'warning-text') + '">' + escapeHtml(publicCheckpoint?.infectionContained ? t('infectionContained') : t('infectionNotContained')) + '</p><p class="muted">' + escapeHtml(t('automaticSuppression')) + ': ' + String(publicCheckpoint?.projectedSuppression ?? 0) + '</p>' + ((publicCheckpoint?.projectedCivilianDamage ?? 0) > 0 ? '<p class="warning-text">' + escapeHtml(t('projectedCivilianDamage')) + ': ' + String(publicCheckpoint?.projectedCivilianDamage) + '</p>' : '<p class="muted">' + escapeHtml(t('noCivilianDamage')) + '</p>') + '</section>'
      : '';
    body.innerHTML = '<section class="checkpoint-card checkpoint-status-' + escapeHtml(checkpoint.status) + '"><div class="checkpoint-heading"><strong>' +
      escapeHtml(t('checkpointStatus')) + ': ' + escapeHtml(statusLabel) + '</strong><span class="status-chip ' + (supplied ? 'is-supplied' : 'is-out-of-supply') +
      '">' + escapeHtml(supplied ? t('supplied') : t('outOfSupply')) + '</span></div><dl class="location-grid"><div><dt>' +
      escapeHtml(t('branch')) + '</dt><dd>' + escapeHtml(branchText) + '</dd></div><div><dt>' + escapeHtml(t('nextArrival')) +
      '</dt><dd>' + escapeHtml(arrivalText) + '</dd></div><div><dt>' + escapeHtml(t('waiting')) + '</dt><dd>' + String(checkpoint.waiting) +
      '</dd></div><div><dt>' + escapeHtml(t('screening')) + '</dt><dd>' + String(checkpoint.screening) + '</dd></div><div><dt>' +
      escapeHtml(t('approved')) + '</dt><dd>' + String(checkpoint.approved) + '</dd></div><div><dt>' + escapeHtml(t('infected')) +
      '</dt><dd>' + String(checkpoint.infected) + '</dd></div><div><dt>' + escapeHtml(t('remainingScreeningTurns')) +
      '</dt><dd>' + String(checkpoint.remainingTurns) + '</dd></div></dl><p class="muted">' + escapeHtml(t('tipCheckpoint')) +
      '</p><label>' + escapeHtml(t('checkpointPolicy')) + '<select data-policy="' + escapeHtml(checkpoint.id) + '" ' +
       (policyEditable ? '' : 'disabled') + '>' + newPolicyOptions + '</select></label><p class="muted">' + escapeHtml(t('checkpointPolicy')) + ': ' + escapeHtml(t(checkpoint.currentPolicy)) + ' · ' + escapeHtml(t('nextPolicy')) + ': ' + escapeHtml(t(checkpoint.screeningPolicy)) + '</p>' + infectionSection + '<section class="policy-details"><h3>' + escapeHtml(t('policyDetails')) + '</h3><p class="muted">' + escapeHtml(t('policyTradeoff')) + '</p><ul class="policy-list">' + policyDetails + '</ul></section>' +
      (newPolicyReason ? '<p class="warning-text">' + escapeHtml(newPolicyReason) + '</p>' : '') +
      (newRelocationAvailable ? '<div class="action-row"><button class="secondary-button" data-action="relocate-checkpoint">' +
        escapeHtml(t('relocateCheckpoint')) + '</button></div>' : '') + '</section>';
    return;
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
