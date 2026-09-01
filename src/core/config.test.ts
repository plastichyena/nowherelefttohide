import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG,
  createDefaultConfig,
  validateGameConfig,
} from './config';

describe('GameConfig', () => {
  it('contains the agreed PoC defaults and validates', () => {
    expect(validateGameConfig(DEFAULT_CONFIG)).toEqual({ valid: true, errors: [] });
    expect(DEFAULT_CONFIG.version).toBe('2.1.0');
    expect(DEFAULT_CONFIG.mapId).toBe('fixed-31x31-v1');
    expect(DEFAULT_CONFIG.facilities.powerPlant.production.powerGeneration).toBe(10);
    expect(DEFAULT_CONFIG.facilities.farm.production).toMatchObject({ inputs: {}, powerMode: 'boost' });
    expect(DEFAULT_CONFIG.finalHordeTurn).toBe(30);
    expect(DEFAULT_CONFIG.horde).toMatchObject({
      cycle: 5,
      periodicInitial: { hordeZombie: 2, zombie: 0 },
      periodicIncrement: { hordeZombie: 1, zombie: 1 },
      finalComposition: { hordeZombie: 7, zombie: 5 },
    });
    expect(DEFAULT_CONFIG.terrain).toEqual({
      movementCost: { plain: 1, forest: 2, mountain: 3, water: null },
      damageMultiplier: { urban: 0.5, forestZombie: 0.5 },
    });
    expect(DEFAULT_CONFIG.refugees).toMatchObject({
      arrivalIntervalMin: 2,
      arrivalIntervalMax: 4,
      arrivalPeopleMin: 5,
      arrivalPeopleMax: 10,
      screeningCapacity: 10,
    });
    expect(DEFAULT_CONFIG.checkpoint).toMatchObject({
      constructionCivilianGoods: 5,
      maxPreparedPostsPerDirection: 3,
      requiresPolice: false,
      initialSupplyRadius: 5,
    });
    expect(DEFAULT_CONFIG.noise).toEqual({
      police: 4,
      nationalGuard: 5,
      publicClass: { police: 'medium', nationalGuard: 'medium' },
    });
    expect(DEFAULT_CONFIG.units.police).toMatchObject({ hp: 25, attack: 5, movement: 10, range: 1, vision: 5, population: 5, maxFuel: 12 });
    expect(DEFAULT_CONFIG.units.nationalGuard).toMatchObject({ hp: 50, attack: 10, movement: 10, range: 2, population: 10, maxFuel: 22 });
    expect(DEFAULT_CONFIG.naturalRecovery).toEqual({ combatRate: 0.1, restRate: 0.2, rounding: 'ceil' });
    expect(DEFAULT_CONFIG.facilities).toMatchObject({
      farm: { workerCapacity: 30 },
      civilianFactory: { workerCapacity: 30 },
      militaryFactory: { workerCapacity: 30 },
      refinery: { workerCapacity: 30 },
      powerPlant: { workerCapacity: 30 },
      windPowerPlant: {
        workerCapacity: 0,
        production: { fixedPowerGeneration: 15 },
        zombieTargetValue: 5,
      },
      simpleFarm: { workerCapacity: 10, buildCivilianGoods: 15 },
      civilianDroneBase: { workerCapacity: 5, buildCivilianGoods: 25 },
    });
    expect(DEFAULT_CONFIG.economy.initialWorkersByFacility).toMatchObject({
      capital: 41,
      'farm-1': 23,
      'civilian-factory-1': 23,
      'refinery-1': 10,
      'power-plant-1': 3,
    });
  });

  it('enforces fixed five-capacity consumers and zero-capacity non-consumers', () => {
    const requiredThree = createDefaultConfig({ facilities: { capital: { production: { powerCapacity: 3 } } } });
    expect(validateGameConfig(requiredThree)).toMatchObject({
      valid: false,
      errors: expect.arrayContaining(['facilities.capital.production.powerCapacity must be 5']),
    });
    const nonConsumerFive = createDefaultConfig({ facilities: { refinery: { production: { powerCapacity: 5 } } } });
    expect(validateGameConfig(nonConsumerFive)).toMatchObject({
      valid: false,
      errors: expect.arrayContaining(['facilities.refinery.production.powerCapacity must be 0']),
    });
  });

  it('deep-merges options without mutating the default snapshot', () => {
    const config = createDefaultConfig({ finalHordeTurn: 12, horde: { cycle: 3 } });
    expect(config.finalHordeTurn).toBe(12);
    expect(config.horde.cycle).toBe(3);
    expect(config.horde.periodicInitial).toEqual(DEFAULT_CONFIG.horde.periodicInitial);
    expect(DEFAULT_CONFIG.finalHordeTurn).toBe(30);

    config.economy.initialResources.food = 0;
    expect(DEFAULT_CONFIG.economy.initialResources.food).toBe(230);

    config.horde.finalComposition.zombie = 99;
    expect(DEFAULT_CONFIG.horde.finalComposition.zombie).toBe(5);
  });

  it('validates every Horde composition component and rejects unusable groups', () => {
    const invalidConfigs = [
      createDefaultConfig({ horde: { periodicInitial: { hordeZombie: -1 } } }),
      createDefaultConfig({ horde: { periodicIncrement: { zombie: 0.5 } } }),
      createDefaultConfig({ horde: { finalComposition: { zombie: -1 } } }),
      createDefaultConfig({ horde: { periodicInitial: { hordeZombie: 0, zombie: 0 } } }),
      createDefaultConfig({ horde: { finalComposition: { hordeZombie: 0, zombie: 0 } } }),
      createDefaultConfig({ horde: { periodicInitial: { hordeZombie: 0, zombie: 1 } } }),
      createDefaultConfig({ horde: { finalComposition: { hordeZombie: 0, zombie: 1 } } }),
    ];

    for (const config of invalidConfigs) {
      expect(validateGameConfig(config).valid).toBe(false);
    }
  });

  it('clones custom per-type Horde compositions without sharing nested state', () => {
    const config = createDefaultConfig({
      horde: {
        periodicInitial: { hordeZombie: 4, zombie: 2 },
        periodicIncrement: { hordeZombie: 2, zombie: 3 },
        finalComposition: { hordeZombie: 9, zombie: 8 },
      },
    });

    expect(validateGameConfig(config)).toEqual({ valid: true, errors: [] });
    expect(config.horde).toMatchObject({
      periodicInitial: { hordeZombie: 4, zombie: 2 },
      periodicIncrement: { hordeZombie: 2, zombie: 3 },
      finalComposition: { hordeZombie: 9, zombie: 8 },
    });
    expect(JSON.parse(JSON.stringify(config))).toEqual(config);
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
        'farm-2': { survivorRange: { min: 20, max: 30 }, infected: 1 },
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
