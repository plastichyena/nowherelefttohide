import { createDefaultConfig } from '../core/config';
import {
  forecastEndTurn,
  forecastFacilityProduction,
  getUnitLegalAttackProjections,
  getUnitLegalMoveFuelProjections,
  deriveVictoryProgress,
  validateAction,
} from '../core/engine';
import { deriveStrategicForecast } from '../core/forecast';
import { deriveCrisisSummary as deriveCoreCrisisSummary, deriveEndTurnRisk as deriveCoreEndTurnRisk } from '../core/crisis';
import {
  createPublicCheckpointProjection,
  createPublicFacilityProjection,
  createPublicUnitProjection,
  type PublicEntityProjectionContext,
} from '../core/public-entities';
import type {
  AgentCheckpointObservation,
  AgentFacilityObservation,
  AgentMapTileObservation,
  AgentObservation,
  AgentUnitObservation,
} from '../agent/types';
import { APP_VERSION } from '../agent/types';
import { hexKey } from '../core/hex';
import {
  deriveCheckpointRole,
  getBlockingZombiesForCheckpoint,
  getBranchSupplyRadius,
  getSuppliedTileKeys,
  isHexSupplied,
} from '../core/supply';
import { getAerialVisibleTileKeys, getGroundVisionCoverageFrom, getPlayerVisionCoverage, getPlayerVisibleTileKeys } from '../core/visibility';
import { effectiveMovementCost, isUrbanHex } from '../core/terrain';
import Phaser from 'phaser';
import type {
  CardinalDirection,
  CheckpointPolicy,
  CheckpointPositionCandidate,
  CheckpointStatus,
  CheckpointState,
  ConstructibleFacilityPositionCandidate,
  ConstructibleFacilityType,
  EndTurnForecast,
  FacilityState,
  GameAction,
  GameConfig,
  GameEvent,
  GamePhase,
  GameResult,
  GameState,
  HeadlessGame,
  HexCoord,
  HumanUnitType,
  ResourceType,
  PowerSupplyReason,
  RoadBranchId,
  UnitState,
} from '../core/types';
import {
  actionForCheckpointPolicy,
  actionForCheckpointActivation,
  actionForPopulationTransfer,
  actionForUnitProduction,
  actionForPowerSupply,
  actionForWorkerAssignment,
  clampInteger,
  findCheckpointAt,
  findFacilityAt,
  findUnit,
  isLegalAction,
  legalActionsForUnit,
  legalAttackTargets,
  legalMoveDestinations,
  populationLocationTotals,
  projectCityTransfer,
  workerAssignmentBounds,
} from './actions';
import { createBoardGame, type BoardAssetWarning, type BoardRenderState, type BoardVisionSelection, type HexBoardScene } from './board';
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
import type { SaveTiming } from '../persistence/save';
import { BOARD_ASSET_REGISTRY, resolveBoardAssetUrl } from './boardAssets';

export interface MovePreview {
  path: HexCoord[];
  destination: HexCoord;
  interceptionRisk?: number | string;
  firstInterception?: HexCoord | null;
  movementMode?: 'normal' | 'emergency';
  effectiveMovementCost?: number;
  fuelCost?: number;
  projectedFuelAfterMove?: number;
  [key: string]: unknown;
}

/** Narrow adapter expected from src/core/engine.ts. */
export interface UiGameEngine extends HeadlessGame {
  previewMove?: (unitId: string, destination: HexCoord) => MovePreview | unknown;
  /** v1.5.2 read-only context. Older test doubles may omit this method. */
  getQuery?: () => UiQueryContext;
}

/**
 * The UI consumes the same immutable Query Context as the Agent boundary.
 * Keep this structural so the Phaser controller can load against v1.5.1 test
 * doubles while the Core rolls the typed context out incrementally.
 */
export interface UiQueryContext {
  readonly revision?: number;
  getEndTurnForecast?: () => EndTurnForecast;
  getStrategicForecast?: () => unknown;
  getCrisisSummary?: () => unknown;
  getEndTurnRisk?: () => unknown;
  getSupply?: () => unknown;
  getVisibleTileKeys?: () => ReadonlySet<string> | readonly string[];
  getSuppliedTileKeys?: () => readonly string[];
  getVision?: () => unknown;
  getFacilityProduction?: () => readonly ReturnType<typeof forecastFacilityProduction>[number][];
  getUnitMoveProjections?: (unitId: string) => readonly unknown[];
  getUnitAttackProjections?: (unitId: string) => readonly unknown[];
  previewMove?: (unitId: string, destination: HexCoord) => MovePreview | unknown;
  getCheckpointPositionCandidates?: () => readonly CheckpointPositionCandidate[];
  getConstructibleFacilityPositionCandidates?: (facilityType: ConstructibleFacilityType) => readonly ConstructibleFacilityPositionCandidate[];
  getLegalActions?: () => readonly GameAction[];
  getLegalActionsForUnit?: (unitId: string) => readonly GameAction[];
  getLegalActionsForFacility?: (facilityId: string) => readonly GameAction[];
  getPublicUnitProjection?: (unitId: string) => AgentUnitObservation | null | undefined;
  getPublicFacilityProjection?: (facilityId: string) => AgentFacilityObservation | null | undefined;
  getPublicCheckpointProjection?: (checkpointId: string) => AgentCheckpointObservation | null | undefined;
}

export type EngineFactory = () => UiGameEngine;

type Screen = 'title' | 'game';
type SheetState = 'collapsed' | 'standard' | 'expanded';
const IS_DEVELOPMENT_BUILD = import.meta.env.DEV;
type ResourceAccordionKey = 'food' | 'civilianGoods' | 'militaryGoods' | 'fuel' | 'electricity';
type OverviewSectionKey = 'crisis' | 'population' | 'branches' | 'events' | 'construction';
type CheckpointPlacement = {
  mode: 'build' | 'relocate';
  checkpointId?: string;
  branchId?: RoadBranchId;
};
type ConstructiblePlacement = {
  facilityType: ConstructibleFacilityType;
};
type CheckpointPreviewTarget = { branchId: RoadBranchId; position: HexCoord };
export type NavigationMode = 'map' | 'domestic';
export type Selection =
  | { kind: 'unit'; id: string }
  /** A visible enemy unit selected from the board. */
  | { kind: 'zombie'; id: string }
  | { kind: 'facility'; id: string }
  | { kind: 'checkpoint'; id: string }
  /** An empty trunk-road tile selected in Domestic mode. */
  | { kind: 'road'; position: HexCoord }
  /** An otherwise empty, public map tile selected for local Domestic actions. */
  | { kind: 'hex'; position: HexCoord }
  | null;

export type UnitActionMode = 'move' | 'attack' | null;

/** The v1.5.0 proficiency values are kept at the UI boundary so older
 * snapshots and test doubles remain renderable while Core rolls out the
 * formal fields. */
export type UnitProficiency = 'recruit' | 'regular' | 'veteran';

export interface UnitProficiencyViewModel {
  proficiency: UnitProficiency;
  recruitSurvivalTurns: number;
  recruitSurvivalTurnsRequired: number;
  regularZombieKills: number;
  veteranZombieKillsRequired: number;
  veteranPromotionPending: boolean;
  attackChargesRemaining: number;
  maxAttackCharges: number;
}

function boundedCount(value: unknown, fallback = 0): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return Math.max(0, Math.trunc(fallback));
  return Math.max(0, Math.trunc(value));
}

/**
 * Read the public proficiency projection without trusting UI-authored
 * values.  This is deliberately a pure formatter helper; Core remains the
 * owner of promotion and charge transitions.
 */
export function unitProficiencyViewModel(
  unit: { type: string },
  config?: unknown,
): UnitProficiencyViewModel | null {
  if (!['police', 'nationalGuard', 'riotPolice'].includes(String(unit.type))) return null;
  const source = unit as unknown as UnknownRecord;
  const configRecord = unknownRecord(config);
  const experience = configRecord.unitExperience && typeof configRecord.unitExperience === 'object'
    ? configRecord.unitExperience as UnknownRecord
    : {};
  const proficiencyValue = source.proficiency;
  const proficiency: UnitProficiency = proficiencyValue === 'recruit' || proficiencyValue === 'veteran' || proficiencyValue === 'regular'
    ? proficiencyValue
    : 'regular';
  const recruitRequired = boundedCount(experience.recruitSurvivalTurnsRequired, 5) || 5;
  const veteranRequired = boundedCount(experience.veteranZombieKillsRequired, 5) || 5;
  const maxChargesDefault = proficiency === 'veteran' ? 2 : 1;
  const maxAttackCharges = boundedCount(source.maxAttackCharges, maxChargesDefault) || maxChargesDefault;
  return {
    proficiency,
    recruitSurvivalTurns: boundedCount(source.recruitSurvivalTurns),
    recruitSurvivalTurnsRequired: recruitRequired,
    regularZombieKills: boundedCount(source.regularZombieKills),
    veteranZombieKillsRequired: veteranRequired,
    veteranPromotionPending: source.veteranPromotionPending === true,
    attackChargesRemaining: Math.min(maxAttackCharges, boundedCount(source.attackChargesRemaining, maxAttackCharges)),
    maxAttackCharges,
  };
}

function proficiencyLabel(proficiency: UnitProficiency, locale: Locale): string {
  const t = createTranslator(locale);
  return t(`proficiency.${proficiency}`);
}

export interface CrisisAlertViewModel {
  id: string;
  severity: 'critical' | 'warning' | 'advisory';
  category: string;
  reasonCode: string;
  entityIds: string[];
  publicFacts: UnknownRecord;
}

export interface CrisisSummaryViewModel {
  alerts: CrisisAlertViewModel[];
  criticalCount: number;
  warningCount: number;
  advisoryCount: number;
}

function crisisSeverity(value: unknown): CrisisAlertViewModel['severity'] {
  return value === 'critical' || value === 'warning' || value === 'advisory' ? value : 'advisory';
}

/** Normalize the Core's public crisis projection for Human UI rendering. */
export function crisisSummaryViewModel(observation: Readonly<AgentObservation> | UnknownRecord): CrisisSummaryViewModel {
  const source = unknownRecord(observation);
  const summary = unknownRecord(source.crisisSummary ?? source.crisis);
  const rawAlerts = Array.isArray(summary.alerts)
    ? summary.alerts
    : Array.isArray(source.crisisAlerts)
      ? source.crisisAlerts
      : [];
  const alerts = rawAlerts.map((raw, index): CrisisAlertViewModel => {
    const entry = unknownRecord(raw);
    const severity = crisisSeverity(entry.severity);
    const entityIds = Array.isArray(entry.entityIds)
      ? entry.entityIds.filter((id): id is string => typeof id === 'string').slice(0, 32)
      : [];
    const facts = unknownRecord(entry.publicFacts ?? entry.facts);
    return {
      id: typeof entry.id === 'string' && entry.id.length > 0 ? entry.id.slice(0, 128) : `crisis-${index}`,
      severity,
      category: typeof entry.category === 'string' ? entry.category.slice(0, 128) : '',
      reasonCode: typeof entry.reasonCode === 'string' ? entry.reasonCode.slice(0, 128) : '',
      entityIds,
      publicFacts: facts,
    };
  });
  const severityOrder: Record<CrisisAlertViewModel['severity'], number> = { critical: 0, warning: 1, advisory: 2 };
  alerts.sort((left, right) => severityOrder[left.severity] - severityOrder[right.severity]
    || left.category.localeCompare(right.category)
    || left.reasonCode.localeCompare(right.reasonCode)
    || left.id.localeCompare(right.id));
  return {
    alerts,
    criticalCount: alerts.filter((alert) => alert.severity === 'critical').length,
    warningCount: alerts.filter((alert) => alert.severity === 'warning').length,
    advisoryCount: alerts.filter((alert) => alert.severity === 'advisory').length,
  };
}

function crisisReasonLabel(alert: CrisisAlertViewModel, locale: Locale): string {
  const t = createTranslator(locale);
  const translated = alert.reasonCode ? t(`crisisReason.${alert.reasonCode}`) : '';
  if (translated && translated !== `crisisReason.${alert.reasonCode}`) return translated;
  if (alert.category) {
    const category = t(`crisisCategory.${alert.category}`);
    if (category !== `crisisCategory.${alert.category}`) return category;
  }
  return alert.reasonCode || alert.category || t('crisisAlert');
}

function crisisFactsLabel(alert: CrisisAlertViewModel, locale: Locale): string {
  const t = createTranslator(locale);
  const facts = alert.publicFacts;
  const pieces: string[] = [];
  const infected = typeof facts.infected === 'number' ? boundedCount(facts.infected) : null;
  if (infected !== null) pieces.push(`${t('infected')} ${infected}`);
  const healthy = typeof facts.healthyPopulation === 'number' ? boundedCount(facts.healthyPopulation) : null;
  if (healthy !== null) pieces.push(`${t('healthyPopulation')} ${healthy}`);
  const units = typeof facts.suppressionCapableUnitCount === 'number' ? boundedCount(facts.suppressionCapableUnitCount) : null;
  if (units !== null) pieces.push(`${t('suppressionCapableUnits')} ${units}`);
  const fallbackDepth = typeof facts.fallbackDepth === 'number' ? boundedCount(facts.fallbackDepth) : null;
  if (fallbackDepth !== null) pieces.push(`${t('fallbackDepth')} ${fallbackDepth}`);
  return pieces.join(' · ');
}

/** Render the compact, persistent Crisis Strip used above the board. */
export function renderCrisisStrip(summary: CrisisSummaryViewModel, locale: Locale): string {
  const t = createTranslator(locale);
  const first = summary.alerts[0];
  if (!first) return '<section class="crisis-strip" data-crisis-strip hidden></section>';
  const remaining = Math.max(0, summary.alerts.length - 1);
  const count = remaining > 0 ? ` · ${t('crisisMore').replace('{0}', String(remaining))}` : '';
  return `<button type="button" class="crisis-strip severity-${first.severity}" data-action="open-crisis" data-crisis-strip aria-live="assertive" aria-label="${escapeHtml(t('crisisStripLabel'))}"><strong>${escapeHtml(t(`crisisSeverity.${first.severity}`))}</strong><span>${escapeHtml(crisisReasonLabel(first, locale))}${crisisFactsLabel(first, locale) ? ` · ${escapeHtml(crisisFactsLabel(first, locale))}` : ''}${escapeHtml(count)}</span></button>`;
}

/** Compact EndTurn fields are intentionally read-only Core projection data. */
export interface EndTurnRiskViewModel {
  readyUnits: string[];
  unitsWithMoveRemaining: string[];
  unitsWithAttackChargesRemaining: Array<{
    unitId: string;
    remainingMove: number;
    remainingAttackCharges: number;
    legalAttackCount: number;
    automaticSuppressionTargetId: string | null;
  }>;
  uncontainedInfectedSites: string[];
  criticalAlerts: CrisisAlertViewModel[];
  forecastGuaranteedDefeat: boolean;
}

export function endTurnRiskViewModel(observation: Readonly<AgentObservation> | UnknownRecord): EndTurnRiskViewModel {
  const source = unknownRecord(observation);
  const risk = unknownRecord(source.endTurnRisk ?? source.endTurn);
  const ids = (value: unknown): string[] => Array.isArray(value)
    ? value.filter((id): id is string => typeof id === 'string').slice(0, 128)
    : [];
  const attackChargeUnits = Array.isArray(risk.unitsWithAttackChargesRemaining)
    ? risk.unitsWithAttackChargesRemaining.map((entry, index) => {
      if (typeof entry === 'string') {
        return {
          unitId: entry,
          remainingMove: 0,
          remainingAttackCharges: 1,
          legalAttackCount: 0,
          automaticSuppressionTargetId: null,
        };
      }
      const unit = unknownRecord(entry);
      return {
        unitId: typeof unit.unitId === 'string' ? unit.unitId : `unit-${index}`,
        remainingMove: boundedCount(unit.remainingMove),
        remainingAttackCharges: boundedCount(unit.remainingAttackCharges),
        legalAttackCount: boundedCount(unit.legalAttackCount),
        automaticSuppressionTargetId: typeof unit.automaticSuppressionTargetId === 'string'
          ? unit.automaticSuppressionTargetId
          : null,
      };
    }).filter((entry) => entry.unitId.length > 0).slice(0, 128)
    : [];
  const crisis = crisisSummaryViewModel(observation);
  const criticalIds = new Set(crisis.alerts.filter((alert) => alert.severity === 'critical').map((alert) => alert.id));
  const criticalAlerts = crisis.alerts.filter((alert) => criticalIds.has(alert.id));
  return {
    readyUnits: ids(risk.readyUnits),
    unitsWithMoveRemaining: ids(risk.unitsWithMoveRemaining),
    unitsWithAttackChargesRemaining: attackChargeUnits.length > 0
      ? attackChargeUnits
      : ids(risk.unitsWithAttackRemaining).map((unitId) => ({
        unitId,
        remainingMove: 0,
        remainingAttackCharges: 1,
        legalAttackCount: 0,
        automaticSuppressionTargetId: null,
      })),
    uncontainedInfectedSites: ids(risk.uncontainedInfectedSites),
    criticalAlerts,
    forecastGuaranteedDefeat: risk.forecastGuaranteedDefeat === true
      || unknownRecord(source.strategicForecast).guaranteedDefeat !== undefined
        && unknownRecord(source.strategicForecast).guaranteedDefeat !== null
        && unknownRecord(unknownRecord(source.strategicForecast).guaranteedDefeat).guaranteed === true,
  };
}

/** True when the Core says Human UI should ask before EndTurn. */
export function shouldConfirmEndTurn(
  summary: CrisisSummaryViewModel,
  risk: EndTurnRiskViewModel,
): boolean {
  return summary.criticalCount > 0
    || risk.criticalAlerts.length > 0
    || risk.unitsWithAttackChargesRemaining.length > 0
    || risk.uncontainedInfectedSites.length > 0
    || risk.forecastGuaranteedDefeat;
}

function overviewSectionMarkup(
  section: OverviewSectionKey,
  title: string,
  summary: string,
  content: string,
  open: boolean,
  locale: Locale,
): string {
  const t = createTranslator(locale);
  const actionLabel = open ? t('collapseSection') : t('expandSection');
  return `<section class="overview-section overview-${section}" data-overview-section="${section}"><button type="button" class="overview-section-toggle" data-action="toggle-overview" data-section="${section}" aria-expanded="${String(open)}" aria-controls="overview-content-${section}" aria-label="${escapeHtml(`${title}: ${actionLabel}`)}"><span class="overview-section-title"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(summary)}</small></span><span class="overview-chevron" aria-hidden="true">${open ? '⌄' : '›'}</span></button><div id="overview-content-${section}" class="overview-section-content"${open ? '' : ' hidden'}>${content}</div></section>`;
}

function crisisEntityTarget(alert: CrisisAlertViewModel): { kind: string; id: string } | null {
  const facts = alert.publicFacts;
  let kind = typeof facts.entityKind === 'string' ? facts.entityKind : typeof facts.siteKind === 'string' ? facts.siteKind : '';
  if (!kind) {
    kind = alert.category === 'unit_supply'
      ? 'unit'
      : alert.category === 'checkpoint_defense'
        ? 'checkpoint'
        : alert.category === 'infection'
          ? 'facility'
          : '';
  }
  const id = typeof facts.entityId === 'string' ? facts.entityId : alert.entityIds[0] ?? '';
  if (!id || !['unit', 'zombie', 'facility', 'checkpoint'].includes(kind)) return null;
  return { kind, id };
}

function renderCrisisList(
  summary: CrisisSummaryViewModel,
  locale: Locale,
  expandedGroups: ReadonlySet<CrisisAlertViewModel['severity']> = new Set(),
): string {
  const t = createTranslator(locale);
  if (summary.alerts.length === 0) return `<div class="empty-state crisis-empty"><span class="empty-glyph">✓</span><p>${escapeHtml(t('crisisNone'))}</p></div>`;
  const groups: Array<CrisisAlertViewModel['severity']> = ['critical', 'warning', 'advisory'];
  const content = groups.map((severity) => {
    const alerts = summary.alerts.filter((alert) => alert.severity === severity);
    if (alerts.length === 0) return '';
    const expanded = expandedGroups.has(severity);
    const visible = expanded ? alerts : alerts.slice(0, 3);
    const rows = visible.map((alert) => {
      const target = crisisEntityTarget(alert);
      const facts = crisisFactsLabel(alert, locale);
      const attrs = target
        ? ` data-entity-kind="${escapeHtml(target.kind)}" data-entity-id="${escapeHtml(target.id)}"`
        : '';
      const q = typeof alert.publicFacts.q === 'number' ? Math.trunc(alert.publicFacts.q) : null;
      const r = typeof alert.publicFacts.r === 'number' ? Math.trunc(alert.publicFacts.r) : null;
      const coordinateAttrs = q !== null && r !== null ? ` data-q="${q}" data-r="${r}"` : '';
      const tag = target || coordinateAttrs ? 'button' : 'article';
      const close = tag === 'button' ? ` type="button" class="crisis-alert crisis-alert-action" data-action="focus-crisis-alert"${attrs}${coordinateAttrs}` : ' class="crisis-alert"';
      return `<${tag}${close}><span class="crisis-alert-severity" aria-hidden="true">${severity === 'critical' ? '!' : severity === 'warning' ? '⚠' : 'i'}</span><span class="crisis-alert-copy"><strong>${escapeHtml(crisisReasonLabel(alert, locale))}</strong>${facts ? `<small>${escapeHtml(facts)}</small>` : ''}</span></${tag}>`;
    }).join('');
    const more = alerts.length > visible.length ? `<button type="button" class="text-button crisis-more" data-action="show-more-crisis" data-crisis-severity="${severity}">${escapeHtml(t('crisisMore').replace('{0}', String(alerts.length - visible.length)))}</button>` : '';
    return `<section class="crisis-group severity-${severity}" data-crisis-group="${severity}"><h4>${escapeHtml(t(`crisisSeverity.${severity}`))} <small>${alerts.length}</small></h4><div class="crisis-alert-list">${rows}</div>${more}</section>`;
  }).join('');
  return `<div class="crisis-list">${content}</div>`;
}

export interface UnitActionAvailability {
  move: boolean;
  attack: boolean;
  wait: boolean;
}

export interface CheckpointCandidateViewModel {
  candidate: CheckpointPositionCandidate;
  reason: string | null;
}

export type CheckpointRole = 'active' | 'standby' | 'dormant' | 'remnant' | 'ruined' | 'abandoned';

export interface CheckpointRoleViewModel {
  id: string;
  branchId: RoadBranchId;
  position: HexCoord;
  status: CheckpointStatus;
  role: CheckpointRole;
  waiting: number;
  screening: number;
  approved: number;
  infected: number;
}

export interface BranchPanelViewModel {
  branchId: RoadBranchId;
  direction: CardinalDirection | string;
  activeCheckpointId: string | null;
  standbyCheckpointIds: string[];
  dormantCheckpointIds: string[];
  fallbackAvailable: boolean;
  currentPolicy: CheckpointPolicy;
  preparedPostCount: number;
  preparedPostLimit: number;
  checkpoints: CheckpointRoleViewModel[];
}

type UnknownRecord = Record<string, unknown>;

function unknownRecord(value: unknown): UnknownRecord {
  return value && typeof value === 'object' ? value as UnknownRecord : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === 'string')
    : [];
}

function checkpointBranchId(checkpoint: Pick<CheckpointState, 'branchId' | 'direction'>): RoadBranchId {
  return checkpoint.branchId ?? checkpoint.direction;
}

function branchStateFor(state: Readonly<GameState>, branchId: RoadBranchId): UnknownRecord {
  const branch = (state.roadBranches ?? []).find((candidate) => candidate.branchId === branchId);
  return unknownRecord(branch);
}

/** Derive role from the Core branch role sources; CheckpointState has no copy. */
export function checkpointRoleFor(
  state: Readonly<GameState>,
  checkpoint: Readonly<CheckpointState>,
): CheckpointRole {
  // Delegate to the Core's common pure function so Human UI, Observation,
  // Headless and Agent cannot drift on role derivation.
  return deriveCheckpointRole(state, checkpoint);
}

function checkpointRoleViewModel(state: Readonly<GameState>, checkpoint: Readonly<CheckpointState>): CheckpointRoleViewModel {
  return {
    id: checkpoint.id,
    branchId: checkpointBranchId(checkpoint),
    position: { ...checkpoint.position },
    status: checkpoint.status,
    role: checkpointRoleFor(state, checkpoint),
    waiting: Math.max(0, checkpoint.waiting ?? 0),
    screening: Math.max(0, checkpoint.screening ?? 0),
    approved: Math.max(0, checkpoint.approved ?? 0),
    infected: Math.max(0, checkpoint.infected ?? 0),
  };
}

/**
 * Build the branch-level administrative panel from public/Core state.  All
 * actionability remains in Core; this is a read-only projection only.
 */
export function branchPanelViewModel(
  state: Readonly<GameState>,
  branchId?: RoadBranchId,
): BranchPanelViewModel[] {
  const definitions = [...(state.map?.roadBranches ?? [])]
    .filter((definition) => !branchId || definition.id === branchId)
    .sort((left, right) => left.id.localeCompare(right.id));
  return definitions.map((definition) => {
    const id = definition.id;
    const branch = branchStateFor(state, id);
    const checkpoints = (state.checkpoints ?? [])
      .filter((checkpoint) => checkpointBranchId(checkpoint) === id)
      .map((checkpoint) => checkpointRoleViewModel(state, checkpoint))
      .sort((left, right) => left.id.localeCompare(right.id));
    const configuredActiveCheckpointId = typeof branch.activeCheckpointId === 'string'
      ? branch.activeCheckpointId
      : null;
    const activeCheckpointId = configuredActiveCheckpointId && checkpoints.some((checkpoint) =>
      checkpoint.id === configuredActiveCheckpointId && checkpoint.role === 'active')
      ? configuredActiveCheckpointId
      : checkpoints.find((checkpoint) => checkpoint.role === 'active')?.id ?? null;
    const standbyCheckpointIds = stringArray(branch.standbyCheckpointIds);
    const standby = standbyCheckpointIds.length > 0
      ? [...standbyCheckpointIds].sort()
      : checkpoints.filter((checkpoint) => checkpoint.role === 'standby').map((checkpoint) => checkpoint.id);
    const dormantCheckpointIds = stringArray(branch.dormantCheckpointIds);
    const dormant = dormantCheckpointIds.length > 0
      ? [...dormantCheckpointIds].sort()
      : checkpoints.filter((checkpoint) => checkpoint.role === 'dormant').map((checkpoint) => checkpoint.id);
    const configuredLimit = branch.preparedPostLimit;
    const fallbackLimit = unknownRecord(state.config?.checkpoint).maxPreparedPostsPerDirection;
    const preparedPostLimit = typeof configuredLimit === 'number'
      ? Math.max(0, Math.trunc(configuredLimit))
      : typeof fallbackLimit === 'number'
        ? Math.max(0, Math.trunc(fallbackLimit))
        : 3;
    const preparedPostCount = typeof branch.preparedPostCount === 'number'
      ? Math.max(0, Math.trunc(branch.preparedPostCount))
      : (activeCheckpointId ? 1 : 0) + standby.length;
    const currentPolicy = branch.currentPolicy === 'passThrough' || branch.currentPolicy === 'normal' || branch.currentPolicy === 'strict'
      ? branch.currentPolicy
      : 'normal';
    const activeCheckpoint = checkpoints.find((checkpoint) => checkpoint.id === activeCheckpointId && checkpoint.status === 'operational');
    const activeRoadIndex = activeCheckpoint
      ? definition.roadTiles.findIndex((position) => hexKey(position) === hexKey(activeCheckpoint.position))
      : -1;
    // This is deliberately structural: hidden Zombie blockers do not affect
    // the public fallbackAvailable flag. Match the Agent Observation rule by
    // requiring a reserve post on the capital side of the current Active.
    const fallbackAvailable = activeRoadIndex > 0 && [...standby, ...dormant].some((checkpointId) => {
      const reserve = checkpoints.find((checkpoint) => checkpoint.id === checkpointId);
      if (!reserve || reserve.status !== 'operational') return false;
      const reserveRoadIndex = definition.roadTiles.findIndex((position) => hexKey(position) === hexKey(reserve.position));
      return reserveRoadIndex >= 0 && reserveRoadIndex < activeRoadIndex;
    });
    return {
      branchId: id,
      direction: definition.direction,
      activeCheckpointId,
      standbyCheckpointIds: [...standby],
      dormantCheckpointIds: [...dormant],
      fallbackAvailable,
      currentPolicy,
      preparedPostCount,
      preparedPostLimit,
      checkpoints,
    };
  });
}

/**
 * Render branch role and fallback depth without revealing hidden blocker
 * information. This helper is intentionally independent from Phaser.
 */
export function renderBranchPanel(
  state: Readonly<GameState>,
  locale: Locale,
): string {
  const t = createTranslator(locale);
  const panels = branchPanelViewModel(state);
  const roleLabel = (role: CheckpointRole): string => t(`checkpointRole.${role}`);
  return `<section class="branch-panel" data-branch-panel="true" aria-labelledby="branch-panel-heading"><div class="section-heading"><h3 id="branch-panel-heading">${escapeHtml(t('branchPanel'))}</h3><span class="status-chip">${escapeHtml(t('branchRoleLimit'))}</span></div>${panels.map((panel) => {
    const checkpoint = (id: string) => panel.checkpoints.find((candidate) => candidate.id === id);
    const roleChip = (id: string, role: CheckpointRole): string => {
      const item = checkpoint(id);
      return `<span class="branch-role-chip role-${role}" data-checkpoint-id="${escapeHtml(id)}" data-checkpoint-role="${role}"><strong>${escapeHtml(roleLabel(role))}</strong><small>${escapeHtml(id)}${item ? ` · ${item.position.q},${item.position.r}` : ''}</small></span>`;
    };
    const active = panel.activeCheckpointId ? roleChip(panel.activeCheckpointId, 'active') : `<span class="muted">${escapeHtml(t('noCheckpoint'))}</span>`;
    const standby = panel.standbyCheckpointIds.map((id) => roleChip(id, 'standby')).join('') || `<span class="muted">${escapeHtml(t('none'))}</span>`;
    const dormant = panel.dormantCheckpointIds.map((id) => roleChip(id, 'dormant')).join('') || `<span class="muted">${escapeHtml(t('none'))}</span>`;
    const lifecycle = panel.checkpoints
      .filter((checkpoint) => checkpoint.role === 'remnant' || checkpoint.role === 'ruined' || checkpoint.role === 'abandoned')
      .map((checkpoint) => roleChip(checkpoint.id, checkpoint.role))
      .join('') || `<span class="muted">${escapeHtml(t('none'))}</span>`;
    return `<article class="branch-panel-card" data-branch-id="${escapeHtml(panel.branchId)}" data-active-checkpoint-id="${escapeHtml(panel.activeCheckpointId ?? '')}" data-standby-checkpoint-ids="${escapeHtml(panel.standbyCheckpointIds.join(','))}" data-dormant-checkpoint-ids="${escapeHtml(panel.dormantCheckpointIds.join(','))}" data-fallback-available="${String(panel.fallbackAvailable)}" data-current-policy="${escapeHtml(panel.currentPolicy)}" data-prepared-count="${panel.preparedPostCount}" data-prepared-limit="${panel.preparedPostLimit}"><div class="branch-flow-heading"><strong>${escapeHtml(formatDirection(panel.direction as CardinalDirection, locale))} · ${escapeHtml(panel.branchId)}</strong><span class="status-chip ${panel.fallbackAvailable ? 'is-supplied' : ''}">${escapeHtml(panel.fallbackAvailable ? t('fallbackAvailable') : t('fallbackUnavailable'))}</span></div><dl class="branch-panel-grid"><div><dt>${escapeHtml(t('activeCheckpoint'))}</dt><dd>${active}</dd></div><div><dt>${escapeHtml(t('standbyCheckpoint'))}</dt><dd>${standby}</dd></div><div><dt>${escapeHtml(t('dormantCheckpoint'))}</dt><dd>${dormant}</dd></div><div><dt>${escapeHtml(t('checkpointRole'))}</dt><dd>${lifecycle}</dd></div><div><dt>${escapeHtml(t('checkpointPolicy'))}</dt><dd>${escapeHtml(t(panel.currentPolicy))}</dd></div><div><dt>${escapeHtml(t('preparedPostCount'))}</dt><dd>${panel.preparedPostCount}/${panel.preparedPostLimit}</dd></div></dl></article>`;
  }).join('')}</section>`;
}

export type NoiseClass = 'small' | 'medium' | 'large' | 'extraLarge';

/** Production-safe class mapping. Exact Core radii never cross this helper. */
export function noiseClassForUnit(unitType: string): NoiseClass | null {
  if (unitType === 'police') return 'medium';
  if (unitType === 'nationalGuard') return 'large';
  return null;
}

/**
 * Render only the public portion of Noise events.  Even if a malformed or
 * internal event accidentally reaches this function, exact radii, affected
 * IDs, counts, and target memory are intentionally ignored.
 */
export function renderNoiseEventLog(
  state: Pick<Readonly<GameState>, 'events'>,
  locale: Locale,
  limit = 6,
): string {
  const t = createTranslator(locale);
  const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.trunc(limit)) : 0;
  const noiseEvents = [...(state.events ?? [])].filter((event) => event.type === 'noise_emitted');
  const events = safeLimit === 0 ? [] : noiseEvents.slice(-safeLimit);
  if (events.length === 0) return '';
  const rows = events.map((event) => {
    const payload = unknownRecord(event.payload);
    const sourceUnitType = typeof payload.sourceUnitType === 'string' ? payload.sourceUnitType : t('unit');
    const noiseClass = payload.noiseClass === 'small' || payload.noiseClass === 'medium' || payload.noiseClass === 'large' || payload.noiseClass === 'extraLarge'
      ? payload.noiseClass
      : 'medium';
    const q = typeof payload.q === 'number' ? payload.q : null;
    const r = typeof payload.r === 'number' ? payload.r : null;
    const center = q !== null && r !== null ? `${q},${r}` : '—';
    const sourceTypeLabel = sourceUnitType === 'police' || sourceUnitType === 'nationalGuard'
      ? unitLabel(sourceUnitType, locale)
      : sourceUnitType;
    const source = typeof payload.sourceUnitId === 'string'
      ? `${payload.sourceUnitId} · ${sourceTypeLabel}`
      : sourceTypeLabel;
    const classLabel = t(`noiseClass${noiseClass[0]!.toUpperCase()}${noiseClass.slice(1)}`);
    return `<li><strong>${escapeHtml(t('noiseEmitted'))}</strong><span>${escapeHtml(source)} · ${escapeHtml(t('noiseClass'))}: ${escapeHtml(classLabel)} · ${escapeHtml(t('noiseCenter'))}: ${escapeHtml(center)}</span></li>`;
  }).join('');
  return `<section class="noise-log" data-noise-log="true"><h3>${escapeHtml(t('noiseLog'))}</h3><ul>${rows}</ul><p class="muted">${escapeHtml(t('noiseCombatHint'))}</p></section>`;
}

export type ImportantEventType = Extract<GameEvent['type'],
  | 'site_infection_started'
  | 'site_fallen'
  | 'site_chain_fallen'
  | 'site_zombies_spawned'
  | 'site_immediate_infection'
  | 'site_noise_respawn'>;

/** Public, UI-safe projection for the six site lifecycle events. */
export interface ImportantEventViewModel {
  id: string;
  turn: number;
  phase: GamePhase;
  type: ImportantEventType;
  siteKind: 'facility' | 'checkpoint';
  siteId: string;
  siteType: string;
  position: HexCoord;
  cause: string | null;
  amount: number | null;
  infectedAtFall: number | null;
  requestedSpawnCount: number | null;
  actualSpawnCount: number | null;
  remainingInfected: number | null;
  remainingHealthy: number | null;
  infected: number | null;
  constructibleInfectedDeaths: number | null;
  chainOriginEventId: string | null;
  chainDepth: number | null;
}

const IMPORTANT_EVENT_TYPES = new Set<ImportantEventType>([
  'site_infection_started',
  'site_fallen',
  'site_chain_fallen',
  'site_zombies_spawned',
  'site_immediate_infection',
  'site_noise_respawn',
]);

/**
 * Convert a Core event to the small public subset the Human UI needs.  In
 * particular, this never forwards raw payloads, spawnedUnitIds,
 * spawnedPositions, Noise radius, or affected Zombie IDs.
 */
export function projectImportantEvent(
  event: Pick<GameEvent, 'id' | 'turn' | 'phase' | 'type' | 'payload'>,
): ImportantEventViewModel | null {
  if (!IMPORTANT_EVENT_TYPES.has(event.type as ImportantEventType)) return null;
  const payload = unknownRecord(event.payload);
  const siteKind = payload.siteKind === 'facility' || payload.siteKind === 'checkpoint'
    ? payload.siteKind
    : null;
  const siteId = typeof payload.siteId === 'string' && payload.siteId.length > 0
    ? payload.siteId.slice(0, 256)
    : null;
  const siteType = typeof payload.siteType === 'string' && payload.siteType.length > 0
    ? payload.siteType.slice(0, 128)
    : null;
  const q = typeof payload.q === 'number' && Number.isSafeInteger(payload.q) ? payload.q : null;
  const r = typeof payload.r === 'number' && Number.isSafeInteger(payload.r) ? payload.r : null;
  if (!siteKind || !siteId || !siteType || q === null || r === null || typeof event.id !== 'string') return null;
  const nonNegative = (value: unknown): number | null => (
    typeof value === 'number' && Number.isFinite(value) && value >= 0
      ? Math.trunc(value)
      : null
  );
  const chainOriginEventId = payload.chainOriginEventId === null
    ? null
    : typeof payload.chainOriginEventId === 'string' && payload.chainOriginEventId.length > 0
      ? payload.chainOriginEventId.slice(0, 256)
      : null;
  return {
    id: event.id.slice(0, 256),
    turn: Number.isSafeInteger(event.turn) ? event.turn : 0,
    phase: event.phase,
    type: event.type as ImportantEventType,
    siteKind,
    siteId,
    siteType,
    position: { q, r },
    cause: typeof payload.cause === 'string' ? payload.cause.slice(0, 128) : null,
    amount: nonNegative(payload.amount),
    infectedAtFall: nonNegative(payload.infectedAtFall),
    requestedSpawnCount: nonNegative(payload.requestedSpawnCount),
    actualSpawnCount: nonNegative(payload.actualSpawnCount),
    remainingInfected: nonNegative(payload.remainingInfected),
    remainingHealthy: nonNegative(payload.remainingHealthy),
    infected: nonNegative(payload.infected),
    constructibleInfectedDeaths: nonNegative(payload.constructibleInfectedDeaths),
    chainOriginEventId,
    chainDepth: nonNegative(payload.chainDepth),
  };
}

/** Return the newest bounded site-event history without exposing raw payloads. */
export function importantEventViewModels(
  events: readonly GameEvent[],
  limit = 50,
): ImportantEventViewModel[] {
  const safeLimit = Number.isFinite(limit) ? Math.max(0, Math.trunc(limit)) : 0;
  if (safeLimit === 0) return [];
  return events
    .map((event) => projectImportantEvent(event))
    .filter((event): event is ImportantEventViewModel => event !== null)
    .slice(-safeLimit);
}

function importantEventLabelKey(type: ImportantEventType): string {
  return type === 'site_infection_started'
    ? 'importantEventInfectionStarted'
    : type === 'site_fallen'
      ? 'importantEventSiteFallen'
      : type === 'site_chain_fallen'
        ? 'importantEventChainFallen'
        : type === 'site_zombies_spawned'
          ? 'importantEventZombiesSpawned'
          : type === 'site_immediate_infection'
            ? 'importantEventImmediateInfection'
            : 'importantEventNoiseRespawn';
}

function importantEventTargetLabel(event: ImportantEventViewModel, locale: Locale): string {
  const target = event.siteKind === 'checkpoint'
    ? createTranslator(locale)('checkpoint')
    : facilityLabel(event.siteType, locale);
  return `${target} · ${event.siteId}`;
}

function importantEventSiteKey(event: ImportantEventViewModel): string {
  return `${event.siteKind}:${event.siteId}`;
}

function siteInfectedBeforeEvent(state: Readonly<GameState>, event: ImportantEventViewModel): number {
  if (event.siteKind === 'facility') {
    return state.facilities.find((facility) => facility.id === event.siteId)?.infected ?? 0;
  }
  return state.checkpoints.find((checkpoint) => checkpoint.id === event.siteId)?.infected ?? 0;
}

function importantEventCauseLabel(cause: string, locale: Locale): string {
  const t = createTranslator(locale);
  const labels: Record<string, string> = {
    latent_infection: t('eventCauseLatentInfection'),
    infection_fall: t('eventCauseInfectionFall'),
    zombie_occupation: t('eventCauseZombieOccupation'),
    empty_zombie_occupation: t('eventCauseEmptyZombieOccupation'),
    spawn_immediate_occupation: t('eventCauseSpawnOccupation'),
    combat_noise: t('eventCauseCombatNoise'),
  };
  return labels[cause] ?? cause;
}

/** Format one public event for both the history and a single-site Toast. */
export function formatImportantEvent(event: ImportantEventViewModel, locale: Locale): string {
  const t = createTranslator(locale);
  const details: string[] = [
    `${t('turn')} ${event.turn}`,
    importantEventTargetLabel(event, locale),
    `${event.position.q},${event.position.r}`,
  ];
  if (event.amount !== null) details.push(`${t('infectedAmount')} ${event.amount}`);
  if (event.infectedAtFall !== null) details.push(`${t('infectedAtFall')} ${event.infectedAtFall}`);
  if (event.cause) details.push(`${t('eventCause')} ${importantEventCauseLabel(event.cause, locale)}`);
  if (event.requestedSpawnCount !== null || event.actualSpawnCount !== null) {
    details.push(`${t('spawnCount')} ${event.actualSpawnCount ?? 0}/${event.requestedSpawnCount ?? event.actualSpawnCount ?? 0}`);
  }
  if (event.remainingInfected !== null) details.push(`${t('remainingInfected')} ${event.remainingInfected}`);
  if (event.remainingHealthy !== null) details.push(`${t('remainingHealthy')} ${event.remainingHealthy}`);
  if (event.infected !== null) details.push(`${t('infected')} ${event.infected}`);
  if (event.constructibleInfectedDeaths !== null && event.constructibleInfectedDeaths > 0) {
    details.push(`${t('constructibleInfectedDeaths')} ${event.constructibleInfectedDeaths}`);
  }
  if (event.chainOriginEventId) details.push(`${t('chainRoot')} ${event.chainOriginEventId}`);
  return `${t(importantEventLabelKey(event.type))} · ${details.join(' · ')}`;
}

/**
 * Aggregate all new important events from one atomic resolution.  A chain is
 * keyed by Core's chainOriginEventId; no UI timing or infection scan is used.
 */
export function importantEventToastText(
  events: readonly ImportantEventViewModel[],
  locale: Locale,
): string | null {
  if (events.length === 0) return null;
  const sites = new Set(events.map((event) => `${event.siteKind}:${event.siteId}`));
  const chainSites = new Map<string, Set<string>>();
  for (const event of events) {
    if (event.chainOriginEventId === null) continue;
    const groupSites = chainSites.get(event.chainOriginEventId) ?? new Set<string>();
    groupSites.add(importantEventSiteKey(event));
    chainSites.set(event.chainOriginEventId, groupSites);
  }
  const t = createTranslator(locale);
  // A normal fall commonly emits both a fall and a spawn event for one site;
  // keep that single-site Toast detailed.  Aggregate only a chain that spans
  // multiple sites, as required by the public rule.
  if ([...chainSites.values()].some((groupSites) => groupSites.size > 1)) {
    const chainCount = events.filter((event) => event.type === 'site_chain_fallen').length;
    return `${t('importantEventToastPrefix')} · ${sites.size} ${t('importantEventSiteUnit')}${chainCount > 0 ? ` · ${t('importantEventChainToast')}` : ''}`;
  }
  return `${t('importantEventToastPrefix')} · ${formatImportantEvent(events[events.length - 1]!, locale)}`;
}

/** Render at most 50 public site events; each item can pan to its public site. */
export function renderImportantEventHistory(
  events: readonly GameEvent[],
  locale: Locale,
  limit = 50,
): string {
  const t = createTranslator(locale);
  const history = importantEventViewModels(events, limit);
  if (history.length === 0) {
    return `<section class="important-event-history" data-important-event-history="true"><div class="section-heading"><h3>${escapeHtml(t('importantEventHistory'))}</h3></div><p class="muted">${escapeHtml(t('importantEventHistoryEmpty'))}</p></section>`;
  }
  const rows = history.map((event) => {
    const chain = event.chainOriginEventId
      ? ` data-chain-origin-event-id="${escapeHtml(event.chainOriginEventId)}"`
      : '';
    return `<li data-important-event-type="${escapeHtml(event.type)}"><button class="important-event-item" data-action="focus-important-event" data-important-event-id="${escapeHtml(event.id)}" data-site-kind="${escapeHtml(event.siteKind)}" data-site-id="${escapeHtml(event.siteId)}" data-q="${event.position.q}" data-r="${event.position.r}"${chain} aria-label="${escapeHtml(formatImportantEvent(event, locale))}"><span class="important-event-marker" aria-hidden="true">${event.type === 'site_noise_respawn' ? '◌' : event.type === 'site_chain_fallen' ? '↝' : '!'}</span><span>${escapeHtml(formatImportantEvent(event, locale))}</span></button></li>`;
  }).join('');
  return `<section class="important-event-history" data-important-event-history="true" aria-labelledby="important-event-history-heading"><div class="section-heading"><h3 id="important-event-history-heading">${escapeHtml(t('importantEventHistory'))}</h3><span class="status-chip">${history.length}/50</span></div><ol>${rows}</ol><p class="muted">${escapeHtml(t('importantEventHistoryHint'))}</p></section>`;
}

/** Localize Core-owned candidate results without duplicating checkpoint rules in the UI. */
export function checkpointCandidateViewModels(
  candidates: readonly CheckpointPositionCandidate[],
  locale: Locale,
): CheckpointCandidateViewModel[] {
  return candidates.map((candidate) => ({
    candidate: {
      ...candidate,
      position: { ...candidate.position },
    },
    reason: candidate.reasonCode ? localizeActionError(candidate.reasonCode, locale) : null,
  }));
}

export function actionForCheckpointCandidate(
  candidate: CheckpointPositionCandidate,
): GameAction {
  if (candidate.actionType === 'RelocateCheckpoint') {
    return {
      type: 'RelocateCheckpoint',
      checkpointId: candidate.checkpointId ?? '',
      branchId: candidate.branchId,
      position: { ...candidate.position },
    };
  }
  if (candidate.actionType === 'ActivateCheckpoint') {
    return {
      type: 'ActivateCheckpoint',
      branchId: candidate.branchId,
      checkpointId: candidate.checkpointId ?? '',
    };
  }
  return {
    type: 'BuildCheckpoint',
    branchId: candidate.branchId,
    position: { ...candidate.position },
  };
}

export interface BoardContextPlacement {
  left: number;
  top: number;
  vertical: 'above' | 'below';
}

export type UnitInteractionCancelStep = 'target' | 'mode' | 'selection' | 'none';

export function unitInteractionCancelStep(
  mode: UnitActionMode,
  hasTarget: boolean,
  hasSelection: boolean,
): UnitInteractionCancelStep {
  if (hasTarget) return 'target';
  if (mode) return 'mode';
  if (hasSelection) return 'selection';
  return 'none';
}

/** Derive menu availability only from the Core-provided legal action list. */
export function unitActionAvailability(actions: readonly GameAction[], unitId: string): UnitActionAvailability {
  return {
    move: actions.some((action) => action.type === 'Move' && action.unitId === unitId),
    attack: actions.some((action) => action.type === 'Attack' && action.attackerId === unitId),
    wait: actions.some((action) => action.type === 'Wait' && action.unitId === unitId),
  };
}

/**
 * Keep a board-side menu inside the visible board. Prefer above the anchor,
 * then flip below when the top edge would be crossed.
 */
export function placeBoardContextUi(
  anchor: Readonly<{ x: number; y: number }>,
  board: Readonly<{ width: number; height: number }>,
  menu: Readonly<{ width: number; height: number }>,
  margin = 8,
  gap = 34,
): BoardContextPlacement {
  const maxLeft = Math.max(margin, board.width - menu.width - margin);
  const left = Math.min(maxLeft, Math.max(margin, anchor.x - menu.width / 2));
  const above = anchor.y - gap - menu.height;
  const vertical = above >= margin ? 'above' : 'below';
  const preferredTop = vertical === 'above' ? above : anchor.y + gap;
  const maxTop = Math.max(margin, board.height - menu.height - margin);
  return {
    left: Math.min(maxLeft, Math.max(margin, left)),
    top: Math.min(maxTop, Math.max(margin, preferredTop)),
    vertical,
  };
}

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
    if (checkpoint) return { kind: 'checkpoint', id: checkpoint.id };
    // Road selection is intentionally limited to the fixed map's trunk-road
    // tiles.  Branch identity is derived from Core candidates later; keeping
    // only the position in UI state avoids adding another persisted contract.
    const roadBranches = state.map?.roadBranches ?? [];
    if (roadBranches.some((branch) => branch.roadTiles.some((tile) => samePosition(tile, position)))) {
      return { kind: 'road', position: { ...position } };
    }
    // Domestic mode can inspect any otherwise-empty public Hex so local
    // Constructible actions can be shown at exactly the selected location.
    const occupied = state.units.some((candidate) => candidate.actionState !== 'destroyed' && samePosition(candidate.position, position));
    if (!occupied) return { kind: 'hex', position: { ...position } };
    return null;
  }

  const unit = state.units.find(
    (candidate) => candidate.actionState !== 'destroyed' && candidate.isPlayerUnit &&
      candidate.position.q === position.q && candidate.position.r === position.r,
  );
  if (unit) return { kind: 'unit', id: unit.id };
  if (facility) return { kind: 'facility', id: facility.id };
  if (checkpoint) return { kind: 'checkpoint', id: checkpoint.id };
  const visibleKeys = (() => {
    try {
      return getPlayerVisibleTileKeys(state);
    } catch {
      return new Set<string>();
    }
  })();
  const zombie = state.units.find((candidate) => !candidate.isPlayerUnit
    && candidate.actionState !== 'destroyed'
    && samePosition(candidate.position, position)
    && visibleKeys.has(hexKey(candidate.position)));
  if (zombie) return { kind: 'zombie', id: zombie.id };
  // A public empty tile remains selectable in Map mode for inspection. The
  // tile itself is read from AgentObservation in the sheet.
  const tile = state.map?.tiles?.find((candidate) => samePosition(candidate, position));
  return tile ? { kind: 'hex', position: { ...position } } : null;
}

function unselectedPrompt(mode: NavigationMode, locale: Locale): string {
  const t = createTranslator(locale);
  if (mode === 'domestic') return locale === 'ja' ? '施設または幹線道路Hexを選択してください' : 'Select a facility or trunk-road Hex';
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

/**
 * The compact power pill is deliberately derived from the public forecast in
 * one place.  The numerator is Required demand and the denominator is the
 * generation that is actually available this turn.  In particular, this
 * helper does not infer shortage from those two numbers: `electricity.shortage`
 * remains the Core's source of truth.
 */
export interface PowerHudViewModel {
  demand: number;
  available: number;
  requiredAllocated: number;
  shortage: number;
  display: string;
  label: string;
  accessibleName: string;
  tooltip: string;
  isShortage: boolean;
}

export type PowerHudForecast = Readonly<Pick<
  EndTurnForecast['electricity'],
  | 'availableGenerationCapacity'
  | 'requiredPowerDemand'
  | 'requiredPowerAllocated'
  | 'shortage'
>>;

export function powerHudViewModel(
  electricity: PowerHudForecast,
  locale: Locale,
): PowerHudViewModel {
  const t = createTranslator(locale);
  const demand = electricity.requiredPowerDemand;
  const available = electricity.availableGenerationCapacity;
  const isShortage = electricity.shortage > 0;
  const shortage = electricity.shortage;
  const label = t('powerHudLabel');
  const accessibleName = locale === 'ja'
    ? `${label}。${t('projectedPowerDemand')} ${demand}、${t('availablePowerSupply')} ${available}、${t('powerHudAccessibleShortage')} ${shortage}`
    : `${label}: ${t('projectedPowerDemand')} ${demand}, ${t('availablePowerSupply')} ${available}, ${t('powerHudAccessibleShortage')} ${shortage}`;
  const tooltip = locale === 'ja'
    ? `${t('projectedPowerDemand')}: ${demand} · ${t('availablePowerSupply')}: ${available} · ${t('requiredPowerAllocated')}: ${electricity.requiredPowerAllocated} · ${t('shortage')}: ${shortage}`
    : `${t('projectedPowerDemand')}: ${demand} · ${t('availablePowerSupply')}: ${available} · ${t('requiredPowerAllocated')}: ${electricity.requiredPowerAllocated} · ${t('shortage')}: ${shortage}`;
  return {
    demand,
    available,
    requiredAllocated: electricity.requiredPowerAllocated,
    shortage,
    display: `${demand}/${available}`,
    label,
    accessibleName,
    tooltip,
    isShortage,
  };
}

export type StrategicWarningTier = 'critical' | 'high' | 'warning' | 'info';

export interface StrategicWarningViewModel {
  tier: StrategicWarningTier;
  key: string;
  title: string;
  detail: string;
}

const STRATEGIC_RESOURCES = ['food', 'civilianGoods', 'militaryGoods', 'fuel', 'electricity'] as const;

function queuePressureLabel(value: AgentObservation['checkpoints'][number]['queuePressureClass'], locale: Locale): string {
  const t = createTranslator(locale);
  return t(`queuePressure${value[0]!.toUpperCase()}${value.slice(1)}`);
}

/**
 * Build the visible warning hierarchy from the Core-owned Strategic Forecast.
 * This projection intentionally consumes only public Observation fields: no
 * hidden Zombie position, target, or future RNG value is consulted here.
 */
export function strategicWarningViewModel(
  observation: Pick<AgentObservation, 'strategicForecast' | 'checkpoints' | 'checkpointPositionCandidates'>,
  locale: Locale,
): StrategicWarningViewModel[] {
  const t = createTranslator(locale);
  const warnings: StrategicWarningViewModel[] = [];
  const forecast = observation.strategicForecast;
  const defeat = forecast.guaranteedDefeat;
  if (defeat.guaranteed) {
    const cause = defeat.causeResource ? t(defeat.causeResource) : t('healthyCivilians');
    warnings.push({
      tier: 'critical',
      key: 'guaranteedDefeat',
      title: t('guaranteedDefeat'),
      detail: `${t('causeResource')}: ${cause} · ${t('projectedHealthyCivilians')}: ${defeat.projectedHealthyCivilians} · ${t('guaranteedDefeatBody')}`,
    });
  }
  for (const resource of STRATEGIC_RESOURCES) {
    // Fuel has a dedicated, lower-tier logistics warning.  Keep it out of
    // the generic current-shortage bucket so the documented hierarchy does
    // not turn a refill shortfall into the same tier as Food/Electricity.
    if (resource === 'fuel') continue;
    const entry = forecast.resources[resource];
    if (!entry?.currentlyShort) continue;
    warnings.push({
      tier: 'high',
      key: `shortage:${resource}`,
      title: `${t('forecastShortage')}: ${t(resource)}`,
      detail: `${t('shortage')}: ${resource === 'electricity' ? entry.currentDemand - entry.currentSupply : Math.max(0, entry.currentDemand - entry.currentSupply)}`,
    });
  }
  for (const checkpoint of observation.checkpoints) {
    if (checkpoint.queuePressureClass !== 'high') continue;
    warnings.push({
      tier: 'high',
      key: `queue:${checkpoint.id}`,
      title: `${t('queuePressure')} · ${t('strategicHigh')}`,
      detail: `${checkpoint.id} · ${queuePressureLabel(checkpoint.queuePressureClass, locale)} · ${t('queuePeople')}: ${checkpoint.queuePeople}/${checkpoint.screeningCapacity}`,
    });
  }
  for (const resource of STRATEGIC_RESOURCES) {
    const entry = forecast.resources[resource];
    if (!entry?.singlePointOfFailure) continue;
    warnings.push({
      tier: 'warning',
      key: `single-point:${resource}`,
      title: `${t('singlePointOfFailure')}: ${t(resource)}`,
      detail: `${t('largestContributor')}: ${entry.largestContributorFacilityId ?? t('none')} · ${t('shortageWithoutContributor')}: ${entry.shortageWithoutLargestContributor}`,
    });
  }
  const noGain = observation.checkpointPositionCandidates.find((candidate) =>
    candidate.legal && (candidate.actionType === 'RelocateCheckpoint' || candidate.actionType === 'ActivateCheckpoint') &&
      (candidate.newlySuppliedHexCount ?? 0) === 0 && (candidate.suppliedFacilityDelta ?? 0) === 0 &&
      (candidate.newlyBuildableConstructibleHexCount ?? 0) === 0,
  );
  if (noGain) {
    warnings.push({
      tier: 'warning',
      key: `checkpoint-no-gain:${noGain.branchId}:${noGain.position.q},${noGain.position.r}`,
      title: t('noGainCheckpoint'),
      detail: `${noGain.branchId} · ${noGain.position.q},${noGain.position.r}`,
    });
  }
  const hasFuelShortage = Boolean(forecast.resources.fuel?.currentlyShort);
  if (hasFuelShortage) {
    warnings.push({ tier: 'warning', key: 'fuel-shortage', title: t('fuelShortage'), detail: t('tipFuel') });
  }
  const queueInfo = observation.checkpoints
    .filter((checkpoint) => checkpoint.queuePressureClass === 'low' || checkpoint.queuePressureClass === 'medium')
    .sort((left, right) => left.id.localeCompare(right.id))[0];
  if (queueInfo) {
    warnings.push({
      tier: 'info',
      key: `queue-info:${queueInfo.id}`,
      title: `${t('queuePressure')} · ${queuePressureLabel(queueInfo.queuePressureClass, locale)}`,
      detail: `${queueInfo.id} · ${t('queuePeople')}: ${queueInfo.queuePeople}/${queueInfo.screeningCapacity}`,
    });
  }
  if (warnings.length === 0) {
    warnings.push({ tier: 'info', key: 'normal-forecast', title: t('forecastNormal'), detail: t('strategicForecast') });
  }
  const order: Record<StrategicWarningTier, number> = { critical: 0, high: 1, warning: 2, info: 3 };
  return warnings.sort((left, right) => order[left.tier] - order[right.tier] || left.key.localeCompare(right.key));
}

export function renderStrategicWarnings(
  observation: Pick<AgentObservation, 'strategicForecast' | 'checkpoints' | 'checkpointPositionCandidates'>,
  locale: Locale,
  options: { compact?: boolean } = {},
): string {
  const t = createTranslator(locale);
  const warnings = strategicWarningViewModel(observation, locale);
  const visible = options.compact ? warnings.filter((warning) => warning.tier === 'critical').slice(0, 1) : warnings;
  if (visible.length === 0) return '';
  return `<section class="strategic-warnings${options.compact ? ' strategic-warnings-compact' : ''}" data-strategic-warnings="true" aria-label="${escapeHtml(t('strategicForecast'))}">${visible.map((warning) => `<article class="strategic-warning tier-${warning.tier}" data-warning-tier="${warning.tier}" data-warning-key="${escapeHtml(warning.key)}"><strong>${escapeHtml(t(`strategic${warning.tier[0]!.toUpperCase()}${warning.tier.slice(1)}`))}: ${escapeHtml(warning.title)}</strong><span>${escapeHtml(warning.detail)}</span></article>`).join('')}</section>`;
}

/**
 * The Help legend accepts the UI registry without making the Core depend on
 * asset paths.  Keeping the small structural interface here also lets the
 * legend remain testable when Phaser and the runtime loader are unavailable.
 * `boardAssets.ts` supplies the concrete registry at runtime; the symbolic
 * fallback is used only while an asset registry is not available (for example
 * in a headless view-model test).
 */
export interface BoardLegendAsset {
  path?: string;
  lodPath?: string;
  label?: string;
  symbol?: string;
}

export type BoardLegendRegistry = Readonly<Record<string, unknown>>;

export interface BoardLegendEntry {
  key: string;
  label: string;
  description: string;
  path: string | null;
  lodPath: string | null;
  paths?: readonly string[];
  symbol: string;
}

export interface BoardLegendSection {
  key: string;
  title: string;
  entries: BoardLegendEntry[];
}

export interface BoardLegendViewModel {
  config: Readonly<GameConfig>;
  configSource: 'current' | 'standard';
  sections: BoardLegendSection[];
}

const LEGEND_TERRAINS = ['plain', 'forest', 'mountain'] as const;
const LEGEND_OVERLAYS = ['road', 'urban'] as const;
const LEGEND_UNITS = ['police', 'nationalGuard', 'riotPolice', 'zombie', 'hordeZombie', 'policeZombie', 'soldierZombie', 'riotZombie', 'hunterZombie'] as const;
const LEGEND_FACILITIES = ['capital', 'city', 'farm', 'civilianFactory', 'militaryFactory', 'refinery', 'powerPlant', 'windPowerPlant', 'simpleFarm', 'civilianDroneBase', 'checkpoint'] as const;

function legendAssetFromRegistry(
  registry: BoardLegendRegistry | undefined,
  category: string,
  key: string,
): BoardLegendAsset | undefined {
  if (!registry || typeof registry !== 'object') return undefined;
  const root = registry as Record<string, unknown>;
  const categoryName = category === 'overlay' || category.endsWith('State') || category === 'horde'
    ? 'overlays'
    : category === 'facility'
      ? 'facilities'
      : category === 'unit'
        ? 'units'
        : category;
  const categoryValue = root[categoryName];
  const categoryEntries = categoryValue && typeof categoryValue === 'object'
    ? categoryValue as Record<string, unknown>
    : undefined;
  const aliases: Record<string, string> = category === 'facilityState'
    ? { unowned: 'unsecured', owned: 'secured' }
    : category === 'checkpointState'
      ? { operational: 'checkpointOperational', abandoned: 'checkpointAbandoned', remnant: 'checkpointRemnant' }
      : category === 'horde'
        ? { periodic: 'horde', final: 'final' }
        : {};
  const candidateKey = aliases[key] ?? key;
  const candidate = categoryEntries?.[candidateKey];
  const nested = candidate && typeof candidate === 'object' ? candidate as Record<string, unknown> : undefined;
  if (typeof candidate === 'string') return { path: candidate };
  if (!nested) return undefined;
  return {
    path: typeof nested.path === 'string' ? nested.path : typeof nested.src === 'string' ? nested.src : undefined,
    lodPath: typeof nested.lodPath === 'string' ? nested.lodPath : typeof nested.lod === 'string' ? nested.lod : undefined,
    label: typeof nested.label === 'string' ? nested.label : undefined,
    symbol: typeof nested.symbol === 'string' ? nested.symbol : undefined,
  };
}

function legendAssetEntry(
  registry: BoardLegendRegistry | undefined,
  category: string,
  key: string,
  label: string,
  description: string,
  symbol: string,
): BoardLegendEntry {
  const asset = legendAssetFromRegistry(registry, category, key);
  return {
    key,
    label: asset?.label ?? label,
    description,
    path: asset?.path ?? null,
    lodPath: asset?.lodPath ?? null,
    symbol: asset?.symbol ?? symbol,
  };
}

function legendCompositeEntry(
  registry: BoardLegendRegistry | undefined,
  key: string,
  label: string,
  description: string,
  layers: ReadonlyArray<readonly [string, string]>,
  symbol: string,
): BoardLegendEntry {
  const paths = layers
    .map(([category, layer]) => legendAssetFromRegistry(registry, category, layer)?.path)
    .filter((path): path is string => Boolean(path));
  return {
    key,
    label,
    description,
    path: paths[0] ?? null,
    lodPath: null,
    paths: paths.length > 0 ? paths : undefined,
    symbol,
  };
}

function configLegendEntry(
  key: string,
  label: string,
  value: string,
): BoardLegendEntry {
  return legendAssetEntry(undefined, 'config', key, label, value, '·');
}

function configLegendEntries(
  config: Readonly<GameConfig>,
  locale: Locale,
): BoardLegendEntry[] {
  const t = createTranslator(locale);
  const entries: BoardLegendEntry[] = [];
  const add = (key: string, label: string, value: string): void => {
    entries.push(configLegendEntry(key, label, value));
  };
  const terrainCost = config.terrain.movementCost;
  add('movementCostPlain', t('legendMovementCostPlain'), String(terrainCost.plain));
  add('movementCostForest', t('legendMovementCostForest'), String(terrainCost.forest));
  add('movementCostMountain', t('legendMovementCostMountain'), String(terrainCost.mountain));
  add('urbanDefenseMultiplier', t('legendUrbanDefenseMultiplier'), `×${config.terrain.damageMultiplier.urban}`);
  add('forestDefenseMultiplier', t('legendForestDefenseMultiplier'), `×${config.terrain.damageMultiplier.forestZombie}`);
  add('ownedFacilityVision', t('legendOwnedFacilityVision'), String(config.vision.ownedFacility));
  add('operationalCheckpointVision', t('legendOperationalCheckpointVision'), String(config.vision.operationalCheckpoint));
  add('capitalVision', t('legendCapitalVision'), String(config.vision.capital));
  add('groundVisionBlocking', t('legendGroundVisionBlocking'), `${t('forest')} / ${t('mountain')}`);
  add('aerialVision', t('legendAerialVision'), t('visionAerialLegend'));

  for (const key of LEGEND_UNITS) {
    const unit = unknownRecord((config.units as unknown as UnknownRecord)[key]);
    if (Object.keys(unit).length === 0) continue;
    const attack = unit.attack ?? unit.recruitAttack ?? 0;
    const attackCharges = typeof unit.maxAttackCharges === 'number'
      ? String(Math.max(0, Math.trunc(unit.maxAttackCharges)))
      : `${t('proficiency.recruit')} 1 / ${t('proficiency.regular')} 1 / ${t('proficiency.veteran')} ${config.unitExperience.veteranAttackCharges}`;
    add(`unit.${key}`, unitLabel(key, locale), `${t('legendHp')} ${unit.hp ?? 0} · ${t('legendAttack')} ${attack} · ${t('legendMovement')} ${unit.movement ?? 0} · ${t('legendRange')} ${unit.range ?? 0} · ${t('legendVision')} ${unit.vision ?? 0} · ${t('legendPopulation')} ${unit.population ?? 0} · ${t('legendAttackCharges')} ${attackCharges}`);
  }
  for (const key of LEGEND_FACILITIES) {
    if (key === 'checkpoint') continue;
    const facility = config.facilities[key];
    const production = facility.production;
    const generation = production.fixedPowerGeneration > 0
      ? `${production.fixedPowerGeneration} ${t('fixed')}`
      : String(production.powerGeneration);
    const build = facility.buildCivilianGoods > 0 ? ` · ${t('buildCost')} ${facility.buildCivilianGoods}` : '';
    const target = facility.zombieTargetValue > 0 ? ` · ${t('zombieTargetValue')} ${facility.zombieTargetValue}` : '';
    add(`facility.${key}`, facilityLabel(key, locale), `${t('legendWorkers')} ${facility.workerCapacity} · ${t('legendMode')} ${powerModeLabel(production.powerMode, locale)} · ${t('legendPowerCapacity')} ${production.powerCapacity} · ${t('legendPowerGeneration')} ${generation} · ${t('legendInputs')} ${formatResourceAmounts(production.inputs, locale, true)} · ${t('legendOutputs')} ${formatResourceAmounts(production.outputs, locale, true)}${build}${target}`);
  }
  add('populationConsumption', t('legendPopulationConsumption'), `${t('food')} ${config.economy.populationConsumption.food} · ${t('civilianGoods')} ${config.economy.populationConsumption.civilianGoods}`);
  for (const key of ['police', 'nationalGuard', 'riotPolice'] as const) {
    const unit = unknownRecord((config.units as unknown as UnknownRecord)[key]);
    if (Object.keys(unit).length === 0) continue;
    const attackCosts = Object.entries(unknownRecord(unit.attackMilitaryGoodsCostByRange))
      .sort(([left], [right]) => Number(left) - Number(right))
      .map(([range, cost]) => `${t('distance')} ${range}: ${cost}`)
      .join(' / ');
    add(`militaryGoods.${key}`, `${unitLabel(key, locale)} · ${t('carriedMilitaryGoods')}`, `${t('max')} ${unit.maxMilitaryGoods ?? 0} · ${t('fixedConsumption')} ${unit.fixedMilitaryGoodsUpkeepPerTurn ?? 0} · ${t('attackCostByDistance')} ${attackCosts} · ${t('suppression')} ${unit.suppressionMilitaryGoodsCost ?? 0} · ${t('emergencyMovement')} ${unit.emergencyMovementPoints ?? 0} MP`);
  }
  add('maxActionsPerTurn', t('maxActionsPerTurn'), String(config.maxActionsPerTurn));
  add('hordeWarningLeadTurns', t('hordeWarningLeadTurns'), String(config.horde.warningLeadTurns));
  config.horde.waves.forEach((wave, index) => {
    const composition = hordeCompositionLabel(wave, locale, config);
    const waveKind = wave.final ? t('finalHorde') : t('periodicHorde');
    add(
      `hordeWave.${index + 1}`,
      `${t('wave')} ${index + 1}`,
      `${waveKind} · ${t('spawnTurn')} ${wave.turn} · ${t('directionCount')} ${wave.directionCount} · ${t('composition')} ${composition}`,
    );
  });
  const mixedSlotTypes = ['zombie', 'policeZombie', 'soldierZombie', 'riotZombie', 'hunterZombie'] as const;
  const specialWeights = mixedSlotTypes
    .map((key) => `${unitLabel(key, locale)} ${config.horde.specialZombieWeights[key]}`)
    .join(' / ');
  add('specialSlotWeights', t('legendSpecialSlotWeights'), specialWeights);
  add('specialSlotCaps', t('legendSpecialSlotCaps'), `${unitLabel('riotZombie', locale)} ${config.horde.riotZombieCapPerDirection} · ${unitLabel('hunterZombie', locale)} ${config.horde.hunterZombieCapPerDirection}`);
  add('initialHunterCount', t('legendInitialHunterCount'), `${config.economy.initialHunterCount.min}–${config.economy.initialHunterCount.max}`);
  add('initialHunterDistance', t('legendInitialHunterDistance'), String(config.economy.initialHunterMinDistance));
  add('spawnReserve', t('spawnReserve'), `${t('spawnReserveTileCount')} 200 · ${t('spawnReserveReason')}`);
  add('initialSupplyRadius', t('initialSupplyRadius'), String(config.checkpoint.initialSupplyRadius));
  add('checkpointMaxPerDirection', t('checkpointMaxPerDirection'), String(config.checkpoint.maxPreparedPostsPerDirection));
  add('checkpointConstructionCost', t('checkpointConstructionCost'), String(config.checkpoint.constructionCivilianGoods));
  add('checkpointSubsequentConstructionCost', t('checkpointSubsequentConstructionCost'), String(config.checkpoint.subsequentConstructionCivilianGoods));
  add('checkpointRelocationCost', t('checkpointRelocationCost'), String(config.checkpoint.relocationCivilianGoods));
  add('screeningCapacity', t('screeningCapacity'), String(config.refugees.screeningCapacity));
  for (const policy of ['passThrough', 'normal', 'strict'] as const) {
    const rule = config.refugees.policies[policy];
    add(`policy.${policy}`, t(policy), `${t('policyTurns')} ${rule.turns} · ${t('policyAcceptance')} ${formatPercent(rule.workerRate, locale)} · ${t('policyInfection')} ${formatPercent(rule.infectionRate, locale)} · ${t('policyInfectedPopulation')} ${formatPercent(rule.infectionPopulationRate, locale)}`);
  }
  add('facilitySpread', t('legendFacilitySpread'), String(config.infection.facilitySpreadPerTurn));
  const policeConfig = unknownRecord((config.units as unknown as UnknownRecord).police);
  const guardConfig = unknownRecord((config.units as unknown as UnknownRecord).nationalGuard);
  add('policeSuppression', t('legendPoliceSuppression'), String(policeConfig.recruitAttack ?? 0));
  add('guardSuppression', t('legendGuardSuppression'), String(guardConfig.recruitAttack ?? 0));
  add('guardCivilianDamage', t('legendGuardCivilianDamage'), formatPercent(typeof guardConfig.suppressionCivilianDamageRate === 'number' ? guardConfig.suppressionCivilianDamageRate : 0, locale));
  add('combatRecovery', t('legendCombatRecovery'), formatPercent(config.naturalRecovery.combatRate, locale));
  add('restRecovery', t('legendRestRecovery'), formatPercent(config.naturalRecovery.restRate, locale));
  return entries;
}

function legendDescription(key: string, locale: Locale, t: (key: string, fallback?: string) => string): string {
  const translated = t(`legendDescription.${key}`);
  if (translated !== `legendDescription.${key}`) return translated;
  const fallback: Record<string, [string, string]> = {
    plain: ['Movement Costは下のConfig数値。特別な防御補正なし。', 'Movement Cost comes from the Config values below. No special defense modifier.'],
    forest: ['Movement Costは下のConfig数値。Forest上のZombieにはForest防御が適用されます。', 'Movement Cost comes from the Config values below. Zombies receive Forest defense on Forest tiles.'],
    mountain: ['Movement Costは下のConfig数値。Ground VisionではForestと同じく遮蔽Terrainです。', 'Movement Cost comes from the Config values below. It blocks Ground Vision like Forest.'],
    road: ['基礎TerrainではないOverlay。実効移動Costは1です。', 'An overlay, not base Terrain. Effective movement Cost is 1.'],
    urban: ['基礎TerrainではないOverlay。実効移動Costは1で、Urban防御が適用されます。', 'An overlay, not base Terrain. Effective movement Cost is 1 and Urban defense applies.'],
    police: ['感染鎮圧と治安活動を担います。自動鎮圧時の民間被害はありません。', 'Handles infection suppression and security. Automatic suppression causes no civilian damage.'],
    nationalGuard: ['射程と火力に優れます。軍需不足時は実効射程が低下し、鎮圧時に民間被害があります（数値はConfig）。', 'Provides range and firepower. Military shortages reduce effective range; suppression can harm civilians (values come from Config).'],
    zombie: ['HPの低い通常敵Unit。Mixed Horde所属個体には所属Markerが付き、Horde ZombieからTargetを継承できます。', 'A lower-HP normal enemy. Mixed-Horde members carry a group marker and can inherit a Horde Zombie target.'],
    hordeZombie: ['高HPでCapitalをStrategic TargetにするHorde中核。所属に応じたHorde Markerと併記します。', 'A high-HP Horde core that uses the Capital as a strategic target, shown with its Horde marker.'],
    policeZombie: ['Police由来の再活性化通常Zombie。Policeの外見を識別できますが、AIとScheduleは通常Zombieです。', 'A reanimated Police-derived normal Zombie. Its Police silhouette is identifiable, but its AI and schedule are normal Zombie behavior.'],
    soldierZombie: ['National Guard由来の再活性化通常Zombie。兵士の外見を識別できますが、Horde中核ではありません。', 'A reanimated National Guard-derived normal Zombie. Its soldier silhouette is identifiable, but it is not a Horde core.'],
    hunterZombie: ['筋骨隆々で長い爪を持つ高速のNormal AI系Zombie。性能値は表示中のConfigを使用し、専用TargetやCapital常時知識は持ちません。', 'A fast Normal AI Zombie with a powerful build and long claws. Its performance comes from the current Config; it has no special target or permanent Capital knowledge.'],
    periodic: ['Horde ZombieとNormal Zombieが混在できる周期集団。MarkerはUnit Typeではなく所属を示します。', 'A periodic group that may mix Horde and Normal Zombies. Its marker shows membership, not Unit Type.'],
    final: ['Final Spawn Group所属を示すMarker。Normal Zombieも含め、Group全滅がVictory条件の一つです。', 'Marks Final Spawn Group membership. Every member, including Normal Zombies, must be defeated for Victory.'],
    capital: ['州都。人口の基点、編成、初期Supply、Capital Ground Visionを担います。', 'The capital anchors population, recruitment, initial Supply, and Capital Ground Vision.'],
    city: ['地方都市。人口を受け入れ、警察編成と民需品生産を担います。', 'A regional city that receives population, produces Police, and supports civilian goods.'],
    farm: ['食料を生産する施設。Required電力が不足すると生産が停止します。', 'Produces Food. Production stops when Required power is unavailable.'],
    civilianFactory: ['民需品を生産する施設。Required電力が不足すると生産が停止します。', 'Produces Civilian Goods. Production stops when Required power is unavailable.'],
    militaryFactory: ['軍需品を生産する施設。入力とRequired電力が必要です。', 'Produces Military Goods. Inputs and Required power are needed.'],
    refinery: ['Fuelを生産するRequired電力施設。', 'Produces Fuel and requires Required power.'],
    powerPlant: ['電力Capacityを発電する施設。Turn-start Fuelの制限を受けます。', 'Generates power Capacity and is limited by Turn-start Fuel.'],
    checkpoint: ['道路上の避難民を待機・審査・合格の3プールで管理します。1回の審査枠は20人です。', 'Manages road refugees through waiting, screening, and approved pools. Each batch screens up to 20 people.'],
    spawnReserve: ['盤面外周200 HexのSpawn Reserve。Player Unit・Facility・Checkpointは配置できませんが、Playerの攻撃とHordeのSpawn・Damageは可能です。', 'The outer 200-Hex Spawn Reserve. Player Units, Facilities, and Checkpoints cannot occupy it; Player attacks and Horde Spawn/damage remain allowed.'],
    unowned: ['未確保。人口操作や生産はできません。', 'Unsecured. Population actions and production are unavailable.'],
    owned: ['確保済み。安全と操作可能Turnの条件を満たせば利用できます。', 'Secured. Available when safe and past its operational turn.'],
    stopped: ['現在停止。状態Markerで停止理由を示します。', 'Currently stopped. The state marker identifies the reason.'],
    infected: ['感染中。感染と生産停止を別々のMarkerで示します。', 'Infected. Infection and production shutdown are shown separately.'],
    ruined: ['荒廃。復旧まで生産・供給の対象外です。', 'Ruined. Excluded from production and supply until recovered.'],
    operational: ['稼働中。避難民方針とSupplyを利用できます。', 'Operational. Refugee policy and Supply are active.'],
    abandoned: ['放棄。避難民管理は停止し、Supplyを延長しません。', 'Abandoned. Refugee management stops and Supply is not extended.'],
    remnant: ['跡地／残存拠点。Lifecycleを保ちますがSupplyは延長しません。', 'Remnant. The lifecycle remains, but it does not extend Supply.'],
  };
  return fallback[key]?.[locale === 'ja' ? 0 : 1] ?? key;
}

function legendSections(
  config: Readonly<GameConfig>,
  locale: Locale,
  registry: BoardLegendRegistry | undefined,
): BoardLegendSection[] {
  const t = createTranslator(locale);
  const terrain = LEGEND_TERRAINS.map((key) => legendAssetEntry(registry, 'terrain', key, terrainLabel(key, locale), legendDescription(key, locale, t), key === 'plain' ? '◇' : key === 'forest' ? '♣' : '△'));
  const overlays = LEGEND_OVERLAYS.map((key) => legendAssetEntry(registry, 'overlay', key, key === 'road' ? t('roadOverlay') : t('urbanOverlay'), legendDescription(key, locale, t), key === 'road' ? '═' : '▦'));
  const units = LEGEND_UNITS.map((key) => legendAssetEntry(registry, 'unit', key, unitLabel(key, locale), legendDescription(key, locale, t), key === 'police' ? 'P' : key === 'nationalGuard' ? 'G' : key === 'riotPolice' ? 'RP' : key === 'zombie' ? 'Z' : key === 'hordeZombie' ? 'H' : key === 'policeZombie' ? 'PZ' : key === 'soldierZombie' ? 'SZ' : key === 'riotZombie' ? 'RZ' : 'HZ'));
  const horde = (['periodic', 'final'] as const).map((key) => legendAssetEntry(registry, 'horde', key, key === 'periodic' ? t('periodicHorde') : t('finalHorde'), legendDescription(key, locale, t), key === 'periodic' ? '↝' : '✹'));
  const facilities = LEGEND_FACILITIES.map((key) => legendAssetEntry(registry, 'facility', key, key === 'checkpoint' ? t('checkpoint') : facilityLabel(key, locale), legendDescription(key, locale, t), key === 'capital' ? '★' : key === 'city' ? '⌂' : key === 'checkpoint' ? '⊞' : '▣'));
  const facilityStates = ['unowned', 'owned', 'stopped', 'infected', 'ruined'].map((key) => legendAssetEntry(registry, 'facilityState', key, t(key), legendDescription(key, locale, t), key === 'owned' ? '✓' : key === 'infected' ? '☣' : key === 'ruined' ? '×' : '•'));
  facilityStates.push(
    legendCompositeEntry(registry, 'securedStopped', locale === 'ja' ? '確保済み + 停止中' : 'Secured + stopped', locale === 'ja' ? '確保済みのBaseに停止中Overlayを重ねます。' : 'Composes the secured Base with the stopped overlay.', [['facilityState', 'owned'], ['facilityState', 'stopped']], '✓·'),
    legendCompositeEntry(registry, 'unsecuredInfected', locale === 'ja' ? '未確保 + 感染' : 'Unsecured + infected', locale === 'ja' ? '未確保のBaseに感染Overlayを重ねます。' : 'Composes the unsecured Base with the infected overlay.', [['facilityState', 'unowned'], ['facilityState', 'infected']], '•☣'),
    legendCompositeEntry(registry, 'ruinedInfected', locale === 'ja' ? '荒廃 + 感染' : 'Ruined + infected', locale === 'ja' ? '荒廃Overlayと感染Overlayを併記します。' : 'Shows ruined and infected overlays together.', [['facilityState', 'ruined'], ['facilityState', 'infected']], '×☣'),
  );
  const checkpointStates = ['operational', 'abandoned', 'remnant', 'ruined', 'infected'].map((key) => legendAssetEntry(registry, 'checkpointState', key, t(key), legendDescription(key, locale, t), key === 'operational' ? '●' : key === 'abandoned' ? '◌' : key === 'remnant' ? '◍' : key === 'infected' ? '☣' : '×'));
  const dynamic = ['selected', 'legalDestination', 'path', 'attackTarget', 'hp', 'infected', 'stopped', 'projected', 'vision', 'visionGround', 'visionBlocked', 'visionAerial', 'fogOfWar', 'supply', 'hordeDirections', 'spawnReserve'].map((key) => legendAssetEntry(registry, 'dynamicOverlay', key, t(`legendOverlay.${key}`), t(`legendOverlayDescription.${key}`), key === 'selected' ? '◎' : key === 'path' ? '→' : key === 'attackTarget' ? '✦' : key === 'hp' ? '▰' : key === 'infected' ? '☣' : key === 'vision' || key === 'visionGround' ? '◌' : key === 'visionBlocked' ? '▒' : key === 'visionAerial' ? '◇' : key === 'fogOfWar' ? '░' : key === 'supply' ? '▧' : key === 'hordeDirections' ? '↝' : key === 'spawnReserve' ? 'R' : '·'));
  const configRows = configLegendEntries(config, locale);
  return [
    { key: 'terrain', title: t('legendTerrain'), entries: terrain },
    { key: 'overlays', title: t('legendOverlays'), entries: overlays },
    { key: 'units', title: t('legendUnits'), entries: units },
    { key: 'horde', title: t('legendHorde'), entries: horde },
    { key: 'facilities', title: t('legendFacilities'), entries: facilities },
    { key: 'facilityStates', title: t('legendFacilityStates'), entries: facilityStates },
    { key: 'checkpointStates', title: t('legendCheckpointStates'), entries: checkpointStates },
    { key: 'zoom', title: t('legendZoom'), entries: [
      legendAssetEntry(registry, 'lod', 'normal', t('legendNormalZoom'), t('legendNormalZoomDescription'), '▣'),
      legendAssetEntry(registry, 'lod', 'low', t('legendLowZoom'), t('legendLowZoomDescription'), '▪'),
    ] },
    { key: 'dynamic', title: t('legendDynamicOverlay'), entries: dynamic },
    { key: 'config', title: t('legendConfigRules'), entries: configRows },
  ];
}

export function boardLegendViewModel(
  config: Readonly<GameConfig> | null | undefined,
  locale: Locale,
  registry?: BoardLegendRegistry,
): BoardLegendViewModel {
  const configSource = config ? 'current' : 'standard';
  const resolvedConfig = config ?? createDefaultConfig();
  return { config: resolvedConfig, configSource, sections: legendSections(resolvedConfig, locale, registry ?? BOARD_ASSET_REGISTRY) };
}

function legendImage(entry: BoardLegendEntry): string {
  if (entry.path) {
    const paths = entry.paths && entry.paths.length > 0 ? entry.paths : [entry.path];
    const lod = entry.lodPath ? ` data-lod-src="${escapeHtml(resolveBoardAssetUrl(entry.lodPath))}"` : '';
    return `<span class="board-legend-images">${paths.map((path, index) => `<img class="board-legend-icon" src="${escapeHtml(resolveBoardAssetUrl(path))}" alt="" loading="lazy"${index === 0 ? lod : ''} />`).join('')}</span>`;
  }
  return `<span class="board-legend-symbol" aria-hidden="true">${escapeHtml(entry.symbol)}</span>`;
}

export function renderBoardLegend(
  config: Readonly<GameConfig> | null | undefined,
  locale: Locale,
  registry?: BoardLegendRegistry,
): string {
  const t = createTranslator(locale);
  const view = boardLegendViewModel(config, locale, registry);
  const source = view.configSource === 'current' ? t('legendConfigCurrent') : t('legendConfigStandard');
  const sections = view.sections.map((section) => `<section class="board-legend-section" data-legend-section="${escapeHtml(section.key)}"><h4>${escapeHtml(section.title)}</h4><ul class="board-legend-list">${section.entries.map((entry) => `<li class="board-legend-entry" data-legend-key="${escapeHtml(entry.key)}">${legendImage(entry)}<span class="board-legend-copy"><strong>${escapeHtml(entry.label)}</strong><span>${escapeHtml(entry.description)}</span></span>${entry.key === 'config' ? `<b class="board-legend-value">${escapeHtml(entry.description)}</b>` : ''}</li>`).join('')}</ul></section>`).join('');
  return `<div class="board-legend" data-board-legend="true"><h3 class="board-legend-heading">${escapeHtml(t('legendTitle'))}</h3><p class="board-legend-source"><strong>${escapeHtml(t('legendConfigSource'))}</strong>: ${escapeHtml(source)}</p><p class="muted">${escapeHtml(t('legendIntro'))}</p>${sections}<section class="board-legend-rules"><h4>${escapeHtml(t('legendRules'))}</h4><p>${escapeHtml(t('legendTerrainRule'))}</p><p>${escapeHtml(t('legendOverlayRule'))}</p><p>${escapeHtml(t('legendUnitRule'))}</p><p>${escapeHtml(t('legendHordeRule'))}</p><p>${escapeHtml(t('legendStateRule'))}</p><p>${escapeHtml(t('legendPowerRule'))}</p><p>${escapeHtml(t('legendFogRule'))}</p><p>${escapeHtml(t('legendDynamicRule'))}</p><p>${escapeHtml(t('legendInfectionRule'))}</p><p>${escapeHtml(t('spawnReserveRule'))}</p><p>${escapeHtml(t('checkpointCapacityRule'))}</p></section></div>`;
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

/** Localize version failures without hiding generic diagnostics. */
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

function hordeStatusLabel(status: 'notStarted' | 'active' | 'defeated', locale: Locale): string {
  const t = createTranslator(locale);
  if (status === 'active') return t('hordeStatusActive');
  if (status === 'defeated') return t('hordeStatusDefeated');
  return t('hordeStatusNotStarted');
}

function finalWaveTurn(config: Readonly<GameConfig>): number | null {
  return config.horde.waves.length > 0
    ? config.horde.waves[config.horde.waves.length - 1]!.turn
    : null;
}

function hordeWaveForIndex(config: Readonly<GameConfig>, nextWaveIndex: number | null): GameConfig['horde']['waves'][number] | undefined {
  if (nextWaveIndex === null || nextWaveIndex < 1) return undefined;
  return config.horde.waves[nextWaveIndex - 1];
}

type AgentNextWave = NonNullable<AgentObservation['horde']['nextWave']>;

function hordeCompositionLabel(
  wave: GameConfig['horde']['waves'][number] | AgentNextWave | undefined,
  locale: Locale,
  config?: Readonly<GameConfig>,
): string {
  if (!wave) return createTranslator(locale)('none');
  const t = createTranslator(locale);
  const base = `${t('hordeZombie')} ${wave.compositionPerDirection.hordeZombie} / ${unitLabel('zombie', locale)} ${wave.compositionPerDirection.zombie}`;
  if (!config) return base;
  const mixedSlotTypes = ['zombie', 'policeZombie', 'soldierZombie', 'riotZombie', 'hunterZombie'] as const;
  const possible = mixedSlotTypes
    .map((key) => `${unitLabel(key, locale)} ${config.horde.specialZombieWeights[key]}`)
    .join(' / ');
  return `${base} · ${t('mixedSlotTypes')} ${possible}`;
}

function hordeWaveSpawnTurn(wave: GameConfig['horde']['waves'][number] | AgentNextWave | undefined): number | null {
  if (!wave) return null;
  return 'spawnTurn' in wave ? wave.spawnTurn : wave.turn;
}

function terrainLabel(terrain: AgentMapTileObservation['terrain'], locale: Locale): string {
  const t = createTranslator(locale);
  const labels: Record<AgentMapTileObservation['terrain'], string> = {
    plain: t('terrainPlain'),
    forest: t('terrainForest'),
    mountain: t('terrainMountain'),
    water: t('terrainWater'),
  };
  return labels[terrain];
}

function terrainDefenseLabel(source: AgentMapTileObservation['terrainDefenseSource'], locale: Locale): string {
  const t = createTranslator(locale);
  if (source === 'urban') return t('terrainDefenseUrban');
  if (source === 'forest') return t('terrainDefenseForest');
  return t('terrainDefenseNone');
}

/** Build one public map tile without materializing the complete Observation. */
function publicMapTileForPosition(
  state: Readonly<GameState>,
  position: HexCoord,
  visibleTileKeys: ReadonlySet<string>,
): AgentMapTileObservation | undefined {
  const tile = state.map.tiles.find((candidate) => candidate.q === position.q && candidate.r === position.r);
  if (!tile) return undefined;
  const checkpoint = state.checkpoints.find((candidate) => samePosition(candidate.position, position));
  const urban = isUrbanHex(state, tile);
  const movementCost = effectiveMovementCost(state, tile);
  const defense = urban
    ? { source: 'urban' as const, multiplier: state.config.terrain.damageMultiplier.urban }
    : tile.terrain === 'forest'
      ? { source: 'forest' as const, multiplier: state.config.terrain.damageMultiplier.forestZombie }
      : { source: 'none' as const, multiplier: 1 };
  return {
    q: tile.q,
    r: tile.r,
    terrain: tile.terrain,
    passable: movementCost !== null,
    road: tile.road,
    urban,
    facilityId: tile.facilityId,
    checkpointId: checkpoint?.id ?? null,
    effectiveMovementCost: movementCost,
    terrainDefenseSource: defense.source,
    terrainDamageMultiplier: defense.multiplier,
    visibleToPlayer: visibleTileKeys.has(tile.key) || visibleTileKeys.has(hexKey(tile)),
    hordeEntranceDirections: [...tile.hordeEntranceDirections].sort(),
    playerOccupancyAllowed: tile.playerOccupancyAllowed,
  };
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
    windPowerPlant: ['風力発電所', 'Wind Power Plant'],
    simpleFarm: ['簡易農場', 'Simple Farm'],
    civilianDroneBase: ['民間ドローン基地', 'Civilian Drone Base'],
  };
  return names[type]?.[locale === 'ja' ? 0 : 1] ?? type;
}

function unitLabel(type: string, locale: Locale): string {
  const names: Record<string, [string, string]> = {
    police: ['警察', 'Police'],
    nationalGuard: ['州兵', 'National Guard'],
    riotPolice: ['暴動鎮圧警察', 'Riot Police'],
    zombie: ['ゾンビ', 'Zombie'],
    hordeZombie: ['Hordeゾンビ', 'Horde Zombie'],
    policeZombie: ['警察ゾンビ', 'Police Zombie'],
    soldierZombie: ['兵士ゾンビ', 'Soldier Zombie'],
    riotZombie: ['暴動鎮圧ゾンビ', 'Riot Zombie'],
    hunterZombie: ['ハンターゾンビ', 'Hunter Zombie'],
  };
  return names[type]?.[locale === 'ja' ? 0 : 1] ?? type;
}

/** Human-facing release label; APP_VERSION remains the single source of truth. */
export function titleVersionLabel(locale: Locale): string {
  return `${createTranslator(locale)('appVersion')} ${APP_VERSION}`;
}

/** Keep the Horde headline visible while allowing its detailed warning facts to collapse. */
export function renderHordeWarningCard(locale: Locale): string {
  const t = createTranslator(locale);
  return `<details class="horde-card" data-bind="horde-card" data-horde-state="periodic" aria-live="polite"><summary class="horde-heading"><strong data-bind="horde-warning">${escapeHtml(t('horde'))}</strong><span data-bind="horde-status">—</span></summary><div class="horde-facts"><span><small>${escapeHtml(t('nextWave'))}</small><b data-bind="horde-wave-index">—</b></span><span><small>${escapeHtml(t('spawnTurn'))}</small><b data-bind="horde-spawn-turn">—</b></span><span><small>${escapeHtml(t('remaining'))}</small><b data-bind="horde-remaining">—</b></span><span><small>${escapeHtml(t('directionCount'))}</small><b data-bind="horde-direction-count">—</b></span><span><small>${escapeHtml(t('directions'))}</small><b data-bind="horde-directions">—</b></span><span><small>${escapeHtml(t('composition'))}</small><b data-bind="horde-composition">—</b></span><span><small>${escapeHtml(t('waveType'))}</small><b data-bind="horde-final">—</b></span></div></details>`;
}

const RESOURCE_ACCORDION_KEYS: readonly ResourceAccordionKey[] = ['food', 'civilianGoods', 'militaryGoods', 'fuel', 'electricity'];

/** Static top-HUD resource controls. Values/details are filled from Core
 * Forecast by updateResourceAccordion; no resource rule lives in this view. */
export function renderResourceAccordion(locale: Locale): string {
  const t = createTranslator(locale);
  const icons: Record<ResourceAccordionKey, string> = {
    food: '◉',
    civilianGoods: '▣',
    militaryGoods: '✦',
    fuel: '◌',
    electricity: '⚡',
  };
  const buttons = RESOURCE_ACCORDION_KEYS.map((resource) => {
    const label = resource === 'electricity' ? t('powerHudLabel') : t(resource);
    return `<button type="button" class="resource-pill resource-accordion-toggle ${resource}-pill" data-action="toggle-resource" data-resource="${resource}" aria-expanded="false" aria-controls="resource-details-${resource}"><span aria-hidden="true">${icons[resource]}</span><b data-bind="${resource}">0</b><small>${escapeHtml(label)}</small><span class="resource-warning-marker" data-resource-warning="${resource}" aria-label="${escapeHtml(t('forecastShortage'))}" hidden>!</span></button>`;
  }).join('');
  const panels = RESOURCE_ACCORDION_KEYS.map((resource) => `<div id="resource-details-${resource}" class="resource-accordion-panel" data-resource-panel="${resource}" role="region" aria-label="${escapeHtml(t(resource === 'electricity' ? 'electricity' : resource))}" hidden></div>`).join('');
  return `<section class="resource-accordion" data-resource-accordion="true" aria-label="${escapeHtml(t('resources'))}"><div class="resource-accordion-buttons">${buttons}</div><div class="resource-accordion-details">${panels}</div></section>`;
}

function resourceShortageAmount(resource: ResourceAccordionKey, forecast: EndTurnForecast): number {
  if (resource === 'food') return Math.max(0, forecast.food.shortage);
  if (resource === 'civilianGoods') return Math.max(0, forecast.civilianGoods.maintenanceShortage + forecast.civilianGoods.productionInputShortage);
  if (resource === 'militaryGoods') return Math.max(0, forecast.militaryGoods.totalUnfilledRefillDemand);
  if (resource === 'fuel') return Math.max(0, forecast.fuel.totalFuelShortage);
  return Math.max(0, forecast.electricity.shortage);
}

function renderResourceAccordionPanel(
  resource: ResourceAccordionKey,
  forecast: EndTurnForecast,
  locale: Locale,
): string {
  const t = createTranslator(locale);
  const rows: Array<[string, string]> = [];
  if (resource === 'electricity') {
    const power = forecast.electricity;
    rows.push(
      [t('projectedPowerDemand'), String(power.requiredPowerDemand)],
      [t('availablePowerSupply'), String(power.availableGenerationCapacity)],
      [t('requiredPowerAllocated'), String(power.requiredPowerAllocated)],
      [t('shortage'), String(power.shortage)],
    );
  } else {
    const detail = unknownRecord(forecast[resource]);
    if (resource === 'militaryGoods') {
      const units = Array.isArray(detail.units) ? detail.units : [];
      const fixedConsumption = units.reduce((total, unit) => total + boundedCount(unknownRecord(unit).fixedConsumption), 0);
      rows.push(
        [t('startingStock'), String(detail.startingStock ?? 0)],
        [t('projectedProductionAmount'), String(detail.projectedProduction ?? 0)],
        [t('fixedConsumption'), String(fixedConsumption)],
        [t('militaryRefillDemand'), String(detail.totalRefillDemand ?? 0)],
        [t('endingStock'), String(detail.projectedEndingStock ?? 0)],
        [t('shortage'), String(resourceShortageAmount(resource, forecast))],
      );
    } else {
      rows.push(
        [t('startingStock'), String(detail.startingStock ?? 0)],
        [t('projectedProductionAmount'), String(detail.projectedProduction ?? 0)],
        [t('maintenanceRequired'), String(detail.maintenanceRequired ?? 0)],
        [t('endingStock'), String(detail.endingStock ?? 0)],
        [t('shortage'), String(resourceShortageAmount(resource, forecast))],
      );
    }
    if (resource === 'civilianGoods') {
      rows.push(
        [t('productionInputDemand'), String(detail.productionInputDemand)],
        [t('productionInputAllocated'), String(detail.productionInputAllocated)],
        [t('productionInputShortage'), String(detail.productionInputShortage)],
        [t('maintenanceShortage'), String(detail.maintenanceShortage)],
      );
    }
    if (resource === 'fuel') {
      rows.push(
        [t('generationFuelDemand'), String(detail.projectedPowerFuelDemand)],
        [t('unitRefillDemand'), String(detail.projectedUnitRefillDemand)],
        [t('projectedFuelUsed'), String(detail.projectedFuelUsed)],
      );
    }
    if (resource === 'militaryGoods') {
      rows.push(
        [t('militaryRefillAmount'), String(detail.projectedTotalRefilled ?? 0)],
        [t('militaryUnfilledDemand'), String(detail.totalUnfilledRefillDemand ?? 0)],
      );
    }
  }
  const shortage = resourceShortageAmount(resource, forecast);
  return `<dl class="resource-accordion-grid">${rows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl>${shortage > 0 ? `<p class="warning-text resource-accordion-shortage">${escapeHtml(t('forecastShortage'))}: ${shortage}</p>` : `<p class="muted resource-accordion-ok">${escapeHtml(t('forecastNormal'))}</p>`}`;
}

function isCity(facility: Pick<FacilityState, 'type'>): boolean {
  return facility.type === 'capital' || facility.type === 'city';
}

/** Auto-show Supply only where the current interaction actually depends on it. */
export function selectionShowsSupplyOverlay(
  state: Pick<GameState, 'facilities' | 'checkpoints'>,
  selection: Selection | null,
): boolean {
  if (!selection) return false;
  if (selection.kind === 'road' || selection.kind === 'hex') return true;
  if (selection.kind === 'zombie') return false;
  if (selection.kind === 'checkpoint') {
    return state.checkpoints.some((checkpoint) => checkpoint.id === selection.id);
  }
  if (selection.kind !== 'facility') return false;
  const facility = state.facilities.find((candidate) => candidate.id === selection.id);
  return Boolean(facility && !isCity(facility));
}

function isPowerSupplyFacility(facility: Pick<FacilityState, 'type'>): boolean {
  return facility.type === 'farm' || facility.type === 'civilianFactory' || facility.type === 'militaryFactory' || facility.type === 'refinery' || facility.type === 'civilianDroneBase';
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

/** Return the fixed map branch owning a trunk-road Hex, if any. */
export function roadBranchForPosition(
  state: Pick<Readonly<GameState>, 'map'>,
  position: HexCoord,
): RoadBranchId | null {
  const branch = state.map?.roadBranches?.find((candidate) =>
    candidate.roadTiles.some((tile) => samePosition(tile, position)),
  );
  return branch?.id ?? null;
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
  resource: 'food' | 'civilianGoods' | 'fuel',
  detail: EndTurnForecast['food'] | EndTurnForecast['civilianGoods'] | EndTurnForecast['fuel'],
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
      [t('currentFuel'), String(fuel.turnStartFuel)],
      [t('windPowerAvailable'), String(fuel.windPowerAvailable)],
      [t('powerPlantPhysicalCapacity'), String(fuel.powerPlantPhysicalCapacity)],
      [t('powerFuelDemand'), String(fuel.projectedPowerFuelDemand)],
      [t('powerFuelUsed'), String(fuel.projectedPowerFuelUsed)],
      [t('fuelAfterPower'), String(fuel.fuelAfterPower)],
      [t('unitRefillDemand'), String(fuel.projectedUnitRefillDemand)],
      [t('unitRefillAmount'), String(fuel.projectedUnitFuelRefilled)],
      [t('totalFuelDemand'), String(fuel.projectedTotalFuelDemand)],
      [t('refineryProduction'), formatForecastAmount(fuel.projectedRefineryProduction)],
      [t('projectedEndingFuel'), String(fuel.projectedEndingFuel)],
      [t('fuelShortage'), String(fuel.powerFuelShortage)],
      [t('unitRefillShortage'), String(fuel.unitRefillFuelShortage)],
      [t('totalFuelShortage'), String(fuel.totalFuelShortage)],
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
  const note = resource === 'fuel' ? `<p class="muted">${escapeHtml(t('fuelSupplyOrder'))}</p>` : '';
  return `<section class="forecast-card resource-forecast-card" data-forecast-resource="${resource}"><h4>${escapeHtml(t(resource))}</h4><dl class="forecast-detail-grid">${rows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl>${note}</section>`;
}

/** Render the Unit-carried Military Goods plan without recreating Core allocation rules. */
export function renderMilitaryGoodsForecast(
  detail: EndTurnForecast['militaryGoods'],
  locale: Locale,
): string {
  const t = createTranslator(locale);
  const rows: Array<[string, string]> = [
    [t('startingStock'), String(detail.startingStock)],
    [t('projectedProduction'), formatForecastAmount(detail.projectedProduction)],
    [t('militaryRefillDemand'), String(detail.totalRefillDemand)],
    [t('militaryRefillAmount'), String(detail.projectedTotalRefilled)],
    [t('militaryUnfilledDemand'), String(detail.totalUnfilledRefillDemand)],
    [t('endingStock'), String(detail.projectedEndingStock)],
  ];
  const unitRows = detail.units.map((unit) => {
    const status = unit.suppressionStatus === 'suppression'
      ? t('suppressionWillRun')
      : unit.suppressionStatus === 'containment_only'
        ? t('containmentOnly')
        : t('none');
    return `<tr data-military-unit="${escapeHtml(unit.unitId)}"><th scope="row">${escapeHtml(unit.unitId)}</th><td>${unit.beforeFixed}</td><td>-${unit.fixedConsumption}</td><td>${unit.afterFixed}</td><td>+${unit.projectedRefillAmount}</td><td>${unit.unfilledRefillDemand}</td><td>${unit.afterRefill}</td><td>${escapeHtml(status)}${unit.suppressionCost > 0 ? ` (-${unit.suppressionCost})` : ''}</td><td>${unit.afterSuppression}</td></tr>`;
  }).join('');
  const unitTable = detail.units.length > 0
    ? `<div class="forecast-table-scroll"><table class="military-unit-forecast"><thead><tr><th>${escapeHtml(t('unit'))}</th><th>${escapeHtml(t('beforeFixed'))}</th><th>${escapeHtml(t('fixedConsumption'))}</th><th>${escapeHtml(t('afterFixed'))}</th><th>${escapeHtml(t('refillAmount'))}</th><th>${escapeHtml(t('militaryUnfilledDemand'))}</th><th>${escapeHtml(t('afterRefill'))}</th><th>${escapeHtml(t('suppression'))}</th><th>${escapeHtml(t('afterSuppression'))}</th></tr></thead><tbody>${unitRows}</tbody></table></div>`
    : `<p class="muted">${escapeHtml(t('noHumanUnits'))}</p>`;
  return `<section class="forecast-card resource-forecast-card military-goods-forecast" data-forecast-resource="militaryGoods"><h4>${escapeHtml(t('militaryGoods'))}</h4><dl class="forecast-detail-grid">${rows.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join('')}</dl><h5>${escapeHtml(t('unitMilitaryGoodsForecast'))}</h5>${unitTable}</section>`;
}

/** Render the complete public EndTurn forecast for the human-facing sheet. */
export function renderEndTurnForecast(forecast: EndTurnForecast, locale: Locale): string {
  const t = createTranslator(locale);
  const electricity = forecast.electricity;
  const powerHud = powerHudViewModel(electricity, locale);
  // Human-facing forecast deliberately aggregates this list. Facility IDs
  // and power reasons remain available in the selected Facility sheet and on
  // the board's per-facility marker, but are not enumerated in the global
  // panel.
  const unpoweredCount = electricity.unpoweredFacilities.length;
  const unpoweredLabel = `${unpoweredCount}${locale === 'ja' ? t('facilities') : ` ${t('facilities').toLowerCase()}`}`;
  const unpowered = `<p class="${unpoweredCount > 0 ? 'warning-text' : 'muted'}" data-unpowered-forecast="true"><strong>${escapeHtml(t('unpoweredForecast'))}</strong>: ${escapeHtml(unpoweredLabel)}</p>`;
  return `<section class="forecast-card end-turn-forecast"><h3>${escapeHtml(t('endTurnForecast'))}</h3><p class="muted">${escapeHtml(t('overcrowding'))}: ${escapeHtml(formatPercent(forecast.overcrowding.cities.reduce((total, city) => total + city.excess / Math.max(1, city.softCap), 0), locale))} · ${escapeHtml(t('additionalFood'))} ${forecast.overcrowding.additionalFood} · ${escapeHtml(t('additionalCivilianGoods'))} ${forecast.overcrowding.additionalCivilianGoods}</p>${forecastResourceCard('food', forecast.food, locale)}${forecastResourceCard('civilianGoods', forecast.civilianGoods, locale)}${renderMilitaryGoodsForecast(forecast.militaryGoods, locale)}${forecastResourceCard('fuel', forecast.fuel, locale)}<section class="forecast-card power-forecast"><h4>${escapeHtml(t('electricity'))}</h4><dl class="forecast-detail-grid"><div><dt>${escapeHtml(t('physicalGenerationCapacity'))}</dt><dd>${electricity.physicalGenerationCapacity}</dd></div><div><dt>${escapeHtml(t('fuelLimitedGenerationCapacity'))}</dt><dd>${electricity.fuelLimitedGenerationCapacity}</dd></div><div><dt>${escapeHtml(t('availableGenerationCapacity'))}</dt><dd>${electricity.availableGenerationCapacity}</dd></div><div><dt>${escapeHtml(t('requiredPowerDemand'))}</dt><dd>${electricity.requiredPowerDemand}</dd></div><div><dt>${escapeHtml(t('requiredPowerAllocated'))}</dt><dd>${electricity.requiredPowerAllocated}</dd></div><div><dt>${escapeHtml(t('shortage'))}</dt><dd>${electricity.shortage}</dd></div></dl><p class="muted">${escapeHtml(t('powerHudLabel'))}: ${escapeHtml(powerHud.display)}</p>${unpowered}</section></section>`;
}

type AgentAttackPreview = AgentUnitObservation['attackPreviews'][number];

export function renderAttackPreview(preview: AgentAttackPreview, locale: Locale, baseAttack?: number): string {
  const t = createTranslator(locale);
  const shortage = baseAttack !== undefined && preview.effectiveAttack < baseAttack;
  return `<div class="attack-preview-detail" data-attack-preview="${escapeHtml(preview.targetUnitId)}"><span>${escapeHtml(t('distance'))} <b>${preview.distance}</b></span><span>${escapeHtml(t('attackMilitaryGoodsCost'))} <b>${preview.militaryGoodsCost}</b></span><span>${escapeHtml(t('militaryGoodsAfterAttack'))} <b>${preview.projectedMilitaryGoodsAfterAttack}</b></span><span>${escapeHtml(t('effectiveAttack'))} <b>${preview.effectiveAttack}</b></span><span>${escapeHtml(t('damageBeforeTerrain'))} <b>${preview.projectedDamageBeforeTerrain}</b> → ${escapeHtml(t('damageAfterTerrain'))} <b>${preview.projectedDamageAfterTerrain}</b></span>${shortage ? `<strong class="warning-text">${escapeHtml(t('militaryGoodsWeakAttackWarning'))}</strong>` : ''}</div>`;
}

/** Human-facing projection of the public carried-Military-Goods fields. */
export function renderUnitMilitaryGoodsDetails(
  unit: AgentUnitObservation,
  locale: Locale,
  shortageMultiplier = 0.2,
): string {
  const t = createTranslator(locale);
  const costs = Object.entries(unit.attackMilitaryGoodsCostByRange)
    .map(([range, cost]) => [Number(range), cost] as const)
    .sort(([left], [right]) => left - right)
    .map(([range, cost]) => `${t('distance')} ${range}: ${cost}`)
    .join(' / ');
  const minimumAttack = Math.max(1, Math.ceil(unit.attack * shortageMultiplier));
  const suppressionStatus = unit.suppressionStatusIfTurnEndsNow === 'suppression'
    ? t('suppressionWillRun')
    : unit.suppressionStatusIfTurnEndsNow === 'containment_only'
      ? t('containmentOnly')
      : t('none');
  const projectedMilitaryRefill = Math.max(0, unit.projectedMilitaryGoodsAfterRefill - unit.projectedMilitaryGoodsAfterFixedConsumption);
  const guardRangeRule = unit.type === 'nationalGuard' ? ` ${escapeHtml(t('guardRangeTwoMilitaryGoodsRule'))}` : '';
  return `<section class="unit-military-goods" data-unit-military-goods="true"><h3>${escapeHtml(t('carriedMilitaryGoods'))}</h3><dl class="forecast-detail-grid"><div><dt>${escapeHtml(t('currentMilitaryGoods'))}</dt><dd>${unit.currentMilitaryGoods}/${unit.maxMilitaryGoods}</dd></div><div><dt>${escapeHtml(t('fixedConsumption'))}</dt><dd>-${unit.fixedMilitaryGoodsUpkeepPerTurn}</dd></div><div><dt>${escapeHtml(t('afterFixed'))}</dt><dd>${unit.projectedMilitaryGoodsAfterFixedConsumption}</dd></div><div><dt>${escapeHtml(t('militaryRefillAmount'))}</dt><dd>+${projectedMilitaryRefill}</dd></div><div><dt>${escapeHtml(t('afterRefill'))}</dt><dd>${unit.projectedMilitaryGoodsAfterRefill}</dd></div><div><dt>${escapeHtml(t('suppression'))}</dt><dd>${escapeHtml(suppressionStatus)} · ${escapeHtml(t('cost'))} ${unit.suppressionMilitaryGoodsCost}</dd></div><div><dt>${escapeHtml(t('afterSuppression'))}</dt><dd>${unit.projectedMilitaryGoodsAfterSuppression}</dd></div><div><dt>${escapeHtml(t('emergencyMovementLimit'))}</dt><dd>${unit.emergencyMovementPoints} MP · ${escapeHtml(t(unit.emergencyMovementAvailable ? 'available' : 'unavailable'))}</dd></div></dl><p><strong>${escapeHtml(t('attackCostByDistance'))}</strong>: ${escapeHtml(costs || t('none'))}</p><p class="muted">${escapeHtml(t('zeroMilitaryGoodsAttack'))}: ${minimumAttack}.${guardRangeRule}</p><p class="muted">${escapeHtml(t('unitStoresLostOnDestruction'))}</p></section>`;
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
    checkpoint_prepared_post_limit_reached: t('checkpointPreparedPostLimitReached'),
    checkpoint_standby_requires_rear_position: t('checkpointStandbyRequiresRearPosition'),
    checkpoint_not_activatable: t('checkpointNotActivatable'),
    checkpoint_target_not_visible: t('checkpointTargetNotVisible'),
    checkpoint_route_not_visible: t('checkpointRouteNotVisible'),
    checkpoint_facility_occupied: t('checkpointFacilityOccupied'),
    checkpoint_not_eligible_for_turn_away: locale === 'ja' ? 'Waiting避難民を追い返せるのはActiveまたはRemnant検問所だけです。' : 'Only an Active or Remnant checkpoint can turn away Waiting refugees.',
    invalid_refugee_turn_away_count: locale === 'ja' ? '追い返す人数はWaiting人数以内の1以上の整数です。' : 'Turn-away count must be a positive integer within the Waiting pool.',
    invalid_checkpoint_branch: locale === 'ja' ? '指定した道路タイルは有効な方面に属していません。' : 'The selected road tile does not belong to a valid branch.',
    unknown_road_branch: locale === 'ja' ? '道路方面を確認できません。' : 'The road branch is unknown.',
    checkpoint_wrong_branch: locale === 'ja' ? '検問所は現在の方面内だけで移設できます。' : 'A checkpoint can only relocate within its current branch.',
    checkpoint_same_position: locale === 'ja' ? '別の道路タイルを選択してください。' : 'Choose a different road tile.',
    unknown_operational_checkpoint: locale === 'ja' ? '移設できる稼働中の検問所を選択してください。' : 'Select an operational checkpoint to relocate.',
    checkpoint_abandoned_forward_block: t('abandonedForwardBlock'),
    power_supply_not_applicable: locale === 'ja' ? '電力供給を変更できるのはFarm・民需工場・軍需工場・Refinery・Civilian Drone Baseです。' : 'Power Supply can only be changed for Farms, Civilian Factories, Military Factories, Refineries, and Civilian Drone Bases.',
    power_supply_unavailable: locale === 'ja' ? '所有中で安全かつ操作可能な産業施設だけ変更できます。' : 'Only an owned, safe, and available industrial facility can change Power Supply.',
    invalid_power_supply: locale === 'ja' ? 'Power SupplyはONまたはOFFで指定してください。' : 'Power Supply must be ON or OFF.',
    insufficient_unit_fuel: locale === 'ja' ? '移動Fuelが不足しています。' : 'The Unit does not have enough Fuel for this move.',
    constructible_out_of_supply: t('buildSupplyRequired'),
    constructible_invalid_terrain: locale === 'ja' ? '建設にはPlainが必要です。' : 'Only Plain terrain can be built on.',
    constructible_road_blocked: locale === 'ja' ? 'Road Hexには建設できません。' : 'Road Hexes cannot be built on.',
    constructible_entrance_blocked: locale === 'ja' ? 'Horde Entranceには建設できません。' : 'Horde Entrances cannot be built on.',
    constructible_facility_occupied: locale === 'ja' ? '既存FacilityがあるHexには建設できません。' : 'A facility already occupies this Hex.',
    constructible_checkpoint_occupied: locale === 'ja' ? 'CheckpointがあるHexには建設できません。' : 'A Checkpoint already occupies this Hex.',
    constructible_player_unit_occupied: locale === 'ja' ? 'Player UnitがいるHexには建設できません。' : 'A player Unit occupies this Hex.',
    constructible_visible_zombie_occupied: locale === 'ja' ? '視認中ZombieがいるHexには建設できません。' : 'A visible Zombie occupies this Hex.',
    horde_spawn_reserve: t('spawnReserveReason'),
    player_occupancy_forbidden: t('spawnReserveReason'),
    constructible_facility_limit_reached: locale === 'ja' ? 'このFacility Typeの建設上限に達しています。' : 'The per-type constructible facility limit has been reached.',
    invalid_constructible_facility_type: locale === 'ja' ? '建設Facility Typeが不正です。' : 'Unknown constructible facility type.',
    facility_not_decommissionable: t('decommissionUnavailable'),
    facility_building: locale === 'ja' ? '建設中の施設は廃止できません。' : 'A facility under construction cannot be decommissioned.',
    facility_decommission_conditions_not_met: t('decommissionUnavailable'),
    facility_zombie_occupied: locale === 'ja' ? 'Zombieがいる施設は廃止できません。' : 'A facility occupied by a Zombie cannot be decommissioned.',
    outside_map: locale === 'ja' ? '盤面外です。' : 'Position is outside the map.',
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
    stateSecured: t('victory'),
    abandoned: locale === 'ja' ? '放棄しました' : 'Abandoned',
    error: locale === 'ja' ? '内部エラー' : 'Internal error',
  };
  return labels[reason] ?? reason;
}

function stateSummary(state: Readonly<GameState>, locale: Locale): string {
  const t = createTranslator(locale);
  const population = populationLocationTotals(state);
  return `${t('population')} ${population.total} · ${t('healthyCivilians')} ${population.healthyCivilians} · ${t('facilities')} ${state.facilities.filter((facility) => facility.owner === 'player' && facility.status === 'owned').length}/${state.map.facilities.length}`;
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
  /** Query Context is reused for every read in one committed UI state. */
  private queryContext: UiQueryContext | null = null;
  private queryEngine: UiGameEngine | null = null;
  private publicProjectionContextState: Readonly<GameState> | null = null;
  private publicProjectionContext: PublicEntityProjectionContext | null = null;
  private selection: Selection = null;
  private unitActionMode: UnitActionMode = null;
  private pendingMove: MovePreview | null = null;
  private pendingAttackTargetId: string | null = null;
  private checkpointPlacement: CheckpointPlacement | null = null;
  private checkpointPreviewTarget: CheckpointPreviewTarget | null = null;
  private checkpointPlacementMessage: string | null = null;
  private constructiblePlacement: ConstructiblePlacement | null = null;
  private constructiblePreviewTarget: HexCoord | null = null;
  private constructiblePlacementMessage: string | null = null;
  private supplyOverlay = false;
  private lastSaveCode: string | null = null;
  /** Code currently shown by the manual-save modal; it may be an export after
   * a failed Storage write and therefore is not necessarily the last local
   * autosave checkpoint. */
  private saveModalCode: string | null = null;
  private lastSaveTiming: SaveTiming | null = null;
  private lastSavedTurn: number | null = null;
  private hasUnsavedChanges = false;
  private saveStatus: 'none' | 'saving' | 'saved' | 'failed' = 'none';
  private manualSavePending = false;
  private toastMessage: string | null = null;
  /** Event IDs already surfaced as a Toast in this UI session. */
  private readonly notifiedEventIds = new Set<string>();
  private guideShown = false;
  private sheetPointerY: number | null = null;
  private sheetDragged = false;
  /** UI-only accordion state; never serialized into GameState/Save. */
  private resourceAccordion: ResourceAccordionKey | null = null;
  private readonly overviewSections = new Map<OverviewSectionKey, boolean>();
  /** Crisis groups reveal three alerts at a time without changing Core state. */
  private readonly crisisExpandedGroups = new Set<CrisisAlertViewModel['severity']>();
  private eventHistoryLimit = 10;

  constructor(root: HTMLElement, createEngine: EngineFactory) {
    this.root = root;
    this.createEngine = createEngine;
    // Save failures are surfaced by saveState so automatic and manual saves
    // share one status path and never emit duplicate toasts.
    this.store = new AutoSaveStore();
    if (IS_DEVELOPMENT_BUILD && typeof window !== 'undefined') {
      const diagnosticsWindow = window as Window & {
        __NLTH_UI_DEBUG__?: {
          getBoardRenderCounters: () => Readonly<import('./board').BoardRenderCounters> | null;
          resetBoardRenderCounters: () => void;
          getLastSaveTiming: () => SaveTiming | null;
        };
      };
      diagnosticsWindow.__NLTH_UI_DEBUG__ = {
        getBoardRenderCounters: () => this.boardScene?.getRenderCounters() ?? null,
        resetBoardRenderCounters: () => this.boardScene?.resetRenderCounters(),
        getLastSaveTiming: () => this.lastSaveTiming,
      };
    }
  }

  mount(): void {
    this.root.ownerDocument.addEventListener('keydown', this.handleGlobalKeyDown);
    this.showTitle();
  }

  private readonly handleGlobalKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Escape' || this.screen !== 'game' || this.root.querySelector('[data-modal]')) return;
    event.preventDefault();
    if (this.resourceAccordion) {
      this.resourceAccordion = null;
      this.updateView();
      return;
    }
    this.cancelUnitInteractionLevel();
  };

  private translator(): (key: string, fallback?: string) => string {
    return createTranslator(this.locale);
  }

  private invalidateQueryContext(): void {
    this.queryContext = null;
    this.queryEngine = null;
    this.publicProjectionContextState = null;
    this.publicProjectionContext = null;
  }

  private query(): UiQueryContext | null {
    if (!this.engine?.getQuery) return null;
    if (this.queryContext && this.queryEngine === this.engine) return this.queryContext;
    try {
      const context = this.engine.getQuery();
      this.queryContext = context;
      this.queryEngine = this.engine;
      return context;
    } catch {
      this.invalidateQueryContext();
      return null;
    }
  }

  private queryEndTurnForecast(): EndTurnForecast {
    if (!this.state) throw new Error('Game state is unavailable');
    try {
      return this.query()?.getEndTurnForecast?.() ?? forecastEndTurn(this.state);
    } catch {
      return forecastEndTurn(this.state);
    }
  }

  private queryStrategicForecast(): AgentObservation['strategicForecast'] {
    if (!this.state) throw new Error('Game state is unavailable');
    try {
      return (this.query()?.getStrategicForecast?.() as AgentObservation['strategicForecast'] | undefined)
        ?? deriveStrategicForecast(this.state);
    } catch {
      return deriveStrategicForecast(this.state);
    }
  }

  private queryCrisisSummary(): CrisisSummaryViewModel {
    if (!this.state) return { alerts: [], criticalCount: 0, warningCount: 0, advisoryCount: 0 };
    try {
      const value = this.query()?.getCrisisSummary?.();
      if (value) return crisisSummaryViewModel({ crisisSummary: value });
    } catch {
      // Fall back to the same pure Core projection used by the Agent adapter.
    }
    const alerts = deriveCoreCrisisSummary(this.state);
    return crisisSummaryViewModel({ crisisSummary: { alerts } });
  }

  private queryEndTurnRisk(): EndTurnRiskViewModel {
    if (!this.state) return endTurnRiskViewModel({ endTurnRisk: {} });
    try {
      const value = this.query()?.getEndTurnRisk?.();
      if (value) return endTurnRiskViewModel({ endTurnRisk: value });
    } catch {
      // Fall back to the same pure Core projection used by the Agent adapter.
    }
    return endTurnRiskViewModel({ endTurnRisk: deriveCoreEndTurnRisk(this.state) });
  }

  private queryVision(): ReturnType<typeof getPlayerVisionCoverage> {
    if (!this.state) {
      return {
        visible: new Set(),
        groundPotential: new Set(),
        groundVisible: new Set(),
        groundBlocked: new Set(),
        aerialVisible: new Set(),
      };
    }
    try {
      const value = this.query()?.getVision?.();
      if (value && typeof value === 'object') return value as ReturnType<typeof getPlayerVisionCoverage>;
    } catch {
      // Fall through to the pure Core helper.
    }
    return getPlayerVisionCoverage(this.state);
  }

  private queryVisibleTileKeys(): ReadonlySet<string> {
    if (!this.state) return new Set();
    try {
      const value = this.query()?.getVisibleTileKeys?.();
      if (value) return value instanceof Set ? value : new Set(value);
    } catch {
      // Fall through to the pure Core helper.
    }
    return getPlayerVisibleTileKeys(this.state);
  }

  private querySuppliedTileKeys(): readonly string[] {
    if (!this.state) return [];
    try {
      const value = this.query()?.getSuppliedTileKeys?.();
      if (value) return [...value];
    } catch {
      // Fall through to the pure Core helper.
    }
    return getSuppliedTileKeys(this.state);
  }

  private queryFacilityProduction(): readonly ReturnType<typeof forecastFacilityProduction>[number][] {
    if (!this.state) return [];
    try {
      const value = this.query()?.getFacilityProduction?.();
      if (value) return value;
    } catch {
      // Fall through to the pure Core helper.
    }
    return forecastFacilityProduction(this.state);
  }

  private queryCheckpointPositionCandidates(): readonly CheckpointPositionCandidate[] {
    if (!this.state) return [];
    try {
      const value = this.query()?.getCheckpointPositionCandidates?.();
      if (value) return value;
    } catch {
      // Fall through to the read-only Headless/Core helper.
    }
    return this.engine?.getCheckpointPositionCandidates() ?? [];
  }

  private queryConstructibleFacilityPositionCandidates(facilityType: ConstructibleFacilityType): readonly ConstructibleFacilityPositionCandidate[] {
    if (!this.state) return [];
    try {
      const value = this.query()?.getConstructibleFacilityPositionCandidates?.(facilityType);
      if (value) return value;
    } catch {
      // Fall through to the read-only Headless/Core helper.
    }
    return this.engine?.getConstructibleFacilityPositionCandidates(facilityType) ?? [];
  }

  private queryUnitMoveProjections(unitId: string): readonly unknown[] {
    if (!this.state) return [];
    try {
      const value = this.query()?.getUnitMoveProjections?.(unitId);
      if (value) return value;
    } catch {
      // Fall through to the pure Core helper.
    }
    return getUnitLegalMoveFuelProjections(this.state, unitId);
  }

  private queryUnitAttackProjections(unitId: string): readonly unknown[] {
    if (!this.state) return [];
    try {
      const value = this.query()?.getUnitAttackProjections?.(unitId);
      if (value) return value;
    } catch {
      // Fall through to the pure Core helper.
    }
    return getUnitLegalAttackProjections(this.state, unitId);
  }

  private queryPublicUnit(unitId: string): AgentUnitObservation | undefined {
    if (!this.state) return undefined;
    try {
      const value = this.query()?.getPublicUnitProjection?.(unitId);
      if (value) return value;
    } catch {
      // Fall through to local Core projection.
    }
    const unit = this.state.units.find((candidate) => candidate.id === unitId);
    return unit ? createPublicUnitProjection(unit, this.state, this.publicEntityContext()) : undefined;
  }

  private queryPublicFacility(facilityId: string): AgentFacilityObservation | undefined {
    if (!this.state) return undefined;
    try {
      const value = this.query()?.getPublicFacilityProjection?.(facilityId);
      if (value) return value;
    } catch {
      // Fall through to local Core projection.
    }
    const facility = this.state.facilities.find((candidate) => candidate.id === facilityId);
    return facility ? createPublicFacilityProjection(facility, this.state, this.publicEntityContext()) : undefined;
  }

  private queryPublicCheckpoint(checkpointId: string): AgentCheckpointObservation | undefined {
    if (!this.state) return undefined;
    try {
      const value = this.query()?.getPublicCheckpointProjection?.(checkpointId);
      if (value) return value;
    } catch {
      // Fall through to local Core projection.
    }
    const checkpoint = this.state.checkpoints.find((candidate) => candidate.id === checkpointId);
    return checkpoint ? createPublicCheckpointProjection(checkpoint, this.state) : undefined;
  }

  private publicEntityContext(): PublicEntityProjectionContext {
    if (!this.state) return {};
    if (this.publicProjectionContextState === this.state && this.publicProjectionContext) {
      return this.publicProjectionContext;
    }
    const forecast = this.queryEndTurnForecast();
    const refills = new Map(forecast.militaryGoods.units.map((unit) => [unit.unitId, {
      demand: unit.refillDemand,
      amount: unit.projectedRefillAmount,
    }] as const));
    const context = {
      visibleTileKeys: this.queryVisibleTileKeys(),
      refillByUnitId: refills,
      militaryByUnitId: new Map(forecast.militaryGoods.units.map((unit) => [unit.unitId, unit] as const)),
      productionByFacility: new Map(this.queryFacilityProduction().map((projection) => [projection.facilityId, projection] as const)),
    };
    this.publicProjectionContextState = this.state;
    this.publicProjectionContext = context;
    return context;
  }

  private showTitle(): void {
    this.screen = 'title';
    this.state = null;
    this.engine = null;
    this.invalidateQueryContext();
    this.lastSaveCode = null;
    this.saveModalCode = null;
    this.lastSaveTiming = null;
    this.manualSavePending = false;
    this.lastSavedTurn = null;
    this.hasUnsavedChanges = false;
    this.saveStatus = 'none';
    this.selection = null;
    this.unitActionMode = null;
    this.pendingMove = null;
    this.pendingAttackTargetId = null;
    this.checkpointPlacement = null;
    this.checkpointPreviewTarget = null;
    this.checkpointPlacementMessage = null;
    this.constructiblePlacement = null;
    this.constructiblePreviewTarget = null;
    this.constructiblePlacementMessage = null;
    this.supplyOverlay = false;
    this.resourceAccordion = null;
    this.overviewSections.clear();
    this.eventHistoryLimit = 10;
    this.notifiedEventIds.clear();
    this.destroyBoard();
    const t = this.translator();
    const canContinue = this.store.hasSave();
    this.root.className = 'app-shell title-screen';
    this.root.innerHTML = `
      <main class="title-card" aria-labelledby="title-heading">
        <div class="title-mark" aria-hidden="true">◇</div>
        <p class="eyebrow">${escapeHtml(t('subtitle'))}</p>
        <h1 id="title-heading">${escapeHtml(t('title'))}</h1>
        <p class="title-version" data-app-version="${escapeHtml(APP_VERSION)}">${escapeHtml(titleVersionLabel(this.locale))}</p>
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
    const defaults = createDefaultConfig();
    const schedule = defaults.horde.waves.map((wave, index) => {
      const composition = hordeCompositionLabel(wave, this.locale, defaults);
      return `<li><strong>${escapeHtml(t('wave'))} ${index + 1}</strong> · ${escapeHtml(t('spawnTurn'))} ${wave.turn} · ${escapeHtml(t('directionCount'))} ${wave.directionCount} · ${escapeHtml(composition)}${wave.final ? ` · ${escapeHtml(t('finalWave'))}` : ''}</li>`;
    }).join('');
    this.root.className = 'app-shell modal-screen';
    this.root.innerHTML = `
      <section class="modal-card" aria-labelledby="new-game-heading">
        <button class="icon-button modal-close" aria-label="${escapeHtml(t('back'))}" data-action="title">×</button>
        <p class="eyebrow">${escapeHtml(t('options'))}</p>
        <h2 id="new-game-heading">${escapeHtml(t('newGame'))}</h2>
        <form data-form="new-game" class="settings-form">
          <label>${escapeHtml(t('newSeed'))}<input name="seed" type="number" inputmode="numeric" value="${Date.now() % 2147483647}" /></label>
          <section class="fixed-horde-schedule" aria-labelledby="horde-schedule-heading"><h3 id="horde-schedule-heading">${escapeHtml(t('hordeSchedule'))}</h3><p class="muted">${escapeHtml(t('fixedHordeScheduleHint'))}</p><ul>${schedule}</ul></section>
          <label>${escapeHtml(t('refugeeIntervalMin'))}<input name="refugeeIntervalMin" type="number" min="1" value="2" /></label>
          <label>${escapeHtml(t('refugeeIntervalMax'))}<input name="refugeeIntervalMax" type="number" min="1" value="4" /></label>
          <label>${escapeHtml(t('refugeePeopleMin'))}<input name="refugeePeopleMin" type="number" min="1" value="5" /></label>
          <label>${escapeHtml(t('refugeePeopleMax'))}<input name="refugeePeopleMax" type="number" min="1" value="10" /></label>
          <label>${escapeHtml(t('screeningCapacity'))}<input name="screeningCapacity" type="number" min="1" value="${defaults.refugees.screeningCapacity}" /></label>
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
        refugees: {
          arrivalIntervalMin: refugeeIntervalMin,
          arrivalIntervalMax: refugeeIntervalMax,
          arrivalPeopleMin: refugeePeopleMin,
          arrivalPeopleMax: refugeePeopleMax,
          screeningCapacity: Math.max(1, Math.floor(numberValue(values.get('screeningCapacity')?.toString(), defaults.refugees.screeningCapacity))),
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
      this.unitActionMode = null;
      this.pendingMove = null;
      this.pendingAttackTargetId = null;
      this.checkpointPlacement = null;
      this.checkpointPreviewTarget = null;
      this.checkpointPlacementMessage = null;
      this.constructiblePlacement = null;
      this.constructiblePreviewTarget = null;
      this.constructiblePlacementMessage = null;
      this.supplyOverlay = false;
      this.resourceAccordion = null;
      this.overviewSections.clear();
      this.crisisExpandedGroups.clear();
      this.eventHistoryLimit = 10;
      this.notifiedEventIds.clear();
      for (const event of this.state.events ?? []) this.notifiedEventIds.add(event.id);
      this.invalidateQueryContext();
      this.lastSaveCode = null;
      this.saveModalCode = null;
      this.lastSaveTiming = null;
      this.manualSavePending = false;
      this.lastSavedTurn = null;
      this.hasUnsavedChanges = true;
      this.saveStatus = 'none';
      this.guideShown = !this.hasSeenGuide();
      this.renderGame();
      this.autosave();
      if (this.guideShown) this.showGuide();
    } catch (error) {
      this.showToast(`${this.translator()('newGameError')}: ${error instanceof Error ? error.message : String(error)}`);
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
    // Keep the debug mount point out of production markup entirely.  The
    // Core may opt into providing diagnostics, but the controller never
    // fabricates them and never stores them in GameState.
    const noiseDebugMount = IS_DEVELOPMENT_BUILD
      ? '<div class="noise-debug-mount" data-noise-debug-mount hidden></div>'
      : '';
    this.root.className = 'app-shell game-screen';
    this.root.innerHTML = `
      <header class="top-hud">
        <div class="hud-brand"><span class="hud-glyph">◇</span><span>${escapeHtml(t('title'))}</span></div>
        <div class="hud-turn"><span data-bind="turn">—</span><small data-bind="turn-label">${escapeHtml(t('turn'))}</small><span class="phase-dot" data-bind="phase" data-phase="${escapeHtml(phaseIndicator.phase)}" aria-hidden="true"></span><span class="phase-label" data-bind="phase-label" title="${escapeHtml(phaseIndicator.label)}">${escapeHtml(phaseIndicator.shortLabel)}</span></div>
        <div class="hud-pop"><span data-bind="population">—</span><small>${escapeHtml(t('population'))}</small></div>
        <button class="icon-button supply-toggle" aria-label="${escapeHtml(t('supplyOverlay'))}" aria-pressed="${this.supplyOverlay}" data-action="toggle-supply" title="${escapeHtml(this.supplyOverlay ? t('supplyOn') : t('supplyOff'))}">◎</button>
        <button class="icon-button" aria-label="${escapeHtml(t('help'))}" data-action="help">?</button>
      </header>
      <section class="resource-strip" aria-label="${escapeHtml(t('resources'))}">
        ${renderResourceAccordion(this.locale)}
        <span class="resource-pill civilian-pill">♙ <b data-bind="healthy-civilians">0</b><small>${escapeHtml(t('healthyCivilians'))}</small></span>
        <span class="resource-pill infected-pill">☣ <b data-bind="infected">0</b><small>${escapeHtml(t('infected'))}</small></span>
        <span class="save-status" data-bind="save-status" aria-live="polite"></span>
      </section>
      ${renderHordeWarningCard(this.locale)}
      <div data-crisis-mount></div>
      <section class="victory-progress" aria-live="polite" aria-label="${escapeHtml(t('victoryProgress'))}"><strong>${escapeHtml(t('victoryProgress'))}</strong><div data-bind="victory-progress"></div></section>
      <main class="board-region"><div id="board-canvas" class="board-canvas" aria-label="${escapeHtml(t('map'))}"></div><div class="unit-context-layer" data-unit-context-layer aria-live="polite"></div>${noiseDebugMount}<div class="board-loading" data-board-loading role="status" aria-live="polite">${escapeHtml(t('boardLoading'))}</div><div id="toast" class="toast" role="status" aria-live="polite"></div></main>
      <section class="bottom-sheet" data-sheet="standard" aria-label="${escapeHtml(t('selected'))}">
        <button class="sheet-handle" type="button" data-action="sheet-toggle"><span></span><span class="sr-only">${escapeHtml(t('selected'))}</span></button>
        <div class="sheet-header" data-action="sheet-toggle"><div><strong data-bind="selection-title">${escapeHtml(t('selectUnit'))}</strong><small data-bind="selection-summary">${escapeHtml(stateSummary(this.state, this.locale))}</small></div><span data-bind="sheet-state">${escapeHtml(sheetStateLabel(this.sheetState, this.locale))}</span></div>
        <div class="sheet-body" data-bind="sheet-body"></div>
      </section>
      <nav class="bottom-nav" aria-label="${escapeHtml(t('map'))}"><button data-nav="map" class="${this.navMode === 'map' ? 'active' : ''}" aria-current="${this.navMode === 'map' ? 'page' : 'false'}" aria-pressed="${this.navMode === 'map'}">▦<span>${escapeHtml(t('map'))}</span></button><button data-nav="domestic" class="${this.navMode === 'domestic' ? 'active' : ''}" aria-current="${this.navMode === 'domestic' ? 'page' : 'false'}" aria-pressed="${this.navMode === 'domestic'}">⌂<span>${escapeHtml(t('domestic'))}</span></button><button data-action="end-turn" class="nav-end">▶<span>${escapeHtml(t('endTurn'))}</span></button><button data-action="save">▤<span>${escapeHtml(t('manualSave'))}</span></button></nav>`;
    this.bindRootEvents();
    this.createBoard();
    this.updateView();
  }

  private createBoard(): void {
    const parent = this.root.querySelector<HTMLElement>('#board-canvas');
    if (!parent) return;
    this.destroyBoard();
    this.setBoardLoading(true);
    const callbacks = {
      onTileTap: (position: HexCoord) => this.onTileTap(position),
      onBlankTap: () => this.cancelUnitInteractionLevel(),
      onViewChange: () => this.positionUnitContextUi(),
      // board.ts may call this while its runtime registry is preloading.  The
      // permissive input keeps the controller compatible with both boolean
      // and message-style loading callbacks without coupling the Core to UI.
      onLoading: (loading: unknown) => this.setBoardLoading(loading),
      onWarning: (warning: BoardAssetWarning) => {
        console.warn(`[board-assets] ${warning.kind}: ${warning.path} (${warning.message})`);
      },
    } as Parameters<typeof createBoardGame>[1];
    this.boardGame = createBoardGame(parent, callbacks);
    const game = this.boardGame;
    const resolveScene = (): void => {
      const scene = game.scene.getScene('hex-board');
      if (scene instanceof Object && 'updateState' in scene) {
        this.boardScene = scene as HexBoardScene;
        this.updateBoard();
        this.renderUnitContextUi();
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

  private setBoardLoading(status: unknown): void {
    let loading = true;
    let message: string | undefined;
    if (typeof status === 'boolean') {
      loading = status;
    } else if (typeof status === 'string') {
      message = status;
      loading = !/^(?:ready|loaded|complete|completed|done|success|error|failed|failure)$/iu.test(status.trim());
    } else if (status && typeof status === 'object') {
      const payload = status as { loading?: unknown; message?: unknown; status?: unknown; phase?: unknown };
      if (typeof payload.loading === 'boolean') loading = payload.loading;
      const label = payload.message ?? payload.status ?? payload.phase;
      if (typeof label === 'string') {
        message = label;
        if (typeof payload.loading !== 'boolean') loading = !/^(?:ready|loaded|complete|completed|done|success|error|failed|failure)$/iu.test(label.trim());
      }
    }
    const indicator = this.root.querySelector<HTMLElement>('[data-board-loading]');
    if (!indicator) return;
    if (message && message.length > 0) indicator.textContent = message;
    else if (loading) indicator.textContent = this.translator()('boardLoading');
    indicator.hidden = !loading;
    indicator.setAttribute('aria-hidden', String(!loading));
  }

  private bindRootEvents(): void {
    this.root.onclick = (event) => {
      const target = event.target as HTMLElement;
      const action = target.closest<HTMLElement>('[data-action]')?.dataset.action;
      const nav = target.closest<HTMLElement>('[data-nav]')?.dataset.nav;
      if (action && !(action === 'sheet-toggle' && this.sheetDragged)) this.onAction(action, target.closest<HTMLElement>('[data-action]') ?? target);
      if (this.resourceAccordion && !target.closest('[data-resource-accordion]')) {
        this.resourceAccordion = null;
        this.updateView();
      }
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
      const target = event.target as HTMLElement;
      const checkpointElement = target.closest<HTMLElement>('.checkpoint-candidate');
      if (checkpointElement) this.previewCheckpointCandidate(checkpointElement);
      const constructibleElement = target.closest<HTMLElement>('.constructible-candidate');
      if (constructibleElement) this.previewConstructibleCandidate(constructibleElement);
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
      case 'toggle-language': this.locale = toggleLocale(this.locale); persistLocale(this.locale); this.checkpointPlacementMessage = null; this.constructiblePlacementMessage = null; this.screen === 'game' ? this.renderGame() : this.showTitle(); break;
      case 'title': this.showTitle(); break;
      case 'help': this.showHelp(); break;
      case 'focus-important-event': this.focusImportantEvent(element); break;
      case 'focus-crisis-alert': this.focusCrisisAlert(element); break;
      case 'open-crisis': this.openCrisis(); break;
      case 'toggle-resource': this.toggleResourceAccordion(element.dataset.resource as ResourceAccordionKey); break;
      case 'toggle-overview': this.toggleOverviewSection(element.dataset.section as OverviewSectionKey); break;
      case 'show-more-crisis': this.showMoreCrisis(element.dataset.crisisSeverity as CrisisAlertViewModel['severity']); break;
      case 'show-more-events': this.eventHistoryLimit = Math.min(50, this.eventHistoryLimit + 10); this.updateView(); break;
      case 'select-same-target': this.selectSameHexTarget(element); break;
      case 'toggle-supply': this.supplyOverlay = !this.supplyOverlay; this.updateView(); break;
      case 'sheet-toggle': this.toggleSheet(); break;
      case 'unit-mode-move': this.enterUnitActionMode('move'); break;
      case 'unit-mode-attack': this.enterUnitActionMode('attack'); break;
      case 'unit-clear-selection': this.clearUnitSelection(); break;
      case 'unit-mode-cancel': this.leaveUnitActionMode(); break;
      case 'unit-target-cancel': this.cancelUnitTarget(); break;
      case 'confirm-move': this.confirmMove(); break;
      case 'confirm-attack': this.confirmAttack(); break;
      case 'cancel-move': this.cancelUnitTarget(); break;
      case 'wait':
      case 'unit-wait': this.waitSelected(); break;
      case 'end-turn': this.endTurn(); break;
      case 'end-turn-confirm': this.dismissModal(); this.commitEndTurn(); break;
      case 'save': this.showSaveModal(); break;
      case 'manual-save': this.manualSave(); break;
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
      case 'produce-riot-police': this.produce('riotPolice'); break;
      case 'build-constructible-local': this.buildConstructibleAtSelectedHex(element.dataset.facilityType); break;
      case 'build-simple-farm': this.startConstructibleBuild('simpleFarm'); break;
      case 'build-civilian-drone-base': this.startConstructibleBuild('civilianDroneBase'); break;
      case 'constructible-place-cancel': this.constructiblePlacement = null; this.constructiblePreviewTarget = null; this.constructiblePlacementMessage = null; this.updateView(); break;
      case 'constructible-build-at': this.executeConstructibleCandidate(element); break;
      case 'build-checkpoint': this.buildCheckpoint(); break;
      case 'relocate-checkpoint': this.startRelocation(); break;
      case 'checkpoint-place-cancel': this.checkpointPlacement = null; this.checkpointPreviewTarget = null; this.checkpointPlacementMessage = null; this.updateView(); break;
      case 'checkpoint-build-at': this.buildCheckpointAt(element); break;
      case 'checkpoint-relocate-at': this.relocateCheckpointAt(element); break;
      case 'build-checkpoint-local': this.buildCheckpoint(); break;
      case 'checkpoint-build-direct': this.executeCheckpointCandidate(element, 'BuildCheckpoint'); break;
      case 'checkpoint-relocate-direct': this.executeCheckpointCandidate(element, 'RelocateCheckpoint'); break;
      case 'activate-checkpoint': this.activateCheckpoint(element); break;
      case 'turn-away-refugees': this.turnAwayRefugees(element); break;
      case 'decommission-facility': this.decommissionFacility(element); break;
      default: break;
    }
  }

  private onNav(nav: string): void {
    if (nav !== 'domestic' && nav !== 'map') return;
    const mode = nav as NavigationMode;
    const selected = this.selectedPosition();
    this.navMode = mode;
    this.unitActionMode = null;
    this.pendingMove = null;
    this.pendingAttackTargetId = null;
    this.checkpointPlacement = null;
    this.checkpointPreviewTarget = null;
    this.checkpointPlacementMessage = null;
    this.constructiblePlacement = null;
    this.constructiblePreviewTarget = null;
    this.constructiblePlacementMessage = null;
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

  private toggleResourceAccordion(resource?: ResourceAccordionKey): void {
    if (!resource || !['food', 'civilianGoods', 'militaryGoods', 'fuel', 'electricity'].includes(resource)) return;
    this.resourceAccordion = this.resourceAccordion === resource ? null : resource;
    this.updateView();
  }

  private toggleOverviewSection(section?: OverviewSectionKey): void {
    if (!section || !['crisis', 'population', 'branches', 'events', 'construction'].includes(section)) return;
    this.overviewSections.set(section, !(this.overviewSections.get(section) ?? false));
    this.updateView();
  }

  private showMoreCrisis(severity?: CrisisAlertViewModel['severity']): void {
    if (severity !== 'critical' && severity !== 'warning' && severity !== 'advisory') return;
    this.crisisExpandedGroups.add(severity);
    this.updateView();
  }

  private openCrisis(): void {
    this.resourceAccordion = null;
    this.selection = null;
    this.overviewSections.set('crisis', true);
    this.sheetState = 'expanded';
    this.updateView();
  }

  private selectSameHexTarget(element: HTMLElement): void {
    if (!this.state) return;
    const kind = element.dataset.selectionKind;
    const id = element.dataset.selectionId;
    if ((kind === 'unit' || kind === 'zombie' || kind === 'facility' || kind === 'checkpoint') && id) {
      this.selection = { kind, id } as Selection;
    } else if ((kind === 'hex' || kind === 'road') && Number.isInteger(Number(element.dataset.q)) && Number.isInteger(Number(element.dataset.r))) {
      this.selection = { kind, position: { q: Number(element.dataset.q), r: Number(element.dataset.r) } } as Selection;
    }
    this.unitActionMode = null;
    this.pendingMove = null;
    this.pendingAttackTargetId = null;
    this.updateView();
  }

  private focusCrisisAlert(element: HTMLElement): void {
    if (!this.state) return;
    const kind = element.dataset.entityKind;
    const id = element.dataset.entityId;
    const q = Number(element.dataset.q);
    const r = Number(element.dataset.r);
    let position: HexCoord | null = Number.isSafeInteger(q) && Number.isSafeInteger(r) ? { q, r } : null;
    if (kind === 'unit' || kind === 'zombie') {
      const unit = id ? this.state.units.find((candidate) => candidate.id === id) : undefined;
      if (unit) {
        this.selection = unit.isPlayerUnit ? { kind: 'unit', id: unit.id } : { kind: 'zombie', id: unit.id };
        position = { ...unit.position };
      }
    } else if (kind === 'facility' && id && this.state.facilities.some((candidate) => candidate.id === id)) {
      this.selection = { kind: 'facility', id };
      position = this.state.facilities.find((candidate) => candidate.id === id)?.position ?? position;
    } else if (kind === 'checkpoint' && id && this.state.checkpoints.some((candidate) => candidate.id === id)) {
      this.selection = { kind: 'checkpoint', id };
      position = this.state.checkpoints.find((candidate) => candidate.id === id)?.position ?? position;
    }
    if (position) this.boardScene?.focusHex(position);
    this.navMode = 'map';
    this.sheetState = 'standard';
    this.updateView();
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
    // v1.5.0 keeps global branch/resource/event information inside the
    // unselected accordions. Constructible candidates are rendered only for a
    // selected Domestic Hex; never append a board-wide candidate list here.
    if (sheetBody && this.checkpointPlacement) sheetBody.insertAdjacentHTML('beforeend', this.renderCheckpointPlacement());
    this.updateBoard();
    this.renderUnitContextUi();
    this.updateNoiseDebugOverlay();
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
    const t = this.translator();
    const population = populationLocationTotals(this.state);
    const forecast = this.queryEndTurnForecast();
    this.updateResourceAccordion(forecast);
    const forecastPower = forecast.electricity;
    const powerHud = powerHudViewModel(forecastPower, this.locale);
    const horde = this.state.horde;
    const warningType = horde.warningType;
    const finalHordeVisible = warningType === 'final' || horde.finalHordeStatus !== 'notStarted';
    const warningLabel = finalHordeVisible ? this.translator()('finalHordeWarning') : this.translator()('horde');
    const warnedDirections = warningType === 'none' ? [] : horde.warningDirections;
    const nextWave = hordeWaveForIndex(this.state.config, horde.nextWaveIndex);
    const finalTurn = finalWaveTurn(this.state.config);
    const nextWaveLabel = horde.nextWaveIndex === null ? '—' : String(horde.nextWaveIndex);
    const directionCount = nextWave ? String(nextWave.directionCount) : '—';
    const directionsLabel = warnedDirections.length > 0
      ? warnedDirections.map((direction) => formatDirection(direction, this.locale)).join(' / ')
      : '—';
    const scheduledSpawnTurn = horde.nextSpawnTurn ?? hordeWaveSpawnTurn(nextWave);
    const composition = hordeCompositionLabel(nextWave, this.locale, this.state.config);
    const remainingTurns = warningType === 'none' && !finalHordeVisible && scheduledSpawnTurn !== null
      ? Math.max(0, scheduledSpawnTurn - this.state.turn)
      : horde.turnsRemaining;
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
      turn: String(this.state.turn),
      'turn-label': `${this.translator()('turn')} · ${this.translator()('finalWaveTurn')} ${finalTurn ?? '—'}`,
      population: String(population.total),
      food: String(this.state.resources.food),
      civilianGoods: String(this.state.resources.civilianGoods),
      militaryGoods: String(this.state.resources.militaryGoods),
      fuel: String(this.state.resources.fuel),
      electricity: powerHud.display,
      power: powerHud.display,
      'horde-warning': warningLabel,
      'horde-status': hordeStatusLabel(horde.finalHordeStatus, this.locale),
      'horde-wave-index': nextWaveLabel,
      'horde-direction-count': directionCount,
      'horde-directions': directionsLabel,
      'horde-composition': composition,
      'horde-final': nextWave?.final || finalHordeVisible && horde.nextWaveIndex === null ? t('finalWave') : '—',
      'horde-remaining': String(remainingTurns),
      'horde-spawn-turn': scheduledSpawnTurn === null ? '—' : String(scheduledSpawnTurn),
      'healthy-civilians': String(population.healthyCivilians),
      infected: String(population.infected),
      'save-status': this.saveStatusLabel(),
    };
    for (const [key, value] of Object.entries(bindings)) {
      const element = this.root.querySelector<HTMLElement>(`[data-bind="${key}"]`);
      if (element) element.textContent = value;
    }
    const hordeCard = this.root.querySelector<HTMLElement>('[data-bind="horde-card"]');
    if (hordeCard) hordeCard.dataset.hordeState = finalHordeVisible ? 'final' : warningType;
    const crisis = this.queryCrisisSummary();
    const strategicWarnings = strategicWarningViewModel({
      strategicForecast: this.queryStrategicForecast(),
      checkpoints: this.state.checkpoints.map((checkpoint) => this.queryPublicCheckpoint(checkpoint.id)).filter((checkpoint): checkpoint is AgentCheckpointObservation => Boolean(checkpoint)),
      checkpointPositionCandidates: [...this.queryCheckpointPositionCandidates()],
    }, this.locale);
    const critical = strategicWarnings.find((warning) => warning.tier === 'critical');
    const criticalStrip = this.root.querySelector<HTMLElement>('[data-bind="strategic-critical"]');
    if (criticalStrip) {
      criticalStrip.hidden = !critical;
      criticalStrip.dataset.warningTier = critical ? critical.tier : 'none';
      const text = criticalStrip.querySelector<HTMLElement>('[data-bind="strategic-critical-text"]');
      if (text) text.textContent = critical ? `${critical.title} · ${critical.detail}` : '';
    }
    const progress = this.root.querySelector<HTMLElement>('[data-bind="victory-progress"]');
    if (progress) {
      const victory = deriveVictoryProgress(this.state);
      const progressItems = [
        ['finalHordeDefeated', this.translator()('finalHordeDefeated'), victory.finalHordeDefeated],
        ['suppliedAreaZombieClear', this.translator()('suppliedAreaZombieClear'), victory.suppliedAreaZombieClear],
        ['suppliedAreaInfectionClear', this.translator()('suppliedAreaInfectionClear'), victory.suppliedAreaInfectionClear],
      ] as const;
      progress.innerHTML = progressItems.map(([key, label, complete]) =>
        `<span class="victory-check ${complete ? 'is-complete' : 'is-pending'}" data-progress="${key}"><b aria-hidden="true">${complete ? '✓' : '○'}</b>${escapeHtml(label)}</span>`,
      ).join('');
    }
    const powerElement = this.root.querySelector<HTMLElement>('[data-bind="power-pill"]');
    if (powerElement) {
      powerElement.title = powerHud.tooltip;
      powerElement.setAttribute('aria-label', powerHud.accessibleName);
      powerElement.classList.toggle('is-shortage', powerHud.isShortage);
      powerElement.dataset.powerState = powerHud.isShortage ? 'shortage' : 'ok';
    }
    const fuelElement = this.root.querySelector<HTMLElement>('.fuel-pill');
    if (fuelElement) {
      const fuel = forecast.fuel;
      fuelElement.title = `${t('fuelForecast')}: ${t('currentFuel')} ${fuel.turnStartFuel} · ${t('powerFuelDemand')} ${fuel.projectedPowerFuelDemand} · ${t('unitRefillDemand')} ${fuel.projectedUnitRefillDemand} · ${t('projectedEndingFuel')} ${fuel.projectedEndingFuel}`;
      fuelElement.setAttribute('aria-label', `${t('fuel')}: ${fuel.turnStartFuel}. ${t('totalFuelDemand')}: ${fuel.projectedTotalFuelDemand}. ${t('projectedEndingFuel')}: ${fuel.projectedEndingFuel}`);
    }
    this.updateCrisisStrip(crisis);
  }

  private updateResourceAccordion(forecast: EndTurnForecast): void {
    const accordion = this.root.querySelector<HTMLElement>('[data-resource-accordion]');
    if (!accordion) return;
    const t = this.translator();
    for (const resource of RESOURCE_ACCORDION_KEYS) {
      const button = accordion.querySelector<HTMLButtonElement>(`[data-resource="${resource}"]`);
      const panel = accordion.querySelector<HTMLElement>(`[data-resource-panel="${resource}"]`);
      const shortage = resourceShortageAmount(resource, forecast);
      const open = this.resourceAccordion === resource;
      if (button) {
        button.setAttribute('aria-expanded', String(open));
        button.classList.toggle('is-open', open);
        button.classList.toggle('has-shortage', shortage > 0);
        button.title = shortage > 0 ? `${t('forecastShortage')}: ${shortage}` : t('forecastNormal');
        const warning = button.querySelector<HTMLElement>('[data-resource-warning]');
        if (warning) {
          warning.hidden = shortage <= 0;
          warning.textContent = shortage > 0 ? '!' : '';
        }
      }
      if (panel) {
        panel.hidden = !open;
        if (open) panel.innerHTML = renderResourceAccordionPanel(resource, forecast, this.locale);
      }
    }
  }

  private updateCrisisStrip(summary: CrisisSummaryViewModel): void {
    const mount = this.root.querySelector<HTMLElement>('[data-crisis-mount]');
    if (!mount) return;
    mount.innerHTML = renderCrisisStrip(summary, this.locale);
  }

  private updateBoard(): void {
    if (!this.state || !this.boardScene) return;
    const suppliedTileKeys = this.querySuppliedTileKeys();
    const supplyContext = this.supplyOverlay || Boolean(this.checkpointPlacement) || Boolean(this.constructiblePlacement) || selectionShowsSupplyOverlay(this.state, this.selection);
    const preview = this.checkpointPreview();
    const constructiblePreview = this.constructibleFacilityPreview();
    const previewTarget = this.checkpointPlacement ? this.checkpointPreviewTarget : null;
    const previewSuppliedTileKeys = previewTarget
      ? getSuppliedTileKeys(this.state, { branchId: previewTarget.branchId, checkpointPosition: previewTarget.position })
      : suppliedTileKeys;
    const render: BoardRenderState = {
      state: this.state,
      locale: this.locale,
      selectedPosition: this.selectedPosition(),
      selectedUnitId: this.selection?.kind === 'unit' ? this.selection.id : null,
      selectedZombieId: this.selection?.kind === 'zombie' ? this.selection.id : null,
      legalDestinations: this.selectedUnitLegalMoves(),
      attackTargetIds: this.selectedUnitAttackTargets(),
      pendingPath: this.pendingMove?.path,
      hordeDirections: this.state.horde.warningType === 'none' ? [] : this.state.horde.warningDirections,
      hordeWarningType: this.state.horde.warningType,
      visibilityOverlay: true,
      visionCoverage: this.queryVision(),
      selectedVision: this.selectedVision(),
      supplyOverlay: supplyContext,
      suppliedTileKeys: previewSuppliedTileKeys,
      facilityProduction: this.queryFacilityProduction(),
      checkpointLegalPreviewPositions: preview.legalPositions,
      checkpointInvalidPreviewPositions: preview.invalidPositions,
      blockedZombieIds: preview.blockedZombieIds,
      checkpointPreviewSelected: previewTarget?.position,
      checkpointPreviewMode: this.checkpointPlacement?.mode ?? null,
      constructibleFacilityType: this.constructiblePlacement?.facilityType ?? null,
      constructibleFacilityLegalPreviewPositions: constructiblePreview.legalPositions,
      constructibleFacilityInvalidPreviewPositions: constructiblePreview.invalidPositions,
      constructibleFacilityPreviewSelected: this.constructiblePreviewTarget,
    };
    this.boardScene.updateState(render);
  }

  private updateNoiseDebugOverlay(): void {
    if (!IS_DEVELOPMENT_BUILD) return;
    const mount = this.root.querySelector<HTMLElement>('[data-noise-debug-mount]');
    if (!mount || !this.state) return;
    const state = this.state;
    const locale = this.locale;
    void import('./noiseDebug').then(({ renderDevelopmentNoiseDebug }) => {
      if (!mount.isConnected) return;
      const markup = renderDevelopmentNoiseDebug(state, locale);
      mount.innerHTML = markup;
      mount.hidden = markup.length === 0;
    });
  }

  private checkpointPreview(): { legalPositions: HexCoord[]; invalidPositions: HexCoord[]; blockedZombieIds: string[] } {
    // Build is a local action from a selected Domestic road Hex. Only
    // Relocate keeps board-wide legal/invalid candidate markers.
    if (!this.state || !this.checkpointPlacement || this.checkpointPlacement.mode !== 'relocate') {
      return { legalPositions: [], invalidPositions: [], blockedZombieIds: [] };
    }
    const candidates = this.checkpointCandidates();
    const legalPositions = candidates.filter((candidate) => candidate.legal).map((candidate) => ({ ...candidate.position }));
    const invalidPositions = candidates.filter((candidate) => !candidate.legal).map((candidate) => ({ ...candidate.position }));
    const visible = this.queryVisibleTileKeys();
    const blockedZombieIds = this.checkpointPreviewTarget
      ? getBlockingZombiesForCheckpoint(
        this.state,
        this.checkpointPreviewTarget.branchId,
        this.checkpointPreviewTarget.position,
      )
        .filter((zombie) => visible.has(hexKey(zombie.position)))
        .map((zombie) => zombie.id)
      : [];
    return { legalPositions, invalidPositions, blockedZombieIds };
  }

  private constructibleFacilityCandidates(
    facilityType = this.constructiblePlacement?.facilityType,
  ): ConstructibleFacilityPositionCandidate[] {
    if (!this.engine || !facilityType) return [];
    try {
      return this.queryConstructibleFacilityPositionCandidates(facilityType)
        .map((candidate) => ({ ...candidate, position: { ...candidate.position } }));
    } catch {
      return [];
    }
  }

  private constructibleFacilityPreview(): { legalPositions: HexCoord[]; invalidPositions: HexCoord[] } {
    if (!this.constructiblePlacement) return { legalPositions: [], invalidPositions: [] };
    const candidates = this.constructibleFacilityCandidates();
    return {
      legalPositions: candidates.filter((candidate) => candidate.legal).map((candidate) => ({ ...candidate.position })),
      invalidPositions: candidates.filter((candidate) => !candidate.legal).map((candidate) => ({ ...candidate.position })),
    };
  }

  private selectedVision(): BoardVisionSelection | null {
    if (!this.state || !this.selection) return null;
    const selected = this.selection;
    const selection = (
      origin: HexCoord,
      radius: number,
      visionMode: BoardVisionSelection['visionMode'],
      terrainLosBlocking: boolean,
    ): BoardVisionSelection | null => {
      if (!Number.isFinite(radius) || radius <= 0) return null;
      // These sets are produced by Core.  In particular, the UI does not
      // recreate a radius ring or trace hexLine for Ground LOS.
      const ground = visionMode === 'ground'
        ? getGroundVisionCoverageFrom(this.state!, origin, radius)
        : null;
      const aerial = ground ? null : getAerialVisibleTileKeys(this.state!, origin, radius);
      const visibleTileKeys = ground?.visible ?? aerial!;
      const potentialTileKeys = ground?.potential ?? aerial!;
      const blockedTileKeys = ground?.blocked ?? new Set<string>();
      return {
        origin: { ...origin },
        radius: Math.max(0, Math.trunc(radius)),
        visionMode,
        terrainLosBlocking,
        visibleTileKeys,
        potentialTileKeys,
        blockedTileKeys,
      };
    };
    if (selected.kind === 'unit') {
      const unit = findUnit(this.state, selected.id);
      return unit && unit.isPlayerUnit
        ? selection(unit.position, unit.vision, 'ground', true)
        : null;
    }
    if (selected.kind === 'facility') {
      const facility = this.state.facilities.find((candidate) => candidate.id === selected.id);
      if (!facility || facility.owner !== 'player' || facility.status === 'ruined') return null;
      const publicFacility = this.queryPublicFacility(facility.id);
      const visionMode = publicFacility?.visionMode ?? (facility.type === 'civilianDroneBase' ? 'aerial' : 'ground');
      const terrainLosBlocking = publicFacility?.terrainLosBlocking ?? visionMode === 'ground';
      const radius = publicFacility?.vision ?? (facility.type === 'capital'
        ? this.state.config.vision.capital
        : facility.type === 'civilianDroneBase'
          ? facility.workers * 2
          : this.state.config.vision.ownedFacility);
      return selection(facility.position, radius, visionMode, terrainLosBlocking);
    }
    if (selected.kind === 'road' || selected.kind === 'hex' || selected.kind === 'zombie') return null;
    const checkpoint = this.state.checkpoints.find((candidate) => candidate.id === selected.id);
    const publicCheckpoint = checkpoint ? this.queryPublicCheckpoint(checkpoint.id) : undefined;
    return checkpoint?.status === 'operational'
      ? selection(checkpoint.position, publicCheckpoint?.vision ?? 0, 'ground', true)
      : null;
  }

  private selectedPosition(): HexCoord | null {
    if (!this.state || !this.selection) return null;
    const selected = this.selection;
    if (selected.kind === 'unit') return findUnit(this.state, selected.id)?.position ?? null;
    if (selected.kind === 'facility') return this.state.facilities.find((facility) => facility.id === selected.id)?.position ?? null;
    if (selected.kind === 'road' || selected.kind === 'hex') return { ...selected.position };
    if (selected.kind === 'zombie') return findUnit(this.state, selected.id)?.position ?? null;
    return this.state.checkpoints.find((checkpoint) => checkpoint.id === selected.id)?.position ?? null;
  }

  private legalActions(): GameAction[] {
    try {
      const listed = this.query()?.getLegalActions?.();
      return listed ? [...listed] : this.engine?.getLegalActions() ?? [];
    } catch {
      return [];
    }
  }

  private checkpointCandidates(placement = this.checkpointPlacement): CheckpointPositionCandidate[] {
    if (!this.engine || !placement) return [];
    try {
      const actionType = placement.mode === 'build' ? 'BuildCheckpoint' : 'RelocateCheckpoint';
      return this.queryCheckpointPositionCandidates()
        .filter((candidate) => candidate.actionType === actionType)
        .filter((candidate) => !placement.branchId || candidate.branchId === placement.branchId)
        .filter((candidate) => placement.mode !== 'relocate' || candidate.checkpointId === placement.checkpointId)
        .map((candidate) => ({ ...candidate, position: { ...candidate.position } }));
    } catch {
      return [];
    }
  }

  /** Return every Core candidate for a branch, preserving Build/Relocate pairs. */
  private checkpointCandidatesForBranch(branchId: RoadBranchId): CheckpointPositionCandidate[] {
    if (!this.engine) return [];
    try {
      return this.queryCheckpointPositionCandidates()
        .filter((candidate) => candidate.branchId === branchId)
        .map((candidate) => ({ ...candidate, position: { ...candidate.position } }));
    } catch {
      return [];
    }
  }

  /**
   * Resolve the one BuildCheckpoint candidate represented by a selected road
   * Hex. Candidate legality and its reason are owned by Core; this helper only
   * narrows the already-returned candidate list to the selected tile.
   */
  private checkpointBuildCandidateAt(position: HexCoord): CheckpointPositionCandidate | null {
    if (!this.engine || !this.state) return null;
    const branchId = roadBranchForPosition(this.state, position);
    if (!branchId) return null;
    try {
      const candidate = this.queryCheckpointPositionCandidates().find((entry) =>
        entry.actionType === 'BuildCheckpoint' && entry.branchId === branchId && samePosition(entry.position, position),
      );
      return candidate ? { ...candidate, position: { ...candidate.position } } : null;
    } catch {
      return null;
    }
  }

  private selectedUnitLegalMoves(): HexCoord[] {
    if (this.unitActionMode !== 'move' || !this.selection || this.selection.kind !== 'unit') return [];
    return this.selectedUnitLegalMovesRaw();
  }

  private selectedUnitLegalMovesRaw(): HexCoord[] {
    if (!this.selection || this.selection.kind !== 'unit') return [];
    const unitActions = this.query()?.getLegalActionsForUnit?.(this.selection.id);
    return unitActions
      ? legalMoveDestinations([...unitActions], this.selection.id)
      : legalMoveDestinations(this.legalActions(), this.selection.id);
  }

  private selectedUnitAttackTargets(): string[] {
    if (this.unitActionMode !== 'attack' || !this.selection || this.selection.kind !== 'unit') return [];
    return this.selectedUnitAttackTargetsRaw();
  }

  private selectedUnitAttackTargetsRaw(): string[] {
    if (!this.selection || this.selection.kind !== 'unit') return [];
    const unitActions = this.query()?.getLegalActionsForUnit?.(this.selection.id);
    return unitActions
      ? legalAttackTargets([...unitActions], this.selection.id)
      : legalAttackTargets(this.legalActions(), this.selection.id);
  }

  private enterUnitActionMode(mode: Exclude<UnitActionMode, null>): void {
    if (this.selection?.kind !== 'unit') return;
    const availability = unitActionAvailability(this.legalActions(), this.selection.id);
    if (!availability[mode]) return;
    this.unitActionMode = mode;
    this.pendingMove = null;
    this.pendingAttackTargetId = null;
    this.updateView();
  }

  private clearUnitSelection(): void {
    this.selection = null;
    this.checkpointPlacementMessage = null;
    this.unitActionMode = null;
    this.pendingMove = null;
    this.pendingAttackTargetId = null;
    this.updateView();
  }

  private leaveUnitActionMode(): void {
    if (this.selection?.kind !== 'unit') return;
    this.unitActionMode = null;
    this.pendingMove = null;
    this.pendingAttackTargetId = null;
    this.updateView();
  }

  private cancelUnitTarget(): void {
    if (this.selection?.kind !== 'unit') return;
    this.pendingMove = null;
    this.pendingAttackTargetId = null;
    this.updateView();
  }

  private cancelUnitInteractionLevel(): void {
    if (this.constructiblePlacement) {
      this.constructiblePlacement = null;
      this.constructiblePreviewTarget = null;
      this.constructiblePlacementMessage = null;
      this.updateView();
      return;
    }
    if (this.checkpointPlacement) return;
    switch (unitInteractionCancelStep(this.unitActionMode, Boolean(this.pendingMove || this.pendingAttackTargetId), Boolean(this.selection))) {
      case 'target': this.cancelUnitTarget(); break;
      case 'mode': this.leaveUnitActionMode(); break;
      case 'selection': this.selection = null; this.checkpointPlacementMessage = null; this.updateView(); break;
      default: break;
    }
  }

  private unitContextAnchorPosition(): HexCoord | null {
    if (!this.state || this.selection?.kind !== 'unit') return null;
    if (this.pendingMove) return this.pendingMove.destination;
    if (this.pendingAttackTargetId) {
      return this.state.units.find((unit) => unit.id === this.pendingAttackTargetId)?.position ?? null;
    }
    return findUnit(this.state, this.selection.id)?.position ?? null;
  }

  private renderUnitContextUi(): void {
    const layer = this.root.querySelector<HTMLElement>('[data-unit-context-layer]');
    if (!layer) return;
    layer.innerHTML = '';
    if (!this.state || this.navMode !== 'map' || this.selection?.kind !== 'unit') return;
    const unit = findUnit(this.state, this.selection.id);
    if (!unit?.isPlayerUnit) return;
    const t = this.translator();

    if (this.pendingMove || this.pendingAttackTargetId) {
      const confirmAction = this.pendingMove ? 'confirm-move' : 'confirm-attack';
      const confirmLabel = this.pendingMove ? t('confirmMove') : t('confirmAttack');
      const publicUnit = this.queryPublicUnit(unit.id);
      const attackPreview = this.pendingAttackTargetId
        ? publicUnit?.attackPreviews.find((candidate) => candidate.targetUnitId === this.pendingAttackTargetId)
        : undefined;
      const movePreview = this.pendingMove
        ? publicUnit?.fuelCostByLegalMove.find((candidate) => samePosition(candidate.destination, this.pendingMove!.destination))
        : undefined;
      const detail = attackPreview
        ? renderAttackPreview(attackPreview, this.locale, publicUnit?.attack)
        : movePreview
          ? `<div class="move-preview-detail" data-move-mode="${movePreview.movementMode}"><strong>${escapeHtml(t(movePreview.movementMode === 'emergency' ? 'emergencyMovement' : 'normalMovement'))}</strong><span>${escapeHtml(t('effectiveMovementCost'))} ${movePreview.effectiveMovementCost}</span><span>${escapeHtml(t('fuelCost'))} ${movePreview.fuelCost} · ${escapeHtml(t('fuelAfterMove'))} ${movePreview.projectedFuelAfterMove}</span></div>`
          : '';
      layer.innerHTML = `<div class="unit-target-confirm" data-unit-context-ui role="group" aria-label="${escapeHtml(confirmLabel)}"><button type="button" class="unit-context-button unit-context-cancel" data-action="unit-target-cancel" data-unit-action="cancel" aria-label="${escapeHtml(t('cancelTarget'))}"><span aria-hidden="true">×</span><small>${escapeHtml(t('cancel'))}</small></button>${detail}<button type="button" class="unit-context-button unit-context-confirm" data-action="${confirmAction}" data-unit-action="confirm" aria-label="${escapeHtml(confirmLabel)}"><span aria-hidden="true">✓</span><small>${escapeHtml(confirmLabel)}</small></button></div>`;
      this.positionUnitContextUi();
      return;
    }

    if (this.unitActionMode) {
      const label = this.unitActionMode === 'move' ? t('moveMode') : t('attackMode');
      layer.innerHTML = `<div class="unit-mode-indicator" data-unit-context-ui role="status"><strong>${escapeHtml(label)}</strong><button type="button" class="unit-context-button unit-context-cancel" data-action="unit-mode-cancel" aria-label="${escapeHtml(t('cancelActionMode'))}">×</button></div>`;
      this.positionUnitContextUi();
      return;
    }

    const availability = unitActionAvailability(this.legalActions(), unit.id);
    layer.innerHTML = `<div class="unit-action-menu" data-unit-context-ui role="toolbar" aria-label="${escapeHtml(t('unitActions'))}"><button type="button" class="unit-context-button" data-action="unit-mode-move" data-unit-action="move" ${availability.move ? '' : 'disabled'}><span aria-hidden="true">⇢</span><small>${escapeHtml(t('move'))}</small></button><button type="button" class="unit-context-button" data-action="unit-mode-attack" data-unit-action="attack" ${availability.attack ? '' : 'disabled'}><span aria-hidden="true">⌖</span><small>${escapeHtml(t('attack'))}</small></button><button type="button" class="unit-context-button" data-action="unit-wait" data-unit-action="wait" ${availability.wait ? '' : 'disabled'}><span aria-hidden="true">Ⅱ</span><small>${escapeHtml(t('wait'))}</small></button><button type="button" class="unit-context-button unit-context-close" data-action="unit-clear-selection" aria-label="${escapeHtml(t('clearSelection'))}">×</button></div>`;
    this.positionUnitContextUi();
  }

  private positionUnitContextUi(): void {
    const context = this.root.querySelector<HTMLElement>('[data-unit-context-ui]');
    const region = this.root.querySelector<HTMLElement>('.board-region');
    const position = this.unitContextAnchorPosition();
    if (!context || !region || !position || !this.boardScene) return;
    const anchor = this.boardScene.projectHexToScreen(position);
    if (!anchor) return;
    const size = { width: context.offsetWidth, height: context.offsetHeight };
    const placement = placeBoardContextUi(
      anchor,
      { width: region.clientWidth, height: region.clientHeight },
      size,
    );
    context.style.left = `${placement.left + size.width / 2}px`;
    context.style.top = context.classList.contains('unit-mode-indicator')
      ? `${placement.top}px`
      : `${placement.top + size.height / 2}px`;
    context.dataset.vertical = placement.vertical;
  }

  private onTileTap(position: HexCoord): void {
    if (!this.state || !this.engine) return;
    if (this.constructiblePlacement) {
      const candidate = this.constructibleFacilityCandidates().find((entry) => samePosition(entry.position, position));
      if (!candidate) return;
      this.constructiblePreviewTarget = { ...candidate.position };
      if (!candidate.legal) {
        this.constructiblePlacementMessage = localizeActionError(candidate.reasonCode ?? undefined, this.locale);
        this.updateView();
        return;
      }
      if (this.apply({ type: 'BuildConstructibleFacility', facilityType: candidate.facilityType, position: { ...candidate.position } })) {
        this.constructiblePlacement = null;
        this.constructiblePreviewTarget = null;
        this.constructiblePlacementMessage = null;
        this.supplyOverlay = true;
        this.updateView();
      }
      return;
    }
    if (this.checkpointPlacement) {
      const candidate = this.checkpointCandidates().find((entry) => samePosition(entry.position, position));
      if (!candidate) return;
      this.checkpointPreviewTarget = { branchId: candidate.branchId, position: { ...candidate.position } };
      if (!candidate.legal) {
        this.checkpointPlacementMessage = localizeActionError(candidate.reasonCode ?? undefined, this.locale);
        this.updateView();
        return;
      }
      if (this.apply(actionForCheckpointCandidate(candidate))) {
        this.checkpointPlacement = null;
        this.checkpointPreviewTarget = null;
        this.checkpointPlacementMessage = null;
        this.supplyOverlay = true;
        this.updateView();
      }
      return;
    }
    if (this.navMode === 'domestic') {
      this.unitActionMode = null;
      this.pendingMove = null;
      this.pendingAttackTargetId = null;
      this.selection = resolveTileSelection(this.state, position, this.navMode);
      this.checkpointPlacementMessage = null;
      this.updateView();
      return;
    }

    if (this.selection?.kind === 'unit') {
      const selected = findUnit(this.state, this.selection.id);
      if (selected && samePosition(selected.position, position)) {
        this.cancelUnitInteractionLevel();
        return;
      }

      if (this.unitActionMode === 'attack') {
        const targetIds = this.selectedUnitAttackTargetsRaw();
        const target = this.state.units.find((candidate) =>
          targetIds.includes(candidate.id) && candidate.actionState !== 'destroyed' && samePosition(candidate.position, position));
        if (target) {
          this.pendingAttackTargetId = target.id;
          this.pendingMove = null;
          this.updateView();
          return;
        }
        if (this.pendingAttackTargetId) this.cancelUnitTarget();
        else this.leaveUnitActionMode();
        return;
      }

      if (this.unitActionMode === 'move') {
        const move = this.selectedUnitLegalMovesRaw().find((candidate) => samePosition(candidate, position));
        if (move) {
          this.pendingMove = this.preview(this.selection.id, move);
          this.pendingAttackTargetId = null;
          this.sheetState = 'standard';
          this.updateView();
          return;
        }
        if (this.pendingMove) this.cancelUnitTarget();
        else this.leaveUnitActionMode();
        return;
      }
    }

    const resolved = resolveTileSelection(this.state, position, this.navMode);
    if (resolved) {
      this.selection = resolved;
      this.checkpointPlacementMessage = null;
      this.unitActionMode = null;
      this.pendingMove = null;
      this.pendingAttackTargetId = null;
      this.updateView();
    } else {
      this.selection = null;
      this.checkpointPlacementMessage = null;
      this.unitActionMode = null;
      this.pendingMove = null;
      this.pendingAttackTargetId = null;
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
    this.pendingAttackTargetId = null;
    this.unitActionMode = null;
    this.apply(action);
  }

  private confirmAttack(): void {
    if (!this.pendingAttackTargetId || !this.selection || this.selection.kind !== 'unit') return;
    const action: GameAction = { type: 'Attack', attackerId: this.selection.id, targetId: this.pendingAttackTargetId };
    this.pendingAttackTargetId = null;
    this.pendingMove = null;
    this.unitActionMode = null;
    this.apply(action);
  }

  private waitSelected(): void {
    if (this.selection?.kind !== 'unit') return;
    const unitId = this.selection.id;
    if (this.apply({ type: 'Wait', unitId })) {
      this.selection = null;
      this.unitActionMode = null;
      this.pendingMove = null;
      this.pendingAttackTargetId = null;
      this.updateView();
    }
  }

  private endTurn(): void {
    if (!this.state) return;
    const forecast = this.queryEndTurnForecast();
    const crisis = this.queryCrisisSummary();
    const endTurnRisk = this.queryEndTurnRisk();
    const t = this.translator();
    const projected: Array<[string, number]> = [];
    if (forecast.food.shortage > 0) projected.push([t('food'), forecast.food.shortage]);
    if (forecast.civilianGoods.maintenanceShortage > 0) {
      projected.push([`${t('civilianGoods')} · ${t('maintenanceShortage')}`, forecast.civilianGoods.maintenanceShortage]);
    }
    if (forecast.civilianGoods.productionInputShortage > 0) {
      projected.push([t('productionInputWarning'), forecast.civilianGoods.productionInputShortage]);
    }
    if (forecast.militaryGoods.totalUnfilledRefillDemand > 0) projected.push([t('militaryGoods'), forecast.militaryGoods.totalUnfilledRefillDemand]);
    if (forecast.fuel.generationFuelShortage > 0) {
      projected.push([t('generationFuelWarning'), forecast.fuel.generationFuelShortage]);
    }
    if (forecast.electricity.shortage > 0) projected.push([t('powerShortageWarning'), forecast.electricity.shortage]);
    const riskConfirmation = shouldConfirmEndTurn(crisis, endTurnRisk);
    if (riskConfirmation || projected.length > 0) {
      const details = projected
        .map(([resource, amount]) => `<li>${escapeHtml(resource)}: <b>${amount}</b></li>`)
        .join('');
      const overcrowding = forecast.overcrowding;
      const crowdDetails = overcrowding.cities.length > 0
        ? `<p class="muted">${escapeHtml(t('overcrowding'))}: ${escapeHtml(formatPercent(overcrowding.cities.reduce((total, city) => total + city.excess / Math.max(1, city.softCap), 0), this.locale))} · ${escapeHtml(t('additionalFood'))} ${overcrowding.additionalFood} · ${escapeHtml(t('additionalCivilianGoods'))} ${overcrowding.additionalCivilianGoods}</p>`
        : '';
      const riskItems = riskConfirmation
        ? `<section class="end-turn-risk" data-end-turn-risk="true"><h3>${escapeHtml(t('endTurnRisk'))}</h3>${crisis.criticalCount > 0 ? `<p class="warning-text">${escapeHtml(t('criticalAlertCount'))}: ${crisis.criticalCount}</p>` : ''}${endTurnRisk.unitsWithAttackChargesRemaining.length > 0 ? `<p>${escapeHtml(t('attackChargeRemainingUnits'))}: ${endTurnRisk.unitsWithAttackChargesRemaining.length}</p>` : ''}${endTurnRisk.uncontainedInfectedSites.length > 0 ? `<p>${escapeHtml(t('uncontainedInfectedSites'))}: ${endTurnRisk.uncontainedInfectedSites.length}</p>` : ''}${endTurnRisk.forecastGuaranteedDefeat ? `<p class="warning-text">${escapeHtml(t('guaranteedDefeat'))}</p>` : ''}</section>`
        : '';
      const title = riskConfirmation ? t('endTurnConfirmation') : t('shortageWarning');
      const body = riskConfirmation ? t('endTurnRiskBody') : t('shortageWarningBody');
      this.root.insertAdjacentHTML('beforeend', `<div class="modal-backdrop" data-modal="shortage"><section class="modal-card floating-card" aria-labelledby="shortage-heading"><h2 id="shortage-heading">${escapeHtml(title)}</h2><p>${escapeHtml(body)}</p>${riskItems}${crowdDetails}${details ? `<ul class="warning-list">${details}</ul>` : ''}<div class="modal-actions"><button class="primary-button" data-action="end-turn-confirm">${escapeHtml(t('proceedAnyway'))}</button><button class="ghost-button" data-action="dismiss-modal">${escapeHtml(t('back'))}</button></div></section></div>`);
      return;
    }
    this.commitEndTurn();
  }

  private commitEndTurn(): void {
    const result = this.apply({ type: 'EndTurn' });
    if (result) {
      this.selection = null;
      this.unitActionMode = null;
      this.pendingMove = null;
      this.pendingAttackTargetId = null;
      this.updateView();
      if (this.state?.gameOver) this.showStatistics(this.state.result);
    }
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
    const selected = this.selection;
    if (!selected || selected.kind !== 'facility' || !this.state) return;
    const input = this.root.querySelector<HTMLInputElement>('[data-worker-number="true"]');
    const facility = this.state.facilities.find((candidate) => candidate.id === selected.id);
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
    const selected = this.selection;
    if (!this.state || !selected || selected.kind !== 'facility') return;
    const facility = this.state.facilities.find((candidate) => candidate.id === selected.id);
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
    const selected = this.selection;
    if (!this.state || !selected || selected.kind !== 'facility') return undefined;
    const facility = this.state.facilities.find((candidate) => candidate.id === selected.id);
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
    const forecast = this.queryEndTurnForecast();
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
    const projectedPower = powerHudViewModel(projectedForecast.electricity, this.locale);
    output.innerHTML = `<dl class="transfer-preview-grid"><div><dt>${escapeHtml(t('fromCity'))}</dt><dd>${projection.fromPopulation} → <b>${projection.fromAfter}</b></dd></div><div><dt>${escapeHtml(t('toCity'))}</dt><dd>${projection.toPopulation} → <b>${projection.toAfter}</b></dd></div><div><dt>${escapeHtml(t('projectedOvercrowding'))}</dt><dd>${escapeHtml(formatPercent(projection.overcrowdingRate, this.locale))}</dd></div><div><dt>${escapeHtml(t('additionalFood'))}</dt><dd>${projection.additionalFood}</dd></div><div><dt>${escapeHtml(t('additionalCivilianGoods'))}</dt><dd>${projection.additionalCivilianGoods}</dd></div></dl><section class="forecast-card transfer-forecast"><h4>${escapeHtml(t('endTurnForecast'))}</h4><p class="muted">${escapeHtml(t('food'))}: ${projectedForecast.food.startingStock} → ${projectedForecast.food.endingStock} · ${escapeHtml(t('shortage'))} ${projectedForecast.food.shortage}</p><p class="muted">${escapeHtml(t('civilianGoods'))}: ${projectedForecast.civilianGoods.startingStock} → ${projectedForecast.civilianGoods.endingStock} · ${escapeHtml(t('maintenanceShortage'))} ${projectedForecast.civilianGoods.maintenanceShortage} · ${escapeHtml(t('productionInputShortage'))} ${projectedForecast.civilianGoods.productionInputShortage}</p><p class="muted">${escapeHtml(t('powerHudLabel'))}: ${escapeHtml(projectedPower.display)}</p></section>`;
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

  private setPolicy(branchId: string, policy: CheckpointPolicy): void {
    const requested: Extract<GameAction, { type: 'SetCheckpointPolicy' }> = { type: 'SetCheckpointPolicy', branchId, policy };
    const action = actionForCheckpointPolicy(this.legalActions(), branchId, policy) ?? requested;
    const reason = this.state ? actionReasonFor(this.state, action, this.locale) : this.translator()('invalidAction');
    if (reason) this.showToast(reason);
    else this.apply(action);
  }

  private produce(unitType: 'police' | 'nationalGuard' | 'riotPolice'): void {
    const facility = this.selectedCity();
    const destination = facility?.position;
    const action = facility ? actionForUnitProduction(this.legalActions(), unitType as HumanUnitType, destination) : undefined;
    if (action) {
      this.apply(action);
      return;
    }
    const requested = {
      type: 'ProduceUnit',
      unitType,
      ...(destination ? { destination } : {}),
    } as GameAction;
    const reason = actionReasonFor(this.state!, requested, this.locale) ??
      (unitType === 'police' ? this.translator()('policeRecruitmentRule') : unitType === 'nationalGuard' ? this.translator()('guardRecruitmentRule') : this.translator()('riotPoliceRecruitmentRule'));
    this.showToast(reason);
    this.updateRecruitmentReasons();
  }

  private startConstructibleBuild(facilityType: ConstructibleFacilityType): void {
    // Legacy action names remain accepted for integrations, but v1.5 never
    // opens a board-wide placement mode. Build must begin from the selected
    // empty Domestic Hex so Core can validate exactly one coordinate.
    if (this.selection?.kind !== 'hex') {
      this.showToast(this.translator()('domesticBuildHint'));
      return;
    }
    this.buildConstructibleAtSelectedHex(facilityType);
  }

  /** Execute a Constructible build for the currently selected Domestic Hex.
   * The candidate is narrowed to that one position; no board-wide marker or
   * coordinate list is exposed to the Human UI. */
  private buildConstructibleAtSelectedHex(facilityType: string | undefined): void {
    if (!this.state || !this.engine || this.selection?.kind !== 'hex') return;
    if (facilityType !== 'simpleFarm' && facilityType !== 'civilianDroneBase') return;
    const position = { ...this.selection.position };
    const candidate = this.constructibleFacilityCandidates(facilityType).find((entry) => samePosition(entry.position, position));
    const action: Extract<GameAction, { type: 'BuildConstructibleFacility' }> = {
      type: 'BuildConstructibleFacility',
      facilityType,
      position,
    };
    if (!candidate || !candidate.legal) {
      const reason = candidate?.reasonCode
        ? localizeActionError(candidate.reasonCode, this.locale)
        : localizeActionError('constructible_invalid_terrain', this.locale);
      this.constructiblePlacementMessage = reason;
      this.updateView();
      return;
    }
    const legalAction = this.legalActions().find((entry) => entry.type === 'BuildConstructibleFacility'
      && entry.facilityType === facilityType && samePosition(entry.position, position));
    if (!legalAction) {
      this.constructiblePlacementMessage = actionReasonFor(this.state, action, this.locale) ?? this.translator()('invalidAction');
      this.updateView();
      return;
    }
    if (this.apply(legalAction)) {
      this.constructiblePlacementMessage = null;
      this.supplyOverlay = true;
      if (this.state) this.selection = resolveTileSelection(this.state, position, 'domestic');
      this.updateView();
    }
  }

  private executeConstructibleCandidate(element: HTMLElement): void {
    if (!this.state || !this.engine || !this.constructiblePlacement) return;
    const q = numberValue(element.dataset.q, NaN);
    const r = numberValue(element.dataset.r, NaN);
    if (!Number.isInteger(q) || !Number.isInteger(r)) return;
    const candidate = this.constructibleFacilityCandidates().find((entry) =>
      entry.position.q === q && entry.position.r === r,
    );
    if (!candidate) return;
    this.constructiblePreviewTarget = { ...candidate.position };
    if (!candidate.legal) {
      this.constructiblePlacementMessage = localizeActionError(candidate.reasonCode ?? undefined, this.locale);
      this.updateView();
      return;
    }
    if (this.apply({ type: 'BuildConstructibleFacility', facilityType: candidate.facilityType, position: { ...candidate.position } })) {
      this.constructiblePlacement = null;
      this.constructiblePreviewTarget = null;
      this.constructiblePlacementMessage = null;
      this.supplyOverlay = true;
      this.updateView();
    }
  }

  private buildCheckpoint(): void {
    // v1.4.5 makes Build a local Domestic-mode action. The selected road Hex
    // is matched against the Core candidate list; no UI-side legality checks
    // or board-wide build placement mode are used.
    if (this.selection?.kind === 'road') {
      const position = { ...this.selection.position };
      const candidate = this.checkpointBuildCandidateAt(position);
      const reason = candidate?.reasonCode
        ? localizeActionError(candidate.reasonCode, this.locale)
        : candidate
          ? null
          : localizeActionError('invalid_checkpoint_tile', this.locale);
      if (!candidate || !candidate.legal) {
        this.checkpointPlacementMessage = reason ?? this.translator()('invalidAction');
        this.updateView();
        return;
      }
      if (this.apply(actionForCheckpointCandidate(candidate))) {
        // The newly-created checkpoint now wins Domestic selection priority at
        // the same location, so its sheet is immediately inspectable.
        if (this.state) this.selection = resolveTileSelection(this.state, position, 'domestic');
        this.supplyOverlay = true;
        this.updateView();
      }
      return;
    }
    this.showToast(this.translator()('invalidAction'));
  }

  private startRelocation(): void {
    const selected = this.selection;
    if (!this.state || selected?.kind !== 'checkpoint') {
      this.showToast(this.translator()('unknownOperationalCheckpoint'));
      return;
    }
    const checkpoint = this.state.checkpoints.find((candidate) => candidate.id === selected.id);
    if (!checkpoint || checkpoint.status !== 'operational') {
      this.showToast(this.translator()('unknownOperationalCheckpoint'));
      return;
    }
    const placement: CheckpointPlacement = {
      mode: 'relocate',
      checkpointId: checkpoint.id,
      branchId: checkpoint.branchId ?? checkpoint.direction,
    };
    const candidates = this.checkpointCandidates(placement);
    if (candidates.length === 0) {
      this.showToast(this.checkpointActionReason('relocate', checkpoint.id));
      return;
    }
    this.checkpointPlacement = placement;
    this.checkpointPlacementMessage = null;
    const first = candidates.find((candidate) => candidate.legal) ?? candidates[0]!;
    this.checkpointPreviewTarget = { branchId: first.branchId, position: { ...first.position } };
    this.supplyOverlay = true;
    this.sheetState = 'standard';
    this.updateView();
  }

  private checkpointActionReason(mode: 'build' | 'relocate', checkpointId?: string): string {
    const checkpoint = checkpointId && this.state
      ? this.state.checkpoints.find((candidate) => candidate.id === checkpointId)
      : undefined;
    const candidates = this.checkpointCandidates({
      mode,
      checkpointId,
      branchId: checkpoint ? checkpoint.branchId ?? checkpoint.direction : undefined,
    });
    const reasonCode = candidates.find((candidate) => !candidate.legal)?.reasonCode;
    if (reasonCode) return localizeActionError(reasonCode, this.locale);
    return this.translator()('invalidAction');
  }

  private buildCheckpointAt(element: HTMLElement): void {
    if (!this.state) return;
    const branchId = element.dataset.branchId;
    const q = numberValue(element.dataset.q, NaN);
    const r = numberValue(element.dataset.r, NaN);
    if (!branchId || !Number.isInteger(q) || !Number.isInteger(r)) return;
    const candidate = this.checkpointCandidates().find((entry) =>
      entry.branchId === branchId && entry.position.q === q && entry.position.r === r,
    );
    if (!candidate) return;
    this.checkpointPreviewTarget = { branchId: candidate.branchId, position: { ...candidate.position } };
    if (!candidate.legal) {
      this.checkpointPlacementMessage = localizeActionError(candidate.reasonCode ?? undefined, this.locale);
      this.updateView();
      return;
    }
    if (this.apply(actionForCheckpointCandidate(candidate))) {
      this.checkpointPlacement = null;
      this.checkpointPreviewTarget = null;
      this.checkpointPlacementMessage = null;
      this.supplyOverlay = true;
      this.updateView();
    }
  }

  /** Execute a branch-panel candidate while preserving its Action type. */
  private executeCheckpointCandidate(
    element: HTMLElement,
    actionType: 'BuildCheckpoint' | 'RelocateCheckpoint',
  ): void {
    if (!this.state || !this.engine) return;
    const branchId = element.dataset.branchId;
    const checkpointId = element.dataset.checkpointId;
    const q = numberValue(element.dataset.q, NaN);
    const r = numberValue(element.dataset.r, NaN);
    if (!branchId || !Number.isInteger(q) || !Number.isInteger(r)) return;
    const candidate = this.checkpointCandidatesForBranch(branchId).find((entry) =>
      entry.actionType === actionType &&
      entry.position.q === q && entry.position.r === r &&
      (actionType !== 'RelocateCheckpoint' || entry.checkpointId === checkpointId),
    );
    if (!candidate) return;
    if (!candidate.legal) {
      this.showToast(localizeActionError(candidate.reasonCode ?? undefined, this.locale));
      return;
    }
    this.apply(actionForCheckpointCandidate(candidate));
  }

  private activateCheckpoint(element: HTMLElement): void {
    if (!this.state) return;
    const branchId = element.dataset.branchId;
    const checkpointId = element.dataset.checkpointId;
    if (!branchId || !checkpointId) return;
    const requested: Extract<GameAction, { type: 'ActivateCheckpoint' }> = {
      type: 'ActivateCheckpoint',
      branchId,
      checkpointId,
    };
    const action = actionForCheckpointActivation(this.legalActions(), branchId, checkpointId) ?? requested;
    const reason = actionReasonFor(this.state, action, this.locale);
    if (reason) {
      this.showToast(reason);
      return;
    }
    this.apply(action);
  }

  /** Submit the user-selected Waiting-pool count through the Core validator. */
  private turnAwayRefugees(element: HTMLElement): void {
    if (!this.state || !this.engine) return;
    const checkpointId = element.dataset.checkpointId;
    if (!checkpointId) return;
    const input = [...this.root.querySelectorAll<HTMLInputElement>('[data-turn-away-count]')]
      .find((candidate) => candidate.dataset.checkpointId === checkpointId);
    const count = Math.trunc(numberValue(element.dataset.count ?? input?.value, 0));
    const action: Extract<GameAction, { type: 'TurnAwayCheckpointRefugees' }> = {
      type: 'TurnAwayCheckpointRefugees',
      checkpointId,
      count,
    };
    const reason = actionReasonFor(this.state, action, this.locale);
    if (reason) {
      this.showToast(reason);
      const message = this.root.querySelector<HTMLElement>('[data-turn-away-reason="true"]');
      if (message) {
        message.textContent = reason;
        message.hidden = false;
      }
      return;
    }
    if (this.apply(action)) this.updateView();
  }

  /** Decommission is intentionally a Core action; this method only gathers the selected ID. */
  private decommissionFacility(element: HTMLElement): void {
    if (!this.state || !this.engine) return;
    const facilityId = element.dataset.facilityId;
    if (!facilityId) return;
    const action: Extract<GameAction, { type: 'DecommissionConstructibleFacility' }> = {
      type: 'DecommissionConstructibleFacility',
      facilityId,
    };
    const reason = actionReasonFor(this.state, action, this.locale);
    if (reason) {
      this.showToast(reason);
      return;
    }
    if (this.apply(action)) {
      this.selection = null;
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
    const candidate = this.checkpointCandidates().find((entry) =>
      entry.branchId === branchId && entry.position.q === q && entry.position.r === r,
    );
    if (!candidate) return;
    this.checkpointPreviewTarget = { branchId: candidate.branchId, position: { ...candidate.position } };
    if (!candidate.legal) {
      this.checkpointPlacementMessage = localizeActionError(candidate.reasonCode ?? undefined, this.locale);
      this.updateView();
      return;
    }
    if (this.apply(actionForCheckpointCandidate(candidate))) {
      this.checkpointPlacement = null;
      this.checkpointPreviewTarget = null;
      this.checkpointPlacementMessage = null;
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
    this.setCheckpointPlacementMessage(null);
    this.updateBoard();
  }

  private previewConstructibleCandidate(element: HTMLElement): void {
    if (!this.state || !this.constructiblePlacement) return;
    const q = numberValue(element.dataset.q, NaN);
    const r = numberValue(element.dataset.r, NaN);
    if (!Number.isInteger(q) || !Number.isInteger(r)) return;
    const candidate = this.constructibleFacilityCandidates().find((entry) => entry.position.q === q && entry.position.r === r);
    if (!candidate) return;
    const current = this.constructiblePreviewTarget;
    if (current?.q === q && current.r === r) return;
    this.constructiblePreviewTarget = { q, r };
    this.constructiblePlacementMessage = candidate.legal ? null : localizeActionError(candidate.reasonCode ?? undefined, this.locale);
    const message = this.root.querySelector<HTMLElement>('[data-constructible-inline-message]');
    if (message) {
      message.textContent = this.constructiblePlacementMessage ?? '';
      message.hidden = !this.constructiblePlacementMessage;
    }
    this.updateBoard();
  }

  private updateRecruitmentReasons(): void {
    if (!this.state) return;
    const city = this.selectedCity();
    const destination = city?.position;
    for (const unitType of ['police', 'nationalGuard', 'riotPolice'] as const) {
      const actionName = unitType === 'police' ? 'police' : unitType === 'nationalGuard' ? 'guard' : 'riot-police';
      const button = this.root.querySelector<HTMLButtonElement>(`[data-action="produce-${actionName}"]`);
      if (!button) continue;
      const requested = { type: 'ProduceUnit', unitType, ...(destination ? { destination } : {}) } as GameAction;
      const reason = !city
        ? (unitType === 'police' ? this.translator()('policeRecruitmentRule') : unitType === 'nationalGuard' ? this.translator()('guardRecruitmentRule') : this.translator()('riotPoliceRecruitmentRule'))
        : actionReasonFor(this.state, requested, this.locale) ?? (unitType === 'police' ? this.translator()('policeRecruitmentRule') : unitType === 'nationalGuard' ? this.translator()('guardRecruitmentRule') : this.translator()('riotPoliceRecruitmentRule'));
      const legal = Boolean(city && actionForUnitProduction(this.legalActions(), unitType as HumanUnitType, destination));
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
    if (reason || (!listed && action.type !== 'EndTurn' && action.type !== 'AssignWorkers' && action.type !== 'TransferPopulation' && action.type !== 'TurnAwayCheckpointRefugees' && action.type !== 'DecommissionConstructibleFacility')) {
      this.showToast(reason ?? this.translator()('invalidAction'));
      return false;
    }
    const previousState = this.state;
    const result = this.engine.step(action);
    if (result.error) {
      this.showToast(localizeActionError(result.error.code, this.locale));
      return false;
    }
    this.state = result.state;
    this.invalidateQueryContext();
    this.hasUnsavedChanges = true;
    this.saveStatus = 'none';
    this.notifyImportantEvents(result.events ?? [], previousState);
    this.checkpointPlacementMessage = null;
    // v1.5.2 keeps one human autosave checkpoint per meaningful boundary:
    // new game, successful EndTurn at the next player turn, and final game
    // over. Other accepted actions remain dirty until that boundary or an
    // explicit Save action.
    if (result.gameOver || (action.type === 'EndTurn' && this.state.phase === 'player')) this.autosave();
    this.updateView();
    if (result.gameOver && result.result) this.showStatistics(result.result);
    return true;
  }

  private notifyImportantEvents(events: readonly GameEvent[], previousState: Readonly<GameState>): void {
    const fresh = events
      .map((event) => projectImportantEvent(event))
      .filter((event): event is ImportantEventViewModel => event !== null)
      .filter((event) => !this.notifiedEventIds.has(event.id));
    for (const event of fresh) this.notifiedEventIds.add(event.id);
    const startedSites = new Set(
      fresh
        .filter((event) => event.type === 'site_infection_started')
        .map((event) => importantEventSiteKey(event)),
    );
    const toastEvents = fresh.filter((event) => (
      event.type !== 'site_immediate_infection' ||
      (!startedSites.has(importantEventSiteKey(event)) && siteInfectedBeforeEvent(previousState, event) <= 0)
    ));
    const message = importantEventToastText(toastEvents, this.locale);
    if (message) this.showToast(message);
  }

  private focusImportantEvent(element: HTMLElement): void {
    if (!this.state) return;
    const q = Number(element.dataset.q);
    const r = Number(element.dataset.r);
    if (!Number.isSafeInteger(q) || !Number.isSafeInteger(r)) return;
    const position = { q, r };
    this.boardScene?.focusHex(position);
    const siteKind = element.dataset.siteKind;
    const siteId = element.dataset.siteId;
    if (siteKind === 'facility' && siteId && this.state.facilities.some((facility) => facility.id === siteId)) {
      this.selection = { kind: 'facility', id: siteId };
    } else if (siteKind === 'checkpoint' && siteId && this.state.checkpoints.some((checkpoint) => checkpoint.id === siteId)) {
      this.selection = { kind: 'checkpoint', id: siteId };
    } else {
      this.selection = null;
    }
    this.navMode = 'map';
    this.unitActionMode = null;
    this.pendingMove = null;
    this.pendingAttackTargetId = null;
    this.sheetState = 'standard';
    this.updateView();
  }

  private saveStatusLabel(): string {
    const t = this.translator();
    const turn = this.lastSavedTurn === null ? '' : ` · ${t('lastSavedTurn')} ${this.lastSavedTurn}`;
    if (this.saveStatus === 'saving') return `${t('saving')}${turn}`;
    if (this.saveStatus === 'failed') return `${t('saveFailed')}${turn}`;
    if (this.hasUnsavedChanges) return `${t('unsavedChanges')}${turn}`;
    if (this.lastSavedTurn !== null) return `${t('saveStatusSaved')}${turn}`;
    return '';
  }

  private refreshSaveStatusUi(): void {
    const status = this.root.querySelector<HTMLElement>('[data-bind="save-status"]');
    if (status) status.textContent = this.saveStatusLabel();
  }

  private saveState(): boolean {
    if (!this.state) return false;
    this.saveStatus = 'saving';
    this.refreshSaveStatusUi();
    const result = this.store.save(this.state);
    if (!result.ok) {
      this.saveStatus = 'failed';
      this.showToast(this.translator()('saveFailed'));
      this.refreshSaveStatusUi();
      return false;
    }
    this.lastSaveCode = result.code;
    this.lastSaveTiming = result.timing ?? null;
    this.lastSavedTurn = this.state.turn;
    this.hasUnsavedChanges = false;
    this.saveStatus = 'saved';
    this.refreshSaveStatusUi();
    return true;
  }

  private autosave(): boolean {
    return this.saveState();
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
      this.invalidateQueryContext();
      this.screen = 'game';
      this.navMode = 'map';
      this.selection = null;
      this.unitActionMode = null;
      this.pendingMove = null;
      this.pendingAttackTargetId = null;
      this.checkpointPlacement = null;
      this.checkpointPreviewTarget = null;
      this.checkpointPlacementMessage = null;
      this.constructiblePlacement = null;
      this.constructiblePreviewTarget = null;
      this.constructiblePlacementMessage = null;
      this.lastSaveCode = null;
      this.saveModalCode = null;
      this.lastSaveTiming = null;
      this.manualSavePending = false;
      this.lastSavedTurn = migrated ? null : this.state.turn;
      this.hasUnsavedChanges = migrated;
      this.saveStatus = migrated ? 'none' : 'saved';
      this.resourceAccordion = null;
      this.overviewSections.clear();
      this.crisisExpandedGroups.clear();
      this.eventHistoryLimit = 10;
      // Loading restores the history but must not replay old event Toasts.
      this.notifiedEventIds.clear();
      for (const event of this.state.events ?? []) this.notifiedEventIds.add(event.id);
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
    // Opening the code export does not mutate the shared local slot. The
    // modal exposes an explicit Manual Save button for that operation.
    const code = encodeSaveCode(this.state);
    this.saveModalCode = code;
    this.root.insertAdjacentHTML('beforeend', `<div class="modal-backdrop" data-modal="save"><section class="modal-card floating-card" aria-labelledby="save-heading"><button class="icon-button modal-close" data-action="dismiss-modal">×</button><h2 id="save-heading">${escapeHtml(t('saveCode'))}</h2><p class="muted" data-bind="save-modal-status" aria-live="polite">${escapeHtml(this.saveStatusLabel())}</p><textarea data-input="save-code" rows="7" spellcheck="false" readonly>${escapeHtml(code)}</textarea><div class="modal-actions"><button class="primary-button" data-action="manual-save">${escapeHtml(t('manualSave'))}</button><button class="secondary-button" data-action="copy-code">${escapeHtml(t('copy'))}</button><button class="secondary-button" data-action="download-json">${escapeHtml(t('download'))}</button><button class="ghost-button" data-action="dismiss-modal">${escapeHtml(t('close'))}</button></div></section></div>`);
  }

  private manualSave(): void {
    if (!this.state) return;
    if (this.manualSavePending) return;
    this.manualSavePending = true;
    const requestedEngine = this.engine;
    this.saveStatus = 'saving';
    this.refreshSaveStatusUi();
    const modalStatus = this.root.querySelector<HTMLElement>('[data-modal="save"] [data-bind="save-modal-status"]');
    if (modalStatus) modalStatus.textContent = this.saveStatusLabel();
    const commit = (): void => {
      if (this.engine !== requestedEngine) return;
      this.manualSavePending = false;
      if (!this.state) return;
      const saved = this.saveState();
      const code = saved && this.lastSaveCode ? this.lastSaveCode : encodeSaveCode(this.state);
      this.saveModalCode = code;
      const textarea = this.root.querySelector<HTMLTextAreaElement>('[data-modal="save"] [data-input="save-code"]');
      if (textarea) textarea.value = code;
      const status = this.root.querySelector<HTMLElement>('[data-modal="save"] [data-bind="save-modal-status"]');
      if (status) status.textContent = this.saveStatusLabel();
      if (saved) this.showToast(this.translator()('manualSaved'));
    };
    if (typeof globalThis.requestAnimationFrame === 'function') globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(commit));
    else commit();
  }

  private copySaveCode(_element?: HTMLElement): void {
    const code = this.saveModalCode ?? this.lastSaveCode;
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
    this.root.insertAdjacentHTML('beforeend', `<div class="modal-backdrop" data-modal="guide"><section class="modal-card floating-card guide-card" aria-labelledby="guide-heading"><div class="guide-icon">◇</div><h2 id="guide-heading">${escapeHtml(t('guideTitle'))}</h2><p>${escapeHtml(t('guideBody'))}</p><p>${escapeHtml(t('guideSteps'))}</p><button class="primary-button" data-action="guide-close">${escapeHtml(t('close'))}</button></section></div>`);
  }

  private showHelp(): void {
    const t = this.translator();
    const tips = ['tipPopulation', 'tipReturn', 'tipOvercrowding', 'tipNextTurn', 'tipRecruitment', 'tipRiotPolice', 'tipHunterZombie', 'tipProficiency', 'tipCheckpoint', 'tipCheckpointCapacity', 'tipCheckpointFallback', 'tipRefugeeRejection', 'tipFinalArrivalStop', 'tipCheckpointQueueMaintenance', 'tipRoadBranches', 'tipSupply', 'tipCheckpointMove', 'tipTerrain', 'tipVision', 'tipInfectionEvents', 'tipHorde', 'tipSpawnReserve', 'tipVictory', 'tipRecovery', 'tipSuppression', 'tipRange', 'tipMilitaryGoods', 'tipEmergencyMovement', 'tipProduction', 'tipPower', 'tipPowerAllocation', 'tipProductionTiming', 'tipFuel', 'tipWind', 'tipBuild', 'tipDecommission', 'tipStrategicForecast', 'tipPolicy', 'tipNoise', 'tipCrisis', 'tipSave']
      .map((key) => `<li>${escapeHtml(t(key))}</li>`)
      .join('');
    const legend = renderBoardLegend(this.state?.config, this.locale, BOARD_ASSET_REGISTRY);
    this.root.insertAdjacentHTML('beforeend', `<div class="modal-backdrop" data-modal="help"><section class="modal-card floating-card help-modal" aria-labelledby="help-heading"><button class="icon-button modal-close" aria-label="${escapeHtml(t('close'))}" data-action="dismiss-modal">×</button><h2 id="help-heading">${escapeHtml(t('help'))}</h2><p>${escapeHtml(t('helpBody'))}</p><h3>${escapeHtml(t('move'))}</h3><p>${escapeHtml(t('guideSteps'))}</p><details class="board-legend-disclosure" data-board-legend-disclosure="true"><summary>${escapeHtml(t('legendTitle'))}</summary>${legend}</details><h3>${escapeHtml(t('tipsTitle'))}</h3><ul class="tips-list">${tips}</ul><button class="ghost-button" data-action="dismiss-modal">${escapeHtml(t('close'))}</button></section></div>`);
  }

  private updateFacilitySupplementalControls(): void {
    const selected = this.selection;
    if (!this.state || selected?.kind !== 'facility') return;
    const facility = this.state.facilities.find((candidate) => candidate.id === selected.id);
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
    // Checkpoint placement is intentionally separated from the Facility
    // sheet in v1.4.5. Domestic road selection owns the local Build action;
    // do not re-introduce a Facility-level button or reason here.
  }

  private showStatistics(result: GameResult | null): void {
    if (!result || this.root.querySelector('[data-modal="statistics"]')) return;
    const t = this.translator();
    const stats = result.statistics;
    const finalPopulation = this.state ? populationLocationTotals(this.state).total : 0;
    const finalFacilities = this.state?.facilities.filter((facility) => facility.owner === 'player' && facility.status === 'owned').length ?? 0;
    const victory = this.state ? deriveVictoryProgress(this.state) : null;
    const progress = victory
      ? [
        ['finalHordeDefeated', t('finalHordeDefeated'), victory.finalHordeDefeated],
        ['suppliedAreaZombieClear', t('suppliedAreaZombieClear'), victory.suppliedAreaZombieClear],
        ['suppliedAreaInfectionClear', t('suppliedAreaInfectionClear'), victory.suppliedAreaInfectionClear],
      ] as const
      : [];
    const progressHtml = progress.map(([, label, complete]) => `<span class="victory-check ${complete ? 'is-complete' : 'is-pending'}"><b aria-hidden="true">${complete ? '✓' : '○'}</b>${escapeHtml(label)}</span>`).join('');
    const terrainEntries = Object.entries(stats.terrainEntriesByType)
      .map(([terrain, count]) => `${escapeHtml(terrainLabel(terrain as AgentMapTileObservation['terrain'], this.locale))} ${count}`)
      .join(' · ');
    this.root.insertAdjacentHTML('beforeend', `<div class="modal-backdrop" data-modal="statistics"><section class="modal-card floating-card" aria-labelledby="statistics-heading"><p class="eyebrow">${escapeHtml(t('gameOver'))}</p><h2 id="statistics-heading">${escapeHtml(result.outcome === 'won' ? t('victory') : t('defeat'))}</h2><div class="stats-grid"><span>${escapeHtml(t('survivedTurns'))}<b>${result.turn}</b></span><span>${escapeHtml(t('finalPopulation'))}<b>${finalPopulation}</b></span><span>${escapeHtml(t('maxPopulation'))}<b>${stats.maxPopulation}</b></span><span>${escapeHtml(t('finalFacilities'))}<b>${finalFacilities}</b></span><span>${escapeHtml(t('maxFacilities'))}<b>${stats.maxSecuredFacilities}</b></span><span>${escapeHtml(t('civilianLosses'))}<b>${stats.civilianLosses}</b></span><span>${escapeHtml(t('unitLosses'))}<b>${stats.unitLosses}</b></span><span>${escapeHtml(t('infectionLosses'))}<b>${stats.infectionLosses}</b></span><span>${escapeHtml(t('shortageLosses'))}<b>${stats.resourceShortageLosses}</b></span><span>${escapeHtml(t('hordeInterceptions'))}<b>${stats.hordeInterceptions}</b></span><span>${escapeHtml(t('finalHordeSpawned'))}<b>${stats.finalHordeSpawned}</b></span><span>${escapeHtml(t('finalHordeKilled'))}<b>${stats.finalHordeKilled}</b></span><span>${escapeHtml(t('normalZombiesKilled'))}<b>${stats.normalZombiesKilled}</b></span><span>${escapeHtml(t('hordeZombiesKilled'))}<b>${stats.hordeZombiesKilled}</b></span><span>${escapeHtml(t('victoryTurn'))}<b>${stats.victoryTurn ?? '—'}</b></span><span>${escapeHtml(t('defeatReason'))}<b>${escapeHtml(gameOverReasonLabel(result.reason, this.locale))}</b></span></div><section class="victory-progress stats-victory"><h3>${escapeHtml(t('victoryProgress'))}</h3><div>${progressHtml || `<span class="muted">${escapeHtml(t('unavailable'))}</span>`}</div></section><p class="muted stats-terrain-summary">${escapeHtml(t('terrain'))}: ${terrainEntries}</p><div class="modal-actions"><button class="primary-button" data-action="title">${escapeHtml(t('reset'))}</button><button class="ghost-button" data-action="dismiss-modal">${escapeHtml(t('close'))}</button></div></section></div>`);
  }

  private renderBranchFlow(): string {
    if (!this.state) return '';
    const t = this.translator();
    const refugeeArrivalsStopped = this.state.horde.finalHordeStatus !== 'notStarted';
    const branches = [...this.state.map.roadBranches].sort((left, right) => left.id.localeCompare(right.id));
    const panels = branchPanelViewModel(this.state);
    const cards = branches.map((branch) => {
      const branchState = this.state!.roadBranches.find((candidate) => candidate.branchId === branch.id);
      const panel = panels.find((candidate) => candidate.branchId === branch.id);
      const checkpoint = panel?.activeCheckpointId
        ? this.state!.checkpoints.find((candidate) => candidate.id === panel.activeCheckpointId)
        : undefined;
      const publicCheckpoint = checkpoint
        ? this.queryPublicCheckpoint(checkpoint.id)
        : undefined;
      const policyKey: CheckpointPolicy = panel?.currentPolicy ?? 'passThrough';
      const policy = this.state!.config.refugees.policies[policyKey];
      const remaining = !refugeeArrivalsStopped && branchState?.nextArrivalTurn !== null && branchState?.nextArrivalTurn !== undefined
        ? Math.max(0, branchState.nextArrivalTurn - this.state!.turn)
        : null;
      const range = String(this.state!.config.refugees.arrivalPeopleMin) + '–' + String(this.state!.config.refugees.arrivalPeopleMax);
      const destination = checkpoint ? t('checkpoint') + ' · ' + checkpoint.id : t('noCheckpoint');
      const policyText = formatPercent(policy.workerRate, this.locale) + ' / ' + formatPercent(policy.infectionRate, this.locale);
      const radius = getBranchSupplyRadius(this.state!, branch.id);
      const screeningCapacity = publicCheckpoint?.screeningCapacity ?? this.state!.config.refugees.screeningCapacity;
      const screeningThroughput = publicCheckpoint?.estimatedScreeningThroughput ?? screeningCapacity / Math.max(1, policy.turns);
      const queuePressure = publicCheckpoint ? queuePressureLabel(publicCheckpoint.queuePressureClass, this.locale) : t('none');
      const screeningTurns = publicCheckpoint?.currentPolicyTurns ?? policy.turns;
      const roleSummary = panel
        ? `<p class="branch-role-summary"><strong>${escapeHtml(t('activeCheckpoint'))}</strong>: ${escapeHtml(panel.activeCheckpointId ?? t('none'))} · <strong>${escapeHtml(t('standbyCheckpoint'))}</strong>: ${panel.standbyCheckpointIds.length} · <strong>${escapeHtml(t('dormantCheckpoint'))}</strong>: ${panel.dormantCheckpointIds.length}</p>`
        : '';
      const arrivalStatus = refugeeArrivalsStopped
        ? t('refugeeArrivalsStopped')
        : remaining === null
          ? t('unavailable')
          : `${t('arrivalIn')} ${remaining}`;
      return '<article class="branch-flow-card' + (refugeeArrivalsStopped ? ' branch-flow-stopped' : '') + '"><div class="branch-flow-heading"><strong>' +
        escapeHtml(formatDirection(branch.direction, this.locale)) + ' · ' + escapeHtml(branch.id) +
        '</strong><span class="status-chip">' + escapeHtml(destination) + '</span></div><dl class="branch-flow-grid"><div><dt>' +
        escapeHtml(t('nextArrival')) + '</dt><dd>' + escapeHtml(arrivalStatus) +
        '</dd></div><div><dt>' + escapeHtml(t('arrivalRange')) + '</dt><dd>' + escapeHtml(range) +
        '</dd></div><div><dt>' + escapeHtml(t('screeningProbability')) + '</dt><dd>' + escapeHtml(policyText) +
        '</dd></div><div><dt>' + escapeHtml(t('screeningCapacity')) + '</dt><dd>' + String(screeningCapacity) +
        '</dd></div><div><dt>' + escapeHtml(t('screeningThroughput')) + '</dt><dd>' + String(screeningThroughput) + ' / ' + escapeHtml(t('turn')) +
        '</dd></div><div><dt>' + escapeHtml(t('policyTurns')) + '</dt><dd>' + String(screeningTurns) + '</dd></div><div><dt>' + escapeHtml(t('queuePressure')) + '</dt><dd>' + escapeHtml(queuePressure) +
        '</dd></div><div><dt>' + escapeHtml(t('supplyRadius')) + '</dt><dd>' + String(radius) +
        '</dd></div></dl>' + roleSummary + (!checkpoint ? '<p class="muted">' + escapeHtml(t('unmanagedPassThrough')) + '</p>' : '') + '</article>';
    }).join('');
    const stoppedNotice = refugeeArrivalsStopped
      ? `<p class="warning-text refugee-arrivals-stopped" data-refugee-arrivals-stopped="true">${escapeHtml(t('refugeeArrivalsStopped'))}</p>`
      : '';
    const rejectionNotice = `<p class="muted refugee-rejection-warning" data-refugee-rejection-warning="true">${escapeHtml(t('refugeeRejectionWarning'))}</p>`;
    return renderBranchPanel(this.state, this.locale) + '<section class="branch-flow-section" aria-labelledby="branch-flow-heading"><h3 id="branch-flow-heading">' +
      escapeHtml(t('arrivalSchedule')) + '</h3>' + stoppedNotice + rejectionNotice + cards + '</section>' + renderNoiseEventLog(this.state, this.locale);
  }

  /** Summary-only build information for the unselected Domestic accordion. */
  private renderConstructionOverview(): string {
    if (!this.state) return '';
    const t = this.translator();
    const types: Array<'simpleFarm' | 'civilianDroneBase'> = ['simpleFarm', 'civilianDroneBase'];
    const rows = types.map((facilityType) => {
      const config = this.state!.config.facilities[facilityType];
      const count = this.state!.facilities.filter((facility) => facility.constructible && facility.type === facilityType).length;
      const limit = Math.ceil(this.state!.map.roadBranches.length / Math.max(1, this.state!.config.constructibleFacility.limitPerTypeDivisor));
      const label = facilityType === 'simpleFarm' ? t('buildSimpleFarm') : t('buildCivilianDroneBase');
      const usage = facilityType === 'simpleFarm' ? t('simpleFarmUse') : t('civilianDroneBaseUse');
      return `<div class="construction-overview-row"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(t('buildCost'))}: ${config.buildCivilianGoods} · ${escapeHtml(t('buildLimit'))}: ${count}/${limit}</span><small>${escapeHtml(usage)}</small></div>`;
    }).join('');
    return `<div class="construction-overview" data-construction-overview="true"><p class="muted">${escapeHtml(t('localBuildOnly'))}</p>${rows}</div>`;
  }

  /**
   * Render the Core-backed Constructible Facility picker and candidate mode.
   * The complete candidate query remains on the board; the sheet keeps a
   * compact coordinate list so a 51×51 map does not become an unwieldy DOM
   * wall on mobile.
   */
  private renderConstructiblePlacement(): string {
    if (!this.state) return '';
    const t = this.translator();
    if (!this.constructiblePlacement) {
      return '';
    }
    const facilityType = this.constructiblePlacement.facilityType;
    const candidates = this.constructibleFacilityCandidates(facilityType);
    const legal = candidates.filter((candidate) => candidate.legal);
    const invalid = candidates.filter((candidate) => !candidate.legal);
    const selected = this.constructiblePreviewTarget
      ? candidates.find((candidate) => samePosition(candidate.position, this.constructiblePreviewTarget!))
      : undefined;
    // Keep the sheet usable on a phone while preserving a representative set
    // of invalid candidates for keyboard/touch users; every candidate remains
    // available as a map marker and is still validated by Core on selection.
    const listed = [...legal.slice(0, 40), ...invalid.slice(0, 12)];
    const buttons = listed.map((candidate) => `<button class="constructible-candidate ${candidate.legal ? 'legal' : 'invalid'}${selected && samePosition(selected.position, candidate.position) ? ' selected' : ''}" data-action="constructible-build-at" data-facility-type="${facilityType}" data-q="${candidate.position.q}" data-r="${candidate.position.r}" aria-invalid="${String(!candidate.legal)}" title="${escapeHtml(candidate.reasonCode ? localizeActionError(candidate.reasonCode, this.locale) : t('buildLegal'))}"><span aria-hidden="true">${candidate.legal ? '✓' : '×'}</span> ${escapeHtml(candidate.position.q + ',' + candidate.position.r)}</button>`).join('');
    const selectedReason = selected && !selected.legal
      ? localizeActionError(selected.reasonCode ?? undefined, this.locale)
      : this.constructiblePlacementMessage;
    return `<section class="constructible-placement" data-constructible-placement="true" data-facility-type="${facilityType}" aria-labelledby="constructible-placement-heading"><div class="section-heading"><h3 id="constructible-placement-heading">${escapeHtml(t('buildMode'))}: ${escapeHtml(facilityLabel(facilityType, this.locale))}</h3><button class="ghost-button compact-button" data-action="constructible-place-cancel">${escapeHtml(t('buildCancel'))}</button></div><p class="muted">${escapeHtml(t('buildModeHint'))}</p><dl class="forecast-detail-grid constructible-summary"><div><dt>${escapeHtml(t('buildLegal'))}</dt><dd>${legal.length}</dd></div><div><dt>${escapeHtml(t('buildIllegal'))}</dt><dd>${invalid.length}</dd></div><div><dt>${escapeHtml(t('buildCost'))}</dt><dd>${this.state.config.facilities[facilityType].buildCivilianGoods} ${escapeHtml(t('civilianGoods'))}</dd></div></dl><div class="constructible-candidates" aria-label="${escapeHtml(t('buildCandidate'))}">${buttons}</div><p class="checkpoint-inline-message constructible-inline-message" data-constructible-inline-message role="status" aria-live="polite"${selectedReason ? '' : ' hidden'}>${escapeHtml(selectedReason ?? '')}</p><p class="muted">${escapeHtml(t('buildCandidate'))}: ${legal.length} · ${escapeHtml(t('buildIllegal'))}: ${invalid.length}</p></section>`;
  }

  private renderCheckpointPlacement(): string {
    if (!this.state || !this.checkpointPlacement) return '';
    const t = this.translator();
    // Build no longer opens a board-wide candidate list. Keep this guard for
    // old UI state or integrations that may still request the former mode.
    if (this.checkpointPlacement.mode === 'build') return '';
    const actionName = t('relocatePreview');
    const hint = t('checkpointRelocateBoardHint');
    const inlineMessage = this.checkpointPlacementMessage ?? '';
    return '<section class="checkpoint-placement" aria-labelledby="checkpoint-placement-heading"><div class="section-heading"><h3 id="checkpoint-placement-heading">' +
      escapeHtml(actionName) + '</h3><button class="ghost-button compact-button" data-action="checkpoint-place-cancel">' +
      escapeHtml(t('cancelPlacement')) + '</button></div><p class="muted">' + escapeHtml(hint) +
      '</p><p class="checkpoint-inline-message" data-checkpoint-inline-message role="status" aria-live="polite"' +
      (inlineMessage ? '' : ' hidden') + '>' + escapeHtml(inlineMessage) + '</p><p class="muted">' + escapeHtml(t('checkpointCandidateHint')) + '</p></section>';
  }

  /** Render the selected Domestic trunk-road Hex and its single Core candidate. */
  private renderRoadSheet(
    position: HexCoord,
    body: HTMLElement,
    title: HTMLElement,
    summary: HTMLElement,
    publicTile?: AgentMapTileObservation,
  ): void {
    const t = this.translator();
    const branchId = this.state ? roadBranchForPosition(this.state, position) : null;
    const candidate = this.checkpointBuildCandidateAt(position);
    const reason = candidate
      ? candidate.legal
        ? null
        : localizeActionError(candidate.reasonCode ?? undefined, this.locale)
      : localizeActionError('invalid_checkpoint_tile', this.locale);
    const cost = this.state?.config.checkpoint.constructionCivilianGoods ?? 0;
    title.textContent = t('roadHex');
    summary.textContent = `${t('location')} ${position.q},${position.r} · ${t('branch')} ${branchId ?? t('unavailable')}`;
    const action = candidate?.legal && branchId
      ? `<button class="secondary-button" data-action="build-checkpoint-local" data-branch-id="${escapeHtml(branchId)}" data-q="${position.q}" data-r="${position.r}">${escapeHtml(t('roadCheckpointBuild'))} · ${escapeHtml(t('civilianGoods'))} ${cost}</button>`
      : `<p class="warning-text checkpoint-build-reason" data-checkpoint-build-reason="true" role="status">${escapeHtml(reason ?? t('checkpointBuildUnavailable'))}</p>`;
    body.innerHTML = `${this.renderTerrainDetails(publicTile, 0)}<section class="road-checkpoint-action" data-road-checkpoint-action="true"><h3>${escapeHtml(t('roadCheckpointBuild'))}</h3><p class="muted">${escapeHtml(t('checkpointPlacementLocalHint'))}</p>${action}</section>`;
  }

  /** Render an empty public Hex with local Constructible actions only. */
  private renderHexSheet(
    position: HexCoord,
    body: HTMLElement,
    title: HTMLElement,
    summary: HTMLElement,
    publicTile?: AgentMapTileObservation,
  ): void {
    const t = this.translator();
    const types: ConstructibleFacilityType[] = ['simpleFarm', 'civilianDroneBase'];
    const candidates = types.map((facilityType) => this.constructibleFacilityCandidates(facilityType)
      .find((candidate) => samePosition(candidate.position, position)));
    const legal = candidates.filter((candidate): candidate is ConstructibleFacilityPositionCandidate => Boolean(candidate?.legal));
    const buttons = legal.map((candidate) => {
      const label = candidate.facilityType === 'simpleFarm' ? t('buildSimpleFarm') : t('buildCivilianDroneBase');
      const cost = this.state?.config.facilities[candidate.facilityType].buildCivilianGoods ?? 0;
      return `<button type="button" class="secondary-button constructible-build-button" data-action="build-constructible-local" data-facility-type="${escapeHtml(candidate.facilityType)}" data-q="${position.q}" data-r="${position.r}">${escapeHtml(label)} · ${escapeHtml(t('buildCost'))} ${cost}</button>`;
    }).join('');
    const reasonCode = candidates.find((candidate) => candidate && !candidate.legal)?.reasonCode;
    const selectedReason = this.constructiblePlacementMessage ?? (reasonCode ? localizeActionError(reasonCode, this.locale) : null);
    title.textContent = t('hex');
    summary.textContent = `${t('location')} ${position.q},${position.r} · ${publicTile?.road ? t('roadOverlay') : ''}${publicTile?.urban ? ` · ${t('urbanOverlay')}` : ''}`;
    const buildBody = this.navMode === 'domestic'
      ? `<section class="constructible-placement constructible-local" data-constructible-local="true"><h3>${escapeHtml(t('buildFacility'))}</h3><p class="muted">${escapeHtml(t('localBuildOnly'))}</p>${buttons || `<p class="warning-text constructible-inline-message" data-constructible-inline-message role="status">${escapeHtml(selectedReason ?? t('noConstructibleHere'))}</p>`}</section>`
      : `<p class="muted">${escapeHtml(t('domesticBuildHint'))}</p>`;
    body.innerHTML = `${this.renderTerrainDetails(publicTile, 0)}${buildBody}`;
  }

  /** Same-Hex tabs expose alternate public targets without changing Core. */
  private renderSameHexTabs(position: HexCoord, selected: Exclude<Selection, null>): string {
    if (!this.state) return '';
    const targets: Array<{ kind: Exclude<Selection, null>['kind']; id?: string; label: string }> = [];
    const units = this.state.units.filter((unit) => unit.actionState !== 'destroyed' && samePosition(unit.position, position));
    for (const unit of units) {
      if (unit.isPlayerUnit) targets.push({ kind: 'unit', id: unit.id, label: unitLabel(unit.type, this.locale) });
      else targets.push({ kind: 'zombie', id: unit.id, label: unitLabel(unit.type, this.locale) });
    }
    const facility = findFacilityAt(this.state, position);
    if (facility) targets.push({ kind: 'facility', id: facility.id, label: facilityLabel(facility.type, this.locale) });
    const checkpoint = findCheckpointAt(this.state, position);
    if (checkpoint) targets.push({ kind: 'checkpoint', id: checkpoint.id, label: this.translator()('checkpoint') });
    const isRoad = this.state.map.roadBranches.some((branch) => branch.roadTiles.some((tile) => samePosition(tile, position)));
    if (!facility && !checkpoint && !units.length) {
      targets.push({ kind: isRoad ? 'road' : 'hex', label: isRoad ? this.translator()('roadHex') : this.translator()('hex') });
    } else if (!targets.some((target) => target.kind === 'hex')) {
      // Keep the full public terrain view reachable from every occupied
      // target. Target tabs remain ordered Unit → Facility/Checkpoint → Hex.
      targets.push({ kind: 'hex', label: this.translator()('hex') });
    }
    if (targets.length < 2) return '';
    return `<nav class="same-hex-tabs" data-same-hex-tabs="true" role="tablist" aria-label="${escapeHtml(this.translator()('sameHexActions'))}">${targets.map((target) => {
      const active = selected.kind === target.kind && ('id' in selected ? selected.id === target.id : samePosition(selected.position, position));
      const positionAttrs = target.id ? ` data-selection-id="${escapeHtml(target.id)}"` : ` data-q="${position.q}" data-r="${position.r}"`;
      return `<button type="button" class="same-hex-tab${active ? ' active' : ''}" role="tab" aria-selected="${String(active)}" data-action="select-same-target" data-selection-kind="${target.kind}"${positionAttrs}>${escapeHtml(target.label)}</button>`;
    }).join('')}</nav>`;
  }

  private renderSheetBody(): void {
    if (!this.state) return;
    const body = this.root.querySelector<HTMLElement>('[data-bind="sheet-body"]');
    const title = this.root.querySelector<HTMLElement>('[data-bind="selection-title"]');
    const summary = this.root.querySelector<HTMLElement>('[data-bind="selection-summary"]');
    if (!body || !title || !summary) return;
    const t = this.translator();
    const selected = this.selection;
    if (!selected) {
      const prompt = unselectedPrompt(this.navMode, this.locale);
      const population = populationLocationTotals(this.state);
      const crisis = this.queryCrisisSummary();
      title.textContent = prompt;
      summary.textContent = stateSummary(this.state, this.locale);
      const isOpen = (section: OverviewSectionKey): boolean => this.overviewSections.has(section)
        ? Boolean(this.overviewSections.get(section))
        : section === 'crisis' && crisis.criticalCount > 0;
      const populationContent = `<div class="population-overview"><div class="empty-state"><span class="empty-glyph">⌖</span><p>${escapeHtml(prompt)}</p></div><h3>${escapeHtml(t('populationLocations'))}</h3><dl class="location-grid"><div><dt>${escapeHtml(t('cityResidents'))}</dt><dd>${population.cityResidents}</dd></div><div><dt>${escapeHtml(t('productionWorkers'))}</dt><dd>${population.productionWorkers}</dd></div><div><dt>${escapeHtml(t('unitPopulation'))}</dt><dd>${population.unitPopulation}</dd></div><div><dt>${escapeHtml(t('waiting'))}</dt><dd>${population.waitingRefugees}</dd></div><div><dt>${escapeHtml(t('screening'))}</dt><dd>${population.screeningRefugees}</dd></div><div><dt>${escapeHtml(t('approved'))}</dt><dd>${population.approvedRefugees}</dd></div><div><dt>${escapeHtml(t('infected'))}</dt><dd>${population.infected}</dd></div><div><dt>${escapeHtml(t('population'))}</dt><dd>${population.total}</dd></div></dl><p class="muted">${escapeHtml(t('tipPopulation'))}</p></div>`;
      const risk = this.queryEndTurnRisk();
      const crisisSummary = `${crisis.criticalCount} ${t('crisisSeverity.critical')} · ${crisis.warningCount} ${t('crisisSeverity.warning')} · ${crisis.advisoryCount} ${t('crisisSeverity.advisory')}`;
      const branchContent = this.renderBranchFlow();
      const eventHistory = renderImportantEventHistory(this.state.events ?? [], this.locale, this.eventHistoryLimit);
      const moreEvents = this.eventHistoryLimit < 50 && importantEventViewModels(this.state.events ?? [], 50).length > this.eventHistoryLimit
        ? `<button type="button" class="secondary-button overview-more-events" data-action="show-more-events">${escapeHtml(t('showMoreEvents'))}</button>`
        : '';
      const constructionContent = this.renderConstructionOverview();
      body.innerHTML = `${overviewSectionMarkup('crisis', t('crisisSection'), crisisSummary, `${renderCrisisList(crisis, this.locale, this.crisisExpandedGroups)}${risk.forecastGuaranteedDefeat ? `<p class="warning-text">${escapeHtml(t('guaranteedDefeat'))}</p>` : ''}`, isOpen('crisis'), this.locale)}${overviewSectionMarkup('population', t('populationLocations'), `${population.total} ${t('population')}`, populationContent, isOpen('population'), this.locale)}${overviewSectionMarkup('branches', t('branchPanel'), t('arrivalSchedule'), branchContent, isOpen('branches'), this.locale)}${overviewSectionMarkup('events', t('importantEventHistory'), `${Math.min(50, importantEventViewModels(this.state.events ?? [], 50).length)}/50`, `${eventHistory}${moreEvents}`, isOpen('events'), this.locale)}${overviewSectionMarkup('construction', t('buildFacility'), t('localBuildOnly'), constructionContent, isOpen('construction'), this.locale)}`;
      return;
    }
    if (selected.kind === 'unit') {
      const unit = findUnit(this.state, selected.id);
      if (!unit) return;
      const listedUnitActions = this.query()?.getLegalActionsForUnit?.(unit.id);
      const actions = listedUnitActions ? [...listedUnitActions] : legalActionsForUnit(this.state, this.legalActions(), unit.id);
      const publicUnit = this.queryPublicUnit(unit.id);
      const publicTile = publicMapTileForPosition(this.state, unit.position, this.queryVisibleTileKeys());
      const proficiency = unitProficiencyViewModel(unit, this.state.config);
      const proficiencySummary = proficiency
        ? ` · ${proficiencyLabel(proficiency.proficiency, this.locale)} · ${t('attackCharge')} ${proficiency.attackChargesRemaining}/${proficiency.maxAttackCharges}`
        : '';
      title.textContent = `${unitLabel(unit.type, this.locale)} · ${unit.id}`;
      summary.textContent = `HP ${unit.hp}/${unit.maxHp}${proficiencySummary} · ${t('unitFuel')} ${publicUnit?.currentFuel ?? unit.currentFuel}/${publicUnit?.maxFuel ?? unit.maxFuel} · ${t('carriedMilitaryGoods')} ${publicUnit?.currentMilitaryGoods ?? unit.currentMilitaryGoods}/${publicUnit?.maxMilitaryGoods ?? unit.maxMilitaryGoods} · ${t('move')} ${unit.movement} · ${t('attack')} ${publicUnit?.attack ?? unit.attack} · ${t('effectiveRange')} ${publicUnit?.effectiveRange ?? unit.range} · ${t('vision')} ${publicUnit?.vision ?? unit.vision}`;
      const risk = this.pendingMove?.interceptionRisk;
      const riskText = typeof risk === 'number' ? risk <= 0.2 ? t('low') : risk <= 0.5 ? t('medium') : t('high') : String(risk ?? t('none'));
      const canWait = actions.some((action) => action.type === 'Wait');
      const supplied = isHexSupplied(this.state, unit.position);
      const supplyReason = supplied ? '' : localizeActionError('recovery_out_of_supply', this.locale);
      body.innerHTML = this.renderSameHexTabs(unit.position, selected) + this.renderUnitSheet(unit, publicUnit, publicTile, actions, riskText, supplied, supplyReason);
      return;
    }
    if (selected.kind === 'zombie') {
      const zombie = findUnit(this.state, selected.id);
      if (!zombie || zombie.isPlayerUnit) return;
      const publicZombie = this.queryPublicUnit(zombie.id);
      const publicTile = publicMapTileForPosition(this.state, zombie.position, this.queryVisibleTileKeys());
      title.textContent = `${unitLabel(zombie.type, this.locale)} · ${zombie.id}`;
      const waveBadge = zombie.hordeKind === 'final'
        ? t('finalWave')
        : zombie.hordeKind === 'periodic'
          ? t('waveMembership')
          : '';
      summary.textContent = `HP ${zombie.hp}/${zombie.maxHp} · ${t('attack')} ${publicZombie?.attack ?? zombie.attack} · ${t('movement')} ${publicZombie?.movement ?? zombie.movement} · ${t('range')} ${publicZombie?.effectiveRange ?? zombie.range}`;
      body.innerHTML = this.renderSameHexTabs(zombie.position, selected) + this.renderZombieSheet(zombie, publicZombie, publicTile, waveBadge);
      return;
    }
    if (selected.kind === 'hex') {
      const publicTile = publicMapTileForPosition(this.state, selected.position, this.queryVisibleTileKeys());
      this.renderHexSheet(selected.position, body, title, summary, publicTile);
      return;
    }
    if (selected.kind === 'road') {
      const publicTile = publicMapTileForPosition(this.state, selected.position, this.queryVisibleTileKeys());
      body.innerHTML = this.renderSameHexTabs(selected.position, selected);
      const content = document.createElement('div');
      this.renderRoadSheet(selected.position, content, title, summary, publicTile);
      body.insertAdjacentHTML('beforeend', content.innerHTML);
      return;
    }
    if (selected.kind === 'checkpoint') {
      const checkpoint = this.state.checkpoints.find((candidate) => candidate.id === selected.id);
      if (!checkpoint) return;
      const publicCheckpoint = this.queryPublicCheckpoint(checkpoint.id);
      const publicTile = publicMapTileForPosition(this.state, checkpoint.position, this.queryVisibleTileKeys());
      body.innerHTML = this.renderSameHexTabs(checkpoint.position, selected);
      const content = document.createElement('div');
      this.renderCheckpointSheet(checkpoint, content, title, summary, publicCheckpoint, publicTile);
      body.insertAdjacentHTML('beforeend', content.innerHTML);
      return;
    }
    const facility = this.state.facilities.find((candidate) => candidate.id === selected.id);
    if (!facility) return;
    const publicFacility = this.queryPublicFacility(facility.id);
    const publicTile = publicMapTileForPosition(this.state, facility.position, this.queryVisibleTileKeys());
    title.textContent = facilityLabel(facility.type, this.locale);
    const owned = facility.owner === 'player' && facility.status === 'owned';
    const statusText = facility.status === 'ruined' ? t('ruined') : facility.owner === 'player' ? t('owned') : t('unowned');
    const projectedProduction = publicFacility?.production;
    const projectedPowerUnavailable = projectedProduction?.powerMode === 'required' && !projectedProduction.projectedPowerSupplied;
    const operationText = facility.infected > 0
      ? t('infected')
      : facility.status === 'ruined'
        ? t('ruined')
        : facility.operationalStatus === 'building'
          ? t('stateBuilding')
          : facility.operationalStatus === 'disabled'
            ? t('stateDisabled')
            : facility.operationalStatus === 'recovering'
              ? t('stateRecovering')
        : facility.workers <= 0
          ? t('stopped')
          : projectedPowerUnavailable
            ? t('unpoweredForecast')
            : facility.operationalStatus === 'operational' ? t('operational') : t('stopped');
    summary.textContent = `${statusText} · ${operationText} · ${t('location')} ${facility.position.q},${facility.position.r} · ${t('vision')} ${publicFacility?.vision ?? 0}`;
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
        return `<section class="population-editor power-supply-editor" data-power-supply-editor="true"><h3>${escapeHtml(t('powerSupply'))}</h3><dl class="forecast-detail-grid"><div><dt>${escapeHtml(t('powerSupply'))}</dt><dd data-power-supply-state="true">${escapeHtml(currentPower)}</dd></div><div><dt>${escapeHtml(t('powerMode'))}</dt><dd>${escapeHtml(powerModeLabel(projectedProduction?.powerMode ?? 'none', this.locale))}</dd></div><div><dt>${escapeHtml(t('projectedPower'))}</dt><dd data-projected-power="true">${escapeHtml(projectedPower)}</dd></div></dl><button class="secondary-button" data-action="toggle-power-supply" data-facility-id="${escapeHtml(facility.id)}" data-enabled="${String(targetEnabled)}" ${availableAction ? '' : 'disabled'}>${escapeHtml(t('powerSupply'))}: ${escapeHtml(targetEnabled ? t('powerOn') : t('powerOff'))}</button>${unavailableReason ? `<p class="warning-text" data-power-supply-reason="true">${escapeHtml(unavailableReason)}</p>` : '<p class="muted" data-power-supply-reason="true"></p>'}</section>`;
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
    const riotConfig = this.state.config.units.riotPolice;
    const riotRecruitmentCost = `P${riotConfig.population}/C${riotConfig.productionCivilianGoods}/M${riotConfig.productionMilitaryGoods}`;
    const recruitment = `<section class="recruitment-editor"><h3>${escapeHtml(t('population'))}</h3><p class="muted">${escapeHtml(city ? t('tipRecruitment') : t('recruitmentDisabled'))}</p><div class="action-row"><button class="secondary-button" data-action="produce-police">${escapeHtml(t('producePolice'))}</button><button class="secondary-button" data-action="produce-guard">${escapeHtml(t('produceGuard'))}</button><button class="secondary-button" data-action="produce-riot-police">${escapeHtml(t('produceRiotPolice'))} · ${escapeHtml(riotRecruitmentCost)}</button></div><p class="warning-text" data-recruitment-reason="police" hidden></p><p class="warning-text" data-recruitment-reason="nationalGuard" hidden></p><p class="warning-text" data-recruitment-reason="riotPolice" hidden></p></section>`;
    const isDecommissionableType = facility.constructible && facility.type === 'civilianDroneBase';
    const decommissionRefund = Math.ceil(this.state.config.facilities.civilianDroneBase.buildCivilianGoods / 2);
    const decommissionAction: Extract<GameAction, { type: 'DecommissionConstructibleFacility' }> = {
      type: 'DecommissionConstructibleFacility',
      facilityId: facility.id,
    };
    const decommissionReason = isDecommissionableType
      ? actionReasonFor(this.state, decommissionAction, this.locale)
      : null;
    const decommissionControl = isDecommissionableType
      ? `<section class="decommission-editor" data-decommission-editor="true"><h3>${escapeHtml(t('decommissionFacility'))}</h3><p class="muted">${escapeHtml(t('decommissionConditions'))}</p><p>${escapeHtml(t('decommissionRefund'))}: <strong>${decommissionRefund} ${escapeHtml(t('civilianGoods'))}</strong></p><button class="secondary-button" data-action="decommission-facility" data-facility-id="${escapeHtml(facility.id)}" ${decommissionReason ? 'disabled' : ''}>${escapeHtml(t('decommissionFacility'))}</button>${decommissionReason ? `<p class="warning-text" data-decommission-reason="true">${escapeHtml(decommissionReason)}</p>` : '<p class="muted" data-decommission-reason="true"></p>'}</section>`
      : '';
    body.innerHTML = this.renderSameHexTabs(facility.position, selected) + `${powerSupplyEditor}<section class="location-card"><dl class="location-grid"><div><dt>${escapeHtml(city ? t('cityResidents') : t('workers'))}</dt><dd>${facility.workers}${cityCap === null ? `/${facility.workerCapacity}` : `/${cityCap}`}</dd></div>${cityCap !== null ? `<div><dt>${escapeHtml(t('overcrowding'))}</dt><dd>${cityExcess > 0 ? escapeHtml(formatPercent(cityExcess / Math.max(1, cityCap), this.locale)) : '0%'}</dd></div>` : ''}<div><dt>${escapeHtml(t('infected'))}</dt><dd>${facility.infected}</dd></div></dl>${facility.infected > 0 ? `<p class="warning-text">${escapeHtml(t('infected'))}: ${facility.infected}</p>` : ''}${city && projectedPowerUnavailable ? `<p class="warning-text"><strong>${escapeHtml(t('unpoweredForecast'))}</strong>: ${escapeHtml(t('powerReason'))} · ${escapeHtml(powerReasonLabel(projectedProduction?.projectedPowerReason, this.locale))}</p>` : ''}${city && facility.populationOperationalTurn > this.state.turn ? `<p class="warning-text">${escapeHtml(t('facilityNotReady'))}</p>` : ''}</section>${workerEditor}${cityTransfer}${recruitment}${decommissionControl}`;
    body.insertAdjacentHTML('beforeend', this.renderFacilityForecast(publicFacility));
    this.updateTransferPreview();
    this.updateRecruitmentReasons();
  }

  private renderZombieSheet(
    zombie: UnitState,
    publicZombie: AgentUnitObservation | undefined,
    publicTile: AgentMapTileObservation | undefined,
    waveBadge: string,
  ): string {
    const t = this.translator();
    const publicAttack = publicZombie?.attack ?? zombie.attack;
    const publicMovement = publicZombie?.movement ?? zombie.movement;
    const publicRange = publicZombie?.effectiveRange ?? publicZombie?.range ?? zombie.range;
    const badge = waveBadge ? `<span class="status-chip zombie-wave-badge">${escapeHtml(waveBadge)}</span>` : '';
    const finalBadge = zombie.hordeKind === 'final' ? `<p class="warning-text">${escapeHtml(t('finalWaveMembership'))}</p>` : '';
    return `<section class="zombie-detail-panel" data-zombie-panel="true"><div class="section-heading"><h3>${escapeHtml(unitLabel(zombie.type, this.locale))}</h3>${badge}</div><dl class="location-grid"><div><dt>${escapeHtml(t('hp'))}</dt><dd>${zombie.hp}/${zombie.maxHp}</dd></div><div><dt>${escapeHtml(t('attack'))}</dt><dd>${publicAttack}</dd></div><div><dt>${escapeHtml(t('movement'))}</dt><dd>${publicMovement}</dd></div><div><dt>${escapeHtml(t('range'))}</dt><dd>${publicRange}</dd></div></dl>${finalBadge}<p class="muted">${escapeHtml(t('visibleEnemyOnly'))}</p></section>`;
  }

  private renderUnitSheet(
    unit: UnitState,
    publicUnit: AgentUnitObservation | undefined,
    publicTile: AgentMapTileObservation | undefined,
    actions: readonly GameAction[],
    riskText: string,
    supplied: boolean,
    supplyReason: string,
  ): string {
    const t = this.translator();
    const canWait = actions.some((action) => action.type === 'Wait');
    const proficiency = unitProficiencyViewModel(unit, this.state?.config);
    const proficiencyText = proficiency
      ? `${proficiencyLabel(proficiency.proficiency, this.locale)}${proficiency.veteranPromotionPending ? ` (${t('veteranPromotionPending')})` : ''}`
      : '';
    const proficiencyProgress = proficiency
      ? proficiency.proficiency === 'recruit'
        ? `${t('regularIn')} ${Math.max(0, proficiency.recruitSurvivalTurnsRequired - proficiency.recruitSurvivalTurns)} ${t('turns')}`
        : proficiency.proficiency === 'regular'
          ? `${t('veteranIn')} ${Math.max(0, proficiency.veteranZombieKillsRequired - proficiency.regularZombieKills)} / ${proficiency.veteranZombieKillsRequired} ${t('kills')}`
          : `${t('attackCharge')} ${proficiency.attackChargesRemaining} / ${proficiency.maxAttackCharges}`
      : '';
    const proficiencySection = proficiency
      ? `<section class="unit-proficiency" data-unit-proficiency="true"><div class="section-heading"><h3>${escapeHtml(t('proficiency'))}</h3><span class="status-chip">${escapeHtml(proficiencyText)}</span></div><p>${escapeHtml(proficiencyProgress)}</p><dl class="forecast-detail-grid"><div><dt>${escapeHtml(t('attackCharge'))}</dt><dd>${proficiency.attackChargesRemaining}/${proficiency.maxAttackCharges}</dd></div><div><dt>${escapeHtml(t('zombieKills'))}</dt><dd>${proficiency.regularZombieKills}/${proficiency.veteranZombieKillsRequired}</dd></div></dl></section>`
      : '';
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
    const rangeReason = publicUnit?.rangeModifierReason === 'carried_military_goods_shortage'
      ? t('carriedMilitaryGoodsShortage')
      : '';
    const infectedFacility = this.state?.facilities.find((facility) =>
      facility.infected > 0 && samePosition(facility.position, unit.position));
    const infectedCheckpoint = this.state?.checkpoints.find((checkpoint) =>
      checkpoint.infected > 0 && samePosition(checkpoint.position, unit.position));
    const infectedTarget = infectedFacility ?? infectedCheckpoint;
    const noiseClass = noiseClassForUnit(unit.type);
    const noiseSection = noiseClass
      ? `<section class="noise-forecast" data-noise-class="${escapeHtml(noiseClass)}"><h3>${escapeHtml(t('noise'))}</h3><p><strong>${escapeHtml(t('noiseClass'))}</strong>: ${escapeHtml(t(`noiseClass${noiseClass[0]!.toUpperCase()}${noiseClass.slice(1)}`))}</p><p class="muted">${escapeHtml(t('noiseCombatHint'))}</p></section>`
      : '';
    const currentFuel = publicUnit?.currentFuel ?? unit.currentFuel;
    const maxFuel = publicUnit?.maxFuel ?? unit.maxFuel;
    const selectedMove = this.pendingMove && publicUnit
      ? publicUnit.fuelCostByLegalMove.find((move) => samePosition(move.destination, this.pendingMove!.destination))
      : undefined;
    const refillDemand = publicUnit?.projectedRefillDemandIfTurnEndsNow ?? Math.max(0, maxFuel - currentFuel);
    const refillAmount = publicUnit?.projectedRefillAmountIfTurnEndsNow ?? 0;
    const refillReason = !supplied
      ? t('refillOutOfSupply')
      : refillDemand <= 0
        ? t('refillNotNeeded')
        : refillAmount < refillDemand
          ? t('refillStateFuelShortage')
          : t('refillAvailable');
    const movementMode = selectedMove?.movementMode ?? (publicUnit?.emergencyMovementAvailable ? 'emergency' : 'normal');
    const fuelSection = `<section class="unit-fuel-forecast" data-unit-fuel="true"><h3>${escapeHtml(t('unitFuel'))}</h3><dl class="forecast-detail-grid"><div><dt>${escapeHtml(t('currentFuel'))}</dt><dd>${currentFuel}/${maxFuel}</dd></div><div><dt>${escapeHtml(t('movementMode'))}</dt><dd data-movement-mode="${movementMode}">${escapeHtml(t(movementMode === 'emergency' ? 'emergencyMovement' : 'normalMovement'))}</dd></div><div><dt>${escapeHtml(t('emergencyMovementLimit'))}</dt><dd>${publicUnit?.emergencyMovementPoints ?? 0} MP</dd></div>${selectedMove ? `<div><dt>${escapeHtml(t('effectiveMovementCost'))}</dt><dd>${selectedMove.effectiveMovementCost} MP</dd></div><div><dt>${escapeHtml(t('fuelCost'))}</dt><dd>-${selectedMove.fuelCost}</dd></div><div><dt>${escapeHtml(t('fuelAfterMove'))}</dt><dd>${selectedMove.projectedFuelAfterMove}/${maxFuel}</dd></div>` : ''}<div><dt>${escapeHtml(t('refillDemand'))}</dt><dd>${refillDemand}</dd></div><div><dt>${escapeHtml(t('refillAmount'))}</dt><dd>${refillAmount}</dd></div><div><dt>${escapeHtml(t('refillReason'))}</dt><dd>${escapeHtml(refillReason)}</dd></div></dl>${publicUnit?.emergencyMovementAvailable ? `<p class="warning-text">${escapeHtml(t('emergencyMovementActive'))}</p>` : ''}<p class="muted">${escapeHtml(t('tipFuel'))}</p></section>`;
    const militaryGoodsSection = publicUnit
      ? renderUnitMilitaryGoodsDetails(
        publicUnit,
        this.locale,
        unit.type === 'police' || unit.type === 'nationalGuard'
          ? this.state?.config.units[unit.type].militaryGoodsShortageAttackMultiplier ?? 0.2
          : 0.2,
      )
      : '';
    const infectionSection = infectedTarget
      ? `<section class="infection-forecast"><h3>${escapeHtml(t('infectionForecast'))}</h3><p class="${publicUnit?.infectionContainmentCapable ? 'is-contained' : 'warning-text'}">${escapeHtml(publicUnit?.infectionContainmentCapable ? t('infectionContained') : t('infectionNotContained'))}</p>${publicUnit?.suppressionAvailableIfTurnEndsNow ? `<p class="muted">${escapeHtml(t('automaticSuppression'))}: ${escapeHtml(t('projectedSuppression'))} ${Math.min(infectedTarget.infected, publicUnit.suppressionPower)} · ${escapeHtml(t('suppressionPower'))} ${publicUnit.suppressionPower} · ${escapeHtml(t('cost'))} ${publicUnit.suppressionMilitaryGoodsCost}</p>${publicUnit.suppressionCivilianDamage > 0 ? `<p class="warning-text">${escapeHtml(t('projectedCivilianDamage'))}: ${publicUnit.suppressionCivilianDamage}</p>` : `<p class="muted">${escapeHtml(t('noCivilianDamage'))}</p>`}` : publicUnit?.suppressionStatusIfTurnEndsNow === 'containment_only' ? `<p class="warning-text">${escapeHtml(t('containmentOnly'))}: ${escapeHtml(t('suppressionMilitaryGoodsUnavailable'))}</p>` : `<p class="muted">${escapeHtml(t('automaticSuppressionUnavailable'))}</p>`}<p class="muted">${escapeHtml(t('tipSuppression'))}</p></section>`
      : '';
    const selectedAttack = this.pendingAttackTargetId
      ? publicUnit?.attackPreviews.find((candidate) => candidate.targetUnitId === this.pendingAttackTargetId)
      : undefined;
    const preview = this.pendingMove
      ? `<div class="preview-card"><strong>${escapeHtml(t('preview'))} · ${escapeHtml(t(movementMode === 'emergency' ? 'emergencyMovement' : 'normalMovement'))}</strong><p>${escapeHtml(t('path'))}: ${Math.max(0, this.pendingMove.path.length - 1)} <span>→ ${this.pendingMove.destination.q},${this.pendingMove.destination.r}</span></p>${selectedMove ? `<p>${escapeHtml(t('effectiveMovementCost'))}: <b>${selectedMove.effectiveMovementCost} MP</b> · ${escapeHtml(t('fuelCost'))}: <b>-${selectedMove.fuelCost}</b> · ${escapeHtml(t('fuelAfterMove'))}: <b>${selectedMove.projectedFuelAfterMove}/${maxFuel}</b></p>` : ''}<p>${escapeHtml(t('interceptionRisk'))}: <b class="risk-${riskText.toLowerCase()}">${escapeHtml(riskText)}</b></p><div class="action-row"><button class="primary-button" data-action="confirm-move">${escapeHtml(t('confirm'))}</button><button class="ghost-button" data-action="cancel-move">${escapeHtml(t('cancel'))}</button></div></div>`
      : selectedAttack
        ? `<div class="preview-card attack-confirm-preview"><strong>${escapeHtml(t('attackPreview'))}</strong>${renderAttackPreview(selectedAttack, this.locale, publicUnit?.attack)}</div>`
        : '';
    const actionHint = this.pendingMove || this.pendingAttackTargetId
      ? t('confirmTargetNearby')
      : this.unitActionMode === 'move'
        ? t('selectDestination')
        : this.unitActionMode === 'attack'
          ? t('selectAttackTarget')
          : t('selectUnitAction');
    return `<p class="supply-status ${supplied ? 'is-supplied' : 'is-out-of-supply'}">${escapeHtml(t(supplied ? 'supplied' : 'outOfSupply'))}${supplyReason ? ` · ${escapeHtml(supplyReason)}` : ''}</p>${proficiencySection}${fuelSection}${militaryGoodsSection}<section class="unit-forecast"><h3>${escapeHtml(t('recoveryForecast'))}</h3><p class="recovery-status recovery-${escapeHtml(recoveryClass)}"><strong>${escapeHtml(recoveryClassLabel(recoveryClass, this.locale))}</strong> · ${escapeHtml(formatPercent(recoveryRate, this.locale))} · +${recoveryBaseAmount} HP</p><dl class="forecast-detail-grid"><div><dt>${escapeHtml(t('recoveryTiming'))}</dt><dd>${escapeHtml(recoveryTiming)}</dd></div><div><dt>${escapeHtml(t('recoveryBaseAmount'))}</dt><dd>+${recoveryBaseAmount} HP</dd></div></dl><p class="muted">${escapeHtml(t('recoveryConditions'))}: ${escapeHtml(t('recoverySurvivalRequired'))} · ${escapeHtml(t('recoverySupplyRequired'))}</p><p class="muted">${escapeHtml(t('tipRecovery'))}</p></section><section class="range-forecast"><h3>${escapeHtml(t('range'))}</h3><p><span>${escapeHtml(t('baseRange'))} ${baseRange}</span> · <strong>${escapeHtml(t('effectiveRange'))} ${effectiveRange}</strong>${rangeReason ? ` · ${escapeHtml(rangeReason)}` : ''}</p></section>${noiseSection}${infectionSection}${preview}<div class="action-row">${canWait ? `<button class="secondary-button" data-action="wait">${escapeHtml(t('wait'))}</button>` : ''}</div><p class="muted">${escapeHtml(actionHint)}</p>`;
  }

  /**
   * Render the public terrain/overlay values for the selected hex. This uses
   * AgentObservation rather than internal map state so the human UI and the
   * public Agent surface stay on the same fair-information boundary.
   */
  private renderTerrainDetails(
    tile: AgentMapTileObservation | undefined,
    vision: number,
    source?: Partial<Pick<AgentUnitObservation, 'terrainDefenseSource' | 'terrainDamageMultiplier' | 'visionMode' | 'terrainLosBlocking'>>,
  ): string {
    if (!tile) return '';
    const t = this.translator();
    const overlays = [
      tile.road ? t('roadOverlay') : null,
      tile.urban ? t('urbanOverlay') : null,
    ].filter((value): value is string => Boolean(value));
    const defenseSource = source?.terrainDefenseSource ?? tile.terrainDefenseSource;
    const damageMultiplier = source?.terrainDamageMultiplier ?? tile.terrainDamageMultiplier;
    const movementCost = tile.effectiveMovementCost === null ? t('blocked') : String(tile.effectiveMovementCost);
    const visibility = tile.visibleToPlayer ? t('visible') : t('hidden');
    const occupancy = tile.playerOccupancyAllowed ? t('playerOccupancyAllowed') : t('playerOccupancyForbidden');
    const visionMode = source?.visionMode;
    const visionRule = visionMode === 'aerial'
      ? t('visionAerialRule')
      : visionMode === 'ground'
        ? t('visionGroundRule')
        : '';
    const visionDetails = visionMode
      ? `<div><dt>${escapeHtml(t('visionMode'))}</dt><dd>${escapeHtml(visionMode === 'aerial' ? t('visionAerial') : t('visionGround'))}</dd></div><div><dt>${escapeHtml(t('terrainLosBlocking'))}</dt><dd>${escapeHtml(source?.terrainLosBlocking ? t('yes') : t('no'))}</dd></div>`
      : '';
    return `<section class="terrain-detail terrain-forecast${tile.playerOccupancyAllowed ? '' : ' spawn-reserve-detail'}" data-terrain="${escapeHtml(tile.terrain)}"><div class="section-heading"><h3>${escapeHtml(t('terrain'))}</h3><span class="status-chip">${escapeHtml(visibility)}</span></div><dl class="forecast-detail-grid"><div><dt>${escapeHtml(t('baseTerrain'))}</dt><dd>${escapeHtml(terrainLabel(tile.terrain, this.locale))}</dd></div><div><dt>${escapeHtml(t('roadOverlay'))} / ${escapeHtml(t('urbanOverlay'))}</dt><dd>${escapeHtml(overlays.join(' · ') || t('none'))}</dd></div><div><dt>${escapeHtml(t('effectiveMovementCost'))}</dt><dd>${escapeHtml(movementCost)}</dd></div><div><dt>${escapeHtml(t('defenseSource'))}</dt><dd>${escapeHtml(terrainDefenseLabel(defenseSource, this.locale))}</dd></div><div><dt>${escapeHtml(t('damageMultiplier'))}</dt><dd>×${escapeHtml(String(damageMultiplier))}</dd></div><div><dt>${escapeHtml(t('vision'))}</dt><dd>${escapeHtml(String(Math.max(0, vision)))}</dd></div>${visionDetails}<div><dt>${escapeHtml(t('playerOccupancyAllowed'))}</dt><dd>${escapeHtml(occupancy)}</dd></div></dl>${visionRule ? `<p class="muted">${escapeHtml(visionRule)}</p>` : ''}${tile.playerOccupancyAllowed ? '' : `<p class="warning-text">${escapeHtml(t('spawnReserveReason'))}</p>`}</section>`;
  }

  private renderFacilityForecast(publicFacility: AgentFacilityObservation | undefined): string {
    if (!publicFacility) return '';
    const t = this.translator();
    const production = publicFacility.production;
    const statusLabel = publicFacility.operationalStatus === 'building'
      ? t('stateBuilding')
      : publicFacility.operationalStatus === 'disabled'
        ? t('stateDisabled')
        : publicFacility.operationalStatus === 'recovering'
          ? t('stateRecovering')
          : publicFacility.operationalStatus === 'operational'
            ? t('operational')
            : publicFacility.operationalStatus === 'stopped'
              ? t('stopped')
              : publicFacility.operationalStatus === 'infected'
                ? t('infected')
                : t('ruined');
    const type = publicFacility.type;
    const config = this.state?.config.facilities[type];
    const buildCost = config?.buildCivilianGoods ?? 0;
    const currentVision = publicFacility.vision;
    const visionLimit = type === 'civilianDroneBase' ? config?.visionRadius ?? 10 : currentVision;
    const facilityFacts = `<section class="facility-facts" data-facility-facts="true"><h3>${escapeHtml(t('facilityStatus'))}</h3><dl class="forecast-detail-grid"><div><dt>${escapeHtml(t('facilityStatus'))}</dt><dd>${escapeHtml(statusLabel)}</dd></div><div><dt>${escapeHtml(t('healthyPopulation'))}</dt><dd>${publicFacility.healthyPopulation}/${publicFacility.populationCapacity}</dd></div><div><dt>${escapeHtml(t('facilitySupply'))}</dt><dd>${escapeHtml(publicFacility.inSupply ? t('supplied') : t('outOfSupply'))}</dd></div><div><dt>${escapeHtml(t('facilityVision'))}</dt><dd>${currentVision}${type === 'civilianDroneBase' ? `/${visionLimit}` : ''}</dd></div><div><dt>${escapeHtml(t('zombieTargetValue'))}</dt><dd>${publicFacility.zombieTargetValue}</dd></div><div><dt>${escapeHtml(t('constructible'))}</dt><dd>${publicFacility.constructible ? t('owned') : t('none')}</dd></div>${publicFacility.constructible ? `<div><dt>${escapeHtml(t('buildTurn'))}</dt><dd>${publicFacility.builtTurn ?? '—'}</dd></div><div><dt>${escapeHtml(t('buildCost'))}</dt><dd>${buildCost} ${escapeHtml(t('civilianGoods'))}</dd></div><div><dt>${escapeHtml(t('recoveryTurn'))}</dt><dd>${publicFacility.recoveryOperationalTurn ?? '—'}</dd></div>` : ''}</dl></section>`;
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
      ? `<p class="warning-text"><strong>${escapeHtml(t('unpoweredForecast'))}</strong>: ${escapeHtml(powerReason || t('powerReason'))}</p>`
      : '';
    const infection = publicFacility.infectedPopulation > 0
      ? `<section class="infection-forecast"><h3>${escapeHtml(t('infectionForecast'))}</h3><p class="${publicFacility.infectionContained ? 'is-contained' : 'warning-text'}">${escapeHtml(publicFacility.infectionContained ? t('infectionContained') : t('infectionNotContained'))}</p><p class="muted">${escapeHtml(t('automaticSuppression'))}: ${publicFacility.projectedSuppression > 0 ? publicFacility.projectedSuppression : t('automaticSuppressionUnavailable')}</p>${publicFacility.projectedCivilianDamage > 0 ? `<p class="warning-text">${escapeHtml(t('projectedCivilianDamage'))}: ${publicFacility.projectedCivilianDamage}</p>` : `<p class="muted">${escapeHtml(t('noCivilianDamage'))}</p>`}</section>`
      : '';
    const specialRule = type === 'windPowerPlant'
      ? `<p class="muted">${escapeHtml(t('windPowerGeneration'))}: 15 · ${escapeHtml(t('windFuelCost'))}: 0 · ${escapeHtml(t('windZombieTarget'))}: 5 · ${escapeHtml(t('facilityVision'))}: ${currentVision} · ${escapeHtml(t('powerMode'))}: ${escapeHtml(t('powerModeNone'))}</p>`
      : type === 'simpleFarm'
        ? `<p class="muted">${escapeHtml(t('foodPerWorker'))}: 5 · ${escapeHtml(t('powerMode'))}: ${escapeHtml(t('powerModeNone'))} · ${escapeHtml(t('buildCost'))}: ${buildCost}</p>`
        : type === 'civilianDroneBase'
          ? `<p class="muted">${escapeHtml(t('droneVisionFormula'))}: ${publicFacility.healthyPopulation} × 3 = ${currentVision} · ${escapeHtml(t('powerRequirement'))}: 5 · ${escapeHtml(t('buildCost'))}: ${buildCost}</p><p class="muted">${escapeHtml(t('droneVisionValues'))}</p>`
          : '';
    return `${facilityFacts}<section class="production-forecast"><h3>${escapeHtml(t('productionForecast'))}</h3><dl class="forecast-detail-grid"><div><dt>${escapeHtml(t('powerMode'))}</dt><dd>${escapeHtml(powerModeLabel(powerMode, this.locale))}</dd></div><div><dt>${escapeHtml(t('powerSupply'))}</dt><dd>${escapeHtml(powerSupply)}</dd></div><div><dt>${escapeHtml(t('projectedPower'))}</dt><dd>${escapeHtml(projectedPower)}</dd></div><div><dt>${escapeHtml(t('powerReason'))}</dt><dd>${escapeHtml(powerReason || t('none'))}</dd></div><div><dt>${escapeHtml(t('lastPowerSupplied'))}</dt><dd>${escapeHtml(lastPower)}</dd></div><div><dt>${escapeHtml(t('productionMultiplier'))}</dt><dd>×${production.projectedProductionMultiplier ?? 1}</dd></div><div><dt>${escapeHtml(t('baseProduction'))}</dt><dd>${escapeHtml(formatResourceAmounts(baseProduction, this.locale, true))}</dd></div><div><dt>${escapeHtml(t('projectedProduction'))}</dt><dd>${escapeHtml(formatResourceAmounts(projectedProduction, this.locale, true))}</dd></div><div><dt>${escapeHtml(t('projectedInput'))}</dt><dd>${escapeHtml(formatResourceAmounts(projectedInput, this.locale, true))}</dd></div><div><dt>${escapeHtml(t('powerRequirement'))}</dt><dd>${escapeHtml(powerRequirement)}</dd></div><div><dt>${escapeHtml(t('powerGeneration'))}</dt><dd>${escapeHtml(powerGeneration)}</dd></div></dl><p class="muted">${escapeHtml(t('perWorker'))}: ${escapeHtml(t('currentProduction'))} ${escapeHtml(formatResourceAmounts(production.outputsPerWorker, this.locale))} · ${escapeHtml(t('inputConsumption'))} ${escapeHtml(formatResourceAmounts(production.inputsPerWorker, this.locale))}</p>${specialRule}${powerWarning}${stopped}<p class="muted">${escapeHtml(t('projectedLoss'))}: ${escapeHtml(formatResourceAmounts(production.projectedOutputLossIfInfectedOrOverrun, this.locale))} · ${escapeHtml(t('powerGeneration'))} ${production.projectedPowerLossIfInfectedOrOverrun}</p></section>${infection}`;
  }

  private renderCheckpointSheet(
    checkpoint: CheckpointState,
    body: HTMLElement,
    title: HTMLElement,
    summary: HTMLElement,
    publicCheckpoint?: AgentCheckpointObservation,
    publicTile?: AgentMapTileObservation,
  ): void {
    const t = this.translator();
    const branchId = checkpointBranchId(checkpoint);
    const role = checkpointRoleFor(this.state!, checkpoint);
    const statusLabel = t(checkpoint.status);
    const roleLabel = t(`checkpointRole.${role}`);
    const branch = this.state?.map.roadBranches.find((candidate) => candidate.id === branchId);
    const branchState = this.state?.roadBranches.find((candidate) => candidate.branchId === branchId);
    const branchPanel = this.state ? branchPanelViewModel(this.state, branchId)[0] : undefined;
    const supplied = this.state ? getSuppliedTileKeys(this.state).includes(String(checkpoint.position.q) + ',' + String(checkpoint.position.r)) : false;
    const branchPolicy = branchPanel?.currentPolicy ?? 'normal';
    const policyEditable = role === 'active' && checkpoint.status === 'operational';
    const newPolicyActionAvailable = this.legalActions().some((action) =>
      action.type === 'SetCheckpointPolicy' && action.branchId === branchId);
    const requestedPolicy: Extract<GameAction, { type: 'SetCheckpointPolicy' }> = {
      type: 'SetCheckpointPolicy',
      branchId,
      policy: branchPolicy === 'normal' ? 'strict' : 'normal',
    };
    const newPolicyReason = !policyEditable
      ? t('invalidAction')
      : newPolicyActionAvailable
        ? null
        : actionReasonFor(this.state!, requestedPolicy, this.locale) ?? t('invalidAction');
    const screeningCapacity = publicCheckpoint?.screeningCapacity ?? this.state?.config.refugees.screeningCapacity ?? 20;
    const screeningThroughput = publicCheckpoint?.estimatedScreeningThroughput ?? screeningCapacity / Math.max(1, this.state?.config.refugees.policies[branchPolicy].turns ?? 1);
    const screeningTurns = publicCheckpoint?.currentPolicyTurns ?? this.state?.config.refugees.policies[branchPolicy].turns ?? 0;
    const checkpointQueuePressure = publicCheckpoint ? queuePressureLabel(publicCheckpoint.queuePressureClass, this.locale) : t('none');
    const newRelocationAvailable = checkpoint.status === 'operational' && this.checkpointCandidates({
      mode: 'relocate',
      checkpointId: checkpoint.id,
      branchId: checkpoint.branchId ?? checkpoint.direction,
    }).length > 0;
    const activationRequested: Extract<GameAction, { type: 'ActivateCheckpoint' }> = { type: 'ActivateCheckpoint', branchId, checkpointId: checkpoint.id };
    const activationAvailable = Boolean(actionForCheckpointActivation(this.legalActions(), branchId, checkpoint.id));
    const activationReason = (role === 'standby' || role === 'dormant') && !activationAvailable
      ? actionReasonFor(this.state!, activationRequested, this.locale) ?? t('invalidAction')
      : null;
    const statusSummary = roleLabel + ' · ' + statusLabel + ' · ' + formatDirection(checkpoint.direction, this.locale);
    title.textContent = t('checkpoint') + ' · ' + checkpoint.id;
    summary.textContent = `${statusSummary} · ${t('vision')} ${publicCheckpoint?.vision ?? 0}`;
    const branchText = branch ? formatDirection(branch.direction, this.locale) + ' · ' + branch.id : branchId;
    const arrivalText = branchState?.nextArrivalTurn === null
      ? (this.state?.horde.finalHordeStatus !== 'notStarted' ? t('refugeeArrivalsStopped') : t('unavailable'))
      : branchState?.nextArrivalTurn !== undefined
        ? t('arrivalIn') + ' ' + String(Math.max(0, branchState.nextArrivalTurn - this.state!.turn))
        : t('unavailable');
    const queuePeople = Math.max(0, checkpoint.waiting + checkpoint.screening + checkpoint.approved);
    const queueFoodMaintenance = queuePeople * this.state!.config.economy.populationConsumption.food;
    const queueCivilianGoodsMaintenance = queuePeople * this.state!.config.economy.populationConsumption.civilianGoods;
    const arrivalsStopped = this.state!.horde.finalHordeStatus !== 'notStarted';
    const turnAwayRequestedCount = Math.min(1, Math.max(0, checkpoint.waiting));
    const turnAwayAction: Extract<GameAction, { type: 'TurnAwayCheckpointRefugees' }> = {
      type: 'TurnAwayCheckpointRefugees',
      checkpointId: checkpoint.id,
      count: turnAwayRequestedCount,
    };
    const turnAwayEligible = (role === 'active' || role === 'remnant') && checkpoint.waiting > 0;
    const turnAwayReason = turnAwayEligible
      ? actionReasonFor(this.state!, turnAwayAction, this.locale)
      : (role === 'active' || role === 'remnant' ? null : t('checkpointTurnAwayRole'));
    const turnAwayControl = `<section class="checkpoint-turn-away" data-turn-away-section="true"><h3>${escapeHtml(t('turnAwayRefugees'))}</h3><p class="muted">${escapeHtml(t('turnAwayHint'))}</p><label>${escapeHtml(t('turnAwayCount'))}<input type="number" min="1" max="${checkpoint.waiting}" step="1" value="${turnAwayRequestedCount || 1}" inputmode="numeric" data-turn-away-count="true" data-checkpoint-id="${escapeHtml(checkpoint.id)}" ${turnAwayEligible ? '' : 'disabled'} /></label><button class="secondary-button" data-action="turn-away-refugees" data-checkpoint-id="${escapeHtml(checkpoint.id)}" ${turnAwayReason || !turnAwayEligible ? 'disabled' : ''}>${escapeHtml(t('turnAwayRefugees'))}</button>${turnAwayReason ? `<p class="warning-text" data-turn-away-reason="true">${escapeHtml(turnAwayReason)}</p>` : '<p class="warning-text" data-turn-away-reason="true" hidden></p>'}<p class="muted">${escapeHtml(t('refugeeRejectionWarning'))}</p></section>`;
    const queueMaintenance = `<section class="checkpoint-queue-maintenance" data-checkpoint-queue-maintenance="true"><h3>${escapeHtml(t('checkpointQueueMaintenance'))}</h3><dl class="forecast-detail-grid"><div><dt>${escapeHtml(t('checkpointMaintenanceHealthy'))}</dt><dd>${queuePeople}</dd></div><div><dt>${escapeHtml(t('checkpointMaintenanceFood'))}</dt><dd>${queueFoodMaintenance}</dd></div><div><dt>${escapeHtml(t('checkpointMaintenanceCivilianGoods'))}</dt><dd>${queueCivilianGoodsMaintenance}</dd></div></dl><p class="muted">${escapeHtml(t('infected'))}: ${checkpoint.infected} · ${escapeHtml(t('checkpointMaintenanceHealthy'))} ${escapeHtml(t('checkpointMaintenanceHealthyHint'))}</p></section>`;
    const arrivalStopNotice = arrivalsStopped ? `<p class="warning-text refugee-arrivals-stopped" data-refugee-arrivals-stopped="true">${escapeHtml(t('refugeeArrivalsStopped'))}</p>` : '';
    const newPolicies: CheckpointPolicy[] = ['passThrough', 'normal', 'strict'];
    const newPolicyOptions = newPolicies.map((policy) => '<option value="' + policy + '" ' + (branchPolicy === policy ? 'selected' : '') + '>' + escapeHtml(t(policy)) + '</option>').join('');
    const policyDetails = checkpointPolicyDetails(this.state!.config.refugees.policies, this.locale);
    const infectionSection = checkpoint.infected > 0
      ? '<section class="infection-forecast"><h3>' + escapeHtml(t('infectionForecast')) + '</h3><p class="' + (publicCheckpoint?.infectionContained ? 'is-contained' : 'warning-text') + '">' + escapeHtml(publicCheckpoint?.infectionContained ? t('infectionContained') : t('infectionNotContained')) + '</p><p class="muted">' + escapeHtml(t('automaticSuppression')) + ': ' + String(publicCheckpoint?.projectedSuppression ?? 0) + '</p>' + ((publicCheckpoint?.projectedCivilianDamage ?? 0) > 0 ? '<p class="warning-text">' + escapeHtml(t('projectedCivilianDamage')) + ': ' + String(publicCheckpoint?.projectedCivilianDamage) + '</p>' : '<p class="muted">' + escapeHtml(t('noCivilianDamage')) + '</p>') + '</section>'
      : '';
    body.innerHTML = '<section class="checkpoint-card checkpoint-status-' + escapeHtml(checkpoint.status) + '" data-checkpoint-id="' + escapeHtml(checkpoint.id) + '" data-checkpoint-role="' + escapeHtml(role) + '" data-checkpoint-status="' + escapeHtml(checkpoint.status) + '"><div class="checkpoint-heading"><strong>' +
      escapeHtml(t('checkpointStatus')) + ': ' + escapeHtml(roleLabel) + ' · ' + escapeHtml(statusLabel) + '</strong><span class="status-chip ' + (supplied ? 'is-supplied' : 'is-out-of-supply') +
      '">' + escapeHtml(supplied ? t('supplied') : t('outOfSupply')) + '</span></div><dl class="location-grid"><div><dt>' +
      escapeHtml(t('branch')) + '</dt><dd>' + escapeHtml(branchText) + '</dd></div><div><dt>' + escapeHtml(t('nextArrival')) +
      '</dt><dd>' + escapeHtml(arrivalText) + '</dd></div><div><dt>' + escapeHtml(t('waiting')) + '</dt><dd>' + String(checkpoint.waiting) +
      '</dd></div><div><dt>' + escapeHtml(t('screening')) + '</dt><dd>' + String(checkpoint.screening) + '</dd></div><div><dt>' +
      escapeHtml(t('approved')) + '</dt><dd>' + String(checkpoint.approved) + '</dd></div><div><dt>' + escapeHtml(t('infected')) +
      '</dt><dd>' + String(checkpoint.infected) + '</dd></div><div><dt>' + escapeHtml(t('screeningCapacity')) + '</dt><dd>' + String(screeningCapacity) + '</dd></div><div><dt>' + escapeHtml(t('screeningThroughput')) + '</dt><dd>' + String(screeningThroughput) + ' / ' + escapeHtml(t('turn')) + '</dd></div><div><dt>' + escapeHtml(t('policyTurns')) + '</dt><dd>' + String(screeningTurns) + '</dd></div><div><dt>' + escapeHtml(t('queuePressure')) + '</dt><dd>' + escapeHtml(checkpointQueuePressure) + '</dd></div><div><dt>' + escapeHtml(t('remainingScreeningTurns')) +
      '</dt><dd>' + String(checkpoint.remainingTurns) + '</dd></div></dl><p class="muted">' + escapeHtml(t('tipCheckpoint')) +
      '</p>' + arrivalStopNotice + queueMaintenance + turnAwayControl + '<p class="checkpoint-role-help"><strong>' + escapeHtml(t('checkpointRole')) + '</strong>: ' + escapeHtml(roleLabel) + '</p><label>' + escapeHtml(t('branchPolicy')) + '<select data-policy="' + escapeHtml(branchId) + '" ' +
       (policyEditable ? '' : 'disabled') + '>' + newPolicyOptions + '</select></label><p class="muted">' + escapeHtml(t('checkpointPolicy')) + ': ' + escapeHtml(t(branchPolicy)) + ' · ' + escapeHtml(t('nextPolicy')) + ': ' + escapeHtml(t(checkpoint.screeningPolicy)) + '</p>' + infectionSection + '<section class="policy-details"><h3>' + escapeHtml(t('policyDetails')) + '</h3><p class="muted">' + escapeHtml(t('policyTradeoff')) + '</p><ul class="policy-list">' + policyDetails + '</ul></section>' +
      (newPolicyReason ? '<p class="warning-text">' + escapeHtml(newPolicyReason) + '</p>' : '') +
      ((role === 'standby' || role === 'dormant') ? '<section class="checkpoint-activation"><p class="muted">' + escapeHtml(t('activateCheckpointHint')) + '</p><button class="secondary-button" data-action="activate-checkpoint" data-branch-id="' + escapeHtml(branchId) + '" data-checkpoint-id="' + escapeHtml(checkpoint.id) + '" ' + (activationAvailable ? '' : 'disabled') + '>' + escapeHtml(t('activateCheckpoint')) + '</button>' + (activationReason ? '<p class="warning-text">' + escapeHtml(activationReason) + '</p>' : '') + '</section>' : '') +
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

  private setCheckpointPlacementMessage(message: string | null): void {
    this.checkpointPlacementMessage = message;
    const element = this.root.querySelector<HTMLElement>('[data-checkpoint-inline-message]');
    if (!element) return;
    element.textContent = message ?? '';
    element.hidden = !message;
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
