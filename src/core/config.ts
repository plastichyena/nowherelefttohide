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
  UnitConfig,
  UnitType,
} from './types';

export const CONFIG_VERSION = '1.0.0';
export const DEFAULT_MAP_ID = 'fixed-15x15-v1';

const facilityIds: FacilityId[] = [
  'capital',
  'city-1',
  'city-2',
  'city-3',
  'city-4',
  'farm-1',
  'farm-2',
  'farm-3',
  'civilian-factory-1',
  'civilian-factory-2',
  'military-factory-1',
  'military-factory-2',
  'refinery-1',
  'refinery-2',
  'power-plant-1',
  'power-plant-2',
];

const emptyInputs = (): ProductionRule['inputs'] => ({});
const emptyOutputs = (): ProductionRule['outputs'] => ({});

function production(
  inputs: ProductionRule['inputs'],
  outputs: ProductionRule['outputs'],
  requiresPower: boolean,
  powerCapacity = 0,
  powerGeneration = 0,
): ProductionRule {
  return { inputs, outputs, requiresPower, powerCapacity, powerGeneration };
}

const defaultUnitConfig: Record<UnitType, UnitConfig> = {
  police: { hp: 25, attack: 5, movement: 5, range: 1, population: 5 },
  nationalGuard: { hp: 50, attack: 10, movement: 5, range: 2, population: 10 },
  zombie: { hp: 10, attack: 5, movement: 3, range: 1, population: 0 },
};

const defaultFacilityConfig: Record<FacilityType, FacilityConfig> = {
  capital: {
    workerCapacity: 100,
    production: production(emptyInputs(), { civilianGoods: 1 }, true, 5),
    overrunSpawnCount: 2,
  },
  city: {
    workerCapacity: 50,
    production: production(emptyInputs(), { civilianGoods: 1 }, true, 5),
    overrunSpawnCount: 2,
  },
  farm: {
    workerCapacity: 25,
    production: { ...production({ fuel: 1 }, { food: 5 }, true, 5) },
    overrunSpawnCount: 2,
  },
  civilianFactory: {
    workerCapacity: 25,
    production: production({ fuel: 1 }, { civilianGoods: 5 }, true, 5),
    overrunSpawnCount: 2,
  },
  militaryFactory: {
    workerCapacity: 25,
    production: production({ fuel: 1, civilianGoods: 1 }, { militaryGoods: 2 }, true, 5),
    overrunSpawnCount: 2,
  },
  refinery: {
    workerCapacity: 25,
    production: production(emptyInputs(), { fuel: 5 }, false),
    overrunSpawnCount: 2,
  },
  powerPlant: {
    workerCapacity: 25,
    production: production(emptyInputs(), emptyOutputs(), false, 0, 5),
    overrunSpawnCount: 2,
  },
};

const initialResources: ResourceStock = {
  food: 230,
  civilianGoods: 230,
  militaryGoods: 75,
  fuel: 92,
};

const initialWorkersByFacility: Record<FacilityId, number> = {
  capital: 0,
  'city-1': 0,
  'city-2': 0,
  'city-3': 0,
  'city-4': 0,
  'farm-1': 23,
  'farm-2': 0,
  'farm-3': 0,
  'civilian-factory-1': 23,
  'civilian-factory-2': 0,
  'military-factory-1': 0,
  'military-factory-2': 0,
  'refinery-1': 10,
  'refinery-2': 0,
  'power-plant-1': 3,
  'power-plant-2': 0,
};

const defaultEconomy: EconomyConfig = {
  populationConsumption: { food: 1, civilianGoods: 1 },
  militaryGoodsPerUnitPopulation: 1,
  initialResources,
  initialWorkersByFacility,
  initialUnemployed: 41,
  initialZombieCount: 4,
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
  maxTurns: 30,
  maxActionsPerTurn: 100,
  units: defaultUnitConfig,
  facilities: defaultFacilityConfig,
  economy: defaultEconomy,
  initialFacilityPopulation: defaultInitialFacilityPopulation,
  naturalRecovery: {
    rate: 0.1,
    rounding: 'ceil',
  },
  horde: {
    cycle: 5,
    initialCount: 2,
    increment: 2,
    warningStartTurn: 1,
    spawnOnlyBeforeFinalTurn: true,
  },
  refugees: {
    arrivalIntervalMin: 2,
    arrivalIntervalMax: 4,
    arrivalPeopleMin: 5,
    arrivalPeopleMax: 10,
    screeningCapacity: 10,
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
    fallBackCapacityRate: 0.5,
    fallBackCapacityRounding: 'ceil',
    policeSuppression: 5,
    nationalGuardSuppression: 10,
    nationalGuardCivilianDamageRate: 0.5,
  },
  checkpoint: {
    constructionCivilianGoods: 25,
    maxPerDirection: 1,
    requiresPolice: true,
    consumesPower: false,
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
  if (typeof config.version !== 'string' || config.version.length === 0) {
    errors.push('version must be a non-empty string');
  }
  if (typeof config.mapId !== 'string' || config.mapId.length === 0) {
    errors.push('mapId must be a non-empty string');
  }
  requireInteger(errors, config.maxTurns, 'maxTurns', 1);
  requireInteger(errors, config.maxActionsPerTurn, 'maxActionsPerTurn', 1);

  const unitTypes: UnitType[] = ['police', 'nationalGuard', 'zombie'];
  for (const type of unitTypes) {
    const unit = config.units?.[type];
    if (!unit) {
      errors.push(`units.${type} is required`);
      continue;
    }
    for (const key of ['hp', 'attack', 'movement', 'range', 'population'] as const) {
      requireInteger(errors, unit[key], `units.${type}.${key}`, 0);
    }
  }

  const facilityTypes: FacilityType[] = [
    'capital',
    'city',
    'farm',
    'civilianFactory',
    'militaryFactory',
    'refinery',
    'powerPlant',
  ];
  for (const type of facilityTypes) {
    const facility = config.facilities?.[type];
    if (!facility) {
      errors.push(`facilities.${type} is required`);
      continue;
    }
    requireInteger(errors, facility.workerCapacity, `facilities.${type}.workerCapacity`, 1);
    requireInteger(errors, facility.overrunSpawnCount, `facilities.${type}.overrunSpawnCount`, 0);
    if (!facility.production || typeof facility.production !== 'object') {
      errors.push(`facilities.${type}.production is required`);
      continue;
    }
    requireInteger(errors, facility.production.powerCapacity, `facilities.${type}.production.powerCapacity`, 0);
    requireInteger(errors, facility.production.powerGeneration, `facilities.${type}.production.powerGeneration`, 0);
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
      'farm-1': 'farm',
      'farm-2': 'farm',
      'farm-3': 'farm',
      'civilian-factory-1': 'civilianFactory',
      'civilian-factory-2': 'civilianFactory',
      'military-factory-1': 'militaryFactory',
      'military-factory-2': 'militaryFactory',
      'refinery-1': 'refinery',
      'refinery-2': 'refinery',
      'power-plant-1': 'powerPlant',
      'power-plant-2': 'powerPlant',
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
    if (!Number.isFinite(naturalRecovery.rate) || naturalRecovery.rate < 0 || naturalRecovery.rate > 1) {
      errors.push('naturalRecovery.rate must be between 0 and 1');
    }
    if (naturalRecovery.rounding !== 'ceil' && naturalRecovery.rounding !== 'floor') {
      errors.push('naturalRecovery.rounding must be ceil or floor');
    }
  }

  const economy = config.economy;
  if (!economy || typeof economy !== 'object') {
    errors.push('economy is required');
  } else {
    requireInteger(errors, economy.initialUnemployed, 'economy.initialUnemployed', 0);
    requireInteger(errors, economy.initialZombieCount, 'economy.initialZombieCount', 0);
    if (economy.initialZombieCount > 4) {
      errors.push('economy.initialZombieCount cannot exceed the four fixed-map positions');
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
    requireInteger(errors, horde.cycle, 'horde.cycle', 1);
    requireInteger(errors, horde.initialCount, 'horde.initialCount', 0);
    requireInteger(errors, horde.increment, 'horde.increment', 0);
    requireInteger(errors, horde.warningStartTurn, 'horde.warningStartTurn', 1);
    if (typeof horde.spawnOnlyBeforeFinalTurn !== 'boolean') {
      errors.push('horde.spawnOnlyBeforeFinalTurn must be boolean');
    }
  }

  const infection = config.infection;
  if (!infection || typeof infection !== 'object') {
    errors.push('infection is required');
  } else {
    requireInteger(errors, infection.facilitySpreadPerTurn, 'infection.facilitySpreadPerTurn', 0);
    requireInteger(errors, infection.policeSuppression, 'infection.policeSuppression', 0);
    requireInteger(errors, infection.nationalGuardSuppression, 'infection.nationalGuardSuppression', 0);
    for (const key of ['fallBackInfectionRate', 'fallBackCapacityRate', 'nationalGuardCivilianDamageRate'] as const) {
      if (!Number.isFinite(infection[key]) || infection[key] < 0 || infection[key] > 1) {
        errors.push(`infection.${key} must be between 0 and 1`);
      }
    }
    if (infection.fallBackCapacityRounding !== 'ceil' && infection.fallBackCapacityRounding !== 'floor') {
      errors.push('infection.fallBackCapacityRounding must be ceil or floor');
    }
  }

  const checkpoint = config.checkpoint;
  if (!checkpoint || typeof checkpoint !== 'object') {
    errors.push('checkpoint is required');
  } else {
    requireInteger(errors, checkpoint.constructionCivilianGoods, 'checkpoint.constructionCivilianGoods', 0);
    requireInteger(errors, checkpoint.maxPerDirection, 'checkpoint.maxPerDirection', 1);
    if (typeof checkpoint.requiresPolice !== 'boolean' || typeof checkpoint.consumesPower !== 'boolean') {
      errors.push('checkpoint flags must be boolean');
    }
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
export const HUMAN_UNIT_TYPES: HumanUnitType[] = ['police', 'nationalGuard'];
