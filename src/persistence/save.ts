import { gzipSync, gunzipSync, strFromU8, strToU8 } from 'fflate';
import { validateGameConfig } from '../core/config';
import { validateInvariants } from '../core/invariants';
import { validateFixedMap } from '../core/map';
import type {
  CheckpointState,
  FacilityState,
  GameState,
  UnitState,
} from '../core/types';

/**
 * Save format is deliberately independent from the game version.  A future
 * game version may still be able to migrate an older save envelope, while an
 * unknown envelope version must never be applied to the running game.
 */
export const SAVE_FORMAT = 'nowhere-left-to-hide-save';
export const SAVE_FORMAT_VERSION = 1;
export const DEFAULT_AUTOSAVE_KEY = 'nowhere-left-to-hide:auto-save:v1';

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

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** Sort object keys while keeping array ordering stable for deterministic saves. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalize(entry));
  }
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

  // Node's global btoa is available on supported runtimes, but this fallback
  // keeps the helper usable in older test runners without bundling Buffer.
  const nodeBuffer = (globalThis as unknown as {
    Buffer?: { from(data: Uint8Array): { toString(encoding: string): string } };
  }).Buffer;
  if (nodeBuffer) {
    return nodeBuffer.from(bytes).toString('base64');
  }
  throw new Error('Base64 encoder is unavailable in this environment');
}

function base64ToBytes(value: string): Uint8Array {
  if (typeof globalThis.atob === 'function') {
    const binary = globalThis.atob(value);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  }

  const nodeBuffer = (globalThis as unknown as {
    Buffer?: { from(data: string, encoding: string): Uint8Array };
  }).Buffer;
  if (nodeBuffer) {
    return nodeBuffer.from(value, 'base64');
  }
  throw new Error('Base64 decoder is unavailable in this environment');
}

function toBase64Url(value: Uint8Array): string {
  return bytesToBase64(value)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
}

function fromBase64Url(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]*$/u.test(value)) {
    throw new Error('Save code contains an invalid Base64URL character');
  }
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

function nonNegative(errors: string[], value: unknown, path: string): void {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    errors.push(`${path} must be a finite number >= 0`);
  }
}

function validateUnit(state: GameState, unit: UnitState, errors: string[], index: number): void {
  const path = `state.units[${index}]`;
  if (!unit || typeof unit !== 'object') {
    errors.push(`${path} must be an object`);
    return;
  }
  if (typeof unit.id !== 'string' || unit.id.length === 0) errors.push(`${path}.id is required`);
  const mapTiles = Array.isArray(state.map?.tiles) ? state.map.tiles : [];
  if (!mapTiles.some((tile) => tile.q === unit.position?.q && tile.r === unit.position?.r)) {
    errors.push(`${path}.position is outside the map`);
  }
  for (const key of ['hp', 'maxHp', 'attack', 'movement', 'range', 'population'] as const) {
    nonNegative(errors, unit[key], `${path}.${key}`);
  }
  if (unit.hp > unit.maxHp) errors.push(`${path}.hp cannot exceed maxHp`);
  if (unit.actionState === 'destroyed' && unit.hp !== 0) {
    errors.push(`${path} destroyed unit must have hp 0`);
  }
}

function validateFacility(facility: FacilityState, errors: string[], index: number): void {
  const path = `state.facilities[${index}]`;
  if (!facility || typeof facility !== 'object') {
    errors.push(`${path} must be an object`);
    return;
  }
  nonNegative(errors, facility.workers, `${path}.workers`);
  nonNegative(errors, facility.infected, `${path}.infected`);
  if (facility.workers + facility.infected > facility.workerCapacity) {
    errors.push(`${path}.workers and infected exceed workerCapacity`);
  }
}

function validateCheckpoint(checkpoint: CheckpointState, errors: string[], index: number): void {
  const path = `state.checkpoints[${index}]`;
  if (!checkpoint || typeof checkpoint !== 'object') {
    errors.push(`${path} must be an object`);
    return;
  }
  for (const key of ['waiting', 'screening', 'remainingTurns'] as const) {
    nonNegative(errors, checkpoint[key], `${path}.${key}`);
  }
}

/** Validate a decoded snapshot before it can reach GameEngine.LoadSnapshot. */
export function validateSnapshot(value: unknown): SaveValidationResult {
  const errors: string[] = [];
  if (!isRecord(value)) {
    return { valid: false, errors: ['Save envelope must be an object'], state: null, envelope: null };
  }
  if (value.format !== SAVE_FORMAT) errors.push(`unsupported save format: ${String(value.format)}`);
  if (value.formatVersion !== SAVE_FORMAT_VERSION) errors.push('unsupported save format version');
  if (typeof value.gameVersion !== 'string' || value.gameVersion.length === 0) errors.push('gameVersion is required');
  if (typeof value.mapId !== 'string' || value.mapId.length === 0) errors.push('mapId is required');
  if (typeof value.seed !== 'number' || !Number.isInteger(value.seed)) errors.push('seed must be an integer');
  if (typeof value.checksum !== 'string' || !/^[0-9a-f]{8}$/u.test(value.checksum)) errors.push('checksum is invalid');
  if (!isRecord(value.state)) errors.push('state is required');
  if (errors.length > 0) return { valid: false, errors, state: null, envelope: null };

  const state = value.state as unknown as GameState;
  const payload = {
    format: value.format,
    formatVersion: value.formatVersion,
    gameVersion: value.gameVersion,
    mapId: value.mapId,
    seed: value.seed,
    state,
  } as Omit<SaveEnvelope, 'checksum'>;
  if (checksum(envelopePayload(payload)) !== value.checksum) errors.push('checksum mismatch');
  if (state.gameVersion !== value.gameVersion) errors.push('state/gameVersion does not match envelope');
  if (state.mapId !== value.mapId) errors.push('state/mapId does not match envelope');
  if (state.seed !== value.seed) errors.push('state/seed does not match envelope');

  const configResult = validateGameConfig(state.config);
  if (!configResult.valid) errors.push(...configResult.errors.map((error) => `config: ${error}`));
  const mapResult = validateFixedMap(state.map);
  if (!mapResult.valid) errors.push(...mapResult.errors.map((error) => `map: ${error}`));
  if (isRecord(state.config) && state.mapId !== state.config.mapId) errors.push('mapId must match config.mapId');
  if (!Number.isInteger(state.turn) || state.turn < 1 || state.turn > state.maxTurns) {
    errors.push('turn must be between 0 and maxTurns');
  }
  if (!Number.isInteger(state.maxTurns) || state.maxTurns < 1) errors.push('maxTurns must be a positive integer');
  if (
    isRecord(state.map) &&
    isRecord(state.config) &&
    isRecord(state.population) &&
    isRecord(state.resources) &&
    Array.isArray(state.facilities) &&
    Array.isArray(state.units) &&
    Array.isArray(state.checkpoints)
  ) {
    try {
      const invariantResult = validateInvariants(state);
      if (!invariantResult.valid) errors.push(...invariantResult.errors.map((error) => `invariant: ${error}`));
    } catch (error) {
      errors.push(`invariant: could not validate snapshot structure (${error instanceof Error ? error.message : String(error)})`);
    }
  }

  const population = state.population;
  if (!population || typeof population !== 'object') {
    errors.push('population is required');
  } else {
    for (const key of [
      'employed',
      'unemployed',
      'police',
      'nationalGuard',
      'unitPopulation',
      'waitingRefugees',
      'screeningRefugees',
      'facilityInfected',
    ] as const) nonNegative(errors, population[key], `population.${key}`);
  }
  const resources = state.resources;
  if (!resources || typeof resources !== 'object') {
    errors.push('resources is required');
  } else {
    for (const key of ['food', 'civilianGoods', 'militaryGoods', 'fuel', 'electricityCapacity', 'electricityRequired'] as const) {
      nonNegative(errors, resources[key], `resources.${key}`);
    }
  }
  if (!Array.isArray(state.units)) errors.push('units must be an array');
  if (!Array.isArray(state.facilities)) errors.push('facilities must be an array');
  if (!Array.isArray(state.checkpoints)) errors.push('checkpoints must be an array');
  for (const [index, unit] of (state.units ?? []).entries()) validateUnit(state, unit, errors, index);
  for (const [index, facility] of (state.facilities ?? []).entries()) validateFacility(facility, errors, index);
  for (const [index, checkpoint] of (state.checkpoints ?? []).entries()) validateCheckpoint(checkpoint, errors, index);

  const occupied = new Map<string, string>();
  for (const unit of state.units ?? []) {
    if (!unit || typeof unit !== 'object' || !unit.position || typeof unit.position !== 'object') continue;
    if (unit.actionState === 'destroyed') continue;
    const key = `${unit.position.q},${unit.position.r}`;
    const previous = occupied.get(key);
    if (previous) errors.push(`multiple living units occupy ${key}: ${previous}, ${unit.id}`);
    occupied.set(key, unit.id);
  }

  const envelope: SaveEnvelope = {
    format: SAVE_FORMAT,
    formatVersion: SAVE_FORMAT_VERSION,
    gameVersion: value.gameVersion as string,
    mapId: value.mapId as string,
    seed: value.seed as number,
    state: clone(state),
    checksum: value.checksum as string,
  };
  return { valid: errors.length === 0, errors, state: errors.length === 0 ? clone(state) : null, envelope: errors.length === 0 ? envelope : null };
}

/** Create a checksummed, URL-safe save code from a complete GameState. */
export function encodeSaveCode(state: GameState): string {
  const envelope = makeEnvelope(state);
  const compressed = gzipSync(strToU8(canonicalJson(envelope)), { level: 9 });
  return toBase64Url(compressed);
}

/** Decode and validate a save code without mutating any caller-owned object. */
export function decodeSaveCode(code: string): SaveValidationResult {
  if (typeof code !== 'string' || code.trim().length === 0) {
    return { valid: false, errors: ['Save code is empty'], state: null, envelope: null };
  }
  try {
    const compressed = fromBase64Url(code.trim());
    if (compressed[0] !== 0x1f || compressed[1] !== 0x8b) {
      return { valid: false, errors: ['Save code is not gzip-compressed'], state: null, envelope: null };
    }
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
  if (typeof json !== 'string' || json.trim().length === 0) {
    return { valid: false, errors: ['Save JSON is empty'], state: null, envelope: null };
  }
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
  private readonly onError?: SaveErrorListener;

  constructor(options: { key?: string; storage?: StorageLike | null; onError?: SaveErrorListener } = {}) {
    this.key = options.key ?? DEFAULT_AUTOSAVE_KEY;
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
    if (!this.storage) {
      return { valid: false, errors: ['ブラウザのローカル保存領域を利用できません'], state: null, envelope: null };
    }
    try {
      const code = this.storage.getItem(this.key);
      if (!code) return { valid: false, errors: ['保存データがありません'], state: null, envelope: null };
      return decodeSaveCode(code);
    } catch (error) {
      return { valid: false, errors: [`自動保存を読み込めません: ${error instanceof Error ? error.message : String(error)}`], state: null, envelope: null };
    }
  }

  hasSave(): boolean {
    if (!this.storage) return false;
    try {
      return this.storage.getItem(this.key) !== null;
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
