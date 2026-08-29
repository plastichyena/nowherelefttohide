import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from '../core/config';
import { GameEngine } from '../core/engine';
import { synchronizePopulation } from '../core/state';
import type { GameState } from '../core/types';
import {
  AutoSaveStore,
  CURRENT_GAME_VERSION,
  DEFAULT_AUTOSAVE_KEY,
  LEGACY_GAME_VERSION,
  LEGACY_AUTOSAVE_KEY,
  SAVE_FORMAT_VERSION,
  V126_GAME_VERSION,
  decodeSaveCode,
  encodeSaveCode,
  exportSaveJson,
  importSaveJson,
} from './save';

function initialState(seed = 42): GameState {
  return new GameEngine(seed, createDefaultConfig()).getState() as GameState;
}

class MemoryStorage {
  private readonly values = new Map<string, string>();
  readonly writes: string[] = [];
  readonly removals: string[] = [];
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.writes.push(key); this.values.set(key, value); }
  removeItem(key: string): void { this.removals.push(key); this.values.delete(key); }
}

function legacyV126State(seed = 42): GameState {
  const state = initialState(seed);
  state.gameVersion = V126_GAME_VERSION;
  state.config.version = V126_GAME_VERSION;
  for (const type of ['capital', 'city', 'farm', 'civilianFactory', 'militaryFactory', 'refinery', 'powerPlant'] as const) {
    const production = state.config.facilities[type].production as unknown as Record<string, unknown>;
    delete production.powerMode;
    production.requiresPower = type !== 'refinery' && type !== 'powerPlant';
    if (['farm', 'civilianFactory', 'militaryFactory'].includes(type)) {
      (production.inputs as Record<string, unknown>).fuel = 1;
    }
    if (type === 'powerPlant') production.powerGeneration = 5;
  }
  for (const facility of state.facilities) {
    const rawFacility = facility as unknown as Record<string, unknown>;
    delete rawFacility.powerSupplyEnabled;
    delete rawFacility.lastPowerSupplied;
  }
  return state;
}

function legacyState(seed = 42): GameState {
  const state = legacyV126State(seed);
  state.gameVersion = LEGACY_GAME_VERSION;
  state.config.version = LEGACY_GAME_VERSION;
  state.config.naturalRecovery = { rate: 0.1, rounding: 'ceil' } as unknown as GameState['config']['naturalRecovery'];
  for (const type of ['farm', 'civilianFactory', 'militaryFactory', 'refinery', 'powerPlant'] as const) {
    state.config.facilities[type].workerCapacity -= 5;
    state.map.facilities
      .filter((facility) => facility.type === type)
      .forEach((facility) => { facility.workerCapacity -= 5; });
    state.facilities
      .filter((facility) => facility.type === type)
      .forEach((facility) => { facility.workerCapacity -= 5; });
  }
  return state;
}

describe('save format', () => {
  it('round-trips a complete GameState through Base64URL and JSON', () => {
    const state = initialState();
    const code = encodeSaveCode(state);
    expect(code).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(code.length).toBeLessThan(exportSaveJson(state).length);
    const decoded = decodeSaveCode(code);
    expect(decoded).toMatchObject({ valid: true, state });

    const json = exportSaveJson(state);
    expect(importSaveJson(json)).toMatchObject({ valid: true, state });
    expect(state.gameVersion).toBe(CURRENT_GAME_VERSION);
    expect(state.population).toHaveProperty('initialPopulation');
    expect(state.population).toHaveProperty('cumulativeArrivals');
    expect(state.population).toHaveProperty('cumulativeDepartures');
    expect(state.population).toHaveProperty('cumulativeDiscoveredInfected');
    expect(state.cityPopulationSnapshot).toEqual(expect.objectContaining({ turn: state.turn, supply: expect.any(Array), reception: expect.any(Array) }));
    expect(state.facilities.every((facility) => Number.isSafeInteger(facility.populationOperationalTurn))).toBe(true);
  });

  it('migrates a v1.2.5 Save Code without changing gameplay data', () => {
    const source = legacyState(43);
    const farm = source.facilities.find((facility) => facility.id === 'farm-1')!;
    farm.status = 'ruined';
    farm.owner = 'none';
    farm.operationalStatus = 'ruined';
    farm.workers = 0;
    farm.infected = 13;
    source.population.cumulativeDeaths += 10;
    synchronizePopulation(source);
    const sourceBefore = JSON.stringify(source);
    const legacyCode = encodeSaveCode(source);

    const decoded = decodeSaveCode(legacyCode);
    expect(decoded).toMatchObject({ valid: true, migrated: true });
    expect(decoded.state?.gameVersion).toBe(CURRENT_GAME_VERSION);
    expect(decoded.state?.config.version).toBe(CURRENT_GAME_VERSION);
    expect(decoded.state?.config.naturalRecovery).toEqual({ combatRate: 0.1, restRate: 0.2, rounding: 'ceil' });
    expect(decoded.state?.facilities.find((facility) => facility.id === 'farm-1')).toMatchObject({
      workerCapacity: 30,
      workers: 0,
      infected: 13,
      status: 'ruined',
      owner: 'none',
    });
    expect(decoded.state?.config.facilities.farm.production).toMatchObject({ powerMode: 'boost', requiresPower: false });
    expect(decoded.state?.config.facilities.farm.production.inputs).not.toHaveProperty('fuel');
    expect(decoded.state?.config.facilities.militaryFactory.production.inputs).toEqual({ civilianGoods: 1 });
    expect(decoded.state?.config.facilities.powerPlant.production).toMatchObject({ powerMode: 'none', powerGeneration: 10 });
    expect(decoded.state?.facilities.find((facility) => facility.type === 'farm')).toMatchObject({ powerSupplyEnabled: true, lastPowerSupplied: null });
    expect(decoded.state?.facilities.find((facility) => facility.type === 'powerPlant')).toMatchObject({ powerSupplyEnabled: false, lastPowerSupplied: null });
    expect(decoded.state?.map.facilities.find((facility) => facility.id === 'farm-1')?.workerCapacity).toBe(30);
    expect(decoded.state?.population.cumulativeDeaths).toBe(source.population.cumulativeDeaths);
    expect(JSON.stringify(source)).toBe(sourceBefore);

    const jsonResult = importSaveJson(exportSaveJson(source));
    expect(jsonResult).toMatchObject({ valid: true, migrated: true, state: decoded.state });
  });

  it('migrates a v1.2.6 Save Code directly to v1.3.0 without changing gameplay data', () => {
    const source = legacyV126State(48);
    const sourceBefore = JSON.stringify(source);
    const preserved = {
      population: source.population,
      resources: source.resources,
      turn: source.turn,
      maxTurns: source.maxTurns,
      actionsTakenThisTurn: source.actionsTakenThisTurn,
      rngState: source.rngState,
      map: source.map,
      checkpoints: source.checkpoints,
      roadBranches: source.roadBranches,
      events: source.events,
      units: source.units,
    };
    const result = decodeSaveCode(encodeSaveCode(source));
    expect(result).toMatchObject({ valid: true, migrated: true });
    expect(result.state?.gameVersion).toBe(CURRENT_GAME_VERSION);
    expect(result.state?.config.version).toBe(CURRENT_GAME_VERSION);
    expect(result.state?.population).toEqual(preserved.population);
    expect(result.state?.resources).toEqual(preserved.resources);
    expect(result.state?.turn).toBe(preserved.turn);
    expect(result.state?.maxTurns).toBe(preserved.maxTurns);
    expect(result.state?.actionsTakenThisTurn).toBe(preserved.actionsTakenThisTurn);
    expect(result.state?.rngState).toEqual(preserved.rngState);
    expect(result.state?.map).toEqual(preserved.map);
    expect(result.state?.checkpoints).toEqual(preserved.checkpoints);
    expect(result.state?.roadBranches).toEqual(preserved.roadBranches);
    expect(result.state?.events).toEqual(preserved.events);
    expect(result.state?.units).toEqual(preserved.units);
    expect(result.state?.config.facilities.powerPlant.production.powerGeneration).toBe(10);
    for (const type of ['farm', 'civilianFactory', 'militaryFactory'] as const) {
      const production = result.state?.config.facilities[type].production;
      expect(production?.powerMode).toBe('boost');
      expect(production?.requiresPower).toBe(false);
      expect(production?.inputs).not.toHaveProperty('fuel');
    }
    expect(result.state?.config.facilities.militaryFactory.production.inputs).toEqual({ civilianGoods: 1 });
    expect(result.state?.facilities.filter((facility) => ['farm', 'civilianFactory', 'militaryFactory'].includes(facility.type)).every((facility) => facility.powerSupplyEnabled && facility.lastPowerSupplied === null)).toBe(true);
    expect(result.state?.facilities.filter((facility) => !['farm', 'civilianFactory', 'militaryFactory'].includes(facility.type)).every((facility) => !facility.powerSupplyEnabled && facility.lastPowerSupplied === null)).toBe(true);
    expect(JSON.stringify(source)).toBe(sourceBefore);
  });

  it('rejects current saves whose facility power capacity breaks the fixed v1.2.7 contract', () => {
    const state = initialState(481);
    state.config.facilities.capital.production.powerCapacity = 3;
    const result = decodeSaveCode(encodeSaveCode(state));
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('config.facilities.capital.production.powerCapacity must be 5');
  });

  it('adds five to custom production capacities and doubles custom recovery up to one', () => {
    const source = legacyState(44);
    source.config.facilities.farm.workerCapacity = 40;
    source.map.facilities.filter((facility) => facility.type === 'farm').forEach((facility) => { facility.workerCapacity = 40; });
    source.facilities.filter((facility) => facility.type === 'farm').forEach((facility) => { facility.workerCapacity = 40; });
    source.config.naturalRecovery = { rate: 0.6, rounding: 'floor' } as unknown as GameState['config']['naturalRecovery'];

    const result = importSaveJson(exportSaveJson(source));
    expect(result).toMatchObject({ valid: true, migrated: true });
    expect(result.state?.config.facilities.farm.workerCapacity).toBe(45);
    expect(result.state?.map.facilities.filter((facility) => facility.type === 'farm').every((facility) => facility.workerCapacity === 45)).toBe(true);
    expect(result.state?.facilities.filter((facility) => facility.type === 'farm').every((facility) => facility.workerCapacity === 45)).toBe(true);
    expect(result.state?.config.naturalRecovery).toEqual({ combatRate: 0.6, restRate: 1, rounding: 'floor' });
  });

  it('rejects legacy Map or GameState capacity mismatches before migration', () => {
    for (const location of ['map', 'state'] as const) {
      const source = legacyState(location === 'map' ? 46 : 47);
      const facilities = location === 'map' ? source.map.facilities : source.facilities;
      facilities.find((facility) => facility.type === 'farm')!.workerCapacity += 1;
      const result = importSaveJson(exportSaveJson(source));
      expect(result.valid).toBe(false);
      expect(result.state).toBeNull();
      expect(result.errors.join(' ')).toMatch(/workerCapacity.*match|capacity.*match/i);
    }
  });

  it('rejects invalid legacy data before migration and preserves the source storage value', () => {
    const source = legacyState(45);
    const validCode = encodeSaveCode(source);
    const envelope = JSON.parse(exportSaveJson(source)) as Record<string, unknown>;
    envelope.checksum = '00000000';
    const checksumFailure = importSaveJson(JSON.stringify(envelope));
    expect(checksumFailure.valid).toBe(false);
    expect(checksumFailure.state).toBeNull();
    expect(checksumFailure.errors.join(' ')).toMatch(/checksum/i);

    source.config.naturalRecovery = { rate: 2, rounding: 'ceil' } as unknown as GameState['config']['naturalRecovery'];
    const invalidConfig = importSaveJson(exportSaveJson(source));
    expect(invalidConfig.valid).toBe(false);
    expect(invalidConfig.state).toBeNull();
    expect(invalidConfig.errors.join(' ')).toMatch(/rate/i);

    const storage = new MemoryStorage();
    storage.setItem(DEFAULT_AUTOSAVE_KEY, validCode);
    const writesBeforeLoad = storage.writes.length;
    const loaded = new AutoSaveStore({ storage }).load();
    expect(loaded).toMatchObject({ valid: true, migrated: true });
    expect(storage.getItem(DEFAULT_AUTOSAVE_KEY)).toBe(validCode);
    expect(storage.writes.length).toBe(writesBeforeLoad);
    expect(storage.removals).toEqual([]);
  });

  it('rejects invalid v1.2.6 data before migration and never rewrites the source', () => {
    const source = legacyV126State(49);
    const validCode = encodeSaveCode(source);
    const envelope = JSON.parse(exportSaveJson(source)) as Record<string, unknown>;
    envelope.checksum = '00000000';
    const checksumFailure = importSaveJson(JSON.stringify(envelope));
    expect(checksumFailure.valid).toBe(false);
    expect(checksumFailure.state).toBeNull();
    expect(checksumFailure.errors.join(' ')).toMatch(/checksum/i);

    const storage = new MemoryStorage();
    storage.setItem(DEFAULT_AUTOSAVE_KEY, validCode);
    const writesBeforeLoad = storage.writes.length;
    const loaded = new AutoSaveStore({ storage }).load();
    expect(loaded).toMatchObject({ valid: true, migrated: true });
    expect(storage.getItem(DEFAULT_AUTOSAVE_KEY)).toBe(validCode);
    expect(storage.writes.length).toBe(writesBeforeLoad);
    expect(storage.removals).toEqual([]);
  });

  it('rejects a tampered code before returning a snapshot', () => {
    const code = encodeSaveCode(initialState());
    const index = Math.floor(code.length / 2);
    const tampered = `${code.slice(0, index)}${code[index] === 'A' ? 'B' : 'A'}${code.slice(index + 1)}`;
    const result = decodeSaveCode(tampered);
    expect(result.valid).toBe(false);
    expect(result.state).toBeNull();
    expect(result.errors.join(' ')).toMatch(/checksum|decode|parse/i);
  });

  it('rejects version and invariant violations in JSON', () => {
    const envelope = JSON.parse(exportSaveJson(initialState())) as Record<string, unknown>;
    envelope.formatVersion = 999;
    expect(importSaveJson(JSON.stringify(envelope)).valid).toBe(false);

    const validEnvelope = JSON.parse(exportSaveJson(initialState())) as { state: GameState };
    validEnvelope.state.facilities[0]!.workers = validEnvelope.state.facilities[0]!.workerCapacity + 1;
    expect(importSaveJson(JSON.stringify(validEnvelope)).valid).toBe(false);
  });

  it('rejects pre-v1.2.5 format data without applying it', () => {
    const envelope = JSON.parse(exportSaveJson(initialState())) as Record<string, unknown>;
    envelope.formatVersion = SAVE_FORMAT_VERSION - 1;
    const result = importSaveJson(JSON.stringify(envelope));
    expect(result.valid).toBe(false);
    expect(result.state).toBeNull();
    expect(result.errors.join(' ')).toMatch(/incompatible|format version/i);
  });

  it('rejects v1.0 JSON and save codes with an explicit old-version message', () => {
    const oldState = { ...initialState(), gameVersion: '1.0.0' } as GameState;
    const oldCode = encodeSaveCode(oldState);
    const codeResult = decodeSaveCode(oldCode);
    expect(codeResult.valid).toBe(false);
    expect(codeResult.state).toBeNull();
    expect(codeResult.errors.join(' ')).toMatch(/旧バージョン|old version/i);

    const oldEnvelope = JSON.parse(exportSaveJson(initialState())) as Record<string, unknown> & { state: Record<string, unknown> };
    oldEnvelope.gameVersion = '1.0.0';
    oldEnvelope.state.gameVersion = '1.0.0';
    const jsonResult = importSaveJson(JSON.stringify(oldEnvelope));
    expect(jsonResult.valid).toBe(false);
    expect(jsonResult.state).toBeNull();
    expect(jsonResult.errors.join(' ')).toMatch(/旧バージョン|old version/i);
  });

  it('requires the v1.1 population, snapshot, facility and checkpoint fields', () => {
    const base = JSON.parse(exportSaveJson(initialState())) as Record<string, unknown> & { state: Record<string, unknown> };
    const mutate = (change: (state: Record<string, unknown>) => void) => {
      const envelope = JSON.parse(JSON.stringify(base)) as typeof base;
      change(envelope.state);
      return importSaveJson(JSON.stringify(envelope));
    };

    const population = base.state.population as Record<string, unknown>;
    delete population.approvedRefugees;
    const missingPopulation = importSaveJson(JSON.stringify(base));
    expect(missingPopulation.valid).toBe(false);
    expect(missingPopulation.errors.join(' ')).toContain('state.population.approvedRefugees');
    population.approvedRefugees = 0;

    const missingSnapshot = mutate((state) => { delete state.cityPopulationSnapshot; });
    expect(missingSnapshot.valid).toBe(false);
    expect(missingSnapshot.errors.join(' ')).toContain('state.cityPopulationSnapshot');

    const missingOperationalTurn = mutate((state) => {
      const facilities = state.facilities as Array<Record<string, unknown>>;
      delete facilities[0]!.populationOperationalTurn;
    });
    expect(missingOperationalTurn.valid).toBe(false);
    expect(missingOperationalTurn.errors.join(' ')).toContain('populationOperationalTurn');

    const missingPowerState = mutate((state) => {
      const facilities = state.facilities as Array<Record<string, unknown>>;
      delete facilities[0]!.powerSupplyEnabled;
      delete facilities[0]!.lastPowerSupplied;
    });
    expect(missingPowerState.valid).toBe(false);
    expect(missingPowerState.errors.join(' ')).toMatch(/powerSupplyEnabled|lastPowerSupplied/);

    const source = initialState();
    const checkpoint = {
      id: 'checkpoint-test',
      position: source.map.roadTiles[0],
      direction: 'north',
      status: 'operational',
      waiting: 0,
      screening: 0,
      remainingTurns: 0,
      screeningPolicy: 'normal',
      currentPolicy: 'normal',
      nextArrivalTurn: null,
      infected: 0,
    };
    const checkpointEnvelope = JSON.parse(exportSaveJson(source)) as typeof base;
    (checkpointEnvelope.state.checkpoints as unknown[]).push(checkpoint);
    const missingApproved = importSaveJson(JSON.stringify(checkpointEnvelope));
    expect(missingApproved.valid).toBe(false);
    expect(missingApproved.errors.join(' ')).toContain('state.checkpoints[0].approved');
  });

  it('round-trips a legitimate state immediately after an owned facility is overrun', () => {
    const engine = new GameEngine(115, createDefaultConfig({
      maxTurns: 2,
      economy: {
        initialZombieCount: 0,
        initialWorkersByFacility: { 'farm-1': 1 },
      },
    }));
    const snapshot = engine.getState() as GameState;
    const farm = snapshot.facilities.find((facility) => facility.id === 'farm-1')!;
    farm.workers = 0;
    farm.infected = 1;
    farm.operationalStatus = 'infected';
    synchronizePopulation(snapshot);
    expect(engine.step({ type: 'LoadSnapshot', snapshot }).error).toBeNull();
    expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
    expect(engine.getState().facilities.find((facility) => facility.id === farm.id)).toMatchObject({
      owner: 'none',
      status: 'ruined',
    });
    expect(importSaveJson(exportSaveJson(engine.getState()))).toMatchObject({
      valid: true,
      state: engine.getState(),
    });
  });

  it('round-trips an operational checkpoint together with its remnant', () => {
    const engine = new GameEngine(125, createDefaultConfig({
      economy: { initialZombieCount: 0 },
    }));
    const build = engine.getLegalActions().find((action) => action.type === 'BuildCheckpoint');
    expect(build).toBeDefined();
    expect(engine.step(build!).error).toBeNull();
    expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
    const occupied = engine.getState() as GameState;
    occupied.checkpoints[0]!.waiting = 3;
    occupied.population.waitingRefugees = 3;
    occupied.population.cumulativeArrivals += 3;
    expect(engine.step({ type: 'LoadSnapshot', snapshot: occupied }).error).toBeNull();
    const relocate = engine.getLegalActions().find((action) => action.type === 'RelocateCheckpoint');
    expect(relocate).toBeDefined();
    expect(engine.step(relocate!).error).toBeNull();
    expect(engine.getState().checkpoints.map((checkpoint) => checkpoint.status).sort()).toEqual(['operational', 'remnant']);
    expect(importSaveJson(exportSaveJson(engine.getState()))).toMatchObject({
      valid: true,
      state: engine.getState(),
    });
  });

  it('uses local storage for autosave and reports storage failures', () => {
    const storage = new MemoryStorage();
    const store = new AutoSaveStore({ storage });
    const saved = store.save(initialState(9));
    expect(saved.ok).toBe(true);
    expect(store.hasSave()).toBe(true);
    expect(store.load().valid).toBe(true);

    const oldCode = encodeSaveCode({ ...initialState(10), gameVersion: '1.0.0' } as GameState);
    storage.setItem(DEFAULT_AUTOSAVE_KEY, oldCode);
    const oldLoad = store.load();
    expect(oldLoad.valid).toBe(false);
    expect(oldLoad.state).toBeNull();
    expect(oldLoad.errors.join(' ')).toMatch(/旧バージョン|old version/i);
    expect(storage.getItem(DEFAULT_AUTOSAVE_KEY)).toBe(oldCode);

    storage.setItem(LEGACY_AUTOSAVE_KEY, oldCode);
    const legacyStore = new AutoSaveStore({ storage });
    expect(legacyStore.load().valid).toBe(false);
    expect(storage.getItem(LEGACY_AUTOSAVE_KEY)).toBe(oldCode);
    expect(legacyStore.save(initialState(11)).ok).toBe(true);
    expect(storage.getItem(LEGACY_AUTOSAVE_KEY)).toBe(oldCode);

    const messages: string[] = [];
    const unavailable = new AutoSaveStore({ storage: null, onError: (message) => messages.push(message) });
    expect(unavailable.save(initialState()).ok).toBe(false);
    expect(messages.length).toBe(1);
  });
});
