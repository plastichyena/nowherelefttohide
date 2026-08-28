import { gzipSync, gunzipSync, strFromU8, strToU8 } from 'fflate';
import { validateGameConfig } from '../core/config';
import { validateInvariants } from '../core/invariants';
import { validateFixedMap } from '../core/map';
import { GAME_VERSION, isCityFacility } from '../core/state';
import type {
  CardinalDirection,
  CheckpointPolicy,
  CheckpointState,
  FacilityState,
  GameEventType,
  GamePhase,
  GameState,
  GameOverReason,
  HexCoord,
  HumanUnitType,
  UnitActionState,
  UnitState,
  UnitType,
} from '../core/types';

/** The only game version accepted by this save implementation. */
export const CURRENT_GAME_VERSION = GAME_VERSION;
/** Alias useful to callers that want to label a generated save explicitly. */
export const SAVE_GAME_VERSION = CURRENT_GAME_VERSION;
/** Game Rules / Config version written by v1.2.5 and accepted for migration. */
export const LEGACY_GAME_VERSION = '1.2.0';

/** Stable envelope identifier shared by autosaves, codes, and JSON exports. */
export const SAVE_FORMAT = 'nowhere-left-to-hide-save';
export const SAVE_FORMAT_VERSION = 2;
/** v1.2.5 writes a new key so a pre-v1.2.5 autosave remains untouched. */
export const DEFAULT_AUTOSAVE_KEY = 'nowhere-left-to-hide:auto-save:v2';
/** Read-only fallback for pre-v1.2.5 data. It is never overwritten or deleted. */
export const LEGACY_AUTOSAVE_KEY = 'nowhere-left-to-hide:auto-save:v1';

export interface SaveEnvelope {
  format: typeof SAVE_FORMAT;
  formatVersion: number;
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
  /** True only when a valid v1.2.5 snapshot was migrated in memory. */
  migrated?: boolean;
}

export interface SaveOperationResult {
  ok: boolean;
  code: string | null;
  error: string | null;
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export type SaveErrorListener = (message: string, error?: unknown) => void;

const CARDINAL_DIRECTIONS: readonly CardinalDirection[] = ['north', 'east', 'south', 'west'];
const CHECKPOINT_POLICIES: readonly CheckpointPolicy[] = ['passThrough', 'normal', 'strict'];
const GAME_PHASES: readonly GamePhase[] = ['player', 'economy', 'refugees', 'infection', 'zombie', 'horde', 'gameOver'];
const UNIT_TYPES: readonly UnitType[] = ['police', 'nationalGuard', 'zombie'];
const HUMAN_UNIT_TYPES: readonly HumanUnitType[] = ['police', 'nationalGuard'];
const UNIT_ACTION_STATES: readonly UnitActionState[] = ['ready', 'moved', 'acted', 'destroyed'];
const GAME_OVER_REASONS: readonly GameOverReason[] = [
  'capitalLost',
  'healthyCiviliansLost',
  'maxTurnsSurvived',
  'abandoned',
  'error',
];
const GAME_EVENT_TYPES: readonly GameEventType[] = [
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
  'infection_suppressed',
  'facility_overrun',
  'facility_recovered',
  'checkpoint_built',
  'checkpoint_relocated',
  'checkpoint_remnant_created',
  'checkpoint_removed',
  'checkpoint_abandoned',
  'checkpoint_recovered',
  'supply_changed',
  'supply_action_rejected',
  'horde_spawned',
  'game_over',
];
const FACILITY_TYPES = [
  'capital',
  'city',
  'farm',
  'civilianFactory',
  'militaryFactory',
  'refinery',
  'powerPlant',
] as const;
const PRODUCTION_FACILITY_TYPES = [
  'farm',
  'civilianFactory',
  'militaryFactory',
  'refinery',
  'powerPlant',
] as const;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Sort object keys while keeping array ordering stable for deterministic saves. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => canonicalize(entry));
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, canonicalize(record[key])]),
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
  return bytesToBase64(value)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
}

function fromBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) throw new Error('Save code contains an invalid Base64URL character');
  const padded = value.replaceAll('-', '+').replaceAll('_', '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return base64ToBytes(padded);
}

/** Small deterministic checksum suitable for detecting copy/paste corruption. */
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasOwn(record: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

function pushUnique(errors: string[], message: string): void {
  if (!errors.includes(message)) errors.push(message);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function requireRecord(errors: string[], value: unknown, path: string): value is Record<string, unknown> {
  if (!isRecord(value)) {
    errors.push(`${path} must be an object`);
    return false;
  }
  return true;
}

function requireArray(errors: string[], value: unknown, path: string): value is unknown[] {
  if (!Array.isArray(value)) {
    errors.push(`${path} must be an array`);
    return false;
  }
  return true;
}

function requireString(errors: string[], value: unknown, path: string): value is string {
  if (typeof value !== 'string' || value.length === 0) {
    errors.push(`${path} must be a non-empty string`);
    return false;
  }
  return true;
}

function requireInteger(errors: string[], value: unknown, path: string, minimum = 0): value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum) {
    errors.push(`${path} must be a safe integer >= ${minimum}`);
    return false;
  }
  return true;
}

function requireBoolean(errors: string[], value: unknown, path: string): value is boolean {
  if (typeof value !== 'boolean') {
    errors.push(`${path} must be a boolean`);
    return false;
  }
  return true;
}

function requireEnum<T extends string>(errors: string[], value: unknown, path: string, values: readonly T[]): value is T {
  if (typeof value !== 'string' || !values.includes(value as T)) {
    errors.push(`${path} has an unsupported value: ${String(value)}`);
    return false;
  }
  return true;
}

function nonNegative(errors: string[], value: unknown, path: string): void {
  if (!isFiniteNonNegative(value)) errors.push(`${path} must be a finite number >= 0`);
}

function nonNegativeInteger(errors: string[], value: unknown, path: string): void {
  if (!isNonNegativeInteger(value)) errors.push(`${path} must be a non-negative integer`);
}

function validateCoordinate(errors: string[], value: unknown, path: string, width = 15, height = 15): value is HexCoord {
  if (!isRecord(value)) {
    errors.push(`${path} must be a coordinate object`);
    return false;
  }
  const q = value.q;
  const r = value.r;
  const validQ = requireInteger(errors, q, `${path}.q`);
  const validR = requireInteger(errors, r, `${path}.r`);
  if (validQ && validR && (q >= width || r >= height)) {
    errors.push(`${path} is outside the map`);
    return false;
  }
  return validQ && validR;
}

function parseVersion(value: string): [number, number, number] | null {
  const match = /^v?(\d+)\.(\d+)(?:\.(\d+))?/u.exec(value.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
}

function versionError(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0 || value === CURRENT_GAME_VERSION) return null;
  const parsed = parseVersion(value);
  const old = parsed !== null && (parsed[0] < 1 || (parsed[0] === 1 && parsed[1] < 2));
  if (old) return `保存データは旧バージョン (old version ${value}) のため読み込めません。現在のVersionは${CURRENT_GAME_VERSION}です。最初から開始してください。`;
  return `unsupported game version: ${value}; current game version is ${CURRENT_GAME_VERSION}`;
}

function addVersionValidation(errors: string[], value: unknown, path: string): void {
  if (typeof value !== 'string' || value.length === 0) {
    errors.push(`${path} is required`);
    return;
  }
  const message = versionError(value);
  if (message) pushUnique(errors, `${path}: ${message}`);
}

function validateMap(errors: string[], value: unknown, expectedMapId: unknown): value is GameState['map'] {
  if (!isRecord(value)) {
    errors.push('state.map must be an object');
    return false;
  }
  const map: Record<string, unknown> = value;
  if (!requireString(errors, map.id, 'state.map.id')) return false;
  if (typeof expectedMapId === 'string' && map.id !== expectedMapId) errors.push('state.map.id does not match mapId');
  if (map.width !== 15 || map.height !== 15) errors.push('state.map must be exactly 15x15');
  const tilesValid = Array.isArray(map.tiles);
  if (!tilesValid) errors.push('state.map.tiles must be an array');
  const roadTilesValid = Array.isArray(map.roadTiles);
  if (!roadTilesValid) errors.push('state.map.roadTiles must be an array');
  const facilitiesValid = Array.isArray(map.facilities);
  if (!facilitiesValid) errors.push('state.map.facilities must be an array');
  const entrancesValid = Array.isArray(map.hordeEntrances);
  if (!entrancesValid) errors.push('state.map.hordeEntrances must be an array');
  const branchesValid = Array.isArray(map.roadBranches);
  if (!branchesValid) errors.push('state.map.roadBranches must be an array');
  const zombiesValid = Array.isArray(map.initialZombiePositions);
  if (!zombiesValid) errors.push('state.map.initialZombiePositions must be an array');
  let traversable = tilesValid && facilitiesValid && entrancesValid && branchesValid && zombiesValid;

  if (tilesValid) {
    const tiles = map.tiles as unknown[];
    if (tiles.length !== 225) errors.push('state.map.tiles must contain 225 tiles');
    const tileKeys = new Set<string>();
    for (const [index, rawTile] of tiles.entries()) {
      const path = `state.map.tiles[${index}]`;
      if (!isRecord(rawTile)) {
        errors.push(`${path} must be an object`);
        traversable = false;
        continue;
      }
      const tile: Record<string, unknown> = rawTile;
      const validCoordinate = validateCoordinate(errors, tile, path);
      const tileData = tile as unknown as Record<string, unknown>;
      const key = typeof tileData.key === 'string' ? tileData.key : '';
      if (!key) errors.push(`${path}.key must be a non-empty string`);
      if (validCoordinate && key !== `${tileData.q},${tileData.r}`) errors.push(`${path}.key does not match its coordinate`);
      if (key && tileKeys.has(key)) errors.push(`duplicate map tile: ${key}`);
      if (key) tileKeys.add(key);
      if (tileData.terrain !== 'land' && tileData.terrain !== 'road') errors.push(`${path}.terrain is invalid`);
      requireBoolean(errors, tileData.road, `${path}.road`);
      if (tileData.movementCost !== 1) errors.push(`${path}.movementCost must be 1`);
      if (tileData.facilityId !== null && typeof tileData.facilityId !== 'string') errors.push(`${path}.facilityId is invalid`);
      if (!Array.isArray(tileData.hordeEntranceDirections)) errors.push(`${path}.hordeEntranceDirections must be an array`);
      else for (const direction of tileData.hordeEntranceDirections) requireEnum(errors, direction, `${path}.hordeEntranceDirections`, CARDINAL_DIRECTIONS);
    }
  }
  if (roadTilesValid) for (const [index, position] of (map.roadTiles as unknown[]).entries()) validateCoordinate(errors, position, `state.map.roadTiles[${index}]`);
  if (facilitiesValid) {
    const facilities = map.facilities as unknown[];
    if (facilities.length !== 16) errors.push('state.map.facilities must contain exactly 16 facilities');
    const ids = new Set<string>();
    const positions = new Set<string>();
    for (const [index, rawFacility] of facilities.entries()) {
      const path = `state.map.facilities[${index}]`;
      if (!isRecord(rawFacility)) {
        errors.push(`${path} must be an object`);
        traversable = false;
        continue;
      }
      const id = typeof rawFacility.id === 'string' ? rawFacility.id : '';
      if (!id) errors.push(`${path}.id must be a non-empty string`);
      if (id && ids.has(id)) errors.push(`duplicate map facility: ${id}`);
      if (id) ids.add(id);
      requireEnum(errors, rawFacility.type, `${path}.type`, FACILITY_TYPES);
      const validCoordinate = validateCoordinate(errors, rawFacility.position, `${path}.position`);
      if (validCoordinate) {
        const position = rawFacility.position as Record<string, unknown>;
        const key = `${position.q},${position.r}`;
        if (positions.has(key)) errors.push(`duplicate map facility position: ${key}`);
        positions.add(key);
      }
      requireString(errors, rawFacility.nameKey, `${path}.nameKey`);
      requireInteger(errors, rawFacility.workerCapacity, `${path}.workerCapacity`, 1);
      requireBoolean(errors, rawFacility.startingOwned, `${path}.startingOwned`);
      requireInteger(errors, rawFacility.startingWorkers, `${path}.startingWorkers`);
      requireInteger(errors, rawFacility.startingInfected, `${path}.startingInfected`);
    }
  }
  if (entrancesValid) {
    const entrances = map.hordeEntrances as unknown[];
    if (entrances.length !== 4) errors.push('state.map.hordeEntrances must contain four entrances');
    const directions = new Set<string>();
    for (const [index, rawEntrance] of entrances.entries()) {
      const path = `state.map.hordeEntrances[${index}]`;
      if (!isRecord(rawEntrance)) {
        errors.push(`${path} must be an object`);
        traversable = false;
        continue;
      }
      if (requireEnum(errors, rawEntrance.direction, `${path}.direction`, CARDINAL_DIRECTIONS)) {
        if (directions.has(rawEntrance.direction)) errors.push(`duplicate Horde entrance direction: ${rawEntrance.direction}`);
        directions.add(rawEntrance.direction);
      }
      validateCoordinate(errors, rawEntrance.tile, `${path}.tile`);
      if (!Array.isArray(rawEntrance.roadTiles)) errors.push(`${path}.roadTiles must be an array`);
      else for (const [roadIndex, position] of rawEntrance.roadTiles.entries()) validateCoordinate(errors, position, `${path}.roadTiles[${roadIndex}]`);
    }
  }
  if (branchesValid) {
    const branches = map.roadBranches as unknown[];
    if (branches.length !== 4) errors.push('state.map.roadBranches must contain four branches');
    const ids = new Set<string>();
    const directions = new Set<string>();
    for (const [index, rawBranch] of branches.entries()) {
      const path = `state.map.roadBranches[${index}]`;
      if (!isRecord(rawBranch)) {
        errors.push(`${path} must be an object`);
        traversable = false;
        continue;
      }
      const idValid = requireString(errors, rawBranch.id, `${path}.id`);
      if (idValid && typeof rawBranch.id === 'string') {
        if (ids.has(rawBranch.id)) errors.push(`duplicate road branch: ${rawBranch.id}`);
        ids.add(rawBranch.id);
      }
      if (requireEnum(errors, rawBranch.direction, `${path}.direction`, CARDINAL_DIRECTIONS)) {
        if (directions.has(rawBranch.direction)) errors.push(`duplicate road branch direction: ${rawBranch.direction}`);
        directions.add(rawBranch.direction);
      }
      validateCoordinate(errors, rawBranch.capitalConnection, `${path}.capitalConnection`);
      if (!Array.isArray(rawBranch.roadTiles)) errors.push(`${path}.roadTiles must be an array`);
      else for (const [roadIndex, position] of rawBranch.roadTiles.entries()) validateCoordinate(errors, position, `${path}.roadTiles[${roadIndex}]`);
      validateCoordinate(errors, rawBranch.entrance, `${path}.entrance`);
    }
  }
  if (zombiesValid) {
    const initialZombiePositions = map.initialZombiePositions as unknown[];
    if (initialZombiePositions.length !== 4) errors.push('state.map.initialZombiePositions must contain four positions');
    for (const [index, position] of initialZombiePositions.entries()) validateCoordinate(errors, position, `state.map.initialZombiePositions[${index}]`);
  }
  if (traversable) {
    try {
      const mapResult = validateFixedMap(value as unknown as GameState['map']);
      if (!mapResult.valid) errors.push(...mapResult.errors.map((error) => `map: ${error}`));
    } catch (error) {
      errors.push(`map: could not validate map (${error instanceof Error ? error.message : String(error)})`);
    }
  }
  return true;
}

function validateFacility(
  facility: unknown,
  errors: string[],
  index: number,
  mapFacilityById: Map<string, Record<string, unknown>>,
  configFacilities: Record<string, unknown> | null,
): facility is FacilityState {
  const path = `state.facilities[${index}]`;
  if (!isRecord(facility)) {
    errors.push(`${path} must be an object`);
    return false;
  }
  const idValid = requireString(errors, facility.id, `${path}.id`);
  const id = typeof facility.id === 'string' ? facility.id : '';
  requireEnum(errors, facility.type, `${path}.type`, FACILITY_TYPES);
  const type = typeof facility.type === 'string' ? facility.type : '';
  requireString(errors, facility.nameKey, `${path}.nameKey`);
  validateCoordinate(errors, facility.position, `${path}.position`);
  requireInteger(errors, facility.workerCapacity, `${path}.workerCapacity`, 1);
  requireBoolean(errors, facility.startingOwned, `${path}.startingOwned`);
  requireInteger(errors, facility.startingWorkers, `${path}.startingWorkers`);
  requireInteger(errors, facility.startingInfected, `${path}.startingInfected`);
  requireEnum(errors, facility.owner, `${path}.owner`, ['player', 'none'] as const);
  requireEnum(errors, facility.status, `${path}.status`, ['unowned', 'owned', 'ruined'] as const);
  requireEnum(errors, facility.operationalStatus, `${path}.operationalStatus`, ['operational', 'stopped', 'infected', 'ruined'] as const);
  nonNegativeInteger(errors, facility.workers, `${path}.workers`);
  nonNegativeInteger(errors, facility.infected, `${path}.infected`);
  if (typeof facility.workerCapacity === 'number' && typeof facility.workers === 'number' && typeof facility.infected === 'number' && type !== 'capital' && type !== 'city' && facility.workers + facility.infected > facility.workerCapacity) errors.push(`${path}.workers and infected exceed workerCapacity`);
  if (facility.securedOrder !== null) nonNegativeInteger(errors, facility.securedOrder, `${path}.securedOrder`);
  nonNegativeInteger(errors, facility.lastAssignedOrder, `${path}.lastAssignedOrder`);
  requireInteger(errors, facility.populationOperationalTurn, `${path}.populationOperationalTurn`, 1);

  const definition = idValid ? mapFacilityById.get(id) : undefined;
  if (idValid && !definition) errors.push(`${path}.id does not exist in state.map.facilities`);
  if (definition) {
    if (facility.type !== definition.type) errors.push(`${path}.type differs from state.map.facilities`);
    if (facility.nameKey !== definition.nameKey) errors.push(`${path}.nameKey differs from state.map.facilities`);
    const position = facility.position;
    const definitionPosition = definition.position;
    if (isRecord(position) && isRecord(definitionPosition) && (position.q !== definitionPosition.q || position.r !== definitionPosition.r)) errors.push(`${path}.position differs from state.map.facilities`);
    if (facility.startingOwned !== definition.startingOwned || facility.startingWorkers !== definition.startingWorkers || facility.startingInfected !== definition.startingInfected) errors.push(`${path} starting definition differs from state.map.facilities`);
  }
  if (configFacilities && type && isRecord(configFacilities[type]) && facility.workerCapacity !== configFacilities[type].workerCapacity) errors.push(`${path}.workerCapacity differs from config.facilities.${type}`);
  if (facility.status === 'unowned' && facility.owner !== 'none') errors.push(`${path} unowned facility must not have a player owner`);
  if (facility.status === 'owned' && facility.owner !== 'player') errors.push(`${path} owned facility must have a player owner`);
  if (facility.status === 'ruined' && facility.owner !== 'none') errors.push(`${path} ruined facility must not have a player owner`);
  if (facility.status === 'ruined' && facility.workers !== 0) errors.push(`${path} ruined facility cannot retain workers`);
  if (facility.status === 'ruined' && facility.operationalStatus !== 'ruined') errors.push(`${path} ruined facility must use ruined operational status`);
  return true;
}

function validateUnit(
  unit: unknown,
  errors: string[],
  index: number,
  tileKeys: Set<string>,
  configUnits: Record<string, unknown> | null,
): unit is UnitState {
  const path = `state.units[${index}]`;
  if (!isRecord(unit)) {
    errors.push(`${path} must be an object`);
    return false;
  }
  requireString(errors, unit.id, `${path}.id`);
  const typeValid = requireEnum(errors, unit.type, `${path}.type`, UNIT_TYPES);
  const type = typeof unit.type === 'string' ? unit.type : '';
  const positionValid = validateCoordinate(errors, unit.position, `${path}.position`);
  if (positionValid && isRecord(unit.position) && !tileKeys.has(`${unit.position.q},${unit.position.r}`)) errors.push(`${path}.position is not a map tile`);
  for (const key of ['hp', 'maxHp', 'attack', 'movement', 'range', 'population'] as const) nonNegativeInteger(errors, unit[key], `${path}.${key}`);
  requireEnum(errors, unit.actionState, `${path}.actionState`, UNIT_ACTION_STATES);
  requireBoolean(errors, unit.canAttack, `${path}.canAttack`);
  requireBoolean(errors, unit.canMove, `${path}.canMove`);
  requireBoolean(errors, unit.isPlayerUnit, `${path}.isPlayerUnit`);
  if (isRecord(unit.activity)) for (const key of ['moved', 'attacked', 'intercepted', 'suppressed'] as const) requireBoolean(errors, unit.activity[key], `${path}.activity.${key}`);
  else errors.push(`${path}.activity must be an object`);
  if (typeof unit.hp === 'number' && typeof unit.maxHp === 'number' && unit.hp > unit.maxHp) errors.push(`${path}.hp cannot exceed maxHp`);
  if (unit.actionState === 'destroyed') errors.push(`${path} destroyed units must not be present in a save`);
  if (typeValid) {
    const expectedPlayerUnit = type !== 'zombie';
    if (unit.isPlayerUnit !== expectedPlayerUnit) errors.push(`${path}.isPlayerUnit does not match type`);
    const configured = configUnits?.[type];
    if (isRecord(configured)) {
      if (unit.maxHp !== configured.hp) errors.push(`${path}.maxHp differs from config.units.${type}.hp`);
      for (const key of ['attack', 'movement', 'range', 'population'] as const) if (unit[key] !== configured[key]) errors.push(`${path}.${key} differs from config.units.${type}.${key}`);
    }
  }
  return true;
}

function validateCheckpoint(
  checkpoint: unknown,
  errors: string[],
  index: number,
  tileKeys: Set<string>,
  roadTiles: Set<string>,
  roadBranchIds: Set<string>,
  maxPerDirection: number | null,
  directionsSeen: Map<string, number>,
): checkpoint is CheckpointState {
  const path = `state.checkpoints[${index}]`;
  if (!isRecord(checkpoint)) {
    errors.push(`${path} must be an object`);
    return false;
  }
  requireString(errors, checkpoint.id, `${path}.id`);
  const positionValid = validateCoordinate(errors, checkpoint.position, `${path}.position`);
  if (positionValid && isRecord(checkpoint.position)) {
    const key = `${checkpoint.position.q},${checkpoint.position.r}`;
    if (!tileKeys.has(key)) errors.push(`${path}.position is not a map tile`);
    if (!roadTiles.has(key)) errors.push(`${path}.position must be on a road`);
  }
  const directionValid = requireEnum(errors, checkpoint.direction, `${path}.direction`, CARDINAL_DIRECTIONS);
  if (directionValid && checkpoint.status === 'operational') {
    const direction = checkpoint.direction as CardinalDirection;
    const count = (directionsSeen.get(direction) ?? 0) + 1;
    directionsSeen.set(direction, count);
    if (maxPerDirection !== null && count > maxPerDirection) errors.push(`${path} exceeds checkpoint limit for ${checkpoint.direction}`);
  }
  const branchValid = requireString(errors, checkpoint.branchId, `${path}.branchId`);
  if (branchValid && typeof checkpoint.branchId === 'string' && !roadBranchIds.has(checkpoint.branchId)) errors.push(`${path}.branchId does not refer to state.map.roadBranches`);
  requireEnum(errors, checkpoint.status, `${path}.status`, ['operational', 'remnant', 'ruined', 'abandoned'] as const);
  for (const key of ['waiting', 'screening', 'approved', 'remainingTurns', 'infected'] as const) nonNegativeInteger(errors, checkpoint[key], `${path}.${key}`);
  requireEnum(errors, checkpoint.screeningPolicy, `${path}.screeningPolicy`, CHECKPOINT_POLICIES);
  requireEnum(errors, checkpoint.currentPolicy, `${path}.currentPolicy`, CHECKPOINT_POLICIES);
  if (checkpoint.nextArrivalTurn !== null) requireInteger(errors, checkpoint.nextArrivalTurn, `${path}.nextArrivalTurn`, 1);
  return true;
}

function validateCityPopulationSnapshot(state: Record<string, unknown>, errors: string[], facilities: Record<string, unknown>[]): void {
  const rawSnapshot = state.cityPopulationSnapshot;
  if (!isRecord(rawSnapshot)) {
    errors.push('state.cityPopulationSnapshot must be an object');
    return;
  }
  const turn = state.turn;
  if (!requireInteger(errors, rawSnapshot.turn, 'state.cityPopulationSnapshot.turn', 1)) return;
  if (typeof turn === 'number' && rawSnapshot.turn !== turn) errors.push('state.cityPopulationSnapshot.turn must match state.turn');
  const supplyValid = Array.isArray(rawSnapshot.supply);
  if (!supplyValid) errors.push('state.cityPopulationSnapshot.supply must be an array');
  const receptionValid = Array.isArray(rawSnapshot.reception);
  if (!receptionValid) errors.push('state.cityPopulationSnapshot.reception must be an array');
  if (!supplyValid || !receptionValid) return;
  const facilityById = new Map<string, Record<string, unknown>>();
  for (const facility of facilities) if (typeof facility.id === 'string') facilityById.set(facility.id, facility);
  const parseEntries = (entries: unknown[], path: string): Map<string, { facilityId: string; population: number; eligible: boolean }> => {
    const result = new Map<string, { facilityId: string; population: number; eligible: boolean }>();
    for (const [index, rawEntry] of entries.entries()) {
      const entryPath = `${path}[${index}]`;
      if (!isRecord(rawEntry)) {
        errors.push(`${entryPath} must be an object`);
        continue;
      }
      const idValid = requireString(errors, rawEntry.facilityId, `${entryPath}.facilityId`);
      const id = typeof rawEntry.facilityId === 'string' ? rawEntry.facilityId : '';
      const populationValid = requireInteger(errors, rawEntry.population, `${entryPath}.population`);
      const eligibleValid = requireBoolean(errors, rawEntry.eligible, `${entryPath}.eligible`);
      if (idValid && result.has(id)) errors.push(`${path} contains duplicate facility ${id}`);
      if (idValid && !facilityById.has(id)) errors.push(`${entryPath}.facilityId is not a facility in the state`);
      if (idValid && facilityById.has(id) && !isCityFacility(facilityById.get(id) as Pick<FacilityState, 'type'>)) errors.push(`${entryPath}.facilityId must refer to a city`);
      if (idValid && populationValid && eligibleValid) result.set(id, { facilityId: id, population: rawEntry.population as number, eligible: rawEntry.eligible as boolean });
    }
    return result;
  };
  const supply = parseEntries(rawSnapshot.supply as unknown[], 'state.cityPopulationSnapshot.supply');
  const reception = parseEntries(rawSnapshot.reception as unknown[], 'state.cityPopulationSnapshot.reception');
  if (supply.size !== reception.size || [...supply.keys()].some((id) => !reception.has(id))) errors.push('cityPopulationSnapshot supply and reception entries must contain the same cities');
  for (const [id, entry] of supply) {
    const other = reception.get(id);
    if (other && (entry.population !== other.population || entry.eligible !== other.eligible)) errors.push(`cityPopulationSnapshot entry ${id} differs between supply and reception`);
    const facility = facilityById.get(id);
    if (entry.eligible && facility && typeof rawSnapshot.turn === 'number' && typeof facility.populationOperationalTurn === 'number' && facility.populationOperationalTurn > rawSnapshot.turn) errors.push(`cityPopulationSnapshot entry ${id} is eligible before populationOperationalTurn`);
  }
  const supplyExpected = [...supply.values()].sort((left, right) => right.population - left.population || left.facilityId.localeCompare(right.facilityId));
  const receptionExpected = [...reception.values()].sort((left, right) => left.population - right.population || left.facilityId.localeCompare(right.facilityId));
  if (JSON.stringify(supplyExpected) !== JSON.stringify([...supply.values()])) errors.push('cityPopulationSnapshot.supply is not in deterministic order');
  if (JSON.stringify(receptionExpected) !== JSON.stringify([...reception.values()])) errors.push('cityPopulationSnapshot.reception is not in deterministic order');
}

function isJsonValue(value: unknown): boolean {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((entry) => isJsonValue(entry));
  if (isRecord(value)) return Object.values(value).every((entry) => isJsonValue(entry));
  return false;
}

function validateGameState(value: Record<string, unknown>, errors: string[]): boolean {
  const requiredFields = [
    'gameVersion', 'config', 'seed', 'rngState', 'turn', 'maxTurns', 'actionsTakenThisTurn', 'phase', 'mapId', 'map', 'facilities',
    'population', 'cityPopulationSnapshot', 'resources', 'units', 'checkpoints', 'roadBranches', 'pendingUnitProductions', 'nextCheckpointNumber', 'nextUnitNumber', 'nextEventNumber',
    'nextAssignmentOrder', 'horde', 'events', 'statistics', 'gameOver', 'result',
  ];
  for (const field of requiredFields) if (!hasOwn(value, field)) errors.push(`state.${field} is required for a valid save`);
  addVersionValidation(errors, value.gameVersion, 'state.gameVersion');
  if (hasOwn(value, 'pendingAdmissions')) errors.push('state.pendingAdmissions is a legacy v1.0 field and is not supported');
  if (!isRecord(value.config)) {
    errors.push('state.config must be an object');
    return false;
  }
  const config: Record<string, unknown> = value.config;
  if (config.version !== CURRENT_GAME_VERSION) {
    const message = versionError(config.version);
    pushUnique(errors, message ? `state.config.version: ${message}` : `state.config.version must be ${CURRENT_GAME_VERSION}`);
  }
  try {
    const configResult = validateGameConfig(config as unknown as GameState['config']);
    if (!configResult.valid) errors.push(...configResult.errors.map((error) => `config: ${error}`));
  } catch (error) {
    errors.push(`config: could not validate configuration (${error instanceof Error ? error.message : String(error)})`);
  }
  if (isRecord(config.economy) && hasOwn(config.economy, 'initialUnemployed')) errors.push('config.economy.initialUnemployed is a legacy v1.0 field and is not supported');

  requireInteger(errors, value.seed, 'state.seed', -Number.MAX_SAFE_INTEGER);
  const maxTurns = value.maxTurns;
  const turn = value.turn;
  const maxTurnsValid = requireInteger(errors, maxTurns, 'state.maxTurns', 1);
  const turnValid = requireInteger(errors, turn, 'state.turn', 1);
  if (maxTurnsValid && turnValid && turn > maxTurns) errors.push('state.turn must not exceed state.maxTurns');
  if (typeof config.maxTurns === 'number' && maxTurnsValid && maxTurns !== config.maxTurns) errors.push('state.maxTurns must match config.maxTurns');
  requireInteger(errors, value.actionsTakenThisTurn, 'state.actionsTakenThisTurn');
  if (typeof config.maxActionsPerTurn === 'number' && typeof value.actionsTakenThisTurn === 'number' && value.actionsTakenThisTurn > config.maxActionsPerTurn) errors.push('state.actionsTakenThisTurn exceeds config.maxActionsPerTurn');
  requireEnum(errors, value.phase, 'state.phase', GAME_PHASES);
  requireString(errors, value.mapId, 'state.mapId');
  if (typeof config.mapId === 'string' && value.mapId !== config.mapId) errors.push('state.mapId must match config.mapId');

  const rngState = value.rngState;
  if (isRecord(rngState)) {
    if (rngState.algorithm !== 'xorshift32-v1') errors.push('state.rngState.algorithm must be xorshift32-v1');
    requireInteger(errors, rngState.seed, 'state.rngState.seed');
    requireInteger(errors, rngState.state, 'state.rngState.state');
    requireInteger(errors, rngState.calls, 'state.rngState.calls');
    if (typeof value.seed === 'number' && typeof rngState.seed === 'number' && (value.seed >>> 0) !== rngState.seed) errors.push('state.rngState.seed must match state.seed');
    if (typeof rngState.seed === 'number' && rngState.seed > 0xffffffff) errors.push('state.rngState.seed must be uint32');
    if (typeof rngState.state === 'number' && rngState.state > 0xffffffff) errors.push('state.rngState.state must be uint32');
  } else errors.push('state.rngState must be an object');

  const mapValid = validateMap(errors, value.map, value.mapId);
  const mapRecord = isRecord(value.map) ? value.map : null;
  const mapFacilityById = new Map<string, Record<string, unknown>>();
  const tileKeys = new Set<string>();
  const roadTiles = new Set<string>();
  if (mapRecord && Array.isArray(mapRecord.facilities)) for (const facility of mapRecord.facilities as unknown[]) if (isRecord(facility) && typeof facility.id === 'string') mapFacilityById.set(facility.id, facility);
  if (mapRecord && Array.isArray(mapRecord.tiles)) for (const tile of mapRecord.tiles as unknown[]) if (isRecord(tile) && typeof tile.q === 'number' && typeof tile.r === 'number') tileKeys.add(`${tile.q},${tile.r}`);
  if (mapRecord && Array.isArray(mapRecord.roadTiles)) for (const position of mapRecord.roadTiles as unknown[]) if (isRecord(position) && typeof position.q === 'number' && typeof position.r === 'number') roadTiles.add(`${position.q},${position.r}`);
  if (!mapValid) errors.push('state.map is invalid');

  const rawFacilities = value.facilities;
  const facilities: Record<string, unknown>[] = [];
  const facilityIds = new Set<string>();
  const configFacilities = isRecord(config.facilities) ? config.facilities : null;
  if (Array.isArray(rawFacilities)) {
    if (mapRecord && Array.isArray(mapRecord.facilities) && rawFacilities.length !== (mapRecord.facilities as unknown[]).length) errors.push('state.facilities count must match state.map.facilities');
    for (const [index, rawFacility] of rawFacilities.entries()) {
      if (validateFacility(rawFacility, errors, index, mapFacilityById, configFacilities)) {
        const facility = rawFacility as unknown as Record<string, unknown>;
        facilities.push(facility);
        if (typeof facility.id === 'string' && facilityIds.has(facility.id)) errors.push(`duplicate state facility id: ${facility.id}`);
        if (typeof facility.id === 'string') facilityIds.add(facility.id);
      }
    }
  } else errors.push('state.facilities must be an array');

  const population = value.population;
  if (isRecord(population)) {
    for (const field of ['initialPopulation', 'cityResidents', 'productionWorkers', 'healthyCivilians', 'police', 'nationalGuard', 'unitPopulation', 'waitingRefugees', 'screeningRefugees', 'approvedRefugees', 'facilityInfected', 'checkpointInfected', 'cumulativeDeaths', 'cumulativeArrivals', 'cumulativeDepartures', 'cumulativeDiscoveredInfected']) nonNegativeInteger(errors, population[field], `state.population.${field}`);
    if (hasOwn(population, 'employed') || hasOwn(population, 'unemployed')) errors.push('state.population uses the legacy employed/unemployed model and cannot be loaded');
    const rawFacilityWorkers = population.facilityWorkers;
    if (requireArray(errors, rawFacilityWorkers, 'state.population.facilityWorkers')) {
      const seen = new Set<string>();
      let previousId = '';
      for (const [index, rawEntry] of rawFacilityWorkers.entries()) {
        const path = `state.population.facilityWorkers[${index}]`;
        if (!isRecord(rawEntry)) {
          errors.push(`${path} must be an object`);
          continue;
        }
        const idValid = requireString(errors, rawEntry.facilityId, `${path}.facilityId`);
        nonNegativeInteger(errors, rawEntry.workers, `${path}.workers`);
        if (idValid && typeof rawEntry.facilityId === 'string') {
          if (seen.has(rawEntry.facilityId)) errors.push(`${path}.facilityId is duplicated`);
          if (previousId && previousId.localeCompare(rawEntry.facilityId) > 0) errors.push('state.population.facilityWorkers must be sorted by facilityId');
          previousId = rawEntry.facilityId;
          seen.add(rawEntry.facilityId);
          const facility = facilities.find((candidate) => candidate.id === rawEntry.facilityId);
          if (!facility || facility.owner !== 'player') errors.push(`${path}.facilityId must refer to an owned facility`);
          else if (rawEntry.workers !== facility.workers) errors.push(`${path}.workers does not match its facility`);
        }
      }
      const ownedCount = facilities.filter((facility) => facility.owner === 'player').length;
      if (rawFacilityWorkers.length !== ownedCount) errors.push('state.population.facilityWorkers must include every owned facility exactly once');
    }
    const cityResidents = facilities.filter((facility) => facility.owner === 'player' && (facility.type === 'capital' || facility.type === 'city')).reduce((total, facility) => total + (typeof facility.workers === 'number' ? facility.workers : 0), 0);
    const productionWorkers = facilities.filter((facility) => facility.owner === 'player' && facility.type !== 'capital' && facility.type !== 'city').reduce((total, facility) => total + (typeof facility.workers === 'number' ? facility.workers : 0), 0);
    if (population.cityResidents !== cityResidents) errors.push('state.population.cityResidents is out of sync with facilities');
    if (population.productionWorkers !== productionWorkers) errors.push('state.population.productionWorkers is out of sync with facilities');
    if (population.healthyCivilians !== cityResidents + productionWorkers) errors.push('state.population.healthyCivilians is out of sync with facilities');
  } else errors.push('state.population must be an object');

  const resources = value.resources;
  if (isRecord(resources)) {
    for (const field of ['food', 'civilianGoods', 'militaryGoods', 'fuel', 'electricityCapacity', 'electricityRequired']) nonNegativeInteger(errors, resources[field], `state.resources.${field}`);
    requireBoolean(errors, resources.militarySupplyAvailable, 'state.resources.militarySupplyAvailable');
  } else errors.push('state.resources must be an object');

  const rawUnits = value.units;
  const unitIds = new Set<string>();
  const configUnits = isRecord(config.units) ? config.units : null;
  if (Array.isArray(rawUnits)) {
    const occupied = new Set<string>();
    for (const [index, rawUnit] of rawUnits.entries()) {
      if (validateUnit(rawUnit, errors, index, tileKeys, configUnits)) {
        const unit = rawUnit as unknown as Record<string, unknown>;
        if (typeof unit.id === 'string' && unitIds.has(unit.id)) errors.push(`duplicate state unit id: ${unit.id}`);
        if (typeof unit.id === 'string') unitIds.add(unit.id);
        if (isRecord(unit.position) && unit.actionState !== 'destroyed') {
          const key = `${unit.position.q},${unit.position.r}`;
          if (occupied.has(key)) errors.push(`multiple living units occupy ${key}`);
          occupied.add(key);
        }
      }
    }
  } else errors.push('state.units must be an array');

  const rawCheckpoints = value.checkpoints;
  const checkpointIds = new Set<string>();
  if (Array.isArray(rawCheckpoints)) {
    const checkpointTiles = new Set<string>();
    const directionsSeen = new Map<string, number>();
    const maxPerDirection = isRecord(config.checkpoint) && isNonNegativeInteger(config.checkpoint.maxPerDirection) ? config.checkpoint.maxPerDirection : null;
    for (const [index, rawCheckpoint] of rawCheckpoints.entries()) {
      const roadBranchIds = new Set<string>();
      if (mapRecord && Array.isArray(mapRecord.roadBranches)) {
        for (const rawBranch of mapRecord.roadBranches as unknown[]) if (isRecord(rawBranch) && typeof rawBranch.id === 'string') roadBranchIds.add(rawBranch.id);
      }
      if (validateCheckpoint(rawCheckpoint, errors, index, tileKeys, roadTiles, roadBranchIds, maxPerDirection, directionsSeen)) {
        const checkpoint = rawCheckpoint as unknown as Record<string, unknown>;
        if (typeof checkpoint.id === 'string' && checkpointIds.has(checkpoint.id)) errors.push(`duplicate checkpoint id: ${checkpoint.id}`);
        if (typeof checkpoint.id === 'string') checkpointIds.add(checkpoint.id);
        if (isRecord(checkpoint.position)) {
          const key = `${checkpoint.position.q},${checkpoint.position.r}`;
          if (checkpointTiles.has(key)) errors.push(`multiple checkpoints occupy ${key}`);
          checkpointTiles.add(key);
        }
      }
    }
  } else errors.push('state.checkpoints must be an array');

  const rawRoadBranches = value.roadBranches;
  const roadBranchIds = new Set<string>();
  if (Array.isArray(rawRoadBranches)) {
    const mapBranchIds = new Set<string>();
    if (mapRecord && Array.isArray(mapRecord.roadBranches)) {
      for (const rawBranch of mapRecord.roadBranches as unknown[]) {
        if (isRecord(rawBranch) && typeof rawBranch.id === 'string') mapBranchIds.add(rawBranch.id);
      }
    }
    if (mapBranchIds.size > 0 && rawRoadBranches.length !== mapBranchIds.size) errors.push('state.roadBranches count must match state.map.roadBranches');
    const activeCheckpointIds = new Set<string>();
    for (const [index, rawBranch] of rawRoadBranches.entries()) {
      const path = `state.roadBranches[${index}]`;
      if (!isRecord(rawBranch)) {
        errors.push(`${path} must be an object`);
        continue;
      }
      const idValid = requireString(errors, rawBranch.branchId, `${path}.branchId`);
      const branchId = typeof rawBranch.branchId === 'string' ? rawBranch.branchId : '';
      if (idValid) {
        if (roadBranchIds.has(branchId)) errors.push(`${path}.branchId is duplicated`);
        roadBranchIds.add(branchId);
        if (!mapBranchIds.has(branchId)) errors.push(`${path}.branchId does not refer to state.map.roadBranches`);
      }
      requireInteger(errors, rawBranch.nextArrivalTurn, `${path}.nextArrivalTurn`, 1);
      requireInteger(errors, rawBranch.checkpointActionsThisTurn, `${path}.checkpointActionsThisTurn`);
      if (typeof rawBranch.checkpointActionsThisTurn === 'number' && rawBranch.checkpointActionsThisTurn > 1) errors.push(`${path}.checkpointActionsThisTurn cannot exceed 1`);
      if (rawBranch.activeCheckpointId !== null) {
        const activeIdValid = requireString(errors, rawBranch.activeCheckpointId, `${path}.activeCheckpointId`);
        if (activeIdValid && typeof rawBranch.activeCheckpointId === 'string') {
          if (activeCheckpointIds.has(rawBranch.activeCheckpointId)) errors.push(`${path}.activeCheckpointId is duplicated`);
          activeCheckpointIds.add(rawBranch.activeCheckpointId);
          const checkpoint = Array.isArray(rawCheckpoints)
            ? rawCheckpoints.find((candidate) => isRecord(candidate) && candidate.id === rawBranch.activeCheckpointId)
            : undefined;
          if (!checkpoint || !isRecord(checkpoint) || checkpoint.status !== 'operational') errors.push(`${path}.activeCheckpointId must refer to an operational checkpoint`);
          else if (checkpoint.branchId !== branchId) errors.push(`${path}.activeCheckpointId belongs to another road branch`);
        }
      }
    }
    for (const branchId of mapBranchIds) if (!roadBranchIds.has(branchId)) errors.push(`state.roadBranches is missing ${branchId}`);
    if (Array.isArray(rawCheckpoints)) {
      for (const rawCheckpoint of rawCheckpoints) {
        if (!isRecord(rawCheckpoint) || rawCheckpoint.status !== 'operational' || typeof rawCheckpoint.branchId !== 'string') continue;
        const branchState = rawRoadBranches.find((candidate) => isRecord(candidate) && candidate.branchId === rawCheckpoint.branchId);
        if (!branchState || !isRecord(branchState) || branchState.activeCheckpointId !== rawCheckpoint.id) errors.push(`operational checkpoint ${String(rawCheckpoint.id)} must be active on its road branch`);
      }
    }
  } else errors.push('state.roadBranches must be an array');

  validateCityPopulationSnapshot(value, errors, facilities);

  const pendingOrders = value.pendingUnitProductions;
  const pendingIds = new Set<string>();
  if (Array.isArray(pendingOrders)) {
    for (const [index, rawOrder] of pendingOrders.entries()) {
      const path = `state.pendingUnitProductions[${index}]`;
      if (!isRecord(rawOrder)) {
        errors.push(`${path} must be an object`);
        continue;
      }
      requireString(errors, rawOrder.id, `${path}.id`);
      if (typeof rawOrder.id === 'string' && pendingIds.has(rawOrder.id)) errors.push(`${path}.id is duplicated`);
      if (typeof rawOrder.id === 'string') pendingIds.add(rawOrder.id);
      const city = typeof rawOrder.cityFacilityId === 'string' ? facilities.find((facility) => facility.id === rawOrder.cityFacilityId) : undefined;
      requireString(errors, rawOrder.cityFacilityId, `${path}.cityFacilityId`);
      // A reservation is retained while a city is temporarily infected or
      // lost; the engine retries it after the city becomes operational again.
      // Therefore the save only needs to ensure that the target remains a
      // known city facility, not that it is owned at this exact turn.
      if (!city || (city.type !== 'capital' && city.type !== 'city')) errors.push(`${path}.cityFacilityId must refer to a city facility`);
      requireEnum(errors, rawOrder.unitType, `${path}.unitType`, HUMAN_UNIT_TYPES);
      requireInteger(errors, rawOrder.population, `${path}.population`, 1);
      requireInteger(errors, rawOrder.readyTurn, `${path}.readyTurn`, 1);
    }
  } else errors.push('state.pendingUnitProductions must be an array');

  for (const field of ['nextCheckpointNumber', 'nextUnitNumber', 'nextEventNumber', 'nextAssignmentOrder']) requireInteger(errors, value[field], `state.${field}`);

  const horde = value.horde;
  if (isRecord(horde)) {
    for (const field of ['spawnedCount', 'totalSpawned', 'turnsRemaining']) nonNegativeInteger(errors, horde[field], `state.horde.${field}`);
    requireEnum(errors, horde.nextDirection, 'state.horde.nextDirection', CARDINAL_DIRECTIONS);
    if (horde.nextSpawnTurn !== null) requireInteger(errors, horde.nextSpawnTurn, 'state.horde.nextSpawnTurn', 1);
    if (horde.lastSpawnTurn !== null) requireInteger(errors, horde.lastSpawnTurn, 'state.horde.lastSpawnTurn', 1);
  } else errors.push('state.horde must be an object');

  const statistics = value.statistics;
  const statisticFields = ['maxPopulation', 'maxSecuredFacilities', 'civilianLosses', 'unitLosses', 'infectionLosses', 'resourceShortageLosses', 'hordeInterceptions', 'unmanagedPassThrough', 'refugeesAccepted', 'refugeesDeparted', 'checkpointsBuilt', 'checkpointsRelocated', 'checkpointRetreats', 'checkpointsRuined', 'checkpointsRecovered', 'checkpointsAbandoned', 'checkpointsRemoved', 'unmanagedBranchTurns', 'maxSuppliedFacilities', 'maxSupplyRadius', 'supplyLosses', 'supplyRejections'];
  if (isRecord(statistics)) {
    for (const field of statisticFields) nonNegativeInteger(errors, statistics[field], `state.statistics.${field}`);
    if (!requireRecord(errors, statistics.refugeeArrivalsByBranch, 'state.statistics.refugeeArrivalsByBranch')) {
      // Error already recorded by requireRecord.
    } else for (const [branchId, arrivals] of Object.entries(statistics.refugeeArrivalsByBranch)) {
      if (!roadBranchIds.has(branchId)) errors.push(`state.statistics.refugeeArrivalsByBranch contains unknown branch ${branchId}`);
      nonNegativeInteger(errors, arrivals, `state.statistics.refugeeArrivalsByBranch.${branchId}`);
    }
    if (!requireRecord(errors, statistics.refugeesScreenedByPolicy, 'state.statistics.refugeesScreenedByPolicy')) {
      // Error already recorded by requireRecord.
    } else for (const policy of CHECKPOINT_POLICIES) nonNegativeInteger(errors, statistics.refugeesScreenedByPolicy[policy], `state.statistics.refugeesScreenedByPolicy.${policy}`);
  }
  else errors.push('state.statistics must be an object');

  const events = value.events;
  if (Array.isArray(events)) {
    const eventIds = new Set<string>();
    for (const [index, rawEvent] of events.entries()) {
      const path = `state.events[${index}]`;
      if (!isRecord(rawEvent)) {
        errors.push(`${path} must be an object`);
        continue;
      }
      requireString(errors, rawEvent.id, `${path}.id`);
      if (typeof rawEvent.id === 'string' && eventIds.has(rawEvent.id)) errors.push(`${path}.id is duplicated`);
      if (typeof rawEvent.id === 'string') eventIds.add(rawEvent.id);
      requireInteger(errors, rawEvent.turn, `${path}.turn`, 1);
      if (typeof value.turn === 'number' && typeof rawEvent.turn === 'number' && rawEvent.turn > value.turn) errors.push(`${path}.turn cannot be after current turn`);
      requireEnum(errors, rawEvent.phase, `${path}.phase`, GAME_PHASES);
      requireEnum(errors, rawEvent.type, `${path}.type`, GAME_EVENT_TYPES);
      if (!requireRecord(errors, rawEvent.payload, `${path}.payload`) || !isJsonValue(rawEvent.payload)) errors.push(`${path}.payload must contain JSON values only`);
    }
  } else errors.push('state.events must be an array');

  const gameOverValid = requireBoolean(errors, value.gameOver, 'state.gameOver');
  if (value.gameOver === true && value.phase !== 'gameOver') errors.push('gameOver state must use gameOver phase');
  if (value.gameOver === false && value.phase === 'gameOver') errors.push('non-game-over state cannot use gameOver phase');
  if (value.result === null) {
    if (value.gameOver === true) errors.push('gameOver state must include a result');
  } else if (isRecord(value.result)) {
    if (value.gameOver === false) errors.push('non-game-over state cannot include a result');
    requireEnum(errors, value.result.outcome, 'state.result.outcome', ['won', 'lost'] as const);
    requireEnum(errors, value.result.reason, 'state.result.reason', GAME_OVER_REASONS);
    requireInteger(errors, value.result.turn, 'state.result.turn', 1);
    if (typeof value.turn === 'number' && typeof value.result.turn === 'number' && value.result.turn !== value.turn) errors.push('state.result.turn must match state.turn');
    if (!requireRecord(errors, value.result.statistics, 'state.result.statistics')) {
      // Error already recorded by requireRecord.
    } else {
      for (const field of statisticFields) nonNegativeInteger(errors, value.result.statistics[field], `state.result.statistics.${field}`);
      if (!requireRecord(errors, value.result.statistics.refugeeArrivalsByBranch, 'state.result.statistics.refugeeArrivalsByBranch')) {
        // Error already recorded by requireRecord.
      } else for (const [branchId, arrivals] of Object.entries(value.result.statistics.refugeeArrivalsByBranch)) {
        if (!roadBranchIds.has(branchId)) errors.push(`state.result.statistics.refugeeArrivalsByBranch contains unknown branch ${branchId}`);
        nonNegativeInteger(errors, arrivals, `state.result.statistics.refugeeArrivalsByBranch.${branchId}`);
      }
      if (!requireRecord(errors, value.result.statistics.refugeesScreenedByPolicy, 'state.result.statistics.refugeesScreenedByPolicy')) {
        // Error already recorded by requireRecord.
      } else for (const policy of CHECKPOINT_POLICIES) nonNegativeInteger(errors, value.result.statistics.refugeesScreenedByPolicy[policy], `state.result.statistics.refugeesScreenedByPolicy.${policy}`);
    }
  } else errors.push('state.result must be an object or null');
  if (gameOverValid && typeof value.gameOver === 'boolean' && value.gameOver !== (value.result !== null)) errors.push('state.gameOver and state.result must agree');

  return true;
}

function legacyValidationError(errors: string[]): SaveValidationResult {
  return { valid: false, errors: [...new Set(errors)], state: null, envelope: null };
}

/**
 * Validate the parts of the v1.2.5 schema which differ from the current one.
 * The complete state validation is performed below on a non-shared copy with
 * only the known schema differences normalized.
 */
function validateLegacySchema(value: Record<string, unknown>): string[] {
  const errors: string[] = [];
  const state = isRecord(value.state) ? value.state : null;
  if (value.gameVersion !== LEGACY_GAME_VERSION) {
    errors.push(`gameVersion must be ${LEGACY_GAME_VERSION} for migration`);
  }
  if (!state) {
    errors.push('state is required for migration');
    return errors;
  }
  if (state.gameVersion !== LEGACY_GAME_VERSION) {
    errors.push(`state.gameVersion must be ${LEGACY_GAME_VERSION} for migration`);
  }
  if (!isRecord(state.config)) {
    errors.push('state.config must be an object for migration');
    return errors;
  }
  const config = state.config;
  if (config.version !== LEGACY_GAME_VERSION) {
    errors.push(`state.config.version must be ${LEGACY_GAME_VERSION} for migration`);
  }
  const recovery = config.naturalRecovery;
  if (!isRecord(recovery)) {
    errors.push('state.config.naturalRecovery must be an object for migration');
  } else {
    if (typeof recovery.rate !== 'number' || !Number.isFinite(recovery.rate) || recovery.rate < 0 || recovery.rate > 1) {
      errors.push('state.config.naturalRecovery.rate must be between 0 and 1 for migration');
    }
    if (recovery.rounding !== 'ceil' && recovery.rounding !== 'floor') {
      errors.push('state.config.naturalRecovery.rounding must be ceil or floor for migration');
    }
  }

  const facilities = isRecord(config.facilities) ? config.facilities : null;
  if (!facilities) {
    errors.push('state.config.facilities must be an object for migration');
  } else {
    for (const type of FACILITY_TYPES) {
      const facility = facilities[type];
      if (!isRecord(facility)) {
        errors.push(`state.config.facilities.${type} must be an object for migration`);
        continue;
      }
      if (!requireInteger(errors, facility.workerCapacity, `state.config.facilities.${type}.workerCapacity`, 1)) continue;
      if ((PRODUCTION_FACILITY_TYPES as readonly string[]).includes(type) && (facility.workerCapacity as number) > Number.MAX_SAFE_INTEGER - 5) {
        errors.push(`state.config.facilities.${type}.workerCapacity is too large to migrate`);
      }
    }
  }

  const map = isRecord(state.map) ? state.map : null;
  if (map && Array.isArray(map.facilities)) {
    for (const [index, facility] of map.facilities.entries()) {
      if (!isRecord(facility)) continue;
      const path = `state.map.facilities[${index}]`;
      const capacityValid = requireInteger(errors, facility.workerCapacity, `${path}.workerCapacity`, 1);
      const type = facility.type;
      const configFacility = typeof type === 'string' && isRecord(facilities) ? facilities[type] : undefined;
      if (capacityValid && isRecord(configFacility) && typeof configFacility.workerCapacity === 'number' && facility.workerCapacity !== configFacility.workerCapacity) {
        errors.push(`${path}.workerCapacity must match state.config.facilities.${type}.workerCapacity for migration`);
      }
    }
  }
  if (Array.isArray(state.facilities)) {
    for (const [index, facility] of state.facilities.entries()) {
      if (!isRecord(facility)) continue;
      const path = `state.facilities[${index}]`;
      const capacityValid = requireInteger(errors, facility.workerCapacity, `${path}.workerCapacity`, 1);
      const type = facility.type;
      const configFacility = typeof type === 'string' && isRecord(facilities) ? facilities[type] : undefined;
      if (capacityValid && isRecord(configFacility) && typeof configFacility.workerCapacity === 'number' && facility.workerCapacity !== configFacility.workerCapacity) {
        errors.push(`${path}.workerCapacity must match state.config.facilities.${type}.workerCapacity for migration`);
      }
    }
  }
  return errors;
}

/** Normalize only schema differences in a private copy for legacy validation. */
function normalizeLegacyForValidation(value: Record<string, unknown>): Record<string, unknown> {
  const candidate = clone(value);
  const state = candidate.state as Record<string, unknown>;
  const config = state.config as Record<string, unknown>;
  const recovery = config.naturalRecovery as Record<string, unknown>;
  const rate = recovery.rate as number;
  config.version = CURRENT_GAME_VERSION;
  config.naturalRecovery = {
    combatRate: rate,
    restRate: Math.min(1, rate * 2),
    rounding: recovery.rounding,
  };
  state.gameVersion = CURRENT_GAME_VERSION;
  candidate.gameVersion = CURRENT_GAME_VERSION;

  // v1.2.5 kept a fixed-map capacity copy beside Config. Align that copy for
  // validation without changing the source snapshot or applying the +5 yet.
  synchronizeMapFacilityCapacities(candidate, config);
  const payload = {
    format: candidate.format,
    formatVersion: candidate.formatVersion,
    gameVersion: candidate.gameVersion,
    mapId: candidate.mapId,
    seed: candidate.seed,
    state: candidate.state,
  } as unknown as Omit<SaveEnvelope, 'checksum'>;
  candidate.checksum = checksum(envelopePayload(payload));
  return candidate;
}

/** Set map/state definition capacities from a copied Config snapshot. */
function synchronizeMapFacilityCapacities(
  candidate: Record<string, unknown>,
  config: Record<string, unknown>,
): void {
  const configFacilities = isRecord(config.facilities) ? config.facilities : null;
  const state = isRecord(candidate.state) ? candidate.state : null;
  const map = state && isRecord(state.map) ? state.map : null;
  if (!configFacilities || !state) return;
  const apply = (entries: unknown): void => {
    if (!Array.isArray(entries)) return;
    for (const rawFacility of entries) {
      if (!isRecord(rawFacility) || typeof rawFacility.type !== 'string') continue;
      const configFacility = configFacilities[rawFacility.type];
      if (isRecord(configFacility) && typeof configFacility.workerCapacity === 'number') {
        rawFacility.workerCapacity = configFacility.workerCapacity;
      }
    }
  };
  apply(map?.facilities);
  apply(state.facilities);
}

/** Apply the deterministic v1.2.5 -> v1.2.6 conversion to a private copy. */
function migrateLegacySnapshot(value: Record<string, unknown>): SaveValidationResult {
  const errors: string[] = [];
  if (value.format !== SAVE_FORMAT) errors.push(`unsupported save format: ${String(value.format)}`);
  if (value.formatVersion !== SAVE_FORMAT_VERSION) {
    errors.push(`unsupported save format version: ${String(value.formatVersion)}; v1.2.5 migration requires format ${SAVE_FORMAT_VERSION}`);
  }
  requireString(errors, value.mapId, 'mapId');
  if (typeof value.seed !== 'number' || !Number.isSafeInteger(value.seed)) errors.push('seed must be a safe integer');
  if (typeof value.checksum !== 'string' || !/^[0-9a-f]{8}$/u.test(value.checksum)) errors.push('checksum is invalid');
  const state = isRecord(value.state) ? value.state : null;
  if (!state) errors.push('state is required');
  if (state && state.gameVersion !== value.gameVersion) errors.push('state/gameVersion does not match envelope');
  if (state && state.mapId !== value.mapId) errors.push('state/mapId does not match envelope');
  if (state && state.seed !== value.seed) errors.push('state/seed does not match envelope');
  if (errors.length > 0) return legacyValidationError(errors);

  const payload = {
    format: value.format,
    formatVersion: value.formatVersion,
    gameVersion: value.gameVersion,
    mapId: value.mapId,
    seed: value.seed,
    state: value.state,
  } as unknown as Omit<SaveEnvelope, 'checksum'>;
  if (checksum(envelopePayload(payload)) !== value.checksum) errors.push('checksum mismatch in v1.2.5 save');
  errors.push(...validateLegacySchema(value));
  if (errors.length > 0) return legacyValidationError(errors);

  let validationCopy: Record<string, unknown>;
  try {
    validationCopy = normalizeLegacyForValidation(value);
  } catch (error) {
    return legacyValidationError([`v1.2.5 save could not be prepared for validation: ${error instanceof Error ? error.message : String(error)}`]);
  }
  const legacyValidation = validateSnapshot(validationCopy);
  if (!legacyValidation.valid) {
    return legacyValidationError(legacyValidation.errors.map((error) => `invalid v1.2.5 save: ${error}`));
  }

  let migrated: Record<string, unknown>;
  try {
    migrated = clone(value);
    const migratedState = migrated.state as Record<string, unknown>;
    const config = migratedState.config as Record<string, unknown>;
    const recovery = config.naturalRecovery as Record<string, unknown>;
    const rate = recovery.rate as number;
    const configFacilities = config.facilities as Record<string, unknown>;
    for (const type of PRODUCTION_FACILITY_TYPES) {
      const facility = configFacilities[type] as Record<string, unknown>;
      facility.workerCapacity = (facility.workerCapacity as number) + 5;
    }
    config.version = CURRENT_GAME_VERSION;
    config.naturalRecovery = {
      combatRate: rate,
      restRate: Math.min(1, rate * 2),
      rounding: recovery.rounding,
    };
    migratedState.gameVersion = CURRENT_GAME_VERSION;
    migrated.gameVersion = CURRENT_GAME_VERSION;
    synchronizeMapFacilityCapacities(migrated, config);
    const migratedPayload = {
      format: migrated.format,
      formatVersion: migrated.formatVersion,
      gameVersion: migrated.gameVersion,
      mapId: migrated.mapId,
      seed: migrated.seed,
      state: migrated.state,
    } as unknown as Omit<SaveEnvelope, 'checksum'>;
    migrated.checksum = checksum(envelopePayload(migratedPayload));
  } catch (error) {
    return legacyValidationError([`v1.2.5 save migration failed: ${error instanceof Error ? error.message : String(error)}`]);
  }

  const result = validateSnapshot(migrated);
  if (!result.valid) {
    return legacyValidationError(result.errors.map((error) => `migrated save is invalid: ${error}`));
  }
  return { ...result, migrated: true };
}

/** Validate a decoded snapshot before it can reach GameEngine.LoadSnapshot. */
export function validateSnapshot(value: unknown): SaveValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) return { valid: false, errors: ['Save envelope must be an object'], state: null, envelope: null };
  if (value.gameVersion === LEGACY_GAME_VERSION) return migrateLegacySnapshot(value);
  // Inspect versions before returning on envelope errors so old saves always get
  // the actionable incompatibility message rather than a generic parse error.
  addVersionValidation(errors, value.gameVersion, 'gameVersion');
  const nestedState = isRecord(value.state) ? value.state : null;
  if (nestedState && typeof nestedState.gameVersion === 'string' && nestedState.gameVersion !== CURRENT_GAME_VERSION) addVersionValidation(errors, nestedState.gameVersion, 'state.gameVersion');
  // v1.0 exports used `version` in a few envelope/state variants.  Inspect it
  // even when a nested state exists so every legacy representation receives
  // the same explicit incompatibility explanation.
  if (typeof value.gameVersion !== 'string' && typeof value.version === 'string') addVersionValidation(errors, value.version, 'version');
  if (nestedState && typeof nestedState.gameVersion !== 'string' && typeof nestedState.version === 'string') addVersionValidation(errors, nestedState.version, 'state.version');
  if (value.format !== SAVE_FORMAT) errors.push(`unsupported save format: ${String(value.format)}`);
  if (value.formatVersion !== SAVE_FORMAT_VERSION) errors.push(`unsupported save format version: ${String(value.formatVersion)}; v1.2 and earlier saves are incompatible`);
  requireString(errors, value.mapId, 'mapId');
  if (typeof value.seed !== 'number' || !Number.isSafeInteger(value.seed)) errors.push('seed must be a safe integer');
  if (typeof value.checksum !== 'string' || !/^[0-9a-f]{8}$/u.test(value.checksum)) errors.push('checksum is invalid');
  if (!nestedState) errors.push('state is required');
  if (!nestedState || value.format !== SAVE_FORMAT || value.formatVersion !== SAVE_FORMAT_VERSION || typeof value.mapId !== 'string' || typeof value.seed !== 'number' || typeof value.checksum !== 'string') return { valid: false, errors: [...new Set(errors)], state: null, envelope: null };

  const payload = { format: value.format, formatVersion: value.formatVersion, gameVersion: value.gameVersion, mapId: value.mapId, seed: value.seed, state: nestedState } as unknown as Omit<SaveEnvelope, 'checksum'>;
  if (checksum(envelopePayload(payload)) !== value.checksum) errors.push('checksum mismatch');
  if (nestedState.gameVersion !== value.gameVersion) errors.push('state/gameVersion does not match envelope');
  if (nestedState.mapId !== value.mapId) errors.push('state/mapId does not match envelope');
  if (nestedState.seed !== value.seed) errors.push('state/seed does not match envelope');
  validateGameState(nestedState, errors);
  const uniqueErrors = [...new Set(errors)];
  if (uniqueErrors.length > 0) return { valid: false, errors: uniqueErrors, state: null, envelope: null };

  const state = clone(nestedState as unknown as GameState);
  try {
    const invariantResult = validateInvariants(state);
    if (!invariantResult.valid) return { valid: false, errors: invariantResult.errors.map((error) => `invariant: ${error}`), state: null, envelope: null };
  } catch (error) {
    return { valid: false, errors: [`invariant: could not validate snapshot structure (${error instanceof Error ? error.message : String(error)})`], state: null, envelope: null };
  }
  const envelope: SaveEnvelope = { format: SAVE_FORMAT, formatVersion: SAVE_FORMAT_VERSION, gameVersion: value.gameVersion as string, mapId: value.mapId as string, seed: value.seed as number, state, checksum: value.checksum as string };
  return { valid: true, errors: [], state: clone(state), envelope };
}

/** Create a checksummed, URL-safe save code from a complete GameState. */
export function encodeSaveCode(state: GameState): string {
  const envelope = makeEnvelope(state);
  const compressed = gzipSync(strToU8(canonicalJson(envelope)), { level: 9 });
  return toBase64Url(compressed);
}

/** Decode and validate a save code without mutating any caller-owned object. */
export function decodeSaveCode(code: string): SaveValidationResult {
  if (typeof code !== 'string' || code.trim().length === 0) return { valid: false, errors: ['Save code is empty'], state: null, envelope: null };
  try {
    const compressed = fromBase64Url(code.trim());
    if (compressed.length < 2 || compressed[0] !== 0x1f || compressed[1] !== 0x8b) return { valid: false, errors: ['Save code is not gzip-compressed'], state: null, envelope: null };
    const parsed: unknown = JSON.parse(strFromU8(gunzipSync(compressed)));
    return validateSnapshot(parsed);
  } catch (error) {
    return { valid: false, errors: [`Save code could not be decoded: ${error instanceof Error ? error.message : String(error)}`], state: null, envelope: null };
  }
}

export function exportSaveJson(state: GameState): string {
  return `${JSON.stringify(makeEnvelope(state), null, 2)}\n`;
}

export function importSaveJson(json: string): SaveValidationResult {
  if (typeof json !== 'string' || json.trim().length === 0) return { valid: false, errors: ['Save JSON is empty'], state: null, envelope: null };
  try {
    return validateSnapshot(JSON.parse(json) as unknown);
  } catch (error) {
    return { valid: false, errors: [`Save JSON could not be parsed: ${error instanceof Error ? error.message : String(error)}`], state: null, envelope: null };
  }
}

function browserStorage(): StorageLike | null {
  try {
    if (typeof globalThis.localStorage === 'undefined') return null;
    return globalThis.localStorage;
  } catch {
    return null;
  }
}

/** Browser local autosave adapter. All failures are returned and optionally announced. */
export class AutoSaveStore {
  private readonly storage: StorageLike | null;
  private readonly key: string;
  private readonly legacyKey: string | null;
  private readonly onError?: SaveErrorListener;

  constructor(options: { key?: string; storage?: StorageLike | null; onError?: SaveErrorListener } = {}) {
    this.key = options.key ?? DEFAULT_AUTOSAVE_KEY;
    this.legacyKey = options.key === undefined ? LEGACY_AUTOSAVE_KEY : null;
    this.storage = options.storage === undefined ? browserStorage() : options.storage;
    this.onError = options.onError;
  }

  save(state: GameState): SaveOperationResult {
    const oldVersion = versionError(state?.gameVersion);
    if (oldVersion) {
      this.onError?.(oldVersion);
      return { ok: false, code: null, error: oldVersion };
    }
    if (!this.storage) {
      const message = 'ブラウザのローカル保存領域を利用できません。セーブコードを使用してください。';
      this.onError?.(message);
      return { ok: false, code: null, error: message };
    }
    try {
      const code = encodeSaveCode(state);
      this.storage.setItem(this.key, code);
      return { ok: true, code, error: null };
    } catch (error) {
      const message = `自動保存に失敗しました: ${error instanceof Error ? error.message : String(error)}`;
      this.onError?.(message, error);
      return { ok: false, code: null, error: message };
    }
  }

  load(): SaveValidationResult {
    if (!this.storage) return { valid: false, errors: ['ブラウザのローカル保存領域を利用できません'], state: null, envelope: null };
    try {
      const currentCode = this.storage.getItem(this.key);
      if (currentCode) return decodeSaveCode(currentCode);
      // A legacy key is intentionally read-only. Loading it may show the
      // incompatibility message, but it must never be migrated or removed.
      const legacyCode = this.legacyKey ? this.storage.getItem(this.legacyKey) : null;
      if (legacyCode) return decodeSaveCode(legacyCode);
      return { valid: false, errors: ['保存データがありません'], state: null, envelope: null };
    } catch (error) {
      return { valid: false, errors: [`自動保存を読み込めません: ${error instanceof Error ? error.message : String(error)}`], state: null, envelope: null };
    }
  }

  hasSave(): boolean {
    if (!this.storage) return false;
    try {
      return this.storage.getItem(this.key) !== null || (this.legacyKey !== null && this.storage.getItem(this.legacyKey) !== null);
    } catch {
      return false;
    }
  }

  clear(): void {
    try {
      this.storage?.removeItem?.(this.key);
    } catch (error) {
      this.onError?.(`自動保存の削除に失敗しました: ${error instanceof Error ? error.message : String(error)}`, error);
    }
  }
}
