import type {
  DeepPartial,
  EconomyConfig,
  FacilityConfig,
  FacilityId,
  FacilityType,
  GameConfig,
  HumanUnitType,
  InitialFacilityPopulationConfig,
  InitialPopulationRange,
  ProductionRule,
  ResourceStock,
  UnitConfigMap,
  UnitType,
} from './types';
import { FIXED_INITIAL_ZOMBIE_COUNT } from './map';

export const CONFIG_VERSION = '3.0.0';
export const DEFAULT_MAP_ID = 'fixed-51x51-v1';

const facilityIds: FacilityId[] = [
  'capital',
  'city-1',
  'city-2',
  'city-3',
  'city-4',
  'city-5',
  'city-6',
  'city-7',
  'city-8',
  'farm-1',
  'farm-2',
  'farm-3',
  'farm-4',
  'farm-5',
  'civilian-factory-1',
  'civilian-factory-2',
  'civilian-factory-3',
  'civilian-factory-4',
  'military-factory-1',
  'military-factory-2',
  'military-factory-3',
  'refinery-1',
  'refinery-2',
  'refinery-3',
  'refinery-4',
  'power-plant-1',
  'power-plant-2',
  'power-plant-3',
  'wind-power-plant-1',
];

const emptyInputs = (): ProductionRule['inputs'] => ({});
const emptyOutputs = (): ProductionRule['outputs'] => ({});

function production(
  inputs: ProductionRule['inputs'],
  outputs: ProductionRule['outputs'],
  powerMode: ProductionRule['powerMode'],
  powerCapacity = 0,
  powerGeneration = 0,
  fixedPowerGeneration = 0,
): ProductionRule {
  return { inputs, outputs, powerMode, requiresPower: powerMode === 'required', powerCapacity, powerGeneration, fixedPowerGeneration };
}

const defaultUnitConfig: UnitConfigMap = {
  police: {
    hp: 25, recruitAttack: 4, movement: 15, range: 1, vision: 5, population: 5, maxFuel: 12,
    maxMilitaryGoods: 5, fixedMilitaryGoodsUpkeepPerTurn: 0,
    attackMilitaryGoodsCostByRange: { 1: 1 }, suppressionMilitaryGoodsCost: 1,
    militaryGoodsShortageAttackMultiplier: 0.2, emergencyMovementPoints: 3,
    recruitmentFacilityTypes: ['capital', 'city'],
    productionCivilianGoods: 10, productionMilitaryGoods: 10, fuelCostRule: 'policeLike',
    suppressionCivilianDamageRate: 0, reanimationUnitType: 'policeZombie', noiseClass: 'medium', noiseRadius: 4,
  },
  nationalGuard: {
    hp: 50, recruitAttack: 8, movement: 10, range: 2, vision: 5, population: 10, maxFuel: 22,
    maxMilitaryGoods: 20, fixedMilitaryGoodsUpkeepPerTurn: 1,
    attackMilitaryGoodsCostByRange: { 1: 1, 2: 2 }, suppressionMilitaryGoodsCost: 1,
    militaryGoodsShortageAttackMultiplier: 0.2, emergencyMovementPoints: 2,
    recruitmentFacilityTypes: ['capital'],
    productionCivilianGoods: 20, productionMilitaryGoods: 25, fuelCostRule: 'nationalGuardLike',
    suppressionCivilianDamageRate: 0.5, reanimationUnitType: 'soldierZombie', noiseClass: 'large', noiseRadius: 8,
  },
  riotPolice: {
    hp: 75, recruitAttack: 10, movement: 10, range: 1, vision: 5, population: 10, maxFuel: 12,
    maxMilitaryGoods: 5, fixedMilitaryGoodsUpkeepPerTurn: 0,
    attackMilitaryGoodsCostByRange: { 1: 1 }, suppressionMilitaryGoodsCost: 1,
    militaryGoodsShortageAttackMultiplier: 0.2, emergencyMovementPoints: 2,
    recruitmentFacilityTypes: ['capital', 'city'],
    productionCivilianGoods: 25, productionMilitaryGoods: 25, fuelCostRule: 'policeLike',
    suppressionCivilianDamageRate: 0, reanimationUnitType: 'riotZombie', noiseClass: 'medium', noiseRadius: 5,
  },
  zombie: {
    hp: 10, attack: 5, movement: 3, range: 1, vision: 3, population: 0, maxFuel: 0,
    maxMilitaryGoods: 0, fixedMilitaryGoodsUpkeepPerTurn: 0,
    attackMilitaryGoodsCostByRange: {}, suppressionMilitaryGoodsCost: 0,
    militaryGoodsShortageAttackMultiplier: 1, emergencyMovementPoints: 0,
  },
  hordeZombie: {
    hp: 20, attack: 5, movement: 3, range: 1, vision: 3, population: 0, maxFuel: 0,
    maxMilitaryGoods: 0, fixedMilitaryGoodsUpkeepPerTurn: 0,
    attackMilitaryGoodsCostByRange: {}, suppressionMilitaryGoodsCost: 0,
    militaryGoodsShortageAttackMultiplier: 1, emergencyMovementPoints: 0,
  },
  policeZombie: {
    hp: 10, attack: 5, movement: 3, range: 1, vision: 5, population: 0, maxFuel: 0,
    maxMilitaryGoods: 0, fixedMilitaryGoodsUpkeepPerTurn: 0,
    attackMilitaryGoodsCostByRange: {}, suppressionMilitaryGoodsCost: 0,
    militaryGoodsShortageAttackMultiplier: 1, emergencyMovementPoints: 0,
  },
  soldierZombie: {
    hp: 20, attack: 5, movement: 5, range: 1, vision: 5, population: 0, maxFuel: 0,
    maxMilitaryGoods: 0, fixedMilitaryGoodsUpkeepPerTurn: 0,
    attackMilitaryGoodsCostByRange: {}, suppressionMilitaryGoodsCost: 0,
    militaryGoodsShortageAttackMultiplier: 1, emergencyMovementPoints: 0,
  },
  riotZombie: {
    hp: 50, attack: 5, movement: 3, range: 1, vision: 5, population: 0, maxFuel: 0,
    maxMilitaryGoods: 0, fixedMilitaryGoodsUpkeepPerTurn: 0,
    attackMilitaryGoodsCostByRange: {}, suppressionMilitaryGoodsCost: 0,
    militaryGoodsShortageAttackMultiplier: 1, emergencyMovementPoints: 0,
  },
};

const defaultFacilityConfig: Record<FacilityType, FacilityConfig> = {
  capital: {
    workerCapacity: 100,
    production: production(emptyInputs(), { civilianGoods: 1 }, 'required', 5),
    overrunSpawnCount: 2,
    buildCivilianGoods: 0, visionRadius: 1, zombieTargetValue: 0,
  },
  city: {
    workerCapacity: 50,
    production: production(emptyInputs(), { civilianGoods: 1 }, 'required', 5),
    overrunSpawnCount: 2,
    buildCivilianGoods: 0, visionRadius: 1, zombieTargetValue: 0,
  },
  farm: {
    workerCapacity: 30,
    production: production(emptyInputs(), { food: 10 }, 'required', 5),
    overrunSpawnCount: 2,
    buildCivilianGoods: 0, visionRadius: 1, zombieTargetValue: 0,
  },
  civilianFactory: {
    workerCapacity: 30,
    production: production(emptyInputs(), { civilianGoods: 10 }, 'required', 5),
    overrunSpawnCount: 2,
    buildCivilianGoods: 0, visionRadius: 1, zombieTargetValue: 0,
  },
  militaryFactory: {
    workerCapacity: 30,
    production: production({ civilianGoods: 1 }, { militaryGoods: 4 }, 'required', 5),
    overrunSpawnCount: 2,
    buildCivilianGoods: 0, visionRadius: 1, zombieTargetValue: 0,
  },
  refinery: {
    workerCapacity: 30,
    production: production(emptyInputs(), { fuel: 5 }, 'required', 5),
    overrunSpawnCount: 2,
    buildCivilianGoods: 0, visionRadius: 1, zombieTargetValue: 0,
  },
  powerPlant: {
    workerCapacity: 30,
    production: production(emptyInputs(), emptyOutputs(), 'none', 0, 10),
    overrunSpawnCount: 2,
    buildCivilianGoods: 0, visionRadius: 1, zombieTargetValue: 0,
  },
  windPowerPlant: {
    workerCapacity: 0,
    production: production(emptyInputs(), emptyOutputs(), 'none', 0, 0, 15),
    overrunSpawnCount: 0,
    buildCivilianGoods: 0, visionRadius: 1, zombieTargetValue: 5,
  },
  simpleFarm: {
    workerCapacity: 10,
    production: production(emptyInputs(), { food: 5 }, 'none'),
    overrunSpawnCount: 2,
    buildCivilianGoods: 15, visionRadius: 1, zombieTargetValue: 0,
  },
  civilianDroneBase: {
    workerCapacity: 5,
    production: production(emptyInputs(), emptyOutputs(), 'required', 5),
    overrunSpawnCount: 2,
    buildCivilianGoods: 25, visionRadius: 15, zombieTargetValue: 0,
  },
};

const initialResources: ResourceStock = {
  food: 230,
  civilianGoods: 255,
  militaryGoods: 75,
  fuel: 92,
};

const initialWorkersByFacility: Record<FacilityId, number> = {
  capital: 41,
  'city-1': 0,
  'city-2': 0,
  'city-3': 0,
  'city-4': 0,
  'city-5': 0,
  'city-6': 0,
  'city-7': 0,
  'city-8': 0,
  'farm-1': 23,
  'farm-2': 0,
  'farm-3': 0,
  'farm-4': 0,
  'farm-5': 0,
  'civilian-factory-1': 23,
  'civilian-factory-2': 0,
  'civilian-factory-3': 0,
  'civilian-factory-4': 0,
  'military-factory-1': 0,
  'military-factory-2': 0,
  'military-factory-3': 0,
  'refinery-1': 10,
  'refinery-2': 0,
  'refinery-3': 0,
  'refinery-4': 0,
  'power-plant-1': 3,
  'power-plant-2': 0,
  'power-plant-3': 0,
  'wind-power-plant-1': 0,
};

const defaultEconomy: EconomyConfig = {
  populationConsumption: { food: 1, civilianGoods: 1 },
  initialResources,
  initialWorkersByFacility,
  initialZombieCount: 25,
};

const defaultInitialFacilityPopulation: Record<FacilityId, InitialFacilityPopulationConfig> =
  Object.fromEntries(
    facilityIds.map((facilityId) => [
      facilityId,
      {
        // `null` deliberately preserves the established owned-facility
        // assignments in economy.initialWorkersByFacility and the map's
        // disconnected-facility defaults.  Config authors can opt in per ID.
        survivors: null,
        infected: null,
        survivorRange: null,
        infectedRange: null,
      },
    ]),
  ) as Record<FacilityId, InitialFacilityPopulationConfig>;

/**
 * Default values are intentionally data-only. The object is never mutated by
 * the core; new-game creation should use createDefaultConfig() to obtain an
 * independent copy that can be stored in GameState.
 */
export const DEFAULT_CONFIG: GameConfig = {
  version: CONFIG_VERSION,
  mapId: DEFAULT_MAP_ID,
  maxActionsPerTurn: 100,
  units: defaultUnitConfig,
  unitExperience: {
    productionProficiencyByType: {
      police: 'recruit',
      nationalGuard: 'recruit',
      riotPolice: 'recruit',
    },
    recruitSurvivalTurnsRequired: 5,
    regularAttackMultiplier: 1.25,
    regularAttackRounding: 'ceil',
    veteranZombieKillsRequired: 5,
    veteranAttackCharges: 2,
  },
  facilities: defaultFacilityConfig,
  economy: defaultEconomy,
  initialFacilityPopulation: defaultInitialFacilityPopulation,
  naturalRecovery: {
    combatRate: 0.1,
    restRate: 0.2,
    rounding: 'ceil',
  },
  horde: {
    warningLeadTurns: 2,
    waves: [
      { turn: 5, directionCount: 1, compositionPerDirection: { hordeZombie: 2, zombie: 3 }, final: false },
      { turn: 10, directionCount: 2, compositionPerDirection: { hordeZombie: 1, zombie: 5 }, final: false },
      { turn: 20, directionCount: 1, compositionPerDirection: { hordeZombie: 4, zombie: 7 }, final: false },
      { turn: 35, directionCount: 3, compositionPerDirection: { hordeZombie: 2, zombie: 7 }, final: false },
      { turn: 50, directionCount: 4, compositionPerDirection: { hordeZombie: 4, zombie: 8 }, final: true },
    ],
    specialZombieWeights: { zombie: 70, policeZombie: 15, soldierZombie: 10, riotZombie: 5 },
    riotZombieCapPerDirection: 1,
    movementNoiseRadius: 8,
  },
  refugees: {
    arrivalIntervalMin: 2,
    arrivalIntervalMax: 4,
    arrivalPeopleMin: 5,
    arrivalPeopleMax: 10,
    screeningCapacity: 20,
    policies: {
      passThrough: {
        turns: 0,
        workerRate: 1,
        infectionRate: 0.5,
        infectionPopulationRate: 0.5,
      },
      normal: {
        turns: 2,
        workerRate: 0.75,
        infectionRate: 0.25,
        infectionPopulationRate: 0.25,
      },
      strict: {
        turns: 5,
        workerRate: 0.5,
        infectionRate: 0,
        infectionPopulationRate: 0,
      },
    },
  },
  infection: {
    facilitySpreadPerTurn: 1,
    fallBackInfectionRate: 0.5,
    zombieSpawnPopulationPerUnit: 5,
    maxZombieSpawnPerResolution: 6,
    zombieSpawnRadius: 1,
    noiseRespawnEnabled: true,
  },
  checkpoint: {
    constructionCivilianGoods: 5,
    subsequentConstructionCivilianGoods: 25,
    relocationCivilianGoods: 25,
    maxPreparedPostsPerDirection: 5,
    requiresPolice: false,
    consumesPower: false,
    initialSupplyRadius: 5,
  },
  constructibleFacility: {
    limitPerTypeDivisor: 2,
  },
  terrain: {
    movementCost: { plain: 1, forest: 2, mountain: 3, water: null },
    damageMultiplier: { urban: 0.5, forestZombie: 0.5 },
  },
  vision: {
    capital: 5,
    ownedFacility: 1,
    operationalCheckpoint: 1,
  },
};

/**
 * Clone a JSON-compatible value. Keeping this helper here makes it explicit
 * that Config snapshots do not share nested mutable objects with defaults.
 */
export function cloneConfig(config: GameConfig): GameConfig {
  return JSON.parse(JSON.stringify(config)) as GameConfig;
}

function mergeObjects(base: unknown, override: unknown): unknown {
  if (Array.isArray(base) || Array.isArray(override)) {
    return override === undefined ? base : override;
  }
  if (
    typeof base === 'object' &&
    base !== null &&
    typeof override === 'object' &&
    override !== null
  ) {
    const result: Record<string, unknown> = { ...(base as Record<string, unknown>) };
    for (const [key, value] of Object.entries(override as Record<string, unknown>)) {
      if (value !== undefined) {
        result[key] = mergeObjects(result[key], value);
      }
    }
    return result;
  }
  return override === undefined ? base : override;
}

/** Create a complete, independent Config snapshot for a new game. */
export function createDefaultConfig(overrides: DeepPartial<GameConfig> = {}): GameConfig {
  const merged = mergeObjects(DEFAULT_CONFIG, overrides);
  return cloneConfig(merged as GameConfig);
}

export interface ConfigValidationResult {
  valid: boolean;
  errors: string[];
}

function requireInteger(errors: string[], value: number, path: string, minimum = 0): void {
  if (!Number.isInteger(value) || value < minimum) {
    errors.push(`${path} must be an integer >= ${minimum}`);
  }
}

function validateInitialPopulationRange(
  errors: string[],
  range: InitialPopulationRange | null | undefined,
  path: string,
): void {
  if (range === null) return;
  if (!range || typeof range !== 'object') {
    errors.push(`${path} must be an object or null`);
    return;
  }
  requireInteger(errors, range.min, `${path}.min`, 0);
  requireInteger(errors, range.max, `${path}.max`, 0);
  if (Number.isInteger(range.min) && Number.isInteger(range.max) && range.min > range.max) {
    errors.push(`${path}.min cannot exceed ${path}.max`);
  }
}

/** Validate option/save input before it is copied into a GameState. */
export function validateGameConfig(config: GameConfig): ConfigValidationResult {
  const errors: string[] = [];
  if (!config || typeof config !== 'object') {
    return { valid: false, errors: ['Config must be an object'] };
  }
  if (config.version !== CONFIG_VERSION) {
    errors.push(`version must be ${CONFIG_VERSION}`);
  }
  if (typeof config.mapId !== 'string' || config.mapId.length === 0) {
    errors.push('mapId must be a non-empty string');
  }
  if (Object.prototype.hasOwnProperty.call(config as unknown as Record<string, unknown>, 'finalHordeTurn')) {
    errors.push(`finalHordeTurn is not part of Game Rules ${CONFIG_VERSION}; derive it from the Final Wave`);
  }
  requireInteger(errors, config.maxActionsPerTurn, 'maxActionsPerTurn', 1);

  const unitTypes: UnitType[] = [
    'police', 'nationalGuard', 'riotPolice', 'zombie', 'hordeZombie', 'policeZombie', 'soldierZombie', 'riotZombie',
  ];
  for (const type of unitTypes) {
    const unit = config.units?.[type];
    if (!unit) {
      errors.push(`units.${type} is required`);
      continue;
    }
    for (const key of [
      'hp', 'movement', 'range', 'vision', 'population', 'maxFuel',
      'maxMilitaryGoods', 'fixedMilitaryGoodsUpkeepPerTurn', 'suppressionMilitaryGoodsCost',
      'emergencyMovementPoints',
    ] as const) {
      requireInteger(errors, unit[key], `units.${type}.${key}`, 0);
    }
    const human = type === 'police' || type === 'nationalGuard' || type === 'riotPolice';
    if (human) {
      const humanUnit = unit as GameConfig['units']['police'];
      requireInteger(errors, humanUnit.recruitAttack, `units.${type}.recruitAttack`, 1);
      requireInteger(errors, humanUnit.productionCivilianGoods, `units.${type}.productionCivilianGoods`, 0);
      requireInteger(errors, humanUnit.productionMilitaryGoods, `units.${type}.productionMilitaryGoods`, 0);
      if (!Array.isArray(humanUnit.recruitmentFacilityTypes) || humanUnit.recruitmentFacilityTypes.length === 0) {
        errors.push(`units.${type}.recruitmentFacilityTypes is required`);
      }
      if (!['policeLike', 'nationalGuardLike'].includes(humanUnit.fuelCostRule)) {
        errors.push(`units.${type}.fuelCostRule is invalid`);
      }
      if (!['small', 'medium', 'large', 'extraLarge'].includes(humanUnit.noiseClass)) {
        errors.push(`units.${type}.noiseClass is invalid`);
      }
      requireInteger(errors, humanUnit.noiseRadius, `units.${type}.noiseRadius`, 0);
      if (!Number.isFinite(humanUnit.suppressionCivilianDamageRate)
        || humanUnit.suppressionCivilianDamageRate < 0
        || humanUnit.suppressionCivilianDamageRate > 1) {
        errors.push(`units.${type}.suppressionCivilianDamageRate must be between 0 and 1`);
      }
    } else {
      requireInteger(errors, (unit as GameConfig['units']['zombie']).attack, `units.${type}.attack`, 1);
    }
    if (typeof unit.militaryGoodsShortageAttackMultiplier !== 'number'
      || !Number.isFinite(unit.militaryGoodsShortageAttackMultiplier)
      || unit.militaryGoodsShortageAttackMultiplier < 0
      || unit.militaryGoodsShortageAttackMultiplier > 1) {
      errors.push(`units.${type}.militaryGoodsShortageAttackMultiplier must be between 0 and 1`);
    }
    if (!unit.attackMilitaryGoodsCostByRange || typeof unit.attackMilitaryGoodsCostByRange !== 'object') {
      errors.push(`units.${type}.attackMilitaryGoodsCostByRange is required`);
    } else if (human) {
      for (let distance = 1; distance <= unit.range; distance += 1) {
        requireInteger(
          errors,
          unit.attackMilitaryGoodsCostByRange[distance],
          `units.${type}.attackMilitaryGoodsCostByRange.${distance}`,
          0,
        );
      }
    }
    if (human && unit.maxFuel < 1) {
      errors.push(`units.${type}.maxFuel must be at least 1`);
    }
    if (human && unit.maxMilitaryGoods < 1) {
      errors.push(`units.${type}.maxMilitaryGoods must be at least 1`);
    }
    if (!human
      && (unit.maxMilitaryGoods !== 0 || unit.emergencyMovementPoints !== 0)) {
      errors.push(`units.${type} must not carry military goods or use emergency movement`);
    }
  }

  const experience = config.unitExperience;
  if (!experience || typeof experience !== 'object') {
    errors.push('unitExperience is required');
  } else {
    for (const type of HUMAN_UNIT_TYPES) {
      if (!['recruit', 'regular', 'veteran'].includes(experience.productionProficiencyByType?.[type])) {
        errors.push(`unitExperience.productionProficiencyByType.${type} is invalid`);
      }
    }
    requireInteger(errors, experience.recruitSurvivalTurnsRequired, 'unitExperience.recruitSurvivalTurnsRequired', 1);
    requireInteger(errors, experience.veteranZombieKillsRequired, 'unitExperience.veteranZombieKillsRequired', 1);
    requireInteger(errors, experience.veteranAttackCharges, 'unitExperience.veteranAttackCharges', 2);
    if (!Number.isFinite(experience.regularAttackMultiplier) || experience.regularAttackMultiplier <= 0) {
      errors.push('unitExperience.regularAttackMultiplier must be positive');
    }
    if (experience.regularAttackRounding !== 'ceil') errors.push('unitExperience.regularAttackRounding must be ceil');
  }

  const facilityTypes: FacilityType[] = [
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
  ];
  for (const type of facilityTypes) {
    const facility = config.facilities?.[type];
    if (!facility) {
      errors.push(`facilities.${type} is required`);
      continue;
    }
    requireInteger(errors, facility.workerCapacity, `facilities.${type}.workerCapacity`, type === 'windPowerPlant' ? 0 : 1);
    requireInteger(errors, facility.overrunSpawnCount, `facilities.${type}.overrunSpawnCount`, 0);
    requireInteger(errors, facility.buildCivilianGoods, `facilities.${type}.buildCivilianGoods`, 0);
    requireInteger(errors, facility.visionRadius, `facilities.${type}.visionRadius`, 0);
    requireInteger(errors, facility.zombieTargetValue, `facilities.${type}.zombieTargetValue`, 0);
    if (!facility.production || typeof facility.production !== 'object') {
      errors.push(`facilities.${type}.production is required`);
      continue;
    }
    requireInteger(errors, facility.production.powerCapacity, `facilities.${type}.production.powerCapacity`, 0);
    requireInteger(errors, facility.production.powerGeneration, `facilities.${type}.production.powerGeneration`, 0);
    requireInteger(errors, facility.production.fixedPowerGeneration, `facilities.${type}.production.fixedPowerGeneration`, 0);
    if (!['required', 'none'].includes(facility.production.powerMode)) {
      errors.push(`facilities.${type}.production.powerMode must be required or none`);
    }
    const expectedPowerMode = ['capital', 'city', 'farm', 'civilianFactory', 'militaryFactory', 'refinery', 'civilianDroneBase'].includes(type)
      ? 'required'
      : 'none';
    if (facility.production.powerMode !== expectedPowerMode) {
      errors.push(`facilities.${type}.production.powerMode must be ${expectedPowerMode}`);
    }
    const expectedPowerCapacity = expectedPowerMode === 'none' ? 0 : 5;
    if (facility.production.powerCapacity !== expectedPowerCapacity) {
      errors.push(`facilities.${type}.production.powerCapacity must be ${expectedPowerCapacity}`);
    }
    if (facility.production.requiresPower !== (expectedPowerMode === 'required')) {
      errors.push(`facilities.${type}.production.requiresPower is inconsistent with powerMode`);
    }
    if (!facility.production.inputs || typeof facility.production.inputs !== 'object') {
      errors.push(`facilities.${type}.production.inputs is required`);
    } else {
      for (const [resource, amount] of Object.entries(facility.production.inputs)) {
        requireInteger(errors, amount, `facilities.${type}.production.inputs.${resource}`, 0);
      }
    }
    if (!facility.production.outputs || typeof facility.production.outputs !== 'object') {
      errors.push(`facilities.${type}.production.outputs is required`);
    } else {
      for (const [resource, amount] of Object.entries(facility.production.outputs)) {
        requireInteger(errors, amount, `facilities.${type}.production.outputs.${resource}`, 0);
      }
    }
  }

  const initialFacilityPopulation = config.initialFacilityPopulation;
  if (!initialFacilityPopulation || typeof initialFacilityPopulation !== 'object') {
    errors.push('initialFacilityPopulation is required');
  } else {
    const facilityTypeById: Record<FacilityId, FacilityType> = {
      capital: 'capital',
      'city-1': 'city',
      'city-2': 'city',
      'city-3': 'city',
      'city-4': 'city',
      'city-5': 'city',
      'city-6': 'city',
      'city-7': 'city',
      'city-8': 'city',
      'farm-1': 'farm',
      'farm-2': 'farm',
      'farm-3': 'farm',
      'farm-4': 'farm',
      'farm-5': 'farm',
      'civilian-factory-1': 'civilianFactory',
      'civilian-factory-2': 'civilianFactory',
      'civilian-factory-3': 'civilianFactory',
      'civilian-factory-4': 'civilianFactory',
      'military-factory-1': 'militaryFactory',
      'military-factory-2': 'militaryFactory',
      'military-factory-3': 'militaryFactory',
      'refinery-1': 'refinery',
      'refinery-2': 'refinery',
      'refinery-3': 'refinery',
      'refinery-4': 'refinery',
      'power-plant-1': 'powerPlant',
      'power-plant-2': 'powerPlant',
      'power-plant-3': 'powerPlant',
      'wind-power-plant-1': 'windPowerPlant',
    };
    for (const facilityId of facilityIds) {
      const initial = initialFacilityPopulation[facilityId];
      const path = `initialFacilityPopulation.${facilityId}`;
      if (!initial || typeof initial !== 'object') {
        errors.push(`${path} is required`);
        continue;
      }
      for (const key of ['survivors', 'infected'] as const) {
        if (initial[key] !== null) requireInteger(errors, initial[key]!, `${path}.${key}`, 0);
      }
      validateInitialPopulationRange(errors, initial.survivorRange, `${path}.survivorRange`);
      validateInitialPopulationRange(errors, initial.infectedRange, `${path}.infectedRange`);

      const facility = config.facilities?.[facilityTypeById[facilityId]];
      if (!facility) continue;
      const legacySurvivors = config.economy?.initialWorkersByFacility?.[facilityId] ?? 0;
      const maximumSurvivors = initial.survivorRange?.max ?? initial.survivors ?? legacySurvivors;
      const maximumInfected = initial.infectedRange?.max ?? initial.infected ?? 0;
      if (maximumSurvivors + maximumInfected > facility.workerCapacity) {
        errors.push(`${path} maximum population exceeds worker capacity`);
      }
    }
  }

  const naturalRecovery = config.naturalRecovery;
  if (!naturalRecovery || typeof naturalRecovery !== 'object') {
    errors.push('naturalRecovery is required');
  } else {
    for (const field of ['combatRate', 'restRate'] as const) {
      if (!Number.isFinite(naturalRecovery[field]) || naturalRecovery[field] < 0 || naturalRecovery[field] > 1) {
        errors.push(`naturalRecovery.${field} must be between 0 and 1`);
      }
    }
    if (naturalRecovery.rounding !== 'ceil' && naturalRecovery.rounding !== 'floor') {
      errors.push('naturalRecovery.rounding must be ceil or floor');
    }
  }

  const economy = config.economy;
  if (!economy || typeof economy !== 'object') {
    errors.push('economy is required');
  } else {
    requireInteger(errors, economy.initialZombieCount, 'economy.initialZombieCount', 0);
    if (economy.initialZombieCount > FIXED_INITIAL_ZOMBIE_COUNT) {
      errors.push(`economy.initialZombieCount cannot exceed the ${FIXED_INITIAL_ZOMBIE_COUNT} fixed-map positions`);
    }
    const stock = economy.initialResources;
    if (!stock || typeof stock !== 'object') {
      errors.push('economy.initialResources is required');
    } else {
      for (const [resource, amount] of Object.entries(stock)) {
        requireInteger(errors, amount, `economy.initialResources.${resource}`, 0);
      }
    }
    for (const facilityId of facilityIds) {
      requireInteger(errors, economy.initialWorkersByFacility?.[facilityId], `economy.initialWorkersByFacility.${facilityId}`, 0);
    }
  }

  const horde = config.horde;
  if (!horde || typeof horde !== 'object') {
    errors.push('horde is required');
  } else {
    for (const retiredField of ['cycle', 'periodicInitial', 'periodicIncrement', 'warningStartTurn', 'spawnOnlyBeforeFinalTurn', 'finalComposition']) {
      if (Object.prototype.hasOwnProperty.call(horde as unknown as Record<string, unknown>, retiredField)) {
        errors.push(`horde.${retiredField} is not supported by Game Rules ${CONFIG_VERSION}`);
      }
    }
    requireInteger(errors, horde.warningLeadTurns, 'horde.warningLeadTurns', 1);
    requireInteger(errors, horde.riotZombieCapPerDirection, 'horde.riotZombieCapPerDirection', 0);
    requireInteger(errors, horde.movementNoiseRadius, 'horde.movementNoiseRadius', 0);
    for (const type of ['zombie', 'policeZombie', 'soldierZombie', 'riotZombie'] as const) {
      requireInteger(errors, horde.specialZombieWeights?.[type], `horde.specialZombieWeights.${type}`, 0);
    }
    if (horde.specialZombieWeights
      && Object.values(horde.specialZombieWeights).reduce((sum, weight) => sum + weight, 0) <= 0) {
      errors.push('horde.specialZombieWeights must have a positive total');
    }
    const validateComposition = (composition: GameConfig['horde']['waves'][number]['compositionPerDirection'], path: string): void => {
      if (!composition || typeof composition !== 'object') {
        errors.push(`${path} is required`);
        return;
      }
      requireInteger(errors, composition.hordeZombie, `${path}.hordeZombie`, 0);
      requireInteger(errors, composition.zombie, `${path}.zombie`, 0);
      if (Number.isInteger(composition.hordeZombie) && Number.isInteger(composition.zombie)) {
        if (composition.hordeZombie + composition.zombie < 1) errors.push(`${path} must contain at least one unit`);
        if (composition.zombie > 0 && composition.hordeZombie === 0) {
          errors.push(`${path} cannot contain Normal Zombies without a Horde Zombie`);
        }
      }
    };
    if (!Array.isArray(horde.waves) || horde.waves.length === 0) {
      errors.push('horde.waves must contain at least one wave');
    } else {
      let previousTurn = 0;
      let finalCount = 0;
      horde.waves.forEach((wave, index) => {
        const path = `horde.waves.${index}`;
        requireInteger(errors, wave?.turn, `${path}.turn`, 1);
        requireInteger(errors, wave?.directionCount, `${path}.directionCount`, 1);
        if (Number.isInteger(wave?.directionCount) && (wave.directionCount < 1 || wave.directionCount > 4)) {
          errors.push(`${path}.directionCount must be between 1 and 4`);
        }
        validateComposition(wave?.compositionPerDirection, `${path}.compositionPerDirection`);
        if (typeof wave?.final !== 'boolean') errors.push(`${path}.final must be boolean`);
        if (wave?.final === true) finalCount += 1;
        if (Number.isInteger(wave?.turn) && wave.turn <= previousTurn) {
          errors.push(`${path}.turn must be strictly increasing`);
        }
        if (Number.isInteger(wave?.turn)) previousTurn = wave.turn;
        if (wave?.final === true && index !== horde.waves.length - 1) {
          errors.push(`${path}.final is only allowed on the last wave`);
        }
      });
      if (finalCount !== 1 || horde.waves.at(-1)?.final !== true) {
        errors.push('horde.waves must contain exactly one Final Wave at the end');
      }
    }
  }

  const infection = config.infection;
  if (!infection || typeof infection !== 'object') {
    errors.push('infection is required');
  } else {
    requireInteger(errors, infection.facilitySpreadPerTurn, 'infection.facilitySpreadPerTurn', 0);
    for (const key of ['fallBackInfectionRate'] as const) {
      if (!Number.isFinite(infection[key]) || infection[key] < 0 || infection[key] > 1) {
        errors.push(`infection.${key} must be between 0 and 1`);
      }
    }
    requireInteger(errors, infection.zombieSpawnPopulationPerUnit, 'infection.zombieSpawnPopulationPerUnit', 1);
    requireInteger(errors, infection.maxZombieSpawnPerResolution, 'infection.maxZombieSpawnPerResolution', 1);
    requireInteger(errors, infection.zombieSpawnRadius, 'infection.zombieSpawnRadius', 1);
    if (typeof infection.noiseRespawnEnabled !== 'boolean') errors.push('infection.noiseRespawnEnabled must be boolean');
  }

  const checkpoint = config.checkpoint;
  if (!checkpoint || typeof checkpoint !== 'object') {
    errors.push('checkpoint is required');
  } else {
    requireInteger(errors, checkpoint.constructionCivilianGoods, 'checkpoint.constructionCivilianGoods', 0);
    requireInteger(errors, checkpoint.subsequentConstructionCivilianGoods, 'checkpoint.subsequentConstructionCivilianGoods', 0);
    requireInteger(errors, checkpoint.relocationCivilianGoods, 'checkpoint.relocationCivilianGoods', 0);
    requireInteger(errors, checkpoint.maxPreparedPostsPerDirection, 'checkpoint.maxPreparedPostsPerDirection', 1);
    requireInteger(errors, checkpoint.initialSupplyRadius, 'checkpoint.initialSupplyRadius', 0);
    if (typeof checkpoint.requiresPolice !== 'boolean' || typeof checkpoint.consumesPower !== 'boolean') {
      errors.push('checkpoint flags must be boolean');
    }
  }

  const constructibleFacility = config.constructibleFacility;
  if (!constructibleFacility || typeof constructibleFacility !== 'object') {
    errors.push('constructibleFacility is required');
  } else {
    requireInteger(errors, constructibleFacility.limitPerTypeDivisor, 'constructibleFacility.limitPerTypeDivisor', 1);
  }

  const terrain = config.terrain;
  if (!terrain || typeof terrain !== 'object') {
    errors.push('terrain is required');
  } else {
    for (const type of ['plain', 'forest', 'mountain'] as const) {
      requireInteger(errors, terrain.movementCost?.[type] ?? Number.NaN, `terrain.movementCost.${type}`, 1);
    }
    if (terrain.movementCost?.water !== null) errors.push('terrain.movementCost.water must be null');
    for (const key of ['urban', 'forestZombie'] as const) {
      const value = terrain.damageMultiplier?.[key];
      if (!Number.isFinite(value) || value <= 0 || value > 1) {
        errors.push(`terrain.damageMultiplier.${key} must be greater than 0 and at most 1`);
      }
    }
  }

  const vision = config.vision;
  if (!vision || typeof vision !== 'object') {
    errors.push('vision is required');
  } else {
    requireInteger(errors, vision.capital, 'vision.capital', 0);
    requireInteger(errors, vision.ownedFacility, 'vision.ownedFacility', 0);
    requireInteger(errors, vision.operationalCheckpoint, 'vision.operationalCheckpoint', 0);
  }

  const refugees = config.refugees;
  if (!refugees || typeof refugees !== 'object') {
    errors.push('refugees is required');
  } else {
    requireInteger(errors, refugees.screeningCapacity, 'refugees.screeningCapacity', 1);
    requireInteger(errors, refugees.arrivalIntervalMin, 'refugees.arrivalIntervalMin', 1);
    requireInteger(errors, refugees.arrivalIntervalMax, 'refugees.arrivalIntervalMax', 1);
    requireInteger(errors, refugees.arrivalPeopleMin, 'refugees.arrivalPeopleMin', 1);
    requireInteger(errors, refugees.arrivalPeopleMax, 'refugees.arrivalPeopleMax', 1);
    if (refugees.arrivalIntervalMin > refugees.arrivalIntervalMax) {
      errors.push('refugees arrival interval minimum cannot exceed maximum');
    }
    if (refugees.arrivalPeopleMin > refugees.arrivalPeopleMax) {
      errors.push('refugees arrival people minimum cannot exceed maximum');
    }
    for (const policy of ['passThrough', 'normal', 'strict'] as const) {
      const policyConfig = refugees.policies?.[policy];
      if (!policyConfig) {
        errors.push(`refugees.policies.${policy} is required`);
        continue;
      }
      requireInteger(errors, policyConfig.turns, `refugees.policies.${policy}.turns`, 0);
      for (const key of ['workerRate', 'infectionRate', 'infectionPopulationRate'] as const) {
        if (!Number.isFinite(policyConfig[key]) || policyConfig[key] < 0 || policyConfig[key] > 1) {
          errors.push(`refugees.policies.${policy}.${key} must be between 0 and 1`);
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/** Runtime assertion variant useful at game bootstrap. */
export function assertValidGameConfig(config: GameConfig): void {
  const result = validateGameConfig(config);
  if (!result.valid) {
    throw new Error(`Invalid GameConfig: ${result.errors.join('; ')}`);
  }
}

export const DEFAULT_GAME_CONFIG = DEFAULT_CONFIG;
export const HUMAN_UNIT_TYPES: HumanUnitType[] = ['police', 'nationalGuard', 'riotPolice'];
