import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG,
  createDefaultConfig,
  validateGameConfig,
} from './config';

describe('GameConfig', () => {
  it('contains the agreed PoC defaults and validates', () => {
    expect(validateGameConfig(DEFAULT_CONFIG)).toEqual({ valid: true, errors: [] });
    expect(DEFAULT_CONFIG.version).toBe('1.1.0');
    expect(DEFAULT_CONFIG.maxTurns).toBe(30);
    expect(DEFAULT_CONFIG.horde).toMatchObject({ cycle: 5, initialCount: 2, increment: 2 });
    expect(DEFAULT_CONFIG.refugees).toMatchObject({
      arrivalIntervalMin: 2,
      arrivalIntervalMax: 4,
      arrivalPeopleMin: 5,
      arrivalPeopleMax: 10,
      screeningCapacity: 10,
    });
    expect(DEFAULT_CONFIG.units.police).toMatchObject({ hp: 25, attack: 5, movement: 5, range: 1, population: 5 });
    expect(DEFAULT_CONFIG.units.nationalGuard).toMatchObject({ hp: 50, attack: 10, movement: 5, range: 2, population: 10 });
    expect(DEFAULT_CONFIG.economy.initialWorkersByFacility).toMatchObject({
      capital: 41,
      'farm-1': 23,
      'civilian-factory-1': 23,
      'refinery-1': 10,
      'power-plant-1': 3,
    });
  });

  it('deep-merges options without mutating the default snapshot', () => {
    const config = createDefaultConfig({ maxTurns: 12, horde: { cycle: 3 } });
    expect(config.maxTurns).toBe(12);
    expect(config.horde.cycle).toBe(3);
    expect(config.horde.initialCount).toBe(DEFAULT_CONFIG.horde.initialCount);
    expect(DEFAULT_CONFIG.maxTurns).toBe(30);

    config.economy.initialResources.food = 0;
    expect(DEFAULT_CONFIG.economy.initialResources.food).toBe(230);
  });

  it('rejects inverted ranges and invalid rates', () => {
    const config = createDefaultConfig({
      refugees: {
        arrivalIntervalMin: 5,
        arrivalIntervalMax: 2,
        policies: { normal: { workerRate: 2 } },
      },
    });
    const result = validateGameConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes('arrival interval'))).toBe(true);
    expect(result.errors.some((error) => error.includes('workerRate'))).toBe(true);
  });

  it('rejects a pre-v1.1 Config version', () => {
    const config = createDefaultConfig();
    config.version = '1.0.0';
    expect(validateGameConfig(config)).toMatchObject({ valid: false });
  });

  it('validates initial disconnected population ranges against their facility capacity', () => {
    const config = createDefaultConfig({
      initialFacilityPopulation: {
        'farm-2': { survivorRange: { min: 20, max: 25 }, infected: 1 },
      },
    });
    const result = validateGameConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some((error) => error.includes('farm-2') && error.includes('capacity'))).toBe(true);
  });

  it('is fully JSON round-trippable', () => {
    expect(JSON.parse(JSON.stringify(DEFAULT_CONFIG))).toEqual(DEFAULT_CONFIG);
  });
});
