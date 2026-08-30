import { gzipSync, gunzipSync, strFromU8, strToU8 } from 'fflate';
import { validateGameConfig } from '../core/config';
import { validateInvariants } from '../core/invariants';
import { validateFixedMap } from '../core/map';
import { GAME_VERSION } from '../core/state';
import type { GameState, JsonValue } from '../core/types';

/** The sole game-rules version accepted by v1.3 saves. */
export const CURRENT_GAME_VERSION = GAME_VERSION;
export const SAVE_GAME_VERSION = CURRENT_GAME_VERSION;
export const SAVE_FORMAT = 'nowhere-left-to-hide-save';
export const SAVE_FORMAT_VERSION = 3;
/** v1.3 never writes to an earlier autosave namespace. */
export const DEFAULT_AUTOSAVE_KEY = 'nowhere-left-to-hide:auto-save:v3';
/** Read-only compatibility probe for the v1.2.7 autosave namespace. */
export const LEGACY_AUTOSAVE_KEY = 'nowhere-left-to-hide:auto-save:v2';
const OLDER_AUTOSAVE_KEY = 'nowhere-left-to-hide:auto-save:v1';
/** Deprecated metadata exports. They are never migration targets in v1.3. */
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
}

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem?(key: string): void;
}

export type SaveErrorListener = (message: string, error?: unknown) => void;

const BASE_TERRAINS = ['plain', 'forest', 'mountain', 'water'] as const;
const UNIT_TYPES = ['police', 'nationalGuard', 'zombie', 'hordeZombie'] as const;
const HORDE_KINDS = ['periodic', 'final'] as const;
const HORDE_WARNING_TYPES = ['periodic', 'final', 'none'] as const;
const FINAL_HORDE_STATUSES = ['notStarted', 'active', 'defeated'] as const;

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
  return `${subject} is incompatible with v1.3.2 / Game Rules ${CURRENT_GAME_VERSION} / Save Format 3 (found ${String(found)}; expected ${CURRENT_GAME_VERSION}). 現在のゲーム状態は変更されません。`;
}

function reject(errors: string[]): SaveValidationResult {
  return { valid: false, errors: uniqueErrors(errors), state: null, envelope: null };
}

function requireFields(errors: string[], value: Record<string, unknown>, path: string, fields: readonly string[]): void {
  for (const field of fields) if (!hasOwn(value, field)) errors.push(`${path}.${field} is required for Save Format 3`);
}

function validateCoordinate(errors: string[], value: unknown, path: string): void {
  if (!isRecord(value) || !isInteger(value.q) || !isInteger(value.r) || value.q >= 15 || value.r >= 15) {
    errors.push(`${path} must be an in-bounds axial coordinate`);
  }
}

/**
 * Reject obsolete container shapes before casting. The core invariant checker
 * performs relational validation; this guard makes v1.3 additions an explicit
 * save boundary instead of silently accepting partial or migrated snapshots.
 */
function validateV13Shape(state: Record<string, unknown>, errors: string[]): void {
  requireFields(errors, state, 'state', [
    'gameVersion', 'config', 'seed', 'rngState', 'turn', 'finalHordeTurn', 'actionsTakenThisTurn',
    'phase', 'mapId', 'map', 'facilities', 'population', 'cityPopulationSnapshot', 'resources',
    'units', 'checkpoints', 'roadBranches', 'pendingUnitProductions', 'nextCheckpointNumber',
    'nextUnitNumber', 'nextEventNumber', 'nextAssignmentOrder', 'horde', 'events', 'statistics',
    'gameOver', 'result',
  ]);
  if (hasOwn(state, 'maxTurns')) errors.push('state.maxTurns is obsolete; use state.finalHordeTurn');
  if (!isInteger(state.finalHordeTurn, 1)) errors.push('state.finalHordeTurn must be a positive integer');
  if (!isInteger(state.turn, 1)) errors.push('state.turn must be a positive integer');

  const config = state.config;
  if (!isRecord(config)) {
    errors.push('state.config must be an object');
  } else {
    requireFields(errors, config, 'state.config', ['version', 'mapId', 'finalHordeTurn', 'terrain', 'vision', 'horde', 'units']);
    if (hasOwn(config, 'maxTurns')) errors.push('state.config.maxTurns is obsolete; use finalHordeTurn');
    if (config.version !== CURRENT_GAME_VERSION) errors.push(incompatibilityError(config.version, 'state.config.version'));
    if (config.finalHordeTurn !== state.finalHordeTurn) errors.push('state.finalHordeTurn must match state.config.finalHordeTurn');
    const terrain = config.terrain;
    if (!isRecord(terrain) || !isRecord(terrain.movementCost) || !isRecord(terrain.damageMultiplier)) {
      errors.push('state.config.terrain must contain movementCost and damageMultiplier');
    } else {
      for (const terrainType of BASE_TERRAINS) {
        const cost = terrain.movementCost[terrainType];
        if (terrainType === 'water' ? cost !== null : !isInteger(cost, 1)) errors.push(`state.config.terrain.movementCost.${terrainType} is invalid`);
      }
    }
    if (!isRecord(config.vision) || !isInteger(config.vision.ownedFacility) || !isInteger(config.vision.operationalCheckpoint)) errors.push('state.config.vision is invalid');
    if (!isRecord(config.horde)) {
      errors.push('state.config.horde must be an object');
    } else {
      for (const field of ['periodicInitial', 'periodicIncrement', 'finalComposition'] as const) {
        const composition = config.horde[field];
        if (!isRecord(composition) || !isInteger(composition.hordeZombie) || !isInteger(composition.zombie)) {
          errors.push(`state.config.horde.${field} is invalid`);
        }
      }
    }
    if (!isRecord(config.units)) {
      errors.push('state.config.units must be an object');
    } else {
      for (const type of UNIT_TYPES) if (!isRecord(config.units[type]) || !isInteger(config.units[type].vision)) errors.push(`state.config.units.${type}.vision is required`);
    }
  }

  const map = state.map;
  if (!isRecord(map) || !Array.isArray(map.tiles)) {
    errors.push('state.map.tiles must be an array');
  } else {
    for (const [index, tile] of map.tiles.entries()) {
      if (!isRecord(tile) || !BASE_TERRAINS.includes(tile.terrain as typeof BASE_TERRAINS[number])) {
        errors.push(`state.map.tiles[${index}].terrain is invalid`);
        continue;
      }
      if (tile.movementCost !== null && !isInteger(tile.movementCost, 1)) errors.push(`state.map.tiles[${index}].movementCost is invalid`);
    }
  }

  if (!Array.isArray(state.units)) {
    errors.push('state.units must be an array');
  } else {
    for (const [index, unit] of state.units.entries()) {
      const path = `state.units[${index}]`;
      if (!isRecord(unit)) {
        errors.push(`${path} must be an object`);
        continue;
      }
      if (!UNIT_TYPES.includes(unit.type as typeof UNIT_TYPES[number])) errors.push(`${path}.type is invalid`);
      if (!isInteger(unit.vision)) errors.push(`${path}.vision is required`);
      if (unit.inheritedTarget !== null) validateCoordinate(errors, unit.inheritedTarget, `${path}.inheritedTarget`);
      if (unit.spawnGroupId !== null && (typeof unit.spawnGroupId !== 'string' || unit.spawnGroupId.length === 0)) errors.push(`${path}.spawnGroupId is invalid`);
      if (unit.hordeKind !== null && !HORDE_KINDS.includes(unit.hordeKind as typeof HORDE_KINDS[number])) errors.push(`${path}.hordeKind is invalid`);
      if (unit.type === 'hordeZombie' && unit.hordeKind === null) errors.push(`${path}.hordeZombie requires hordeKind`);
    }
  }

  const horde = state.horde;
  if (!isRecord(horde)) {
    errors.push('state.horde must be an object');
  } else {
    requireFields(errors, horde, 'state.horde', ['warningType', 'finalHordeStatus', 'finalSpawnGroupId', 'finalSpawnedCount']);
    if (!HORDE_WARNING_TYPES.includes(horde.warningType as typeof HORDE_WARNING_TYPES[number])) errors.push('state.horde.warningType is invalid');
    if (!FINAL_HORDE_STATUSES.includes(horde.finalHordeStatus as typeof FINAL_HORDE_STATUSES[number])) errors.push('state.horde.finalHordeStatus is invalid');
    if (horde.finalSpawnGroupId !== null && (typeof horde.finalSpawnGroupId !== 'string' || horde.finalSpawnGroupId.length === 0)) errors.push('state.horde.finalSpawnGroupId is invalid');
    if (!isInteger(horde.finalSpawnedCount)) errors.push('state.horde.finalSpawnedCount is invalid');
  }

  const statistics = state.statistics;
  const statisticFields = [
    'finalHordeSpawned', 'finalHordeKilled', 'normalZombiesKilled', 'hordeZombiesKilled', 'maxVisibleZombies',
    'periodicHordeZombiesSpawned', 'periodicNormalZombiesSpawned',
    'finalHordeZombiesSpawned', 'finalNormalZombiesSpawned',
    'turnsAfterFinalHorde', 'urbanDefenseApplications', 'urbanDefenseDamagePrevented',
    'forestDefenseApplications', 'forestDefenseDamagePrevented', 'normalZombieIdleCount',
    'hordeTargetInheritedCount', 'hordeTargetClearedCount',
  ];
  if (!isRecord(statistics)) {
    errors.push('state.statistics must be an object');
  } else {
    requireFields(errors, statistics, 'state.statistics', [
      ...statisticFields, 'finalHordeDefeated', 'suppliedAreaZombieClearTurn', 'suppliedAreaInfectionClearTurn',
      'victoryTurn', 'terrainEntriesByType',
    ]);
    for (const field of statisticFields) if (!isInteger(statistics[field])) errors.push(`state.statistics.${field} is invalid`);
    if (typeof statistics.finalHordeDefeated !== 'boolean') errors.push('state.statistics.finalHordeDefeated is invalid');
    for (const field of ['suppliedAreaZombieClearTurn', 'suppliedAreaInfectionClearTurn', 'victoryTurn']) if (statistics[field] !== null && !isInteger(statistics[field], 1)) errors.push(`state.statistics.${field} is invalid`);
    if (!isRecord(statistics.terrainEntriesByType)) {
      errors.push('state.statistics.terrainEntriesByType is invalid');
    } else {
      for (const terrainType of BASE_TERRAINS) if (!isInteger(statistics.terrainEntriesByType[terrainType])) errors.push(`state.statistics.terrainEntriesByType.${terrainType} is invalid`);
    }
  }

  if (!Array.isArray(state.events) || !state.events.every(isJsonValue)) errors.push('state.events must contain JSON-compatible events');

  if (state.result !== null) {
    if (!isRecord(state.result)) {
      errors.push('state.result must be an object or null');
    } else {
      requireFields(errors, state.result, 'state.result', ['outcome', 'reason', 'turn', 'statistics']);
      if (!isRecord(state.result.statistics)) {
        errors.push('state.result.statistics must be an object');
      } else {
        requireFields(errors, state.result.statistics, 'state.result.statistics', [
          ...statisticFields, 'finalHordeDefeated', 'suppliedAreaZombieClearTurn',
          'suppliedAreaInfectionClearTurn', 'victoryTurn', 'terrainEntriesByType',
        ]);
      }
    }
  }
}

function validateStateForSave(state: GameState): string[] {
  const errors: string[] = [];
  const raw = state as unknown as Record<string, unknown>;
  validateV13Shape(raw, errors);
  if (raw.gameVersion !== CURRENT_GAME_VERSION) errors.push(incompatibilityError(raw.gameVersion, 'state.gameVersion'));
  const config = isRecord(raw.config) ? raw.config : null;
  const map = isRecord(raw.map) ? raw.map : null;
  if (!config || !map) return uniqueErrors(errors);
  if (raw.mapId !== config.mapId) errors.push('state.mapId must match state.config.mapId');
  try {
    const configResult = validateGameConfig(config as unknown as GameState['config']);
    if (!configResult.valid) errors.push(...configResult.errors.map((error) => `config: ${error}`));
  } catch (error) {
    errors.push(`config validation failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  try {
    const mapResult = validateFixedMap(map as unknown as GameState['map']);
    if (!mapResult.valid) errors.push(...mapResult.errors.map((error) => `map: ${error}`));
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
  if (value.formatVersion !== SAVE_FORMAT_VERSION) errors.push(`unsupported save format version: ${String(value.formatVersion)}; v1.3.1 and earlier saves cannot be loaded`);
  if (value.gameVersion !== CURRENT_GAME_VERSION) errors.push(incompatibilityError(value.gameVersion, 'gameVersion'));
  if (typeof value.mapId !== 'string' || value.mapId.length === 0) errors.push('mapId must be a non-empty string');
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

/** Create a checksummed, URL-safe v1.3 save code. */
export function encodeSaveCode(state: GameState): string {
  const errors = validateStateForSave(state);
  if (errors.length > 0) throw new Error(`State cannot be saved: ${errors.join('; ')}`);
  return toBase64Url(gzipSync(strToU8(canonicalJson(makeEnvelope(state))), { level: 9 }));
}

/** Decode and validate a v1.3 save code without changing caller-owned state. */
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
    this.legacyKeys = options.key === undefined ? [LEGACY_AUTOSAVE_KEY, OLDER_AUTOSAVE_KEY] : [];
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

  /** Clears only the v1.3 key; legacy data is deliberately preserved. */
  clear(): void {
    try {
      this.storage?.removeItem?.(this.key);
    } catch (error) {
      this.onError?.(`自動保存の削除に失敗しました: ${error instanceof Error ? error.message : String(error)}`, error);
    }
  }
}
