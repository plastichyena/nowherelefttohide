import type { GameState, FacilityState, EndTurnForecast, MilitaryGoodsForecast, HumanUnitType, NextTurnPenaltyForecast, PowerSupplyReason, ResourceType } from './types';
import type { ArmyBaseMilitaryGoodsProjection, FacilityProductionProjection } from './economy-types';
import { cloneState, isCityFacility, getFacilityState } from './state';
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
        isCityFacility(facility) &&
        (facility.type !== 'temporaryHousing' || isHexSupplied(state, facility.position)),
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
    armyBaseMilitaryGoods: null,
  };
}

function facilityStoppedReason(facility: Readonly<FacilityState>): FacilityProductionProjection['stoppedReason'] {
  if (facility.status === 'ruined') return 'ruined';
  if (facility.operationalStatus === 'building') return 'building';
  if (facility.operationalStatus === 'recovering') return 'recovering';
  if (facility.operationalStatus === 'disabled') return 'disabled';
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
  armyBaseMilitaryGoodsRefills: Array<{ facilityId: string; amount: number }>;
  armyBasePowerOrders: Array<{ orderId: string; facilityId: string; powerSupplied: boolean }>;
}

interface MilitaryGoodsPlan {
  forecast: MilitaryGoodsForecast;
  armyBaseMilitaryGoodsRefills: Array<{ facilityId: string; amount: number }>;
}

function isNormallyOperatingArmyBase(facility: Readonly<FacilityState>): boolean {
  return facility.type === 'armyBase' &&
    facility.owner === 'player' &&
    facility.status === 'owned' &&
    facility.infected === 0 &&
    facility.operationalStatus === 'operational';
}

function armyBaseMilitaryGoodsRefillEligibility(
  state: Readonly<GameState>,
  facility: Readonly<FacilityState>,
): Pick<ArmyBaseMilitaryGoodsProjection, 'inSupply' | 'refillEligible' | 'refillReason'> {
  const inSupply = isHexSupplied(state, facility.position);
  if (facility.owner !== 'player' || facility.status !== 'owned') {
    return { inSupply, refillEligible: false, refillReason: 'not_owned' };
  }
  if (facility.infected > 0) return { inSupply, refillEligible: false, refillReason: 'infection' };
  if (facility.operationalStatus !== 'operational') {
    return { inSupply, refillEligible: false, refillReason: 'not_operational' };
  }
  if (!inSupply) return { inSupply, refillEligible: false, refillReason: 'out_of_supply' };
  if ((facility.armyBase?.militaryGoods ?? 0) >= state.config.armyBase.maxMilitaryGoods) {
    return { inSupply, refillEligible: true, refillReason: 'full' };
  }
  return { inSupply, refillEligible: true, refillReason: 'supplied' };
}

function calculateMilitaryGoodsPlan(
  state: Readonly<GameState>,
  projectedProduction: number,
): MilitaryGoodsPlan {
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
  const armyBaseMilitaryGoodsRefills: Array<{ facilityId: string; amount: number }> = [];
  for (const facility of stableFacilities(state as GameState)) {
    if (facility.type !== 'armyBase' || !facility.armyBase) continue;
    const eligibility = armyBaseMilitaryGoodsRefillEligibility(state, facility);
    if (!eligibility.refillEligible || eligibility.refillReason === 'full' || nationalAvailable <= 0) continue;
    const amount = Math.min(
      nationalAvailable,
      Math.max(0, state.config.armyBase.maxMilitaryGoods - facility.armyBase.militaryGoods),
    );
    if (amount <= 0) continue;
    armyBaseMilitaryGoodsRefills.push({ facilityId: facility.id, amount });
    nationalAvailable -= amount;
  }
  return {
    forecast: {
      startingStock: state.resources.militaryGoods,
      projectedProduction,
      totalRefillDemand,
      projectedTotalRefilled,
      totalUnfilledRefillDemand: totalRefillDemand - projectedTotalRefilled,
      projectedEndingStock: nationalAvailable,
      units: forecastUnits,
    },
    armyBaseMilitaryGoodsRefills,
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
  const facilityById = new Map(facilities.map((facility) => [facility.id, facility]));
  const armyBaseReservations = new Map(
    [...state.pendingUnitProductions]
      .sort((left, right) => left.id.localeCompare(right.id))
      .filter((order) => facilityById.get(order.cityFacilityId)?.type === 'armyBase')
      .map((order) => [order.cityFacilityId, order] as const),
  );
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
  const overcrowdingFood = overcrowdingAdditionalConsumption(normalFood, overcrowding);
  const overcrowdingCivilian = overcrowdingAdditionalConsumption(normalCivilian, overcrowding);

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
  const fuelLimitedGenerationCapacity = windPowerAvailable + Math.min(
    powerPlantPhysicalCapacity,
    Math.floor(state.resources.fuel / 2) * 5,
  );
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
    (facility) => isOwned(facility) && ['capital', 'city'].includes(facility.type) && facility.workers > 0 && canProduce(facility),
  );
  let requiredPowerDemand = cityTargets.reduce(
    (total, facility) => total + state.config.facilities[facility.type].production.powerCapacity,
    0,
  );
  let requiredPowerAllocated = allocate(cityTargets);

  const housingCanRequestPower = (facility: FacilityState) =>
    facility.type === 'temporaryHousing' &&
    isOwned(facility) &&
    !['building', 'disabled', 'recovering', 'ruined'].includes(facility.operationalStatus) &&
    isHexSupplied(state, facility.position);
  const occupiedHousingTargets = facilities.filter(
    (facility) => housingCanRequestPower(facility) && facility.workers > 0,
  );
  requiredPowerDemand += occupiedHousingTargets.reduce(
    (total, facility) => total + state.config.facilities[facility.type].production.powerCapacity,
    0,
  );
  requiredPowerAllocated += allocate(occupiedHousingTargets);

  const occupiedHousingOutages = facilities
    .filter((facility) =>
      facility.type === 'temporaryHousing' &&
      isOwned(facility) &&
      !['building', 'disabled', 'recovering', 'ruined'].includes(facility.operationalStatus) &&
      facility.workers > 0 &&
      !supplied.has(facility.id))
    .map((facility) => ({
      facilityId: facility.id,
      reason: isHexSupplied(state, facility.position)
        ? 'power_shortage' as const
        : 'supply_disconnected' as const,
    }));
  const housingOutageFood = normalFood <= 0 || occupiedHousingOutages.length === 0
    ? 0
    : Math.ceil(normalFood * occupiedHousingOutages.length / 100);
  const housingOutageCivilian = normalCivilian <= 0 || occupiedHousingOutages.length === 0
    ? 0
    : Math.ceil(normalCivilian * occupiedHousingOutages.length / 100);
  const maintenance = {
    food: normalFood + overcrowdingFood + housingOutageFood,
    civilianGoods: normalCivilian + overcrowdingCivilian + housingOutageCivilian,
  };

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
    return total + Math.floor(staffed(facility) * perWorker);
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

  // Army Base recruitment is a sixth, final allocation tier. Its reservation
  // requires no workers and remains eligible outside Supply, but only while
  // the Base itself is normally operating.
  const armyBaseTargets = facilities.filter(
    (facility) => isNormallyOperatingArmyBase(facility) && armyBaseReservations.has(facility.id),
  );
  requiredPowerDemand += armyBaseTargets.reduce(
    (total, facility) => total + state.config.facilities[facility.type].production.powerCapacity,
    0,
  );
  requiredPowerAllocated += allocate(armyBaseTargets);

  const emptyHousingTargets = facilities.filter(
    (facility) => housingCanRequestPower(facility) && facility.workers === 0,
  );
  requiredPowerDemand += emptyHousingTargets.reduce(
    (total, facility) => total + state.config.facilities[facility.type].production.powerCapacity,
    0,
  );
  requiredPowerAllocated += allocate(emptyHousingTargets);

  const projections = facilities.map((facility): FacilityProductionProjection => {
    const rule = state.config.facilities[facility.type].production;
    const normalArmyBase = isNormallyOperatingArmyBase(facility);
    const armyBaseHasReservation = facility.type === 'armyBase' && armyBaseReservations.has(facility.id);
    const eligible = isOwned(facility) && facility.workers > 0;
    const eligibleForPower = facility.type === 'armyBase'
      ? normalArmyBase
      : facility.type === 'temporaryHousing'
        ? housingCanRequestPower(facility)
        : eligible;
    let projectedPowerReason: PowerSupplyReason = reasons.get(facility.id) ?? 'not_applicable';
    let projectedPowerRequested = requested.has(facility.id);
    const powerMode = facility.type === 'armyBase' && !armyBaseHasReservation
      ? 'none' as const
      : rule.powerMode;
    const toggleable = ['farm', 'civilianFactory', 'militaryFactory', 'refinery', 'civilianDroneBase'].includes(facility.type);
    if (facility.type === 'temporaryHousing' && isOwned(facility) && !['building', 'disabled', 'recovering', 'ruined'].includes(facility.operationalStatus) && !isHexSupplied(state, facility.position)) {
      projectedPowerRequested = false;
      projectedPowerReason = 'supply_disconnected';
    } else if (facility.type === 'armyBase' && armyBaseHasReservation && !normalArmyBase) {
      projectedPowerRequested = false;
      projectedPowerReason = 'not_eligible';
    } else if (powerMode === 'required' && toggleable && !facility.powerSupplyEnabled) projectedPowerReason = 'power_supply_off';
    else if (!eligibleForPower && powerMode !== 'none') projectedPowerReason = facility.workers <= 0 ? 'no_population' : 'not_eligible';
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
    const operatingWorkers = powerMode === 'required' && !projectedPowerSupplied
      ? 0
      : potentialOperatingWorkers;
    const baseOutputs = Object.fromEntries(
      Object.entries(rule.outputs).map(([resource, amount]) => [resource, Math.floor(amount * potentialOperatingWorkers)]),
    ) as Partial<Record<ResourceType, number>>;
    const outputs = powerMode === 'required' && !projectedPowerSupplied
      ? {}
      : Object.fromEntries(
        Object.entries(baseOutputs).map(([resource, amount]) => [resource, (amount ?? 0) * productionMultiplier]),
      ) as Partial<Record<ResourceType, number>>;
    const inputs = facility.type === 'militaryFactory' && projectedPowerSupplied
      ? { civilianGoods: (rule.inputs.civilianGoods ?? 0) * operatingWorkers }
      : {};
    const stoppedReason = !canProduce(facility) && !normalArmyBase
      ? facilityStoppedReason(facility)
      : powerMode === 'required' && !projectedPowerSupplied
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
      powerMode,
      requiredPowerCapacity: powerMode === 'required' ? rule.powerCapacity : 0,
      powerSupplyEnabled: facility.powerSupplyEnabled,
      projectedPowerRequested,
      projectedPowerSupplied,
      projectedPowerReason,
      lastPowerSupplied: facility.lastPowerSupplied,
      productionMultiplier,
      baseOutputs,
      stoppedReason,
      armyBaseMilitaryGoods: null,
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
  const generationFuelDemand = Math.max(0, totalPowerDemand - windPowerAvailable) / 5 * 2;
  const projectedFuelUsed = Math.max(0, totalPowerAllocated - windPowerAvailable) / 5 * 2;
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
  const militaryGoodsPlan = calculateMilitaryGoodsPlan(state, production('militaryGoods'));
  const militaryGoods = militaryGoodsPlan.forecast;
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
  const armyBaseRefillsByFacilityId = new Map(
    militaryGoodsPlan.armyBaseMilitaryGoodsRefills.map((refill) => [refill.facilityId, refill.amount]),
  );
  const projectedFacilities = projections.map((projection) => {
    const facility = facilityById.get(projection.facilityId)!;
    if (facility.type !== 'armyBase' || !facility.armyBase) return projection;
    const refillEligibility = armyBaseMilitaryGoodsRefillEligibility(state, facility);
    const projectedRefillAmount = armyBaseRefillsByFacilityId.get(facility.id) ?? 0;
    const remainingCapacity = Math.max(0, state.config.armyBase.maxMilitaryGoods - facility.armyBase.militaryGoods);
    const refillReason = refillEligibility.refillReason === 'supplied' && projectedRefillAmount < remainingCapacity
      ? 'national_stock_shortage' as const
      : refillEligibility.refillReason;
    const hasReservation = armyBaseReservations.has(facility.id);
    return {
      ...projection,
      armyBaseMilitaryGoods: {
        capacity: state.config.armyBase.maxMilitaryGoods,
        current: facility.armyBase.militaryGoods,
        inSupply: refillEligibility.inSupply,
        refillEligible: refillEligibility.refillEligible,
        projectedRefillAmount,
        projectedAfterRefill: facility.armyBase.militaryGoods + projectedRefillAmount,
        refillReason,
        recruitmentPower: {
          hasReservation,
          requested: projection.projectedPowerRequested,
          supplied: projection.projectedPowerSupplied,
          reason: projection.projectedPowerReason,
        },
      },
    };
  });
  const unpoweredFacilities = projectedFacilities
    .filter((projection) => projection.powerMode !== 'none' && !projection.projectedPowerSupplied)
    .map((projection) => ({ facilityId: projection.facilityId, reason: projection.projectedPowerReason }));
  return {
    facilities: projectedFacilities,
    unitRefills: [...unitRefillAmounts.entries()].map(([unitId, amount]) => ({ unitId, amount })),
    armyBaseMilitaryGoodsRefills: militaryGoodsPlan.armyBaseMilitaryGoodsRefills,
    armyBasePowerOrders: [...armyBaseReservations.values()].map((order) => ({
      orderId: order.id,
      facilityId: order.cityFacilityId,
      powerSupplied: supplied.has(order.cityFacilityId),
    })),
    forecast: {
      populationConsumers: consumers,
      maintenancePopulation: {
        residents: facilities.filter(f => f.owner === 'player' && isCityFacility(f)).reduce((n, f) => n + f.workers, 0),
        workers: facilities.filter(f => f.owner === 'player' && !isCityFacility(f)).reduce((n, f) => n + f.workers, 0),
        units: state.population.unitPopulation,
        queue: { waiting: state.checkpoints.reduce((n, c) => n + c.waiting, 0), screening: state.checkpoints.reduce((n, c) => n + c.screening, 0), approved: state.checkpoints.reduce((n, c) => n + c.approved, 0) },
      },
      maintenanceBreakdown: {
        food: { base: normalFood, overcrowding: overcrowdingFood, housingOutage: housingOutageFood, total: maintenance.food },
        civilianGoods: { base: normalCivilian, overcrowding: overcrowdingCivilian, housingOutage: housingOutageCivilian, total: maintenance.civilianGoods },
      },
      housingOutage: {
        facilities: occupiedHousingOutages,
        outageCount: occupiedHousingOutages.length,
        penaltyRatio: occupiedHousingOutages.length / 100,
        additionalFood: housingOutageFood,
        additionalCivilianGoods: housingOutageCivilian,
      },
      overcrowding: {
        cities: overcrowding,
        additionalFood: overcrowdingFood,
        additionalCivilianGoods: overcrowdingCivilian,
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

function overcrowdingPenaltyRatio(terms: ReturnType<typeof overcrowdingTerms>): number {
  return terms.reduce((total, term) => total + term.excess / term.softCap, 0);
}

function applyKnownReception(
  state: GameState,
  recipients: readonly FacilityState[],
  amount: number,
): boolean {
  if (amount <= 0) return true;
  if (recipients.length === 0) return false;
  const normalCities = recipients.filter((facility) => facility.type !== 'temporaryHousing');
  const housings = recipients.filter((facility) => facility.type === 'temporaryHousing');
  const stableOrder = new Map(recipients.map((facility, index) => [facility.id, index]));
  let remaining = amount;
  for (const group of [normalCities, housings]) {
    for (const facility of group) {
      if (remaining <= 0) break;
      const occupied = facility.workers + (facility.type === 'temporaryHousing' ? facility.infected : 0);
      const accepted = Math.min(remaining, Math.max(0, state.config.facilities[facility.type].workerCapacity - occupied));
      facility.workers += accepted;
      remaining -= accepted;
    }
  }
  while (remaining > 0) {
    const target = [...recipients].sort((left, right) => {
      const leftCapacity = state.config.facilities[left.type].workerCapacity;
      const rightCapacity = state.config.facilities[right.type].workerCapacity;
      const leftPopulation = left.workers + (left.type === 'temporaryHousing' ? left.infected : 0);
      const rightPopulation = right.workers + (right.type === 'temporaryHousing' ? right.infected : 0);
      return leftPopulation * rightCapacity - rightPopulation * leftCapacity
        || (stableOrder.get(left.id) ?? 0) - (stableOrder.get(right.id) ?? 0);
    })[0]!;
    target.workers += 1;
    remaining -= 1;
  }
  return true;
}

function projectKnownNextTurnPopulation(state: Readonly<GameState>, targetTurn: number): GameState {
  const projected = cloneState(state as GameState);
  for (const checkpoint of [...projected.checkpoints].sort((left, right) => left.id.localeCompare(right.id))) {
    if (!['operational', 'remnant'].includes(checkpoint.status) || checkpoint.screening <= 0 || checkpoint.remainingTurns !== 1) continue;
    const policy = projected.config.refugees.policies[checkpoint.screeningPolicy];
    if (policy.infectionRate > 0) continue;
    const accepted = Math.floor(checkpoint.screening * policy.workerRate);
    checkpoint.screening = 0;
    checkpoint.remainingTurns = 0;
    if (!applyKnownReception(projected, eligibleSnapshotCities(projected, 'reception'), accepted)) {
      checkpoint.approved += accepted;
    }
  }
  projected.turn = targetTurn;
  for (const facility of projected.facilities) {
    if (
      facility.operationalStatus === 'building' &&
      facility.builtTurn !== null &&
      facility.builtTurn < targetTurn
    ) {
      facility.operationalStatus = facility.type === 'windPowerPlant' || facility.type === 'temporaryHousing'
        ? 'operational'
        : facility.workers > 0 ? 'operational' : 'stopped';
      facility.populationOperationalTurn = targetTurn;
    }
    if (
      facility.operationalStatus === 'recovering' &&
      facility.recoveryOperationalTurn !== null &&
      facility.recoveryOperationalTurn <= targetTurn
    ) {
      facility.operationalStatus = facility.type === 'windPowerPlant' || facility.type === 'temporaryHousing' || facility.type === 'armyBase' || facility.workers > 0
        ? 'operational'
        : 'stopped';
      facility.populationOperationalTurn = targetTurn;
      facility.recoveryOperationalTurn = null;
    }
  }

  const recipients = projected.facilities
    .filter((facility) =>
      facility.owner === 'player' &&
      facility.status === 'owned' &&
      facility.infected === 0 &&
      facility.populationOperationalTurn <= targetTurn &&
      isCityFacility(facility) &&
      (facility.type !== 'temporaryHousing' || isHexSupplied(projected, facility.position)))
    .sort((left, right) => left.workers - right.workers || left.id.localeCompare(right.id));
  const approved = projected.checkpoints
    .filter((checkpoint) => ['operational', 'remnant'].includes(checkpoint.status))
    .reduce((total, checkpoint) => total + checkpoint.approved, 0);
  if (applyKnownReception(projected, recipients, approved)) {
    for (const checkpoint of projected.checkpoints) {
      if (['operational', 'remnant'].includes(checkpoint.status)) checkpoint.approved = 0;
    }
  }
  return projected;
}

/**
 * Exact next-player-turn warning based only on already committed facts. Random
 * arrivals, screening outcomes, infections, combat, and spawn positions are
 * deliberately absent. Build completions and already-approved refugees are
 * deterministic and therefore included.
 */
export function forecastNextTurnPenalties(state: Readonly<GameState>): NextTurnPenaltyForecast {
  return detachedQueryValue(state, 'next-turn-penalties', () => {
    const current = calculateEconomyPlan(state);
    const targetTurn = state.turn + 1;
    const projected = projectKnownNextTurnPopulation(state, targetTurn);
    projected.resources = {
      food: current.forecast.food.endingStock,
      civilianGoods: current.forecast.civilianGoods.endingStock,
      militaryGoods: current.forecast.militaryGoods.projectedEndingStock,
      fuel: current.forecast.fuel.endingStock,
      electricityCapacity: current.forecast.electricity.physicalGenerationCapacity,
      electricityRequired: current.forecast.electricity.requiredPowerDemand,
    };
    const forecast = computeEconomyPlan(projected).forecast;
    return {
      targetTurn,
      overcrowding: {
        active: forecast.overcrowding.cities.length > 0,
        facilities: forecast.overcrowding.cities,
        penaltyRatio: overcrowdingPenaltyRatio(forecast.overcrowding.cities),
        additionalFood: forecast.overcrowding.additionalFood,
        additionalCivilianGoods: forecast.overcrowding.additionalCivilianGoods,
      },
      housingOutage: {
        active: forecast.housingOutage.outageCount > 0,
        ...forecast.housingOutage,
      },
    };
  });
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

/**
 * Forecast the power result of accepting an Army Base National Guard
 * reservation without registering a speculative State in the query cache.
 * A caller can use this before dispatching ProduceUnit to warn that the
 * reservation is legal but will wait for power.
 */
export function forecastArmyBaseRecruitmentPower(
  state: Readonly<GameState>,
  facilityId: string,
): ArmyBaseMilitaryGoodsProjection['recruitmentPower'] | null {
  const facility = state.facilities.find((candidate) => candidate.id === facilityId);
  if (!facility || facility.type !== 'armyBase') return null;
  const hasReservation = state.pendingUnitProductions.some((order) => order.cityFacilityId === facilityId);
  const candidateState: GameState = hasReservation
    ? state as GameState
    : {
      ...state,
      pendingUnitProductions: [
        ...state.pendingUnitProductions,
        {
          id: `power-preview-${facilityId}`,
          cityFacilityId: facilityId,
          unitType: 'nationalGuard',
          population: state.config.units.nationalGuard.population,
          readyTurn: state.turn + 1,
        },
      ],
    };
  const projection = computeEconomyPlan(candidateState).facilities
    .find((candidate) => candidate.facilityId === facilityId);
  return projection?.armyBaseMilitaryGoods?.recruitmentPower ?? null;
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
