import { gzipSync, strToU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from '../core/config';
import { GameEngine, getCheckpointPositionCandidates } from '../core/engine';
import { createCityPopulationSnapshot, createInitialState, synchronizePopulation } from '../core/state';
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
  measureSaveEncoding,
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

function stateWithArmyBaseReservation(seed = 42): GameState {
  const state = initialState(seed);
  const armyBase = state.facilities.find((facility) => facility.type === 'armyBase')!;
  const capital = state.facilities.find((facility) => facility.id === 'capital')!;
  armyBase.owner = 'player';
  armyBase.status = 'owned';
  armyBase.operationalStatus = 'operational';
  armyBase.armyBase = { militaryGoods: 24, interceptionsRemaining: 0, reward: 'pending' };
  capital.workers -= 10;
  state.pendingUnitProductions.push({
    id: 'production-army-base-boundary',
    cityFacilityId: armyBase.id,
    unitType: 'nationalGuard',
    population: 10,
    readyTurn: state.turn + 1,
    powerReady: false,
  });
  synchronizePopulation(state);
  createCityPopulationSnapshot(state);
  return state;
}

describe('v1.5.6 Save Format 15', () => {
  it('exposes stable per-stage timings without changing Save Format 15 bytes', () => {
    const state = initialState(15152);
    const measured = measureSaveEncoding(state);
    expect(measured.code).toBe(encodeSaveCode(state));
    expect(measured.timing.normalizedBytes).toBeGreaterThan(0);
    expect(measured.timing.compressedBytes).toBeGreaterThan(0);
    expect(measured.timing.codeChars).toBe(measured.code.length);
    for (const key of ['validationMs', 'normalizationMs', 'checksumMs', 'gzipMs', 'base64Ms', 'totalMs'] as const) {
      expect(measured.timing[key]).toBeGreaterThanOrEqual(0);
    }
  });

  it('round-trips a detached complete Save Format 15 GameState through code and JSON', () => {
    const state = initialState(77);
    const code = encodeSaveCode(state);
    const decoded = decodeSaveCode(code);

    expect(decoded).toMatchObject({ valid: true, errors: [] });
    expect(decoded.envelope).toMatchObject({
      format: SAVE_FORMAT,
      formatVersion: 15,
      gameVersion: CURRENT_GAME_VERSION,
      mapId: 'fixed-51x51-v4',
      seed: 77,
    });
    expect(decoded.state).toEqual(state);

    const json = exportSaveJson(state);
    expect(importSaveJson(json).state).toEqual(state);
    decoded.state!.horde.finalHordeStatus = 'active';
    expect(decodeSaveCode(code).state!.horde.finalHordeStatus).toBe('notStarted');
  });

  it('preserves v1.5.6 Army Base, Gas, Wind Noise, and pending Noise state without conversion', () => {
    const state = initialState(78);
    const riot = state.units.find((unit) => unit.type === 'police')!;
    const capital = state.facilities.find((facility) => facility.id === 'capital')!;
    capital.workers -= 5;
    Object.assign(riot, {
      type: 'riotPolice' as const,
      hp: 75,
      maxHp: 75,
      attack: 12,
      movement: 10,
      range: 1,
      vision: 5,
      population: 10,
      proficiency: 'veteran' as const,
      recruitSurvivalTurns: 5,
      regularZombieKills: 5,
      veteranPromotionPending: false,
      maxFuel: 12,
      currentFuel: 12,
      maxMilitaryGoods: 5,
      currentMilitaryGoods: 5,
      maxAttackCharges: 2,
      attackChargesRemaining: 1,
    });
    state.pendingNoisePulses.push({
      id: 'noise-v150-save',
      center: { q: 24, r: 24 },
      radius: 5,
      sourceKind: 'humanCombat',
      sourceUnitType: 'riotPolice',
      emittedTurn: state.turn,
    });
    const armyBase = state.facilities.find((facility) => facility.type === 'armyBase')!;
    armyBase.owner = 'player';
    armyBase.status = 'owned';
    armyBase.operationalStatus = 'operational';
    armyBase.armyBase = { militaryGoods: 24, interceptionsRemaining: 0, reward: 'pending' };
    capital.workers -= 10;
    state.pendingUnitProductions.push({
      id: 'production-army-base-save',
      cityFacilityId: armyBase.id,
      unitType: 'nationalGuard',
      population: 10,
      readyTurn: state.turn + 1,
      powerReady: false,
    });
    state.pendingNoisePulses.push({
      id: 'noise-army-base-save',
      center: { ...armyBase.position },
      radius: state.config.armyBase.noiseRadius,
      sourceKind: 'armyBase',
      sourceUnitType: 'armyBase',
      emittedTurn: state.turn,
    });
    const wind = state.facilities.find((facility) => facility.type === 'windPowerPlant')!;
    state.pendingNoisePulses.push({
      id: 'noise-wind-save',
      center: { ...wind.position },
      radius: state.config.windPower.noiseRadius,
      sourceKind: 'windPower',
      sourceUnitType: 'windPowerPlant',
      emittedTurn: state.turn,
    });
    state.events.push({
      id: 'event-army-base-save',
      turn: state.turn,
      phase: 'zombie',
      type: 'army_base_reward',
      payload: { facilityId: armyBase.id, reward: 'pending' },
    });
    state.statistics.noisePulsesBySourceType.armyBase = 1;
    state.statistics.noisePulsesBySourceType.windPowerPlant = 1;
    state.statistics.gasZombiesSpawned = state.initialGasPositions.length;
    synchronizePopulation(state);
    createCityPopulationSnapshot(state);

    const loaded = decodeSaveCode(encodeSaveCode(state));
    expect(loaded).toMatchObject({ valid: true, errors: [] });
    expect(loaded.state?.units.find((unit) => unit.id === riot.id)).toMatchObject({
      type: 'riotPolice', proficiency: 'veteran', recruitSurvivalTurns: 5,
      regularZombieKills: 5, veteranPromotionPending: false,
      maxAttackCharges: 2, attackChargesRemaining: 1,
    });
    expect(loaded.state?.pendingNoisePulses).toEqual(state.pendingNoisePulses);
    expect(loaded.state?.facilities.find((facility) => facility.id === armyBase.id)?.armyBase).toEqual(armyBase.armyBase);
    expect(loaded.state?.pendingUnitProductions).toContainEqual(expect.objectContaining({
      cityFacilityId: armyBase.id,
      unitType: 'nationalGuard',
      powerReady: false,
    }));
    expect(loaded.state?.initialGasPositions).toEqual(state.initialGasPositions);
  });

  it('writes the v1.5.6 version boundaries and complete v1.5.6 Config / Statistics / Event state', () => {
    const envelope = exportedEnvelope(initialState(6));
    const state = envelope.state as Record<string, unknown>;
    const config = state.config as Record<string, unknown>;

    expect(envelope.formatVersion).toBe(SAVE_FORMAT_VERSION);
    expect(envelope.formatVersion).toBe(15);
    expect(envelope.gameVersion).toBe('8.0.0');
    expect(config.version).toBe('8.0.0');
    expect(config.mapId).toBe('fixed-51x51-v4');
    expect((state.map as Record<string, unknown>).width).toBe(51);
    expect((state.map as Record<string, unknown>).height).toBe(51);
    expect(state).toHaveProperty('nextConstructibleFacilityNumber', 1);
    expect(state).toHaveProperty('finalHordeTurn', 50);
    expect(state).not.toHaveProperty('maxTurns');
    expect(config).not.toHaveProperty('maxTurns');
    expect(config).not.toHaveProperty('finalHordeTurn');
    expect(config).toMatchObject({
      economy: {
        initialZombieCount: 25,
        initialHunterCount: { min: 1, max: 4 },
        initialHunterMinDistance: 20,
        initialGasCount: { min: 1, max: 2 },
        initialGasMinDistance: 9,
      },
      infection: {
        zombieSpawnPopulationPerUnit: 5,
        maxZombieSpawnPerResolution: 6,
        zombieSpawnRadius: 1,
        noiseRespawnEnabled: true,
      },
      unitExperience: {
        productionProficiencyByType: { police: 'recruit', nationalGuard: 'recruit', riotPolice: 'recruit' },
        recruitSurvivalTurnsRequired: 5,
        regularAttackMultiplier: 1.25,
        regularAttackRounding: 'ceil',
        veteranZombieKillsRequired: 5,
        veteranAttackCharges: 2,
      },
      horde: {
        specialZombieWeights: { zombie: 70, policeZombie: 10, soldierZombie: 10, riotZombie: 5, hunterZombie: 5, gasZombie: 5 },
        riotZombieCapPerDirection: 1,
        hunterZombieCapPerDirection: 1,
        gasZombieCapPerDirection: 1,
        movementNoiseRadius: 8,
      },
      windPower: { noiseRadius: 8 },
      armyBase: { maxMilitaryGoods: 40, interceptionCost: 2, attack: 10, range: 2, noiseRadius: 8, staffedVision: 5, rewardLastTurn: 20 },
      units: {
        police: { recruitAttack: 6, noiseClass: 'medium', noiseRadius: 4 },
        riotPolice: { hp: 75, recruitAttack: 9, reanimationUnitType: 'riotZombie', noiseRadius: 5 },
        riotZombie: { hp: 60, attack: 5 },
        hunterZombie: { hp: 20, attack: 15, movement: 15, range: 1, vision: 5 },
        gasZombie: { hp: 35, attack: 5, explosionDamage: 30, explosionInfection: 30 },
      },
    });
    expect(state).toHaveProperty('pendingNoisePulses', []);
    expect((state.map as Record<string, unknown>).initialZombiePositions).toHaveLength(25);
    expect(state).toHaveProperty('initialHunterPositions');
    expect((state.initialHunterPositions as unknown[]).length).toBeGreaterThanOrEqual(1);
    expect((state.initialHunterPositions as unknown[]).length).toBeLessThanOrEqual(4);
    expect(state).toHaveProperty('initialGasPositions');
    expect((state.initialGasPositions as unknown[]).length).toBeGreaterThanOrEqual(1);
    expect((state.initialGasPositions as unknown[]).length).toBeLessThanOrEqual(2);
    expect((state.map as Record<string, unknown>).facilities).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'army-base-1', type: 'armyBase' }),
    ]));
    expect(state.statistics).toMatchObject({
      initialNormalZombies: 25,
      noiseRespawnAttempts: 0,
      infectedPopulationConvertedToZombies: 0,
      groundVisionBlockedHexes: 0,
      civilianDroneBasesBuilt: 0,
      riotPoliceProduced: 0,
      riotZombiesSpawned: 0,
      hunterZombiesSpawned: (state.initialHunterPositions as unknown[]).length,
      hunterZombiesKilled: 0,
      gasZombiesSpawned: (state.initialGasPositions as unknown[]).length,
      gasZombiesKilled: 0,
      gasExplosions: 0,
      gasExplosionUnitDamage: 0,
      noisePulsesBySourceType: expect.objectContaining({ armyBase: 0, windPowerPlant: 0 }),
      hordeMovementNoisePulses: 0,
    });
  });

  it('requires the Wave Config, Horde State, Horde Spawn Reserve, and current Statistics shape', () => {
    const envelope = exportedEnvelope(initialState(17));
    const state = envelope.state as Record<string, unknown>;
    const config = state.config as Record<string, unknown>;
    const horde = state.horde as Record<string, unknown>;
    const map = state.map as Record<string, unknown>;
    delete (config.horde as Record<string, unknown>).warningLeadTurns;
    (config.infection as Record<string, unknown>).fallBackCapacityRate = 0.5;
    delete horde.warningDirections;
    delete horde.spawnGroupIdsByWave;
    delete horde.pendingWaves;
    delete horde.waves;
    delete map.hordeSpawnReserve;
    delete state.initialHunterPositions;
    delete ((map.tiles as Array<Record<string, unknown>>)[0]!).playerOccupancyAllowed;
    delete (state.statistics as Record<string, unknown>).noiseRespawnAttempts;
    delete config.unitExperience;
    delete config.windPower;
    delete (config.horde as Record<string, unknown>).specialZombieWeights;
    delete state.pendingNoisePulses;
    delete (state.units as Array<Record<string, unknown>>)[0]!.proficiency;
    delete (state.units as Array<Record<string, unknown>>)[0]!.previousFallbackPosition;
    delete (state.units as Array<Record<string, unknown>>)[0]!.fallbackTarget;
    delete (state.units as Array<Record<string, unknown>>)[0]!.waveCapitalAnchor;
    delete (state.statistics as Record<string, unknown>).riotPoliceProduced;
    delete ((state.statistics as Record<string, unknown>).noisePulsesBySourceType as Record<string, unknown>).windPowerPlant;

    const result = importSaveJson(JSON.stringify(resign(envelope)));
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/warningLeadTurns|fallBackCapacityRate|warningDirections|spawnGroupIdsByWave|pendingWaves|horde\.waves|hordeSpawnReserve|playerOccupancyAllowed|initialHunterPositions|noiseRespawnAttempts|unitExperience|windPower|specialZombieWeights|pendingNoisePulses|proficiency|previousFallbackPosition|fallbackTarget|waveCapitalAnchor|riotPoliceProduced|windPowerPlant/i);
  });

  it('rejects missing or invalid v1.5.6 Army Base, Gas, Wind Noise, Event, and statistics data', () => {
    const valid = exportedEnvelope(stateWithArmyBaseReservation(117));

    const missingBaseState = clone(valid);
    const missingBase = missingBaseState.state as Record<string, unknown>;
    const baseFacility = (missingBase.facilities as Array<Record<string, unknown>>).find((facility) => facility.type === 'armyBase')!;
    delete baseFacility.armyBase;
    const missingBaseResult = importSaveJson(JSON.stringify(resign(missingBaseState)));
    expect(missingBaseResult.valid).toBe(false);
    expect(missingBaseResult.errors.join(' ')).toMatch(/armyBase/i);

    const missingPowerState = clone(valid);
    const pending = ((missingPowerState.state as Record<string, unknown>).pendingUnitProductions as Array<Record<string, unknown>>)[0]!;
    delete pending.powerReady;
    const missingPowerResult = importSaveJson(JSON.stringify(resign(missingPowerState)));
    expect(missingPowerResult.valid).toBe(false);
    expect(missingPowerResult.errors.join(' ')).toMatch(/powerReady/i);

    const invalidGasState = clone(valid);
    const invalidGas = invalidGasState.state as Record<string, unknown>;
    (invalidGas.initialGasPositions as Array<Record<string, unknown>>)[0]!.q = 0;
    const invalidGasResult = importSaveJson(JSON.stringify(resign(invalidGasState)));
    expect(invalidGasResult.valid).toBe(false);
    expect(invalidGasResult.errors.join(' ')).toMatch(/initial Zombie positions.*seed|Gas|seed/i);

    const invalidNoiseState = clone(valid);
    const invalidNoise = invalidNoiseState.state as Record<string, unknown>;
    invalidNoise.pendingNoisePulses = [{
      id: 'noise-invalid-army-base', center: { q: 24, r: 24 }, radius: 8,
      sourceKind: 'humanCombat', sourceUnitType: 'armyBase', emittedTurn: 1,
    }];
    const invalidNoiseResult = importSaveJson(JSON.stringify(resign(invalidNoiseState)));
    expect(invalidNoiseResult.valid).toBe(false);
    expect(invalidNoiseResult.errors.join(' ')).toMatch(/sourceKind.*sourceUnitType|source kind and type/i);

    const invalidEventState = clone(valid);
    const invalidEvents = (invalidEventState.state as Record<string, unknown>).events as Array<Record<string, unknown>>;
    invalidEvents.push({ id: 'event-invalid', turn: 1, phase: 'zombie', type: 'army_base_interception', payload: {} });
    const invalidEventResult = importSaveJson(JSON.stringify(resign(invalidEventState)));
    expect(invalidEventResult.valid).toBe(false);
    expect(invalidEventResult.errors.join(' ')).toMatch(/event.*invalid/i);

    const missingStatisticState = clone(valid);
    const statistics = (missingStatisticState.state as Record<string, unknown>).statistics as Record<string, unknown>;
    delete statistics.gasExplosions;
    delete (statistics.noisePulsesBySourceType as Record<string, unknown>).armyBase;
    delete (statistics.noisePulsesBySourceType as Record<string, unknown>).windPowerPlant;
    const missingStatisticResult = importSaveJson(JSON.stringify(resign(missingStatisticState)));
    expect(missingStatisticResult.valid).toBe(false);
    expect(missingStatisticResult.errors.join(' ')).toMatch(/gasExplosions|noisePulsesBySourceType\.armyBase|noisePulsesBySourceType\.windPowerPlant/i);
  });

  it('requires current Checkpoint history, Rejected Refugee counters, and reanimation statistics', () => {
    const envelope = exportedEnvelope(initialState(18));
    const state = envelope.state as Record<string, unknown>;
    delete state.rejectedRefugeesByDirection;
    delete ((state.roadBranches as Array<Record<string, unknown>>)[0]!).hasBuiltCheckpoint;
    delete (state.statistics as Record<string, unknown>).reanimationFacilityInfections;
    delete (state.statistics as Record<string, unknown>).rejectedBonusZombiesByDirection;

    const result = importSaveJson(JSON.stringify(resign(envelope)));
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/rejectedRefugeesByDirection|hasBuiltCheckpoint|reanimationFacilityInfections|rejectedBonusZombiesByDirection/i);
  });

  it('rejects a Player Unit on the static Horde Spawn Reserve without changing the live state', () => {
    const current = initialState(83);
    const before = clone(current);
    const envelope = exportedEnvelope(current);
    const state = envelope.state as Record<string, unknown>;
    const units = state.units as Array<Record<string, unknown>>;
    (units[0]!.position as Record<string, unknown>).q = 50;
    (units[0]!.position as Record<string, unknown>).r = 25;

    const result = importSaveJson(JSON.stringify(resign(envelope)));
    expect(result).toMatchObject({ valid: false, state: null, envelope: null });
    expect(result.errors.join(' ')).toMatch(/Horde Spawn Reserve|player.*occupy/i);
    expect(current).toEqual(before);
  });

  it('preserves terrain, Horde Zombie target state, Final Horde group, and Victory fields', () => {
    const config = createDefaultConfig({
      economy: { initialZombieCount: 0, initialHunterCount: { min: 0, max: 0 } },
      horde: {
        warningLeadTurns: 1,
        waves: [{ turn: 1, directionCount: 1, compositionPerDirection: { hordeZombie: 1, zombie: 1 }, final: true }],
      },
    });
    const engine = new GameEngine(16, config);
    const endTurn = engine.step({ type: 'EndTurn' });
    expect(endTurn.error).toBeNull();
    const state = clone(endTurn.state);
    const finalHorde = state.units.filter((unit) => unit.hordeKind === 'final');
    expect(finalHorde).toHaveLength(2);
    expect(finalHorde.every((unit) => unit.hordeKind === 'final' && state.horde.finalSpawnGroupIds.includes(unit.spawnGroupId!))).toBe(true);
    expect(state.horde).toMatchObject({ finalHordeStatus: 'active', finalSpawnedCount: 2 });
    expect(state.statistics).toHaveProperty('finalHordeSpawned', 2);
    expect(state.statistics.finalHordeZombiesSpawned).toBe(1);
    expect(state.statistics.finalHordeSpawned).toBe(
      state.statistics.finalHordeZombiesSpawned + state.statistics.finalNormalZombiesSpawned,
    );
    expect(state.statistics.terrainEntriesByType).toEqual({ plain: 0, forest: 0, mountain: 0, water: 0 });
    expect(decodeSaveCode(encodeSaveCode(state)).state).toEqual(state);
  });

  it('rejects duplicate or missing Pending Wave rosters that disagree with a public Wave count', () => {
    const config = createDefaultConfig({
      economy: { initialZombieCount: 0, initialHunterCount: { min: 0, max: 0 } },
      horde: {
        warningLeadTurns: 1,
        waves: [{ turn: 1, directionCount: 1, compositionPerDirection: { hordeZombie: 5, zombie: 18 }, final: true }],
      },
    });
    const state = new GameEngine(160, config).step({ type: 'EndTurn' }).state;
    expect(state.horde.waves[0]!.pendingCount).toBeGreaterThan(0);

    const duplicateEnvelope = exportedEnvelope(clone(state));
    const duplicateHorde = ((duplicateEnvelope.state as Record<string, unknown>).horde as Record<string, unknown>);
    const pendingWaves = duplicateHorde.pendingWaves as Array<Record<string, unknown>>;
    pendingWaves.push(clone(pendingWaves[0]!));
    const duplicateResult = importSaveJson(JSON.stringify(resign(duplicateEnvelope)));
    expect(duplicateResult).toMatchObject({ valid: false, state: null, envelope: null });
    expect(duplicateResult.errors.join(' ')).toMatch(/Pending Horde Wave.*match|groupId.*duplicated/i);

    const missingEnvelope = exportedEnvelope(clone(state));
    ((missingEnvelope.state as Record<string, unknown>).horde as Record<string, unknown>).pendingWaves = [];
    const missingResult = importSaveJson(JSON.stringify(resign(missingEnvelope)));
    expect(missingResult).toMatchObject({ valid: false, state: null, envelope: null });
    expect(missingResult.errors.join(' ')).toMatch(/untracked pending roster/i);
  });

  it('preserves current overrun Event payloads and derived Statistics without adding UI-only state', () => {
    const state = initialState(51);
    state.events.push({
      id: 'event-999',
      turn: state.turn,
      phase: 'infection',
      type: 'facility_overrun',
      payload: {
        siteKind: 'facility',
        siteId: 'farm-1',
        cause: 'infection_fall',
        infectedAtFall: 15,
        requestedSpawnCount: 3,
        actualSpawnCount: 2,
        remainingInfected: 5,
        chainDepth: 1,
      },
    });
    state.statistics.noiseRespawnAttempts = 2;
    state.statistics.noiseRespawnZombiesSpawned = 3;
    state.statistics.groundVisionBlockedHexes = 8;
    state.statistics.civilianDroneBasesBuilt = 1;

    const loaded = decodeSaveCode(encodeSaveCode(state));
    expect(loaded.valid).toBe(true);
    expect(loaded.state?.events).toEqual(state.events);
    expect(loaded.state?.statistics).toMatchObject({
      noiseRespawnAttempts: 2,
      noiseRespawnZombiesSpawned: 3,
      groundVisionBlockedHexes: 8,
      civilianDroneBasesBuilt: 1,
    });
    expect(loaded.state).not.toHaveProperty('toastHistory');
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

  it('rejects coordinates outside the fixed map', () => {
    const envelope = exportedEnvelope(initialState(83));
    const state = envelope.state as Record<string, unknown>;
    const units = state.units as Array<Record<string, unknown>>;
    (units[0]!.position as Record<string, unknown>).q = 51;
    const outsideResult = importSaveJson(JSON.stringify(resign(envelope)));
    expect(outsideResult.valid).toBe(false);
    expect(outsideResult.errors.join(' ')).toMatch(/in-bounds|outside|map/i);
  });

  it('rejects legal initial Zombie coordinates whose order does not match the saved seed', () => {
    const envelope = exportedEnvelope(initialState(83));
    const state = envelope.state as Record<string, unknown>;
    const map = state.map as Record<string, unknown>;
    const positions = map.initialZombiePositions as Array<Record<string, unknown>>;
    [positions[0], positions[1]] = [positions[1]!, positions[0]!];

    const result = importSaveJson(JSON.stringify(resign(envelope)));

    expect(result.valid).toBe(false);
    expect(result.state).toBeNull();
    expect(result.errors.join(' ')).toMatch(/initial Zombie positions and order.*seed/i);
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
    legacy.formatVersion = 8;
    legacy.gameVersion = '2.3.0';
    const legacyState = legacy.state as Record<string, unknown>;
    legacyState.gameVersion = '2.3.0';
    legacyState.mapId = 'fixed-31x31-v2';
    (legacyState.config as Record<string, unknown>).version = '2.3.0';
    (legacyState.config as Record<string, unknown>).mapId = 'fixed-31x31-v2';

    const result = decodeSaveCode(codeForEnvelope(legacy));
    expect(result.valid).toBe(false);
    expect(result.state).toBeNull();
    expect(result.envelope).toBeNull();
    expect(result.errors.join(' ')).toMatch(/format version|incompatible|2\.3\.0/i);
    expect(result.errors.join(' ')).toContain('v1.5.3 and earlier saves cannot be loaded or converted');
    expect(current).toEqual(before);
  });

  it('rejects a stale state/config version even when the envelope has Save Format 15', () => {
    const envelope = exportedEnvelope();
    const state = envelope.state as Record<string, unknown>;
    state.gameVersion = '2.4.0';
    (state.config as Record<string, unknown>).version = '2.4.0';
    const result = importSaveJson(JSON.stringify(resign(envelope)));

    expect(result).toMatchObject({ valid: false, state: null, envelope: null });
    expect(result.errors.join(' ')).toMatch(/incompatible/i);
  });

  it('rejects a partial current schema rather than treating it as a migration candidate', () => {
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

  it('uses the v15 autosave key and never rewrites or removes the v14 legacy key', () => {
    const storage = new MemoryStorage();
    const legacy = exportedEnvelope(initialState(9));
    legacy.formatVersion = 10;
    legacy.gameVersion = '3.0.0';
    const legacyState = legacy.state as Record<string, unknown>;
    legacyState.gameVersion = '3.0.0';
    (legacyState.config as Record<string, unknown>).version = '3.0.0';
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
    expect(saved.timing?.storageWriteMs).toBeGreaterThanOrEqual(0);
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
