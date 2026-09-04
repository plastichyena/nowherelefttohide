import { describe, expect, it } from 'vitest';
import {
  DEFAULT_CONFIG,
  createDefaultConfig,
  validateGameConfig,
} from './config';

describe('v1.5.0 GameConfig', () => {
  it('contains the agreed PoC defaults and validates', () => {
    expect(validateGameConfig(DEFAULT_CONFIG)).toEqual({ valid: true, errors: [] });
    expect(DEFAULT_CONFIG.version).toBe('3.0.0');
    expect(DEFAULT_CONFIG.mapId).toBe('fixed-51x51-v1');
    expect(DEFAULT_CONFIG.economy.initialZombieCount).toBe(25);
    expect(DEFAULT_CONFIG.economy.initialResources).toMatchObject({
      food: 230,
      civilianGoods: 255,
      militaryGoods: 75,
      fuel: 92,
    });
    expect(DEFAULT_CONFIG.facilities.powerPlant.production.powerGeneration).toBe(10);
    expect(DEFAULT_CONFIG.facilities.farm.production).toMatchObject({ inputs: {}, outputs: { food: 10 }, powerMode: 'required' });
    expect(DEFAULT_CONFIG.facilities.refinery.production).toMatchObject({ outputs: { fuel: 5 }, powerMode: 'required', powerCapacity: 5 });
    expect(DEFAULT_CONFIG.facilities.simpleFarm.production).toMatchObject({ outputs: { food: 5 }, powerMode: 'none', powerCapacity: 0 });
    expect(DEFAULT_CONFIG.horde.warningLeadTurns).toBe(2);
    expect(DEFAULT_CONFIG.horde.waves).toEqual([
      { turn: 5, directionCount: 1, compositionPerDirection: { hordeZombie: 2, zombie: 3 }, final: false },
      { turn: 10, directionCount: 2, compositionPerDirection: { hordeZombie: 1, zombie: 5 }, final: false },
      { turn: 20, directionCount: 1, compositionPerDirection: { hordeZombie: 4, zombie: 7 }, final: false },
      { turn: 35, directionCount: 3, compositionPerDirection: { hordeZombie: 2, zombie: 7 }, final: false },
      { turn: 50, directionCount: 4, compositionPerDirection: { hordeZombie: 4, zombie: 8 }, final: true },
    ]);
    expect(DEFAULT_CONFIG.terrain).toEqual({
      movementCost: { plain: 1, forest: 2, mountain: 3, water: null },
      damageMultiplier: { urban: 0.5, forestZombie: 0.5 },
    });
    expect(DEFAULT_CONFIG.refugees).toMatchObject({
      arrivalIntervalMin: 2,
      arrivalIntervalMax: 4,
      arrivalPeopleMin: 5,
      arrivalPeopleMax: 10,
      screeningCapacity: 20,
    });
    expect(DEFAULT_CONFIG.checkpoint).toMatchObject({
      constructionCivilianGoods: 5,
      subsequentConstructionCivilianGoods: 25,
      relocationCivilianGoods: 25,
      maxPreparedPostsPerDirection: 5,
      requiresPolice: false,
      initialSupplyRadius: 5,
    });
    expect(DEFAULT_CONFIG.unitExperience).toEqual({
      productionProficiencyByType: { police: 'recruit', nationalGuard: 'recruit', riotPolice: 'recruit' },
      recruitSurvivalTurnsRequired: 5,
      regularAttackMultiplier: 1.25,
      regularAttackRounding: 'ceil',
      veteranZombieKillsRequired: 5,
      veteranAttackCharges: 2,
    });
    expect(DEFAULT_CONFIG.infection).toMatchObject({
      zombieSpawnPopulationPerUnit: 5,
      maxZombieSpawnPerResolution: 6,
      zombieSpawnRadius: 1,
      noiseRespawnEnabled: true,
    });
    expect(DEFAULT_CONFIG.vision).toEqual({ capital: 5, ownedFacility: 1, operationalCheckpoint: 1 });
    expect(DEFAULT_CONFIG.units.police).toMatchObject({ hp: 25, recruitAttack: 4, movement: 15, range: 1, vision: 5, population: 5, maxFuel: 12, noiseClass: 'medium', noiseRadius: 4 });
    expect(DEFAULT_CONFIG.units.nationalGuard).toMatchObject({ hp: 50, recruitAttack: 8, movement: 10, range: 2, population: 10, maxFuel: 22, noiseClass: 'large', noiseRadius: 8 });
    expect(DEFAULT_CONFIG.units.riotPolice).toMatchObject({ hp: 75, recruitAttack: 10, movement: 10, range: 1, vision: 5, population: 10, maxFuel: 12, noiseClass: 'medium', noiseRadius: 5 });
    expect(DEFAULT_CONFIG.units.riotZombie).toMatchObject({ hp: 50, attack: 5, movement: 3, range: 1, vision: 5 });
    expect(DEFAULT_CONFIG.horde).toMatchObject({
      specialZombieWeights: { zombie: 70, policeZombie: 15, soldierZombie: 10, riotZombie: 5 },
      riotZombieCapPerDirection: 1,
      movementNoiseRadius: 8,
    });
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
      civilianDroneBase: { workerCapacity: 5, buildCivilianGoods: 25, visionRadius: 15 },
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
    const nonConsumerFive = createDefaultConfig({ facilities: { simpleFarm: { production: { powerCapacity: 5 } } } });
    expect(validateGameConfig(nonConsumerFive)).toMatchObject({
      valid: false,
      errors: expect.arrayContaining(['facilities.simpleFarm.production.powerCapacity must be 0']),
    });
  });

  it('deep-merges options without mutating the default snapshot', () => {
    const config = createDefaultConfig({ horde: { warningLeadTurns: 3 } });
    expect(config.horde.warningLeadTurns).toBe(3);
    expect(config.horde.waves).toEqual(DEFAULT_CONFIG.horde.waves);

    config.economy.initialResources.food = 0;
    expect(DEFAULT_CONFIG.economy.initialResources.food).toBe(230);

    config.horde.waves[4]!.compositionPerDirection.zombie = 99;
    expect(DEFAULT_CONFIG.horde.waves[4]!.compositionPerDirection.zombie).toBe(8);
  });

  it('accepts zero initial Zombies but rejects more than the 25 fixed-map positions', () => {
    expect(validateGameConfig(createDefaultConfig({ economy: { initialZombieCount: 0 } }))).toEqual({
      valid: true,
      errors: [],
    });
    const tooMany = createDefaultConfig({ economy: { initialZombieCount: 26 } });
    expect(validateGameConfig(tooMany)).toMatchObject({
      valid: false,
      errors: expect.arrayContaining(['economy.initialZombieCount cannot exceed the 25 fixed-map positions']),
    });
  });

  it('validates the v1.4.3 infection Spawn and Capital Vision fields', () => {
    const invalid = createDefaultConfig({
      infection: {
        zombieSpawnPopulationPerUnit: 0,
        maxZombieSpawnPerResolution: 0,
        zombieSpawnRadius: 0,
        noiseRespawnEnabled: 'yes' as unknown as boolean,
      },
      vision: { capital: -1 },
    });
    const result = validateGameConfig(invalid);
    expect(result.valid).toBe(false);
    expect(result.errors).toEqual(expect.arrayContaining([
      'infection.zombieSpawnPopulationPerUnit must be an integer >= 1',
      'infection.maxZombieSpawnPerResolution must be an integer >= 1',
      'infection.zombieSpawnRadius must be an integer >= 1',
      'infection.noiseRespawnEnabled must be boolean',
      'vision.capital must be an integer >= 0',
    ]));
  });

  it('validates every Horde composition component and rejects unusable groups', () => {
    const invalidConfigs = [
      createDefaultConfig({ horde: { waves: [{ turn: 5, directionCount: 1, compositionPerDirection: { hordeZombie: -1, zombie: 0 }, final: true }] } }),
      createDefaultConfig({ horde: { waves: [{ turn: 5, directionCount: 1, compositionPerDirection: { hordeZombie: 1, zombie: 0.5 }, final: true }] } }),
      createDefaultConfig({ horde: { waves: [{ turn: 5, directionCount: 1, compositionPerDirection: { hordeZombie: 0, zombie: 0 }, final: true }] } }),
      createDefaultConfig({ horde: { waves: [{ turn: 5, directionCount: 1, compositionPerDirection: { hordeZombie: 0, zombie: 1 }, final: true }] } }),
      createDefaultConfig({ horde: { waves: [
        { turn: 5, directionCount: 1, compositionPerDirection: { hordeZombie: 1, zombie: 0 }, final: true },
        { turn: 5, directionCount: 1, compositionPerDirection: { hordeZombie: 1, zombie: 0 }, final: false },
      ] } }),
    ];

    for (const config of invalidConfigs) {
      expect(validateGameConfig(config).valid).toBe(false);
    }
  });

  it('clones custom per-type Horde compositions without sharing nested state', () => {
    const config = createDefaultConfig({
      horde: {
        waves: [{ turn: 12, directionCount: 2, compositionPerDirection: { hordeZombie: 9, zombie: 8 }, final: true }],
      },
    });

    expect(validateGameConfig(config)).toEqual({ valid: true, errors: [] });
    expect(config.horde).toMatchObject({
      waves: [{ turn: 12, directionCount: 2, compositionPerDirection: { hordeZombie: 9, zombie: 8 }, final: true }],
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
