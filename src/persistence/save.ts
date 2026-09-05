import { gzipSync, gunzipSync, strFromU8, strToU8 } from 'fflate';
import { validateGameConfig } from '../core/config';
import { validateInvariants } from '../core/invariants';
import {
  FIXED_MAP_HEIGHT,
  FIXED_MAP_ID,
  FIXED_MAP_WIDTH,
  initialZombiePositionsMatchSeed,
  initialHunterPositionsMatchSeed,
  validateFixedMap,
} from '../core/map';
import { GAME_VERSION } from '../core/state';
import type { GameState, JsonValue } from '../core/types';

/** The sole game-rules version accepted by v1.5.1 saves. */
export const CURRENT_GAME_VERSION = GAME_VERSION;
export const SAVE_GAME_VERSION = CURRENT_GAME_VERSION;
export const SAVE_FORMAT = 'nowhere-left-to-hide-save';
export const SAVE_FORMAT_VERSION = 11;
/** v1.5.1 never writes to an earlier autosave namespace. */
export const DEFAULT_AUTOSAVE_KEY = 'nowhere-left-to-hide:auto-save:v11';
/** Read-only compatibility probe for the immediately preceding autosave namespace. */
export const LEGACY_AUTOSAVE_KEY = 'nowhere-left-to-hide:auto-save:v10';
const OLDER_AUTOSAVE_KEYS = [
  'nowhere-left-to-hide:auto-save:v9',
  'nowhere-left-to-hide:auto-save:v8',
  'nowhere-left-to-hide:auto-save:v7',
  'nowhere-left-to-hide:auto-save:v6',
  'nowhere-left-to-hide:auto-save:v5',
  'nowhere-left-to-hide:auto-save:v4',
  'nowhere-left-to-hide:auto-save:v3',
  'nowhere-left-to-hide:auto-save:v2',
] as const;
/** Deprecated metadata exports. They are never migration targets in v1.5.1. */
export const V125_GAME_VERSION = '1.2.0';
export const V126_GAME_VERSION = '1.2.1';
export const LEGACY_GAME_VERSION = V125_GAME_VERSION;

export interface SaveEnvelope {
  format: typeof SAVE_FORMAT;
  formatVersion: typeof SAVE_FORMAT_VERSION;
  gameVersion: string;
  mapId: string;
  seed: number;
  state: GameState;
  checksum: string;
}

export interface SaveValidationResult {
  valid: boolean;
  errors: string[];
  state: GameState | null;
  envelope: SaveEnvelope | null;
  /** Retained for UI compatibility; v1.3 never migrates an older save. */
  migrated?: false;
}

export interface SaveOperationResult {
  ok: boolean;
  code: string | null;
  error: string | null;
  /** Optional synchronous save timings for profiling and diagnostics. */
  timing?: SaveTiming;
}

export interface SaveTiming {
  validationMs: number;
  normalizationMs: number;
  checksumMs: number;
  gzipMs: number;
  base64Ms: number;
  storageWriteMs?: number;
  totalMs: number;
  normalizedBytes: number;
  compressedBytes: number;
  codeChars: number;
}

export interface SaveEncodingMeasurement {
  code: string;
  timing: SaveTiming;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export type SaveErrorListener = (message: string, error?: unknown) => void;

const BASE_TERRAINS = ['plain', 'forest', 'mountain', 'water'] as const;
const UNIT_TYPES = ['police', 'nationalGuard', 'riotPolice', 'zombie', 'hordeZombie', 'policeZombie', 'soldierZombie', 'riotZombie', 'hunterZombie'] as const;
const HUMAN_UNIT_TYPES = ['police', 'nationalGuard', 'riotPolice'] as const;
const ZOMBIE_UNIT_TYPES = ['zombie', 'hordeZombie', 'policeZombie', 'soldierZombie', 'riotZombie', 'hunterZombie'] as const;
const FACILITY_TYPES = [
  'capital',
  'city',
  'farm',
  'civilianFactory',
  'militaryFactory',
  'refinery',
  'powerPlant',
  'windPowerPlant',
  'simpleFarm',
  'civilianDroneBase',
] as const;
const CONSTRUCTIBLE_FACILITY_TYPES = ['simpleFarm', 'civilianDroneBase'] as const;
const FACILITY_STATUSES = ['unowned', 'owned', 'ruined'] as const;
const FACILITY_OPERATIONAL_STATUSES = [
  'building',
  'operational',
  'stopped',
  'infected',
  'disabled',
  'recovering',
  'ruined',
] as const;
const CHECKPOINT_STATUSES = ['operational', 'remnant', 'ruined', 'abandoned'] as const;
const CHECKPOINT_POLICIES = ['passThrough', 'normal', 'strict'] as const;
const CARDINAL_DIRECTIONS = ['north', 'east', 'south', 'west'] as const;
const GAME_PHASES = ['player', 'economy', 'refugees', 'infection', 'zombie', 'horde', 'gameOver'] as const;
const GAME_OVER_REASONS = ['capitalLost', 'healthyCiviliansLost', 'stateSecured', 'abandoned', 'error'] as const;
const GAME_EVENT_TYPES = [
  'unit_moved',
  'unit_recovered',
  'interception',
  'attack',
  'damage',
  'unit_destroyed',
  'facility_captured',
  'workers_assigned',
  'population_transferred',
  'population_conscripted',
  'resource_produced',
  'resource_consumed',
  'resource_shortage',
  'refugees_arrived',
  'refugees_screened',
  'latent_infection',
  'infection_spread',
  'site_infection_started',
  'infection_suppressed',
  'facility_overrun',
  'site_fallen',
  'site_zombies_spawned',
  'site_immediate_infection',
  'site_chain_fallen',
  'site_noise_respawn',
  'facility_recovered',
  'checkpoint_built',
  'checkpoint_relocated',
  'checkpoint_remnant_created',
  'checkpoint_removed',
  'checkpoint_abandoned',
  'checkpoint_recovered',
  'checkpoint_activated',
  'checkpoint_fallback',
  'checkpoint_role_changed',
  'supply_changed',
  'supply_action_rejected',
  'power_supply_changed',
  'power_allocated',
  'constructible_built',
  'facility_disabled',
  'terrain_defense_applied',
  'enemy_spotted',
  'enemy_lost',
  'aerial_enemy_discovered',
  'zombie_idle',
  'horde_target_inherited',
  'horde_target_cleared',
  'noise_emitted',
  'noise_targeted',
  'noise_target_reached',
  'noise_target_overridden',
  'unit_promoted',
  'unit_promotion_pending',
  'unit_kill_credited',
  'attack_charge_consumed',
  'riot_police_commissioned',
  'victory_progress_changed',
  'horde_warning',
  'horde_spawned',
  'checkpoint_refugees_turned_away',
  'checkpoint_refugees_rejected',
  'horde_rejected_bonus_applied',
  'refugee_arrivals_ended',
  'constructible_decommissioned',
  'human_unit_reanimated',
  'game_over',
] as const;
const HORDE_KINDS = ['periodic', 'final'] as const;
const HORDE_WARNING_TYPES = ['periodic', 'final', 'none'] as const;
const FINAL_HORDE_STATUSES = ['notStarted', 'active', 'defeated'] as const;
const STATISTIC_INTEGER_FIELDS = [
  'maxPopulation',
  'maxSecuredFacilities',
  'civilianLosses',
  'unitLosses',
  'infectionLosses',
  'resourceShortageLosses',
  'hordeInterceptions',
  'unmanagedPassThrough',
  'refugeesAccepted',
  'refugeesDeparted',
  'checkpointsBuilt',
  'checkpointsRelocated',
  'checkpointRetreats',
  'checkpointsRuined',
  'checkpointsRecovered',
  'checkpointsAbandoned',
  'checkpointsRemoved',
  'unmanagedBranchTurns',
  'maxSuppliedFacilities',
  'maxSupplyRadius',
  'supplyLosses',
  'supplyRejections',
  'finalHordeSpawned',
  'finalHordeKilled',
  'periodicHordeZombiesSpawned',
  'periodicNormalZombiesSpawned',
  'finalHordeZombiesSpawned',
  'finalNormalZombiesSpawned',
  'normalZombiesKilled',
  'hordeZombiesKilled',
  'maxVisibleZombies',
  'turnsAfterFinalHorde',
  'urbanDefenseApplications',
  'urbanDefenseDamagePrevented',
  'forestDefenseApplications',
  'forestDefenseDamagePrevented',
  'normalZombieIdleCount',
  'hordeTargetInheritedCount',
  'hordeTargetClearedCount',
  'standbyCheckpointsCreated',
  'dormantCheckpointsCreated',
  'checkpointActivations',
  'checkpointFallbacks',
  'checkpointFallbacksFromStandby',
  'checkpointFallbacksFromDormant',
  'checkpointFallbacksPreventingUnmanagedArrival',
  'maxCheckpointPostsPerBranch',
  'maxPreparedCheckpointPostsPerBranch',
  'activeCheckpointLosses',
  'noisePulsesEmitted',
  'policeNoisePulses',
  'nationalGuardNoisePulses',
  'normalZombiesNoiseTargeted',
  'noiseTargetsReached',
  'noiseTargetsOverriddenByHorde',
  'noiseTargetsOverriddenByVisiblePopulation',
  'initialNormalZombies',
  'fallenSitesTriggeredByNoise',
  'noiseRespawnAttempts',
  'noiseRespawnZombiesSpawned',
  'infectedPopulationConvertedToZombies',
  'unspawnedInfectedPopulation',
  'immediateInfectionsFromSpawn',
  'chainOverruns',
  'maximumOverrunChainLength',
  'constructibleInfectedDeaths',
  'groundVisionPotentialHexes',
  'groundVisionVisibleHexes',
  'groundVisionBlockedHexes',
  'maxGroundVisionBlockedHexes',
  'cumulativeGroundVisionBlockedHexes',
  'groundVisionSamples',
  'civilianDroneBasesBuilt',
  'maxCivilianDroneVisionRadius',
  'aerialDiscoveriesInGroundBlockedArea',
  'checkpointQueueFoodDemand',
  'checkpointQueueCivilianGoodsDemand',
  'checkpointQueueFoodConsumed',
  'checkpointQueueCivilianGoodsConsumed',
  'policeZombiesSpawned',
  'soldierZombiesSpawned',
  'policeZombiesKilled',
  'soldierZombiesKilled',
  'policeZombiesFinal',
  'soldierZombiesFinal',
  'riotZombiesFinal',
  'hunterZombiesFinal',
  'policeReanimations',
  'nationalGuardReanimations',
  'reanimationImmediateInfections',
  'reanimationFacilityInfections',
  'reanimationCheckpointInfections',
  'reanimationSiteFalls',
  'reanimationChainOverruns',
  'preventedRefugeeArrivalsAfterFinal',
  'civilianDroneBasesDecommissioned',
  'civilianGoodsRefundedFromDecommission',
  'policeLongRangeMoves',
  'riotPoliceProduced',
  'riotPoliceLost',
  'riotZombiesSpawned',
  'hunterZombiesSpawned',
  'riotZombiesKilled',
  'hunterZombiesKilled',
  'riotPoliceReanimations',
  'hordeMovementNoisePulses',
] as const;
const STATISTIC_NULLABLE_FIELDS = [
  'suppliedAreaZombieClearTurn',
  'suppliedAreaInfectionClearTurn',
  'victoryTurn',
] as const;
const STATISTIC_RECORD_FIELDS = [
  'refugeeArrivalsByBranch',
  'refugeesScreenedByPolicy',
  'terrainEntriesByType',
  'checkpointFallbacksByBranch',
  'refugeesRejectedByDirectionAndPolicy',
  'refugeesTurnedAwayByDirection',
  'rejectedBonusZombiesByDirection',
  'rejectedCounterResetsByDirection',
  'recruitsCommissionedByType',
  'regularPromotionsByType',
  'veteranPromotionsByType',
  'veteranZombieKillsByType',
  'hordeSpecialSpawnedByType',
  'finalSpecialZombiesSpawnedByType',
  'noisePulsesBySourceType',
  'hordeNoiseRespawnedByType',
] as const;
const REQUIRED_STATISTIC_FIELDS = [
  ...STATISTIC_INTEGER_FIELDS,
  'finalHordeDefeated',
  ...STATISTIC_NULLABLE_FIELDS,
  ...STATISTIC_RECORD_FIELDS,
] as const;
const REQUIRED_STATE_FIELDS = [
  'gameVersion',
  'config',
  'seed',
  'rngState',
  'turn',
  'finalHordeTurn',
  'actionsTakenThisTurn',
  'phase',
  'mapId',
  'map',
  'facilities',
  'population',
  'initialHunterPositions',
  'cityPopulationSnapshot',
  'resources',
  'units',
  'checkpoints',
  'roadBranches',
  'rejectedRefugeesByDirection',
  'pendingNoisePulses',
  'pendingUnitProductions',
  'nextCheckpointNumber',
  'nextConstructibleFacilityNumber',
  'nextUnitNumber',
  'nextEventNumber',
  'nextAssignmentOrder',
  'horde',
  'events',
  'statistics',
  'gameOver',
  'result',
] as const;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof globalThis.btoa === 'function') {
    let binary = '';
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return globalThis.btoa(binary);
  }
  const nodeBuffer = (globalThis as unknown as {
    Buffer?: { from(data: Uint8Array): { toString(encoding: string): string } };
  }).Buffer;
  if (nodeBuffer) return nodeBuffer.from(bytes).toString('base64');
  throw new Error('Base64 encoder is unavailable in this environment');
}

function base64ToBytes(value: string): Uint8Array {
  if (typeof globalThis.atob === 'function') {
    const binary = globalThis.atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  }
  const nodeBuffer = (globalThis as unknown as {
    Buffer?: { from(data: string, encoding: string): Uint8Array };
  }).Buffer;
  if (nodeBuffer) return nodeBuffer.from(value, 'base64');
  throw new Error('Base64 decoder is unavailable in this environment');
}

function toBase64Url(value: Uint8Array): string {
  return bytesToBase64(value).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function fromBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error('Save code contains an invalid Base64URL character');
  return base64ToBytes(
    value.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(value.length / 4) * 4, '='),
  );
}

/** Small deterministic checksum for accidental corruption detection. */
export function checksum(value: string): string {
  let hash = 0x811c9dc5;
  for (const byte of utf8(value)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function envelopePayload(envelope: Omit<SaveEnvelope, 'checksum'>): string {
  return canonicalJson(envelope);
}

function makeEnvelope(state: GameState): SaveEnvelope {
  const payload: Omit<SaveEnvelope, 'checksum'> = {
    format: SAVE_FORMAT,
    formatVersion: SAVE_FORMAT_VERSION,
    gameVersion: state.gameVersion,
    mapId: state.mapId,
    seed: state.seed,
    state: clone(state),
  };
  return { ...payload, checksum: checksum(envelopePayload(payload)) };
}

function isInteger(value: unknown, minimum = 0): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum;
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function isUint32(value: unknown): value is number {
  return isInteger(value) && value <= 0xffffffff;
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isRecord(value) && Object.values(value).every(isJsonValue);
}

function uniqueErrors(errors: string[]): string[] {
  return [...new Set(errors)];
}

function incompatibilityError(found: unknown, subject: string): string {
  return `${subject} is incompatible with v1.4.5 or earlier / Game Rules ${CURRENT_GAME_VERSION} / Save Format ${SAVE_FORMAT_VERSION} (found ${String(found)}; expected ${CURRENT_GAME_VERSION}). 現在のゲーム状態は変更されません。旧Saveは変換・削除・上書きされません。`;
}

function reject(errors: string[]): SaveValidationResult {
  return { valid: false, errors: uniqueErrors(errors), state: null, envelope: null };
}

function requireFields(errors: string[], value: Record<string, unknown>, path: string, fields: readonly string[]): void {
  for (const field of fields) if (!hasOwn(value, field)) errors.push(`${path}.${field} is required for Save Format ${SAVE_FORMAT_VERSION}`);
}

function validateCoordinate(
  errors: string[],
  value: unknown,
  path: string,
  width = FIXED_MAP_WIDTH,
  height = FIXED_MAP_HEIGHT,
): void {
  if (
    !isRecord(value) ||
    !isInteger(value.q) ||
    !isInteger(value.r) ||
    value.q >= width ||
    value.r >= height
  ) {
    errors.push(`${path} must be an in-bounds axial coordinate`);
  }
}

function validateHordeConfigShape(value: unknown, finalHordeTurn: unknown, errors: string[]): void {
  if (!isRecord(value)) {
    errors.push('state.config.horde must be an object');
    return;
  }
  requireFields(errors, value, 'state.config.horde', ['warningLeadTurns', 'waves', 'specialZombieWeights', 'riotZombieCapPerDirection', 'hunterZombieCapPerDirection', 'movementNoiseRadius']);
  for (const retiredField of ['cycle', 'periodicInitial', 'periodicIncrement', 'warningStartTurn', 'spawnOnlyBeforeFinalTurn', 'finalComposition']) {
    if (hasOwn(value, retiredField)) errors.push(`state.config.horde.${retiredField} is obsolete; use horde.waves`);
  }
  if (!isInteger(value.warningLeadTurns, 1)) errors.push('state.config.horde.warningLeadTurns is invalid');
  const waves = value.waves;
  if (!Array.isArray(waves) || waves.length === 0) {
    errors.push('state.config.horde.waves must contain at least one Wave');
    return;
  }

  let previousTurn = 0;
  let finalWaveTurn: number | null = null;
  waves.forEach((wave, index) => {
    const path = `state.config.horde.waves[${index}]`;
    if (!isRecord(wave)) {
      errors.push(`${path} must be an object`);
      return;
    }
    requireFields(errors, wave, path, ['turn', 'directionCount', 'compositionPerDirection', 'final']);
    if (!isInteger(wave.turn, 1)) errors.push(`${path}.turn is invalid`);
    if (!isInteger(wave.directionCount, 1) || wave.directionCount > 4) errors.push(`${path}.directionCount is invalid`);
    if (!isRecord(wave.compositionPerDirection)) {
      errors.push(`${path}.compositionPerDirection must be an object`);
    } else {
      const composition = wave.compositionPerDirection;
      requireFields(errors, composition, `${path}.compositionPerDirection`, ['hordeZombie', 'zombie']);
      if (!isInteger(composition.hordeZombie) || !isInteger(composition.zombie)) {
        errors.push(`${path}.compositionPerDirection is invalid`);
      } else if (composition.hordeZombie + composition.zombie < 1) {
        errors.push(`${path}.compositionPerDirection must contain at least one unit`);
      } else if (composition.zombie > 0 && composition.hordeZombie === 0) {
        errors.push(`${path}.compositionPerDirection cannot contain Normal Zombies without a Horde Zombie`);
      }
    }
    if (typeof wave.final !== 'boolean') errors.push(`${path}.final is invalid`);
    if (isInteger(wave.turn, 1) && wave.turn <= previousTurn) errors.push(`${path}.turn must be strictly increasing`);
    if (isInteger(wave.turn, 1)) previousTurn = wave.turn;
    if (wave.final === true) {
      if (index !== waves.length - 1 || finalWaveTurn !== null) errors.push(`${path}.final is invalid`);
      if (isInteger(wave.turn, 1)) finalWaveTurn = wave.turn;
    }
  });
  if (finalWaveTurn === null) errors.push('state.config.horde.waves must end with one Final Wave');
  if (finalWaveTurn !== null && finalHordeTurn !== finalWaveTurn) errors.push('state.finalHordeTurn must match the configured Final Wave');
}

function hasCanonicalDirectionOrder(directions: unknown[]): boolean {
  let lastIndex = -1;
  for (const direction of directions) {
    const index = CARDINAL_DIRECTIONS.indexOf(direction as typeof CARDINAL_DIRECTIONS[number]);
    if (index < 0 || index <= lastIndex) return false;
    lastIndex = index;
  }
  return true;
}

/**
 * Reject obsolete or partial pre-v1.5.1 container shapes before casting. The core
 * invariant checker performs relational validation; this guard makes the Wave
 * schedule, reserved map perimeter, and warning state an explicit save
 * boundary instead of silently accepting a partial snapshot.
 */
function validateV144Shape(state: Record<string, unknown>, errors: string[]): void {
  requireFields(errors, state, 'state', REQUIRED_STATE_FIELDS);
  if (hasOwn(state, 'maxTurns')) errors.push('state.maxTurns is obsolete; use state.finalHordeTurn');
  if (state.gameVersion !== CURRENT_GAME_VERSION) errors.push(incompatibilityError(state.gameVersion, 'state.gameVersion'));
  if (!isSafeInteger(state.seed)) errors.push('state.seed must be a safe integer');
  if (!isInteger(state.turn, 1)) errors.push('state.turn must be a positive integer');
  if (!isInteger(state.finalHordeTurn, 1)) errors.push('state.finalHordeTurn must be a positive integer');
  if (!isInteger(state.actionsTakenThisTurn)) errors.push('state.actionsTakenThisTurn must be a non-negative integer');
  if (!GAME_PHASES.includes(state.phase as typeof GAME_PHASES[number])) errors.push('state.phase is invalid');
  if (state.mapId !== FIXED_MAP_ID) errors.push(`state.mapId must be ${FIXED_MAP_ID}`);

  const rngState = state.rngState;
  if (!isRecord(rngState)) {
    errors.push('state.rngState must be an object');
  } else {
    requireFields(errors, rngState, 'state.rngState', ['algorithm', 'seed', 'state', 'calls']);
    if (rngState.algorithm !== 'xorshift32-v1') errors.push('state.rngState.algorithm is invalid');
    if (!isUint32(rngState.seed)) errors.push('state.rngState.seed must be an unsigned 32-bit integer');
    if (!isUint32(rngState.state)) errors.push('state.rngState.state must be an unsigned 32-bit integer');
    if (!isInteger(rngState.calls)) errors.push('state.rngState.calls must be a non-negative integer');
    if (isSafeInteger(state.seed) && rngState.seed !== (state.seed >>> 0)) errors.push('state.rngState.seed must match the uint32 form of state.seed');
  }

  const config = state.config;
  if (!isRecord(config)) {
    errors.push('state.config must be an object');
  } else {
    requireFields(errors, config, 'state.config', [
      'version',
      'mapId',
      'maxActionsPerTurn',
      'units',
      'unitExperience',
      'facilities',
      'economy',
      'initialFacilityPopulation',
      'naturalRecovery',
      'horde',
      'refugees',
      'infection',
      'checkpoint',
      'constructibleFacility',
      'terrain',
      'vision',
    ]);
    if (hasOwn(config, 'maxTurns')) errors.push('state.config.maxTurns is obsolete; use horde.waves');
    if (hasOwn(config, 'finalHordeTurn')) errors.push('state.config.finalHordeTurn is obsolete; derive it from the Final Wave');
    if (config.version !== CURRENT_GAME_VERSION) errors.push(incompatibilityError(config.version, 'state.config.version'));
    if (config.mapId !== FIXED_MAP_ID) errors.push(`state.config.mapId must be ${FIXED_MAP_ID}`);
    validateHordeConfigShape(config.horde, state.finalHordeTurn, errors);
    const infection = config.infection;
    if (!isRecord(infection)) {
      errors.push('state.config.infection must be an object');
    } else {
      // Save Format 11 deliberately has no conversion path for the old
      // fallback-capacity tuning. Reject a hand-edited v1.4.3-shaped
      // container even when its outer version strings were forged as current.
      for (const retiredField of ['fallBackCapacityRate', 'fallBackCapacityRounding']) {
        if (hasOwn(infection, retiredField)) {
          errors.push(`state.config.infection.${retiredField} is obsolete in Game Rules ${CURRENT_GAME_VERSION}`);
        }
      }
    }
  }

  const map = state.map;
  if (!isRecord(map)) {
    errors.push('state.map must be an object');
  } else {
    requireFields(errors, map, 'state.map', [
      'id',
      'width',
      'height',
      'tiles',
      'roadTiles',
      'facilities',
      'hordeEntrances',
      'hordeSpawnReserve',
      'roadBranches',
      'initialZombiePositions',
    ]);
    if (map.id !== FIXED_MAP_ID) errors.push(`state.map.id must be ${FIXED_MAP_ID}`);
    if (map.width !== FIXED_MAP_WIDTH || map.height !== FIXED_MAP_HEIGHT) errors.push(`state.map must be exactly ${FIXED_MAP_WIDTH}x${FIXED_MAP_HEIGHT}`);
    if (!Array.isArray(map.tiles)) {
      errors.push('state.map.tiles must be an array');
    } else {
      for (const [index, tile] of map.tiles.entries()) {
        const path = `state.map.tiles[${index}]`;
        if (!isRecord(tile)) {
          errors.push(`${path} must be an object`);
          continue;
        }
        requireFields(errors, tile, path, ['key', 'q', 'r', 'terrain', 'road', 'movementCost', 'facilityId', 'hordeEntranceDirections', 'playerOccupancyAllowed']);
        validateCoordinate(errors, tile, path, FIXED_MAP_WIDTH, FIXED_MAP_HEIGHT);
        if (!BASE_TERRAINS.includes(tile.terrain as typeof BASE_TERRAINS[number])) errors.push(`${path}.terrain is invalid`);
        if (typeof tile.road !== 'boolean') errors.push(`${path}.road is invalid`);
        if (tile.movementCost !== null && !isInteger(tile.movementCost, 1)) errors.push(`${path}.movementCost is invalid`);
        if (tile.facilityId !== null && (typeof tile.facilityId !== 'string' || tile.facilityId.length === 0)) errors.push(`${path}.facilityId is invalid`);
        if (!Array.isArray(tile.hordeEntranceDirections) || tile.hordeEntranceDirections.some((direction) => !CARDINAL_DIRECTIONS.includes(direction as typeof CARDINAL_DIRECTIONS[number]))) errors.push(`${path}.hordeEntranceDirections is invalid`);
        if (typeof tile.playerOccupancyAllowed !== 'boolean') errors.push(`${path}.playerOccupancyAllowed is invalid`);
      }
    }
    if (!Array.isArray(map.roadTiles)) errors.push('state.map.roadTiles must be an array');
    if (!Array.isArray(map.facilities)) errors.push('state.map.facilities must be an array');
    if (!Array.isArray(map.hordeEntrances)) errors.push('state.map.hordeEntrances must be an array');
    if (!Array.isArray(map.hordeSpawnReserve)) {
      errors.push('state.map.hordeSpawnReserve must be an array');
    } else {
      for (const [index, position] of map.hordeSpawnReserve.entries()) {
        validateCoordinate(errors, position, `state.map.hordeSpawnReserve[${index}]`, FIXED_MAP_WIDTH, FIXED_MAP_HEIGHT);
      }
    }
    if (!Array.isArray(map.roadBranches)) errors.push('state.map.roadBranches must be an array');
    if (!Array.isArray(map.initialZombiePositions)) errors.push('state.map.initialZombiePositions must be an array');
  }

  const population = state.population;
  if (!isRecord(population)) {
    errors.push('state.population must be an object');
  } else {
    const fields = [
      'initialPopulation',
      'cityResidents',
      'productionWorkers',
      'healthyCivilians',
      'police',
      'nationalGuard',
      'riotPolice',
      'unitPopulation',
      'facilityWorkers',
      'waitingRefugees',
      'screeningRefugees',
      'approvedRefugees',
      'facilityInfected',
      'checkpointInfected',
      'cumulativeDeaths',
      'cumulativeArrivals',
      'cumulativeDepartures',
      'cumulativeDiscoveredInfected',
    ] as const;
    requireFields(errors, population, 'state.population', fields);
    for (const field of fields) {
      if (field !== 'facilityWorkers' && !isInteger(population[field])) errors.push(`state.population.${field} is invalid`);
    }
    if (!Array.isArray(population.facilityWorkers)) {
      errors.push('state.population.facilityWorkers must be an array');
    } else {
      for (const [index, entry] of population.facilityWorkers.entries()) {
        if (!isRecord(entry) || typeof entry.facilityId !== 'string' || !isInteger(entry.workers)) errors.push(`state.population.facilityWorkers[${index}] is invalid`);
      }
    }
  }

  const citySnapshot = state.cityPopulationSnapshot;
  if (!isRecord(citySnapshot)) {
    errors.push('state.cityPopulationSnapshot must be an object');
  } else {
    requireFields(errors, citySnapshot, 'state.cityPopulationSnapshot', ['turn', 'supply', 'reception']);
    if (!isInteger(citySnapshot.turn, 1) || citySnapshot.turn !== state.turn) errors.push('state.cityPopulationSnapshot.turn must match state.turn');
    for (const field of ['supply', 'reception'] as const) {
      if (!Array.isArray(citySnapshot[field])) {
        errors.push(`state.cityPopulationSnapshot.${field} must be an array`);
      } else {
        for (const [index, entry] of citySnapshot[field].entries()) {
          if (!isRecord(entry) || typeof entry.facilityId !== 'string' || !isInteger(entry.population) || typeof entry.eligible !== 'boolean') errors.push(`state.cityPopulationSnapshot.${field}[${index}] is invalid`);
        }
      }
    }
  }

  const resources = state.resources;
  if (!isRecord(resources)) {
    errors.push('state.resources must be an object');
  } else {
    requireFields(errors, resources, 'state.resources', ['food', 'civilianGoods', 'militaryGoods', 'fuel', 'electricityCapacity', 'electricityRequired']);
    for (const resource of ['food', 'civilianGoods', 'militaryGoods', 'fuel', 'electricityCapacity', 'electricityRequired'] as const) if (!isInteger(resources[resource])) errors.push(`state.resources.${resource} is invalid`);
  }

  const facilities = state.facilities;
  if (!Array.isArray(facilities)) {
    errors.push('state.facilities must be an array');
  } else {
    for (const [index, facility] of facilities.entries()) {
      const path = `state.facilities[${index}]`;
      if (!isRecord(facility)) {
        errors.push(`${path} must be an object`);
        continue;
      }
      requireFields(errors, facility, path, [
        'id',
        'type',
        'nameKey',
        'position',
        'workerCapacity',
        'startingOwned',
        'startingWorkers',
        'startingInfected',
        'owner',
        'status',
        'operationalStatus',
        'workers',
        'infected',
        'securedOrder',
        'lastAssignedOrder',
        'populationOperationalTurn',
        'powerSupplyEnabled',
        'lastPowerSupplied',
        'constructible',
        'builtTurn',
        'recoveryOperationalTurn',
      ]);
      if (typeof facility.id !== 'string' || facility.id.length === 0) errors.push(`${path}.id is invalid`);
      if (!FACILITY_TYPES.includes(facility.type as typeof FACILITY_TYPES[number])) errors.push(`${path}.type is invalid`);
      if (typeof facility.nameKey !== 'string') errors.push(`${path}.nameKey is invalid`);
      validateCoordinate(errors, facility.position, `${path}.position`);
      for (const field of ['workerCapacity', 'startingWorkers', 'startingInfected', 'workers', 'infected', 'lastAssignedOrder'] as const) if (!isInteger(facility[field])) errors.push(`${path}.${field} is invalid`);
      if (typeof facility.startingOwned !== 'boolean') errors.push(`${path}.startingOwned is invalid`);
      if (facility.securedOrder !== null && !isInteger(facility.securedOrder)) errors.push(`${path}.securedOrder is invalid`);
      if (!FACILITY_STATUSES.includes(facility.status as typeof FACILITY_STATUSES[number])) errors.push(`${path}.status is invalid`);
      if (!FACILITY_OPERATIONAL_STATUSES.includes(facility.operationalStatus as typeof FACILITY_OPERATIONAL_STATUSES[number])) errors.push(`${path}.operationalStatus is invalid`);
      if (facility.owner !== 'player' && facility.owner !== 'none') errors.push(`${path}.owner is invalid`);
      if (!isInteger(facility.populationOperationalTurn, 1)) errors.push(`${path}.populationOperationalTurn is invalid`);
      if (typeof facility.powerSupplyEnabled !== 'boolean') errors.push(`${path}.powerSupplyEnabled is invalid`);
      if (facility.lastPowerSupplied !== null && typeof facility.lastPowerSupplied !== 'boolean') errors.push(`${path}.lastPowerSupplied is invalid`);
      if (typeof facility.constructible !== 'boolean') errors.push(`${path}.constructible is invalid`);
      if (facility.builtTurn !== null && !isInteger(facility.builtTurn, 1)) errors.push(`${path}.builtTurn is invalid`);
      if (facility.recoveryOperationalTurn !== null && !isInteger(facility.recoveryOperationalTurn, 1)) errors.push(`${path}.recoveryOperationalTurn is invalid`);
      if (CONSTRUCTIBLE_FACILITY_TYPES.includes(facility.type as typeof CONSTRUCTIBLE_FACILITY_TYPES[number]) !== (facility.constructible === true)) errors.push(`${path}.constructible does not match its facility type`);
      if (facility.constructible && facility.builtTurn === null) errors.push(`${path}.constructible facilities require builtTurn`);
      if (!facility.constructible && facility.builtTurn !== null) errors.push(`${path}.fixed facilities cannot have builtTurn`);
    }
  }

  const units = state.units;
  if (!Array.isArray(units)) {
    errors.push('state.units must be an array');
  } else {
    for (const [index, unit] of units.entries()) {
      const path = `state.units[${index}]`;
      if (!isRecord(unit)) {
        errors.push(`${path} must be an object`);
        continue;
      }
      requireFields(errors, unit, path, [
        'id',
        'type',
        'position',
        'hp',
        'maxHp',
        'attack',
        'movement',
        'range',
        'vision',
        'population',
        'proficiency',
        'recruitSurvivalTurns',
        'regularZombieKills',
        'veteranPromotionPending',
        'attackChargesRemaining',
        'maxAttackCharges',
        'currentFuel',
        'maxFuel',
        'currentMilitaryGoods',
        'maxMilitaryGoods',
        'actionState',
        'canAttack',
        'canMove',
        'isPlayerUnit',
        'inheritedTarget',
        'noiseTarget',
        'spawnGroupId',
        'hordeKind',
        'activity',
      ]);
      if (typeof unit.id !== 'string' || unit.id.length === 0) errors.push(`${path}.id is invalid`);
      if (!UNIT_TYPES.includes(unit.type as typeof UNIT_TYPES[number])) errors.push(`${path}.type is invalid`);
      validateCoordinate(errors, unit.position, `${path}.position`);
      for (const field of ['hp', 'maxHp', 'attack', 'movement', 'range', 'vision', 'population', 'currentFuel', 'maxFuel', 'currentMilitaryGoods', 'maxMilitaryGoods'] as const) if (!isInteger(unit[field])) errors.push(`${path}.${field} is invalid`);
      for (const field of ['recruitSurvivalTurns', 'regularZombieKills', 'attackChargesRemaining', 'maxAttackCharges'] as const) if (!isInteger(unit[field])) errors.push(`${path}.${field} is invalid`);
      if (typeof unit.veteranPromotionPending !== 'boolean') errors.push(`${path}.veteranPromotionPending is invalid`);
      if (isInteger(unit.currentFuel) && isInteger(unit.maxFuel) && unit.currentFuel > unit.maxFuel) errors.push(`${path}.currentFuel exceeds maxFuel`);
      if (isInteger(unit.currentMilitaryGoods) && isInteger(unit.maxMilitaryGoods) && unit.currentMilitaryGoods > unit.maxMilitaryGoods) errors.push(`${path}.currentMilitaryGoods exceeds maxMilitaryGoods`);
      const configuredUnit = isRecord(config) && isRecord(config.units)
        ? config.units[unit.type as string]
        : undefined;
      if (isRecord(configuredUnit) && isInteger(configuredUnit.maxFuel) && unit.maxFuel !== configuredUnit.maxFuel) errors.push(`${path}.maxFuel must match state.config.units.${String(unit.type)}.maxFuel`);
      if (isRecord(configuredUnit) && isInteger(configuredUnit.maxMilitaryGoods) && unit.maxMilitaryGoods !== configuredUnit.maxMilitaryGoods) errors.push(`${path}.maxMilitaryGoods must match state.config.units.${String(unit.type)}.maxMilitaryGoods`);
      if (ZOMBIE_UNIT_TYPES.includes(unit.type as typeof ZOMBIE_UNIT_TYPES[number])) {
        if (unit.currentFuel !== 0 || unit.maxFuel !== 0) errors.push(`${path} Zombie Fuel must be zero`);
        if (unit.currentMilitaryGoods !== 0 || unit.maxMilitaryGoods !== 0) errors.push(`${path} Zombie Military Goods must be zero`);
        if (unit.proficiency !== null || unit.recruitSurvivalTurns !== 0 || unit.regularZombieKills !== 0 || unit.veteranPromotionPending !== false) errors.push(`${path} Zombie proficiency must be empty`);
      } else if (!HUMAN_UNIT_TYPES.includes(unit.type as typeof HUMAN_UNIT_TYPES[number])
        || (isInteger(unit.maxFuel) && unit.maxFuel < 1)
        || (isInteger(unit.maxMilitaryGoods) && unit.maxMilitaryGoods < 1)) {
        errors.push(`${path} human unit capacity is invalid`);
      } else if (!['recruit', 'regular', 'veteran'].includes(unit.proficiency as string)) {
        errors.push(`${path}.proficiency is invalid`);
      }
      if (!['ready', 'moved', 'acted', 'destroyed'].includes(unit.actionState as string)) errors.push(`${path}.actionState is invalid`);
      for (const field of ['canAttack', 'canMove', 'isPlayerUnit'] as const) if (typeof unit[field] !== 'boolean') errors.push(`${path}.${field} is invalid`);
      if (unit.inheritedTarget !== null) validateCoordinate(errors, unit.inheritedTarget, `${path}.inheritedTarget`);
      if (unit.noiseTarget !== null) validateCoordinate(errors, unit.noiseTarget, `${path}.noiseTarget`);
      if (unit.spawnGroupId !== null && (typeof unit.spawnGroupId !== 'string' || unit.spawnGroupId.length === 0)) errors.push(`${path}.spawnGroupId is invalid`);
      if (unit.hordeKind !== null && !HORDE_KINDS.includes(unit.hordeKind as typeof HORDE_KINDS[number])) errors.push(`${path}.hordeKind is invalid`);
      if (!isRecord(unit.activity)) {
        errors.push(`${path}.activity must be an object`);
      } else {
        requireFields(errors, unit.activity, `${path}.activity`, ['moved', 'attacked', 'intercepted', 'suppressed']);
        for (const field of ['moved', 'attacked', 'intercepted', 'suppressed'] as const) if (typeof unit.activity[field] !== 'boolean') errors.push(`${path}.activity.${field} is invalid`);
      }
    }
  }

  const checkpoints = state.checkpoints;
  if (!Array.isArray(checkpoints)) {
    errors.push('state.checkpoints must be an array');
  } else {
    for (const [index, checkpoint] of checkpoints.entries()) {
      const path = `state.checkpoints[${index}]`;
      if (!isRecord(checkpoint)) {
        errors.push(`${path} must be an object`);
        continue;
      }
      requireFields(errors, checkpoint, path, ['id', 'position', 'direction', 'status', 'waiting', 'screening', 'approved', 'remainingTurns', 'screeningPolicy', 'nextArrivalTurn', 'infected']);
      if (typeof checkpoint.id !== 'string' || checkpoint.id.length === 0) errors.push(`${path}.id is invalid`);
      validateCoordinate(errors, checkpoint.position, `${path}.position`);
      if (!CARDINAL_DIRECTIONS.includes(checkpoint.direction as typeof CARDINAL_DIRECTIONS[number])) errors.push(`${path}.direction is invalid`);
      if (checkpoint.branchId !== undefined && (typeof checkpoint.branchId !== 'string' || checkpoint.branchId.length === 0)) errors.push(`${path}.branchId is invalid`);
      if (!CHECKPOINT_STATUSES.includes(checkpoint.status as typeof CHECKPOINT_STATUSES[number])) errors.push(`${path}.status is invalid`);
      for (const field of ['waiting', 'screening', 'approved', 'remainingTurns', 'infected'] as const) if (!isInteger(checkpoint[field])) errors.push(`${path}.${field} is invalid`);
      if (!CHECKPOINT_POLICIES.includes(checkpoint.screeningPolicy as typeof CHECKPOINT_POLICIES[number])) errors.push(`${path}.screeningPolicy is invalid`);
      if (checkpoint.nextArrivalTurn !== null && !isInteger(checkpoint.nextArrivalTurn, 1)) errors.push(`${path}.nextArrivalTurn is invalid`);
      if (checkpoint.overrunProcessed !== undefined && typeof checkpoint.overrunProcessed !== 'boolean') errors.push(`${path}.overrunProcessed is invalid`);
    }
  }

  const branches = state.roadBranches;
  if (!Array.isArray(branches)) {
    errors.push('state.roadBranches must be an array');
  } else {
    for (const [index, branch] of branches.entries()) {
      const path = `state.roadBranches[${index}]`;
      if (!isRecord(branch)) {
        errors.push(`${path} must be an object`);
        continue;
      }
      requireFields(errors, branch, path, ['branchId', 'nextArrivalTurn', 'checkpointActionsThisTurn', 'activeCheckpointId', 'standbyCheckpointIds', 'currentPolicy', 'hasBuiltCheckpoint']);
      if (typeof branch.branchId !== 'string' || branch.branchId.length === 0) errors.push(`${path}.branchId is invalid`);
      if (branch.nextArrivalTurn !== null && !isInteger(branch.nextArrivalTurn, 1)) errors.push(`${path}.nextArrivalTurn is invalid`);
      if (!isInteger(branch.checkpointActionsThisTurn)) errors.push(`${path}.checkpointActionsThisTurn is invalid`);
      if (branch.activeCheckpointId !== null && (typeof branch.activeCheckpointId !== 'string' || branch.activeCheckpointId.length === 0)) errors.push(`${path}.activeCheckpointId is invalid`);
      if (!Array.isArray(branch.standbyCheckpointIds) || branch.standbyCheckpointIds.some((id) => typeof id !== 'string' || id.length === 0) || new Set(branch.standbyCheckpointIds).size !== branch.standbyCheckpointIds.length) errors.push(`${path}.standbyCheckpointIds is invalid`);
      if (!CHECKPOINT_POLICIES.includes(branch.currentPolicy as typeof CHECKPOINT_POLICIES[number])) errors.push(`${path}.currentPolicy is invalid`);
      if (typeof branch.hasBuiltCheckpoint !== 'boolean') errors.push(`${path}.hasBuiltCheckpoint is invalid`);
    }
  }

  const rejectedRefugees = state.rejectedRefugeesByDirection;
  if (!isRecord(rejectedRefugees)) {
    errors.push('state.rejectedRefugeesByDirection must be an object');
  } else {
    for (const direction of CARDINAL_DIRECTIONS) {
      const path = `state.rejectedRefugeesByDirection.${direction}`;
      const counters = rejectedRefugees[direction];
      if (!isRecord(counters)) {
        errors.push(`${path} must be an object`);
        continue;
      }
      requireFields(errors, counters, path, ['normalRejected', 'strictRejected', 'turnedAway']);
      for (const field of ['normalRejected', 'strictRejected', 'turnedAway'] as const) {
        if (!isInteger(counters[field])) errors.push(`${path}.${field} is invalid`);
      }
    }
  }

  const pending = state.pendingUnitProductions;
  if (!Array.isArray(pending)) {
    errors.push('state.pendingUnitProductions must be an array');
  } else {
    for (const [index, order] of pending.entries()) {
      const path = `state.pendingUnitProductions[${index}]`;
      if (!isRecord(order)) {
        errors.push(`${path} must be an object`);
        continue;
      }
      requireFields(errors, order, path, ['id', 'cityFacilityId', 'unitType', 'population', 'readyTurn']);
      if (typeof order.id !== 'string' || order.id.length === 0 || typeof order.cityFacilityId !== 'string' || order.cityFacilityId.length === 0) errors.push(`${path} identifiers are invalid`);
      if (!HUMAN_UNIT_TYPES.includes(order.unitType as typeof HUMAN_UNIT_TYPES[number])) errors.push(`${path}.unitType is invalid`);
      if (!isInteger(order.population) || !isInteger(order.readyTurn, 1)) errors.push(`${path}.population or readyTurn is invalid`);
    }
  }

  const pendingNoise = state.pendingNoisePulses;
  if (!Array.isArray(pendingNoise)) {
    errors.push('state.pendingNoisePulses must be an array');
  } else {
    for (const [index, pulse] of pendingNoise.entries()) {
      const path = `state.pendingNoisePulses[${index}]`;
      if (!isRecord(pulse)) {
        errors.push(`${path} must be an object`);
        continue;
      }
      requireFields(errors, pulse, path, ['id', 'center', 'radius', 'sourceKind', 'sourceUnitType', 'emittedTurn']);
      if (typeof pulse.id !== 'string' || pulse.id.length === 0) errors.push(`${path}.id is invalid`);
      validateCoordinate(errors, pulse.center, `${path}.center`);
      if (!isInteger(pulse.radius) || !isInteger(pulse.emittedTurn, 1)) errors.push(`${path}.radius or emittedTurn is invalid`);
      if (!['humanCombat', 'hordeMovement'].includes(pulse.sourceKind as string)) errors.push(`${path}.sourceKind is invalid`);
      if (!['police', 'nationalGuard', 'riotPolice', 'hordeZombie'].includes(pulse.sourceUnitType as string)) errors.push(`${path}.sourceUnitType is invalid`);
    }
  }

  for (const field of ['nextCheckpointNumber', 'nextConstructibleFacilityNumber', 'nextUnitNumber', 'nextEventNumber', 'nextAssignmentOrder'] as const) if (!isInteger(state[field], 1)) errors.push(`state.${field} must be a positive integer`);

  const horde = state.horde;
  if (!isRecord(horde)) {
    errors.push('state.horde must be an object');
  } else {
    requireFields(errors, horde, 'state.horde', ['nextWaveIndex', 'totalSpawned', 'warningDirections', 'turnsRemaining', 'nextSpawnTurn', 'lastSpawnTurn', 'warningType', 'spawnedWaveIndices', 'spawnGroupIdsByWave', 'finalHordeStatus', 'finalSpawnGroupIds', 'finalSpawnedCount']);
    for (const retiredField of ['spawnedCount', 'nextDirection', 'finalSpawnGroupId']) {
      if (hasOwn(horde, retiredField)) errors.push(`state.horde.${retiredField} is obsolete; use Wave Horde state`);
    }
    if (horde.nextWaveIndex !== null && !isInteger(horde.nextWaveIndex, 1)) errors.push('state.horde.nextWaveIndex is invalid');
    for (const field of ['totalSpawned', 'turnsRemaining', 'finalSpawnedCount'] as const) if (!isInteger(horde[field])) errors.push(`state.horde.${field} is invalid`);
    if (!Array.isArray(horde.warningDirections)
      || !hasCanonicalDirectionOrder(horde.warningDirections)) {
      errors.push('state.horde.warningDirections must contain unique canonical directions');
    }
    for (const field of ['nextSpawnTurn', 'lastSpawnTurn'] as const) if (horde[field] !== null && !isInteger(horde[field], 1)) errors.push(`state.horde.${field} is invalid`);
    if (!HORDE_WARNING_TYPES.includes(horde.warningType as typeof HORDE_WARNING_TYPES[number])) errors.push('state.horde.warningType is invalid');
    if (!FINAL_HORDE_STATUSES.includes(horde.finalHordeStatus as typeof FINAL_HORDE_STATUSES[number])) errors.push('state.horde.finalHordeStatus is invalid');
    if (!Array.isArray(horde.spawnedWaveIndices)
      || horde.spawnedWaveIndices.some((waveIndex) => !isInteger(waveIndex, 1))
      || new Set(horde.spawnedWaveIndices).size !== horde.spawnedWaveIndices.length) {
      errors.push('state.horde.spawnedWaveIndices is invalid');
    }
    if (!isRecord(horde.spawnGroupIdsByWave)) {
      errors.push('state.horde.spawnGroupIdsByWave must be an object');
    } else {
      for (const [waveIndex, groupIds] of Object.entries(horde.spawnGroupIdsByWave)) {
        if (!/^\d+$/u.test(waveIndex) || !isInteger(Number(waveIndex), 1)
          || !Array.isArray(groupIds) || groupIds.length === 0
          || groupIds.some((groupId) => typeof groupId !== 'string' || groupId.length === 0)
          || new Set(groupIds).size !== groupIds.length) {
          errors.push(`state.horde.spawnGroupIdsByWave.${waveIndex} is invalid`);
        }
      }
    }
    if (!Array.isArray(horde.finalSpawnGroupIds)
      || horde.finalSpawnGroupIds.some((groupId) => typeof groupId !== 'string' || groupId.length === 0)
      || new Set(horde.finalSpawnGroupIds).size !== horde.finalSpawnGroupIds.length) {
      errors.push('state.horde.finalSpawnGroupIds is invalid');
    }
  }

  if (!Array.isArray(state.events)) {
    errors.push('state.events must be an array');
  } else {
    for (const [index, event] of state.events.entries()) {
      const path = `state.events[${index}]`;
      if (!isRecord(event) || !isJsonValue(event)) {
        errors.push(`${path} must contain JSON-compatible event data`);
        continue;
      }
      requireFields(errors, event, path, ['id', 'turn', 'phase', 'type', 'payload']);
      if (typeof event.id !== 'string' || event.id.length === 0 || !isInteger(event.turn, 1) || !GAME_PHASES.includes(event.phase as typeof GAME_PHASES[number]) || !GAME_EVENT_TYPES.includes(event.type as typeof GAME_EVENT_TYPES[number]) || !isRecord(event.payload)) errors.push(`${path} has invalid event fields`);
    }
  }

  validateStatisticsShape(state.statistics, errors, 'state.statistics');

  if (state.gameOver !== (state.result !== null)) errors.push('state.gameOver must match state.result');
  if (state.result !== null) {
    if (!isRecord(state.result)) {
      errors.push('state.result must be an object or null');
    } else {
      requireFields(errors, state.result, 'state.result', ['outcome', 'reason', 'turn', 'statistics']);
      if (state.result.outcome !== 'won' && state.result.outcome !== 'lost') errors.push('state.result.outcome is invalid');
      if (!isInteger(state.result.turn, 1)) errors.push('state.result.turn is invalid');
      if (!GAME_OVER_REASONS.includes(state.result.reason as typeof GAME_OVER_REASONS[number])) errors.push('state.result.reason is invalid');
      validateStatisticsShape(state.result.statistics, errors, 'state.result.statistics');
    }
  }
}

function validateStatisticsShape(value: unknown, errors: string[], path: string): void {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return;
  }
  requireFields(errors, value, path, REQUIRED_STATISTIC_FIELDS);
  for (const field of STATISTIC_INTEGER_FIELDS) if (!isInteger(value[field])) errors.push(`${path}.${field} is invalid`);
  if (typeof value.finalHordeDefeated !== 'boolean') errors.push(`${path}.finalHordeDefeated is invalid`);
  for (const field of STATISTIC_NULLABLE_FIELDS) if (value[field] !== null && !isInteger(value[field], 1)) errors.push(`${path}.${field} is invalid`);
  const terrainEntries = value.terrainEntriesByType;
  if (!isRecord(terrainEntries)) {
    errors.push(`${path}.terrainEntriesByType is invalid`);
  } else {
    for (const terrain of BASE_TERRAINS) if (!isInteger(terrainEntries[terrain])) errors.push(`${path}.terrainEntriesByType.${terrain} is invalid`);
  }
  const policyEntries = value.refugeesScreenedByPolicy;
  if (!isRecord(policyEntries)) {
    errors.push(`${path}.refugeesScreenedByPolicy is invalid`);
  } else {
    for (const policy of CHECKPOINT_POLICIES) if (!isInteger(policyEntries[policy])) errors.push(`${path}.refugeesScreenedByPolicy.${policy} is invalid`);
  }
  for (const field of ['refugeeArrivalsByBranch', 'checkpointFallbacksByBranch', 'refugeesTurnedAwayByDirection', 'rejectedBonusZombiesByDirection', 'rejectedCounterResetsByDirection'] as const) {
    if (!isRecord(value[field]) || Object.values(value[field]).some((entry) => !isInteger(entry))) errors.push(`${path}.${field} is invalid`);
  }
  const rejectedByDirectionAndPolicy = value.refugeesRejectedByDirectionAndPolicy;
  if (!isRecord(rejectedByDirectionAndPolicy)) {
    errors.push(`${path}.refugeesRejectedByDirectionAndPolicy is invalid`);
  } else {
    for (const direction of CARDINAL_DIRECTIONS) {
      const entry = rejectedByDirectionAndPolicy[direction];
      if (!isRecord(entry) || !isInteger(entry.normal) || !isInteger(entry.strict)) {
        errors.push(`${path}.refugeesRejectedByDirectionAndPolicy.${direction} is invalid`);
      }
    }
  }
}

function validateStateForSave(state: GameState): string[] {
  const errors: string[] = [];
  const raw = state as unknown as Record<string, unknown>;
  validateV144Shape(raw, errors);
  if (raw.gameVersion !== CURRENT_GAME_VERSION) errors.push(incompatibilityError(raw.gameVersion, 'state.gameVersion'));
  const config = isRecord(raw.config) ? raw.config : null;
  const map = isRecord(raw.map) ? raw.map : null;
  if (!config || !map) return uniqueErrors(errors);
  if (raw.mapId !== config.mapId) errors.push('state.mapId must match state.config.mapId');
  if (raw.mapId !== FIXED_MAP_ID) errors.push(`state.mapId must be ${FIXED_MAP_ID}`);
  try {
    const configResult = validateGameConfig(config as unknown as GameState['config']);
    if (!configResult.valid) errors.push(...configResult.errors.map((error) => `config: ${error}`));
  } catch (error) {
    errors.push(`config validation failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    const mapResult = validateFixedMap(map as unknown as GameState['map']);
    if (!mapResult.valid) errors.push(...mapResult.errors.map((error) => `map: ${error}`));
    if (Number.isSafeInteger(raw.seed)
      && (!initialZombiePositionsMatchSeed(map as unknown as GameState['map'], raw.seed as number) || !initialHunterPositionsMatchSeed(raw as unknown as GameState))) {
      errors.push('map: initial Zombie positions and order must match the deterministic state seed');
    }
  } catch (error) {
    errors.push(`map validation failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    const invariants = validateInvariants(state);
    if (!invariants.valid) errors.push(...invariants.errors.map((error) => `invariant: ${error}`));
  } catch (error) {
    errors.push(`invariant validation failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return uniqueErrors(errors);
}

/** Validate a decoded snapshot without mutating the supplied object. */
export function validateSnapshot(value: unknown): SaveValidationResult {
  if (!isRecord(value)) return reject(['Save envelope must be a JSON object']);
  const errors: string[] = [];
  if (value.format !== SAVE_FORMAT) errors.push(`unsupported save format: ${String(value.format)}`);
  if (value.formatVersion !== SAVE_FORMAT_VERSION) {
    errors.push(`unsupported save format version: ${String(value.formatVersion)}; v1.4.4以前 / v1.4.4 and earlier saves cannot be loaded or converted; earlier formats are rejected without conversion, deletion, or overwrite`);
  }
  if (value.gameVersion !== CURRENT_GAME_VERSION) errors.push(incompatibilityError(value.gameVersion, 'gameVersion'));
  if (value.mapId !== FIXED_MAP_ID) errors.push(`mapId must be ${FIXED_MAP_ID}`);
  if (!Number.isSafeInteger(value.seed)) errors.push('seed must be a safe integer');
  if (typeof value.checksum !== 'string' || !/^[0-9a-f]{8}$/u.test(value.checksum)) errors.push('checksum is invalid');
  if (!isRecord(value.state)) errors.push('state must be an object');
  if (errors.length > 0 || !isRecord(value.state)) return reject(errors);

  const rawState = value.state;
  if (rawState.gameVersion !== CURRENT_GAME_VERSION) errors.push(incompatibilityError(rawState.gameVersion, 'state.gameVersion'));
  if (rawState.mapId !== value.mapId) errors.push('state.mapId does not match mapId');
  if (rawState.seed !== value.seed) errors.push('state.seed does not match seed');
  const payload = {
    format: value.format,
    formatVersion: value.formatVersion,
    gameVersion: value.gameVersion,
    mapId: value.mapId,
    seed: value.seed,
    state: rawState,
  } as unknown as Omit<SaveEnvelope, 'checksum'>;
  if (checksum(envelopePayload(payload)) !== value.checksum) errors.push('checksum mismatch');
  if (errors.length > 0) return reject(errors);

  const state = clone(rawState as unknown as GameState);
  errors.push(...validateStateForSave(state));
  if (errors.length > 0) return reject(errors);
  const envelope: SaveEnvelope = {
    format: SAVE_FORMAT,
    formatVersion: SAVE_FORMAT_VERSION,
    gameVersion: CURRENT_GAME_VERSION,
    mapId: state.mapId,
    seed: state.seed,
    state: clone(state),
    checksum: value.checksum as string,
  };
  return { valid: true, errors: [], state: clone(state), envelope };
}

function clockMs(): number {
  return typeof globalThis.performance?.now === 'function' ? globalThis.performance.now() : Date.now();
}

/**
 * Encode one committed state and expose synchronous stage timings for the
 * v1.5.2 save benchmark. Gzip keeps level 9 for Save Format 11 compatibility;
 * a zero mtime makes repeated encodes of one committed state byte-stable so
 * the shared autosave slot is not rewritten only because the clock advanced.
 */
export function measureSaveEncoding(state: GameState): SaveEncodingMeasurement {
  const totalStart = clockMs();
  const validationStart = clockMs();
  const errors = validateStateForSave(state);
  const validationMs = clockMs() - validationStart;
  if (errors.length > 0) throw new Error(`State cannot be saved: ${errors.join('; ')}`);

  const normalizationStart = clockMs();
  const payload: Omit<SaveEnvelope, 'checksum'> = {
    format: SAVE_FORMAT,
    formatVersion: SAVE_FORMAT_VERSION,
    gameVersion: state.gameVersion,
    mapId: state.mapId,
    seed: state.seed,
    state: clone(state),
  };
  const normalizedPayload = envelopePayload(payload);
  const normalizationMs = clockMs() - normalizationStart;

  const checksumStart = clockMs();
  const digest = checksum(normalizedPayload);
  const checksumMs = clockMs() - checksumStart;

  const envelopeText = canonicalJson({ ...payload, checksum: digest });
  const gzipStart = clockMs();
  const compressed = gzipSync(utf8(envelopeText), { level: 9, mtime: 0 });
  const gzipMs = clockMs() - gzipStart;

  const base64Start = clockMs();
  const code = toBase64Url(compressed);
  const base64Ms = clockMs() - base64Start;
  const totalMs = clockMs() - totalStart;
  return {
    code,
    timing: {
      validationMs,
      normalizationMs,
      checksumMs,
      gzipMs,
      base64Ms,
      totalMs,
      normalizedBytes: utf8(envelopeText).byteLength,
      compressedBytes: compressed.byteLength,
      codeChars: code.length,
    },
  };
}

/** Create a checksummed, URL-safe v1.5.1 Save Format 11 code. */
export function encodeSaveCode(state: GameState): string {
  return measureSaveEncoding(state).code;
}

/** Decode and validate a v1.5.1 save code without changing caller-owned state. */
export function decodeSaveCode(code: string): SaveValidationResult {
  if (typeof code !== 'string' || code.trim().length === 0) return reject(['Save code is empty']);
  try {
    const compressed = fromBase64Url(code.trim());
    if (compressed.length < 2 || compressed[0] !== 0x1f || compressed[1] !== 0x8b) return reject(['Save code is not gzip-compressed']);
    return validateSnapshot(JSON.parse(strFromU8(gunzipSync(compressed))) as unknown);
  } catch (error) {
    return reject([`Save code could not be decoded: ${error instanceof Error ? error.message : String(error)}`]);
  }
}

export function exportSaveJson(state: GameState): string {
  const errors = validateStateForSave(state);
  if (errors.length > 0) throw new Error(`State cannot be saved: ${errors.join('; ')}`);
  return `${JSON.stringify(makeEnvelope(state), null, 2)}\n`;
}

export function importSaveJson(json: string): SaveValidationResult {
  if (typeof json !== 'string' || json.trim().length === 0) return reject(['Save JSON is empty']);
  try {
    return validateSnapshot(JSON.parse(json) as unknown);
  } catch (error) {
    return reject([`Save JSON could not be parsed: ${error instanceof Error ? error.message : String(error)}`]);
  }
}

function browserStorage(): StorageLike | null {
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage;
  } catch {
    return null;
  }
}

/** Browser local autosave adapter. Legacy keys are probe-only and never changed. */
export class AutoSaveStore {
  private readonly storage: StorageLike | null;
  private readonly key: string;
  private readonly legacyKeys: readonly string[];
  private readonly onError?: SaveErrorListener;

  constructor(options: { key?: string; storage?: StorageLike | null; onError?: SaveErrorListener } = {}) {
    this.key = options.key ?? DEFAULT_AUTOSAVE_KEY;
    this.legacyKeys = options.key === undefined ? [LEGACY_AUTOSAVE_KEY, ...OLDER_AUTOSAVE_KEYS] : [];
    this.storage = options.storage === undefined ? browserStorage() : options.storage;
    this.onError = options.onError;
  }

  save(state: GameState): SaveOperationResult {
    if (!this.storage) {
      const message = 'ブラウザのローカル保存領域を利用できません。セーブコードを使用してください。';
      this.onError?.(message);
      return { ok: false, code: null, error: message };
    }
    try {
      const measurement = measureSaveEncoding(state);
      const writeStart = clockMs();
      const code = measurement.code;
      this.storage.setItem(this.key, code);
      const storageWriteMs = clockMs() - writeStart;
      return {
        ok: true,
        code,
        error: null,
        timing: {
          ...measurement.timing,
          storageWriteMs,
          totalMs: measurement.timing.totalMs + storageWriteMs,
        },
      };
    } catch (error) {
      const message = `自動保存に失敗しました: ${error instanceof Error ? error.message : String(error)}`;
      this.onError?.(message, error);
      return { ok: false, code: null, error: message };
    }
  }

  load(): SaveValidationResult {
    if (!this.storage) return reject(['ブラウザのローカル保存領域を利用できません']);
    try {
      const current = this.storage.getItem(this.key);
      if (current !== null) return decodeSaveCode(current);
      for (const legacyKey of this.legacyKeys) {
        const legacy = this.storage.getItem(legacyKey);
        if (legacy !== null) return decodeSaveCode(legacy);
      }
      return reject(['保存データがありません']);
    } catch (error) {
      return reject([`自動保存を読み込めません: ${error instanceof Error ? error.message : String(error)}`]);
    }
  }

  hasSave(): boolean {
    if (!this.storage) return false;
    try {
      return this.storage.getItem(this.key) !== null || this.legacyKeys.some((key) => this.storage?.getItem(key) !== null);
    } catch {
      return false;
    }
  }

  /** Clears only the current v1.5.1/v11 key; legacy data is deliberately preserved. */
  clear(): void {
    try {
      this.storage?.removeItem?.(this.key);
    } catch (error) {
      this.onError?.(`自動保存の削除に失敗しました: ${error instanceof Error ? error.message : String(error)}`, error);
    }
  }
}
