import { gzipSync, strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from '../core/config';
import { GameEngine, getCheckpointPositionCandidates } from '../core/engine';
import { createInitialState } from '../core/state';
import type { GameState } from '../core/types';
import {
  AutoSaveStore,
  CURRENT_GAME_VERSION,
  DEFAULT_AUTOSAVE_KEY,
  LEGACY_AUTOSAVE_KEY,
  SAVE_FORMAT,
  SAVE_FORMAT_VERSION,
  checksum,
  decodeSaveCode,
  encodeSaveCode,
  exportSaveJson,
  importSaveJson,
  type StorageLike,
} from './save';

function initialState(seed = 42): GameState {
  return createInitialState(seed, createDefaultConfig());
}

class MemoryStorage implements StorageLike {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(record).sort().map((key) => [key, canonicalize(record[key])]));
  }
  return value;
}

function resign(envelope: Record<string, unknown>): Record<string, unknown> {
  const { checksum: _ignored, ...payload } = envelope;
  return { ...payload, checksum: checksum(JSON.stringify(canonicalize(payload))) };
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return globalThis.btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '');
}

function codeForEnvelope(envelope: Record<string, unknown>): string {
  return base64Url(gzipSync(strToU8(JSON.stringify(envelope))));
}

function exportedEnvelope(state = initialState()): Record<string, unknown> {
  return JSON.parse(exportSaveJson(state)) as Record<string, unknown>;
}

describe('v1.4.0 Save Format 5', () => {
  it('round-trips a detached complete Save Format 5 GameState through code and JSON', () => {
    const state = initialState(77);
    const code = encodeSaveCode(state);
    const decoded = decodeSaveCode(code);

    expect(decoded).toMatchObject({ valid: true, errors: [] });
    expect(decoded.envelope).toMatchObject({
      format: SAVE_FORMAT,
      formatVersion: 5,
      gameVersion: CURRENT_GAME_VERSION,
      mapId: 'fixed-31x31-v1',
      seed: 77,
    });
    expect(decoded.state).toEqual(state);

    const json = exportSaveJson(state);
    expect(importSaveJson(json).state).toEqual(state);
    decoded.state!.horde.finalHordeStatus = 'active';
    expect(decodeSaveCode(code).state!.horde.finalHordeStatus).toBe('notStarted');
  });

  it('writes the v1.4.0 version boundaries', () => {
    const envelope = exportedEnvelope(initialState(6));
    const state = envelope.state as Record<string, unknown>;
    const config = state.config as Record<string, unknown>;

    expect(envelope.formatVersion).toBe(SAVE_FORMAT_VERSION);
    expect(envelope.formatVersion).toBe(5);
    expect(envelope.gameVersion).toBe('2.0.0');
    expect(config.version).toBe('2.0.0');
    expect(config.mapId).toBe('fixed-31x31-v1');
    expect((state.map as Record<string, unknown>).width).toBe(31);
    expect((state.map as Record<string, unknown>).height).toBe(31);
    expect(state).toHaveProperty('nextConstructibleFacilityNumber', 1);
    expect(state).toHaveProperty('finalHordeTurn', 30);
    expect(state).not.toHaveProperty('maxTurns');
    expect(config).not.toHaveProperty('maxTurns');
  });

  it('preserves terrain, Horde Zombie target state, Final Horde group, and Victory fields', () => {
    const config = createDefaultConfig({
      finalHordeTurn: 1,
      economy: { initialZombieCount: 0 },
      horde: { cycle: 1, finalComposition: { hordeZombie: 1, zombie: 1 } },
    });
    const engine = new GameEngine(16, config);
    const endTurn = engine.step({ type: 'EndTurn' });
    expect(endTurn.error).toBeNull();
    const state = clone(endTurn.state);
    const finalHorde = state.units.filter((unit) => unit.hordeKind === 'final');
    expect(finalHorde).toHaveLength(2);
    expect(finalHorde.every((unit) => unit.hordeKind === 'final' && unit.spawnGroupId === state.horde.finalSpawnGroupId)).toBe(true);
    expect(state.horde).toMatchObject({ finalHordeStatus: 'active', finalSpawnedCount: 2 });
    expect(state.statistics).toHaveProperty('finalHordeSpawned', 2);
    expect(state.statistics).toMatchObject({ finalHordeZombiesSpawned: 1, finalNormalZombiesSpawned: 1 });
    expect(state.statistics.terrainEntriesByType).toEqual({ plain: 0, forest: 0, mountain: 0, water: 0 });
    expect(decodeSaveCode(encodeSaveCode(state)).state).toEqual(state);
  });

  it('persists Unit Fuel and Wind / Constructible Facility state without derived Forecast fields', () => {
    const engine = new GameEngine(73, createDefaultConfig());
    const candidate = engine.getConstructibleFacilityPositionCandidates('simpleFarm').find((entry) => entry.legal)!;
    const built = engine.step({ type: 'BuildConstructibleFacility', facilityType: 'simpleFarm', position: candidate.position });
    expect(built.error).toBeNull();
    const state = clone(built.state);
    const police = state.units.find((unit) => unit.type === 'police')!;
    police.currentFuel = 7;
    const wind = state.facilities.find((facility) => facility.type === 'windPowerPlant')!;
    const constructible = state.facilities.find((facility) => facility.constructible)!;
    const loaded = decodeSaveCode(encodeSaveCode(state));
    expect(loaded.valid).toBe(true);
    expect(loaded.state?.units.find((unit) => unit.id === police.id)?.currentFuel).toBe(7);
    expect(loaded.state?.facilities.find((facility) => facility.id === wind.id)?.type).toBe('windPowerPlant');
    expect(loaded.state?.facilities.find((facility) => facility.id === wind.id)).toMatchObject({
      constructible: false,
      builtTurn: null,
      recoveryOperationalTurn: null,
    });
    expect(loaded.state?.facilities.find((facility) => facility.id === constructible.id)).toMatchObject({
      type: 'simpleFarm',
      constructible: true,
      builtTurn: 1,
      operationalStatus: 'building',
    });
    expect(loaded.state).not.toHaveProperty('forecast');
  });

  it('accepts 31x31 boundary coordinates and rejects coordinates outside the fixed map', () => {
    const envelope = exportedEnvelope(initialState(83));
    const state = envelope.state as Record<string, unknown>;
    const units = state.units as Array<Record<string, unknown>>;
    (units[0]!.position as Record<string, unknown>).q = 30;
    (units[0]!.position as Record<string, unknown>).r = 30;
    // This is only a coordinate-shape check, so keep the state checksum valid
    // while allowing the relational invariant to report any other mismatch.
    const boundaryResult = importSaveJson(JSON.stringify(resign(envelope)));
    expect(boundaryResult.errors.join(' ')).not.toMatch(/outside|in-bounds/i);

    (units[0]!.position as Record<string, unknown>).q = 31;
    const outsideResult = importSaveJson(JSON.stringify(resign(envelope)));
    expect(outsideResult.valid).toBe(false);
    expect(outsideResult.errors.join(' ')).toMatch(/in-bounds|outside|map/i);
  });

  it('re-derives identical checkpoint candidates after load without storing them in GameState', () => {
    const state = initialState(91);
    const before = getCheckpointPositionCandidates(state);
    const loaded = decodeSaveCode(encodeSaveCode(state)).state!;
    expect(getCheckpointPositionCandidates(loaded)).toEqual(before);
    expect(loaded).not.toHaveProperty('checkpointCandidates');
  });

  it('rejects prior-version envelopes without changing the current state or RNG snapshot', () => {
    const current = initialState(18);
    const before = clone(current);
    const legacy = exportedEnvelope(current);
    legacy.formatVersion = 3;
    legacy.gameVersion = '1.4.1';
    const legacyState = legacy.state as Record<string, unknown>;
    legacyState.gameVersion = '1.4.1';
    (legacyState.config as Record<string, unknown>).version = '1.4.1';

    const result = decodeSaveCode(codeForEnvelope(legacy));
    expect(result.valid).toBe(false);
    expect(result.state).toBeNull();
    expect(result.envelope).toBeNull();
    expect(result.errors.join(' ')).toMatch(/format version|incompatible|1\.2\.7/i);
    expect(result.errors.join(' ')).toContain('v1.3.3 and earlier saves cannot be loaded or converted');
    expect(current).toEqual(before);
  });

  it('rejects a stale state/config version even when the envelope has Format 5', () => {
    const envelope = exportedEnvelope();
    const state = envelope.state as Record<string, unknown>;
    state.gameVersion = '1.4.0';
    (state.config as Record<string, unknown>).version = '1.4.0';
    const result = importSaveJson(JSON.stringify(resign(envelope)));

    expect(result).toMatchObject({ valid: false, state: null, envelope: null });
    expect(result.errors.join(' ')).toMatch(/incompatible/i);
  });

  it('rejects a partial v1.4 schema rather than treating it as a migration candidate', () => {
    const envelope = exportedEnvelope();
    const state = envelope.state as Record<string, unknown>;
    delete (state.horde as Record<string, unknown>).finalHordeStatus;
    delete (state.units as Array<Record<string, unknown>>)[0]!.vision;
    delete (state.statistics as Record<string, unknown>).finalHordeDefeated;
    const result = importSaveJson(JSON.stringify(resign(envelope)));

    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/finalHordeStatus|vision|finalHordeDefeated/i);
  });

  it('rejects obsolete maxTurns and tampered checksums without returning a snapshot', () => {
    const obsolete = exportedEnvelope();
    const state = obsolete.state as Record<string, unknown>;
    state.maxTurns = 30;
    const obsoleteResult = importSaveJson(JSON.stringify(resign(obsolete)));
    expect(obsoleteResult.valid).toBe(false);
    expect(obsoleteResult.errors.join(' ')).toMatch(/maxTurns is obsolete/i);

    const tampered = exportedEnvelope();
    tampered.checksum = '00000000';
    const tamperedResult = importSaveJson(JSON.stringify(tampered));
    expect(tamperedResult).toMatchObject({ valid: false, state: null, envelope: null });
    expect(tamperedResult.errors.join(' ')).toMatch(/checksum/i);
  });

  it('uses the v5 autosave key and never rewrites or removes a legacy key', () => {
    const storage = new MemoryStorage();
    const legacy = exportedEnvelope(initialState(9));
    legacy.formatVersion = 3;
    legacy.gameVersion = '1.4.1';
    storage.setItem(LEGACY_AUTOSAVE_KEY, codeForEnvelope(legacy));
    const beforeLegacy = storage.getItem(LEGACY_AUTOSAVE_KEY);
    const store = new AutoSaveStore({ storage });

    expect(store.hasSave()).toBe(true);
    const oldLoad = store.load();
    expect(oldLoad.valid).toBe(false);
    expect(oldLoad.errors.join(' ')).toMatch(/format version|incompatible/i);
    expect(storage.getItem(DEFAULT_AUTOSAVE_KEY)).toBeNull();
    expect(storage.getItem(LEGACY_AUTOSAVE_KEY)).toBe(beforeLegacy);

    const saved = store.save(initialState(10));
    expect(saved.ok).toBe(true);
    expect(storage.getItem(DEFAULT_AUTOSAVE_KEY)).toBe(saved.code);
    expect(storage.getItem(LEGACY_AUTOSAVE_KEY)).toBe(beforeLegacy);
    expect(store.load()).toMatchObject({ valid: true, state: expect.any(Object) });

    store.clear();
    expect(storage.getItem(DEFAULT_AUTOSAVE_KEY)).toBeNull();
    expect(storage.getItem(LEGACY_AUTOSAVE_KEY)).toBe(beforeLegacy);
  });

  it('reports unavailable storage and malformed input without throwing', () => {
    const unavailable = new AutoSaveStore({ storage: null });
    expect(unavailable.save(initialState())).toMatchObject({ ok: false, code: null });
    expect(unavailable.load()).toMatchObject({ valid: false, state: null });
    expect(decodeSaveCode('not a save')).toMatchObject({ valid: false, state: null });
    expect(importSaveJson('{')).toMatchObject({ valid: false, state: null });
  });
});
