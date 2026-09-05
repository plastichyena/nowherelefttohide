import type { GameState, FacilityState, EndTurnForecast, MilitaryGoodsForecast, HumanUnitType, PowerSupplyReason, ResourceType } from './types';
import type { FacilityProductionProjection } from './economy-types';
import { isCityFacility, getFacilityState } from './state';
import { isHexSupplied } from './supply';
import { forecastUnitSuppression, infectedSuppressionTarget } from './combat-query';
import { detachedQueryValue } from './query-cache';
import { deriveProductionCapacity } from './production-capacity';
export function stableFacilities(state: GameState, descending = false): FacilityState[] {
  return [...state.facilities].sort((left, right) => {
    const leftOrder = left.securedOrder ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = right.securedOrder ?? Number.MAX_SAFE_INTEGER;
    const order = leftOrder - rightOrder || left.id.localeCompare(right.id);
    return descending ? -order : order;
  });
}

export function eligibleSnapshotCities(
  state: GameState,
  order: 'supply' | 'reception',
): FacilityState[] {
  if (state.cityPopulationSnapshot.turn !== state.turn) return [];
  return state.cityPopulationSnapshot[order]
    .filter((entry) => entry.eligible)
    .map((entry) => getFacilityState(state, entry.facilityId))
    .filter(
      (facility): facility is FacilityState =>
        facility !== undefined &&
        facility.owner === 'player' &&
        facility.status === 'owned' &&
        facility.infected === 0 &&
        facility.populationOperationalTurn <= state.turn &&
        isCityFacility(facility),
    );
}

export function availableSupplyPopulation(state: GameState): number {
  return eligibleSnapshotCities(state, 'supply').reduce((total, city) => total + city.workers, 0);
}

function emptyFacilityProjection(
  facility: Readonly<FacilityState>,
  stoppedReason: FacilityProductionProjection['stoppedReason'],
): FacilityProductionProjection {
  return {
    facilityId: facility.id,
    operatingWorkers: 0,
    inputs: {},
    outputs: {},
    powerGeneration: 0,
    powerMode: 'none',
    requiredPowerCapacity: 0,
    powerSupplyEnabled: false,
    projectedPowerRequested: false,
    projectedPowerSupplied: false,
    projectedPowerReason: 'not_applicable',
    lastPowerSupplied: facility.lastPowerSupplied,
    productionMultiplier: 1,
    baseOutputs: {},
    stoppedReason,
  };
}

function facilityStoppedReason(facility: Readonly<FacilityState>): FacilityProductionProjection['stoppedReason'] {
  if (facility.status === 'ruined') return 'ruined';
  if (facility.infected > 0) return 'infection';
  if (facility.owner !== 'player' || facility.status !== 'owned') return 'not_owned';
  if (facility.workers <= 0) return 'no_workers';
  if (facility.operationalStatus !== 'operational') return 'power_unavailable';
  return null;
}

interface EconomyPlan {
  forecast: EndTurnForecast;
  facilities: FacilityProductionProjection[];
  unitRefills: Array<{ unitId: string; amount: number }>;
}

function calculateMilitaryGoodsPlan(
  state: Readonly<GameState>,
  projectedProduction: number,
): MilitaryGoodsForecast {
  const units = state.units
    .filter((unit) => unit.isPlayerUnit)
    .sort((left, right) => left.id.localeCompare(right.id));
  const working = units.map((unit) => {
    const fixedRequested = state.config.units[unit.type as HumanUnitType].fixedMilitaryGoodsUpkeepPerTurn;
    const fixedConsumption = Math.min(unit.currentMilitaryGoods, fixedRequested);
    const afterFixed = unit.currentMilitaryGoods - fixedConsumption;
    return {
      unit,
      inSupply: isHexSupplied(state, unit.position),
      fixedConsumption,
      afterFixed,
      refillDemand: Math.max(0, unit.maxMilitaryGoods - afterFixed),
      refillAmount: 0,
    };
  });
  let nationalAvailable = state.resources.militaryGoods + projectedProduction;
  while (nationalAvailable > 0 && working.some((entry) => entry.inSupply && entry.refillAmount < entry.refillDemand)) {
    for (const entry of working) {
      if (nationalAvailable <= 0) break;
      if (!entry.inSupply || entry.refillAmount >= entry.refillDemand) continue;
      entry.refillAmount += 1;
      nationalAvailable -= 1;
    }
  }
  const forecastUnits = working.map((entry) => {
    const afterRefill = entry.afterFixed + entry.refillAmount;
    const suppression = forecastUnitSuppression(state, entry.unit, afterRefill);
    const hasSuppressionTarget = infectedSuppressionTarget(state, entry.unit) !== null;
    const suppressionCost = suppression?.militaryGoodsCost ?? 0;
    return {
      unitId: entry.unit.id,
      unitType: entry.unit.type as HumanUnitType,
      inSupply: entry.inSupply,
      beforeFixed: entry.unit.currentMilitaryGoods,
      fixedConsumption: entry.fixedConsumption,
      afterFixed: entry.afterFixed,
      refillDemand: entry.refillDemand,
      projectedRefillAmount: entry.refillAmount,
      unfilledRefillDemand: entry.refillDemand - entry.refillAmount,
      afterRefill,
      suppressionCost,
      suppressionStatus: suppression
        ? 'suppression' as const
        : hasSuppressionTarget
          ? 'containment_only' as const
          : 'none' as const,
      afterSuppression: afterRefill - suppressionCost,
    };
  });
  const totalRefillDemand = forecastUnits.reduce((sum, unit) => sum + unit.refillDemand, 0);
  const projectedTotalRefilled = forecastUnits.reduce((sum, unit) => sum + unit.projectedRefillAmount, 0);
  return {
    startingStock: state.resources.militaryGoods,
    projectedProduction,
    totalRefillDemand,
    projectedTotalRefilled,
    totalUnfilledRefillDemand: totalRefillDemand - projectedTotalRefilled,
    projectedEndingStock: nationalAvailable,
    units: forecastUnits,
  };
}

export function calculateEconomyPlan(state: Readonly<GameState>): EconomyPlan {
  return detachedQueryValue(state, 'economy', () => computeEconomyPlan(state));
}

function computeEconomyPlan(state: Readonly<GameState>): EconomyPlan {
  const facilities = stableFacilities(state as GameState);
  const isOwned = (facility: Readonly<FacilityState>) => facility.owner === 'player' && facility.status === 'owned';
  const canProduce = (facility: Readonly<FacilityState>) =>
    isOwned(facility) && facility.infected === 0 && facility.workers > 0 && facility.operationalStatus === 'operational';
  const checkpointHealthyConsumers = state.checkpoints.reduce(
    (total, checkpoint) => total + checkpoint.waiting + checkpoint.screening + checkpoint.approved,
    0,
  );
  const consumers = state.facilities.reduce(
    (total, facility) => total + (facility.owner === 'player' ? facility.workers : 0),
    state.population.unitPopulation,
  ) + checkpointHealthyConsumers;
  const overcrowding = overcrowdingTerms(state);
  const normalFood = consumers * state.config.economy.populationConsumption.food;
  const normalCivilian = consumers * state.config.economy.populationConsumption.civilianGoods;
  const maintenance = {
    food: normalFood + overcrowdingAdditionalConsumption(normalFood, overcrowding),
    civilianGoods: normalCivilian + overcrowdingAdditionalConsumption(normalCivilian, overcrowding),
  };

  const powerPlantPhysicalCapacity = facilities
    .filter((facility) => facility.type === 'powerPlant' && canProduce(facility))
    .reduce((total, facility) => total + facility.workers * state.config.facilities.powerPlant.production.powerGeneration, 0);
  const windPowerAvailable = facilities
    .filter((facility) =>
      facility.type === 'windPowerPlant' &&
      isOwned(facility) &&
      facility.infected === 0 &&
      facility.operationalStatus === 'operational')
    .reduce((total, facility) => total + state.config.facilities.windPowerPlant.production.fixedPowerGeneration, 0);
  const physicalGenerationCapacity = windPowerAvailable + powerPlantPhysicalCapacity;
  const fuelLimitedGenerationCapacity = windPowerAvailable + state.resources.fuel * 5;
  const availableGenerationCapacity = Math.floor(
    Math.min(physicalGenerationCapacity, fuelLimitedGenerationCapacity) / 5,
  ) * 5;
  let remainingPower = availableGenerationCapacity;
  const supplied = new Set<string>();
  const requested = new Set<string>();
  const reasons = new Map<string, PowerSupplyReason>();
  const allocate = (targets: FacilityState[]): number => {
    let allocated = 0;
    let lostInTier = false;
    for (const facility of targets) {
      const demand = state.config.facilities[facility.type].production.powerCapacity;
      requested.add(facility.id);
      if (remainingPower >= demand) {
        remainingPower -= demand;
        allocated += demand;
        supplied.add(facility.id);
        reasons.set(facility.id, 'supplied');
      } else {
        const underlying: PowerSupplyReason = physicalGenerationCapacity <= fuelLimitedGenerationCapacity
          ? 'physical_capacity_shortage'
          : 'fuel_shortage';
        reasons.set(facility.id, lostInTier ? 'allocation_priority' : underlying);
        lostInTier = true;
      }
    }
    return allocated;
  };

  const cityTargets = facilities.filter(
    (facility) => isOwned(facility) && isCityFacility(facility) && facility.workers > 0 && canProduce(facility),
  );
  let requiredPowerDemand = cityTargets.reduce(
    (total, facility) => total + state.config.facilities[facility.type].production.powerCapacity,
    0,
  );
  let requiredPowerAllocated = allocate(cityTargets);

  const maintenanceTargets = facilities.filter(
    (facility) =>
      canProduce(facility) &&
      ['farm', 'civilianFactory'].includes(facility.type) &&
      facility.powerSupplyEnabled,
  );
  requiredPowerDemand += maintenanceTargets.reduce(
    (total, facility) => total + state.config.facilities[facility.type].production.powerCapacity,
    0,
  );
  requiredPowerAllocated += allocate(maintenanceTargets);

  const staffed = (facility: FacilityState) => isCityFacility(facility)
    ? Math.min(facility.workers, state.config.facilities[facility.type].workerCapacity)
    : facility.workers;
  const preliminaryCivilianProduction = facilities.reduce((total, facility) => {
    if (!canProduce(facility)) return total;
    const rule = state.config.facilities[facility.type].production;
    const perWorker = rule.outputs.civilianGoods ?? 0;
    if (perWorker <= 0 || facility.type === 'militaryFactory') return total;
    if (rule.powerMode === 'required' && !supplied.has(facility.id)) return total;
    return total + staffed(facility) * perWorker;
  }, 0);
  const maintenanceReservation = Math.max(0, maintenance.civilianGoods - preliminaryCivilianProduction);
  let civilianInputAvailable = Math.max(0, state.resources.civilianGoods - maintenanceReservation);
  const militaryInputWorkers = new Map<string, number>();
  const militaryFacilities = facilities.filter(
    (facility) => facility.type === 'militaryFactory' && canProduce(facility) && facility.powerSupplyEnabled,
  );
  for (const facility of militaryFacilities) {
    const perWorker = state.config.facilities.militaryFactory.production.inputs.civilianGoods ?? 0;
    const workers = perWorker > 0
      ? Math.min(facility.workers, Math.floor(civilianInputAvailable / perWorker))
      : facility.workers;
    militaryInputWorkers.set(facility.id, workers);
    civilianInputAvailable -= workers * perWorker;
  }
  const militaryTargets = militaryFacilities.filter(
    (facility) => (militaryInputWorkers.get(facility.id) ?? 0) > 0,
  );
  requiredPowerDemand += militaryTargets.reduce(
    (total, facility) => total + state.config.facilities[facility.type].production.powerCapacity,
    0,
  );
  requiredPowerAllocated += allocate(militaryTargets);

  const refineryTargets = facilities.filter(
    (facility) => canProduce(facility) && facility.type === 'refinery' && facility.powerSupplyEnabled,
  );
  requiredPowerDemand += refineryTargets.reduce(
    (total, facility) => total + state.config.facilities[facility.type].production.powerCapacity,
    0,
  );
  requiredPowerAllocated += allocate(refineryTargets);

  const droneTargets = facilities.filter(
    (facility) =>
      isOwned(facility) &&
      facility.type === 'civilianDroneBase' &&
      facility.workers > 0 &&
      facility.powerSupplyEnabled &&
      facility.operationalStatus === 'operational',
  );
  requiredPowerDemand += droneTargets.reduce(
    (total, facility) => total + state.config.facilities[facility.type].production.powerCapacity,
    0,
  );
  requiredPowerAllocated += allocate(droneTargets);

  const projections = facilities.map((facility): FacilityProductionProjection => {
    const rule = state.config.facilities[facility.type].production;
    const eligible = isOwned(facility) && facility.workers > 0;
    let projectedPowerReason: PowerSupplyReason = reasons.get(facility.id) ?? 'not_applicable';
    let projectedPowerRequested = requested.has(facility.id);
    const toggleable = ['farm', 'civilianFactory', 'militaryFactory', 'refinery', 'civilianDroneBase'].includes(facility.type);
    if (rule.powerMode === 'required' && toggleable && !facility.powerSupplyEnabled) projectedPowerReason = 'power_supply_off';
    else if (!eligible && rule.powerMode !== 'none') projectedPowerReason = facility.workers <= 0 ? 'no_population' : 'not_eligible';
    else if (facility.type === 'militaryFactory' && canProduce(facility) && (militaryInputWorkers.get(facility.id) ?? 0) === 0) {
      projectedPowerReason = 'production_input_unavailable';
      projectedPowerRequested = false;
    }
    const projectedPowerSupplied = supplied.has(facility.id);
    const productionMultiplier = 1;
    const potentialOperatingWorkers = !canProduce(facility)
      ? 0
      : facility.type === 'militaryFactory'
        ? militaryInputWorkers.get(facility.id) ?? 0
        : staffed(facility);
    const operatingWorkers = rule.powerMode === 'required' && !projectedPowerSupplied
      ? 0
      : potentialOperatingWorkers;
    const baseOutputs = Object.fromEntries(
      Object.entries(rule.outputs).map(([resource, amount]) => [resource, amount * potentialOperatingWorkers]),
    ) as Partial<Record<ResourceType, number>>;
    const outputs = rule.powerMode === 'required' && !projectedPowerSupplied
      ? {}
      : Object.fromEntries(
        Object.entries(baseOutputs).map(([resource, amount]) => [resource, (amount ?? 0) * productionMultiplier]),
      ) as Partial<Record<ResourceType, number>>;
    const inputs = facility.type === 'militaryFactory' && projectedPowerSupplied
      ? { civilianGoods: (rule.inputs.civilianGoods ?? 0) * operatingWorkers }
      : {};
    const stoppedReason = !canProduce(facility)
      ? facilityStoppedReason(facility)
      : rule.powerMode === 'required' && !projectedPowerSupplied
        ? 'power_unavailable'
        : facility.type === 'militaryFactory' && operatingWorkers < facility.workers
          ? 'input_shortage'
          : null;
    return {
      facilityId: facility.id,
      operatingWorkers,
      inputs,
      outputs,
      powerGeneration: facility.type === 'powerPlant' && canProduce(facility)
        ? rule.powerGeneration * facility.workers
        : facility.type === 'windPowerPlant' && isOwned(facility) && facility.operationalStatus === 'operational'
          ? rule.fixedPowerGeneration
          : 0,
      powerMode: rule.powerMode,
      requiredPowerCapacity: rule.powerMode === 'required' ? rule.powerCapacity : 0,
      powerSupplyEnabled: facility.powerSupplyEnabled,
      projectedPowerRequested,
      projectedPowerSupplied,
      projectedPowerReason,
      lastPowerSupplied: facility.lastPowerSupplied,
      productionMultiplier,
      baseOutputs,
      stoppedReason,
    };
  });
  const production = (resource: ResourceType) => projections.reduce(
    (total, projection) => total + (projection.outputs[resource] ?? 0),
    0,
  );
  const militaryInputDemand = militaryFacilities.reduce(
    (total, facility) => total + facility.workers * (state.config.facilities.militaryFactory.production.inputs.civilianGoods ?? 0),
    0,
  );
  const militaryInputAllocated = projections.reduce(
    (total, projection) => total + (projection.inputs.civilianGoods ?? 0),
    0,
  );
  const totalPowerDemand = requiredPowerDemand;
  const totalPowerAllocated = requiredPowerAllocated;
  const generationFuelDemand = Math.max(0, totalPowerDemand - windPowerAvailable) / 5;
  const projectedFuelUsed = Math.max(0, totalPowerAllocated - windPowerAvailable) / 5;
  const fuelAfterPower = Math.max(0, state.resources.fuel - projectedFuelUsed);
  const refillUnits = state.units
    .filter((unit) => unit.isPlayerUnit && isHexSupplied(state, unit.position) && unit.currentFuel < unit.maxFuel)
    .sort((left, right) => left.id.localeCompare(right.id));
  const refillRemaining = new Map(refillUnits.map((unit) => [unit.id, unit.maxFuel - unit.currentFuel]));
  const unitRefillAmounts = new Map(refillUnits.map((unit) => [unit.id, 0]));
  let refillFuelAvailable = fuelAfterPower;
  while (refillFuelAvailable > 0 && [...refillRemaining.values()].some((amount) => amount > 0)) {
    for (const unit of refillUnits) {
      if (refillFuelAvailable <= 0) break;
      const remaining = refillRemaining.get(unit.id) ?? 0;
      if (remaining <= 0) continue;
      refillRemaining.set(unit.id, remaining - 1);
      unitRefillAmounts.set(unit.id, (unitRefillAmounts.get(unit.id) ?? 0) + 1);
      refillFuelAvailable -= 1;
    }
  }
  const projectedUnitRefillDemand = refillUnits.reduce((total, unit) => total + unit.maxFuel - unit.currentFuel, 0);
  const projectedUnitFuelRefilled = [...unitRefillAmounts.values()].reduce((total, amount) => total + amount, 0);
  const militaryGoods = calculateMilitaryGoodsPlan(state, production('militaryGoods'));
  const resourceForecast = (
    resource: 'food',
    maintenanceRequired: number,
  ): EndTurnForecast['food'] => {
    const startingStock = state.resources[resource];
    const projectedProduction = production(resource);
    const shortage = Math.max(0, maintenanceRequired - startingStock - projectedProduction);
    return {
      startingStock,
      projectedProduction,
      maintenanceRequired,
      endingStock: Math.max(0, startingStock + projectedProduction - maintenanceRequired),
      available: startingStock,
      productionInputRequired: 0,
      required: maintenanceRequired,
      shortage,
    };
  };
  const civilianStarting = state.resources.civilianGoods;
  const civilianProduction = production('civilianGoods');
  const civilianShortage = Math.max(
    0,
    maintenance.civilianGoods - (civilianStarting - militaryInputAllocated + civilianProduction),
  );
  const fuelProduction = production('fuel');
  const fuelEnding = Math.max(0, fuelAfterPower - projectedUnitFuelRefilled + fuelProduction);
  const unpoweredFacilities = projections
    .filter((projection) => projection.powerMode !== 'none' && !projection.projectedPowerSupplied)
    .map((projection) => ({ facilityId: projection.facilityId, reason: projection.projectedPowerReason }));
  return {
    facilities: projections,
    unitRefills: [...unitRefillAmounts.entries()].map(([unitId, amount]) => ({ unitId, amount })),
    forecast: {
      populationConsumers: consumers,
      overcrowding: {
        cities: overcrowding,
        additionalFood: maintenance.food - normalFood,
        additionalCivilianGoods: maintenance.civilianGoods - normalCivilian,
      },
      food: resourceForecast('food', maintenance.food),
      civilianGoods: {
        startingStock: civilianStarting,
        projectedProduction: civilianProduction,
        maintenanceRequired: maintenance.civilianGoods,
        productionInputDemand: militaryInputDemand,
        productionInputAllocated: militaryInputAllocated,
        productionInputShortage: Math.max(0, militaryInputDemand - militaryInputAllocated),
        endingStock: Math.max(0, civilianStarting - militaryInputAllocated + civilianProduction - maintenance.civilianGoods),
        maintenanceShortage: civilianShortage,
        available: civilianStarting,
        productionInputRequired: militaryInputDemand,
        required: maintenance.civilianGoods + militaryInputDemand,
        shortage: civilianShortage,
      },
      militaryGoods,
      fuel: {
        startingStock: state.resources.fuel,
        projectedProduction: fuelProduction,
        maintenanceRequired: 0,
        turnStartFuel: state.resources.fuel,
        windPowerAvailable,
        powerPlantPhysicalCapacity,
        projectedPowerFuelDemand: generationFuelDemand,
        projectedPowerFuelUsed: projectedFuelUsed,
        fuelAfterPower,
        projectedUnitRefillDemand,
        projectedUnitFuelRefilled,
        projectedTotalFuelDemand: generationFuelDemand + projectedUnitRefillDemand,
        projectedRefineryProduction: fuelProduction,
        projectedEndingFuel: fuelEnding,
        powerFuelShortage: Math.max(0, generationFuelDemand - state.resources.fuel),
        unitRefillFuelShortage: Math.max(0, projectedUnitRefillDemand - Math.max(0, state.resources.fuel - projectedFuelUsed)),
        totalFuelShortage: Math.max(0, generationFuelDemand + projectedUnitRefillDemand - state.resources.fuel),
        generationFuelDemand,
        projectedFuelUsed,
        generationFuelShortage: Math.max(0, generationFuelDemand - state.resources.fuel),
        endingStock: fuelEnding,
        available: state.resources.fuel,
        productionInputRequired: generationFuelDemand,
        required: generationFuelDemand,
        shortage: Math.max(0, generationFuelDemand + projectedUnitRefillDemand - state.resources.fuel),
      },
      electricity: {
        physicalGenerationCapacity,
        fuelLimitedGenerationCapacity,
        availableGenerationCapacity,
        requiredPowerDemand,
        requiredPowerAllocated,
        unpoweredFacilities,
        capacity: physicalGenerationCapacity,
        required: totalPowerDemand,
        shortage: Math.max(0, totalPowerDemand - requiredPowerAllocated),
      },
    },
  };
}

function overcrowdingTerms(state: Readonly<GameState>): Array<{ facilityId: string; excess: number; softCap: number }> {
  return state.facilities
    .filter(
      (facility) =>
        facility.owner === 'player' && facility.status === 'owned' && isCityFacility(facility),
    )
    .map((facility) => ({
      facilityId: facility.id,
      excess: Math.max(0, facility.workers - state.config.facilities[facility.type].workerCapacity),
      softCap: state.config.facilities[facility.type].workerCapacity,
    }))
    .filter((term) => term.excess > 0)
    .sort((left, right) => left.facilityId.localeCompare(right.facilityId));
}

function gcdBigInt(left: bigint, right: bigint): bigint {
  let a = left < 0n ? -left : left;
  let b = right < 0n ? -right : right;
  while (b !== 0n) {
    const next = a % b;
    a = b;
    b = next;
  }
  return a;
}

function overcrowdingAdditionalConsumption(normal: number, terms: ReturnType<typeof overcrowdingTerms>): number {
  if (normal <= 0 || terms.length === 0) return 0;
  let numerator = 0n;
  let denominator = 1n;
  for (const term of terms) {
    numerator = numerator * BigInt(term.softCap) + BigInt(term.excess) * denominator;
    denominator *= BigInt(term.softCap);
    const divisor = gcdBigInt(numerator, denominator);
    numerator /= divisor;
    denominator /= divisor;
  }
  const amount = (BigInt(normal) * numerator + denominator - 1n) / denominator;
  return Math.max(1, Number(amount));
}

/**
 * Predict economy requirements for the current player turn without mutating
 * GameState.  The calculation intentionally uses the same secured-order and
 * electricity rules as the economy phase, while exposing full staffing input
 * demand so the UI can warn before partial fuel operation is resolved.
 */
export function forecastEndTurn(state: Readonly<GameState>): EndTurnForecast {
  return calculateEconomyPlan(state).forecast;
}

export function forecastProductionCapacity(state: Readonly<GameState>) {
  const plan = calculateEconomyPlan(state);
  return deriveProductionCapacity(state, plan.forecast, plan.facilities, availableSupplyPopulation(state));
}

export function forecastUnitRefills(
  state: Readonly<GameState>,
): Array<{ unitId: string; demand: number; amount: number }> {
  const plan = calculateEconomyPlan(state);
  const amounts = new Map(plan.unitRefills.map((entry) => [entry.unitId, entry.amount]));
  return state.units
    .filter((unit) => unit.isPlayerUnit)
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((unit) => ({
      unitId: unit.id,
      demand: Math.max(0, unit.maxFuel - unit.currentFuel),
      amount: amounts.get(unit.id) ?? 0,
    }));
}

export function forecastFacilityProduction(
  state: Readonly<GameState>,
): FacilityProductionProjection[] {
  return calculateEconomyPlan(state).facilities;
}
