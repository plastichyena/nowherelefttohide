/**
 * Public entity projections shared by the Human UI and Agent Query API.
 *
 * This module intentionally contains no state-changing operation and does not
 * import the Phaser adapter.  The Agent type import is type-only so the Core
 * remains independent of the Agent runtime at build time; the returned values
 * are plain JSON projections and are safe to clone at an API boundary.
 */
import {
  effectiveRange,
  forecastUnitSuppression,
  getUnitLegalAttackProjections,
} from './combat-query';
import { forecastEndTurn, forecastFacilityProduction, forecastUnitRefills } from './economy-query';
import { getUnitLegalMoveFuelProjections } from './movement-query';
import { deriveUnitRecovery } from './recovery';
import { facilityZombieTargetValue, isCityFacility, isProductionFacility } from './state';
import { deriveCheckpointRole, isHexSupplied } from './supply';
import { effectiveMovementCost, terrainDefenseAt } from './terrain';
import { getTile } from './map';
import { hexKey } from './hex';
import type {
  CheckpointState,
  EndTurnForecast,
  FacilityState,
  GameState,
  ResourceType,
  UnitState,
} from './types';
import type {
  AgentCheckpointObservation,
  AgentFacilityObservation,
  AgentUnitObservation,
  UnitProficiency,
} from '../agent/types';

type PublicUnitProjection = AgentUnitObservation;
type PublicFacilityProjection = AgentFacilityObservation;
type PublicCheckpointProjection = AgentCheckpointObservation;

export interface PublicEntityProjectionContext {
  /** Core-owned visibility result for this state revision. */
  visibleTileKeys?: ReadonlySet<string>;
  /** Optional shared EndTurn forecast maps. */
  refillByUnitId?: ReadonlyMap<string, { demand: number; amount: number }>;
  militaryByUnitId?: ReadonlyMap<string, EndTurnForecast['militaryGoods']['units'][number]>;
  productionByFacility?: ReadonlyMap<string, ReturnType<typeof forecastFacilityProduction>[number]>;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function unitString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function isHumanUnitType(type: string): boolean {
  return type === 'police' || type === 'nationalGuard' || type === 'riotPolice';
}

function multiplyResources(
  values: Partial<Record<ResourceType, number>>,
  workers: number,
): Partial<Record<ResourceType, number>> {
  return Object.fromEntries(
    Object.entries(values).map(([resource, amount]) => [resource, amount * workers]),
  ) as Partial<Record<ResourceType, number>>;
}

function containingUnitAt(state: Readonly<GameState>, q: number, r: number): UnitState | undefined {
  const key = `${q},${r}`;
  return [...state.units]
    .filter((unit) => unit.isPlayerUnit && hexKey(unit.position) === key)
    .sort((left, right) => left.id.localeCompare(right.id))[0];
}

function projectionMaps(
  state: Readonly<GameState>,
  context: PublicEntityProjectionContext,
): { refillByUnitId: ReadonlyMap<string, { demand: number; amount: number }>; militaryByUnitId: ReadonlyMap<string, EndTurnForecast['militaryGoods']['units'][number]>; productionByFacility: ReadonlyMap<string, ReturnType<typeof forecastFacilityProduction>[number]> } {
  const needsForecast = !context.refillByUnitId || !context.militaryByUnitId;
  const forecast = needsForecast ? forecastUnitForecast(state) : null;
  const refillByUnitId = context.refillByUnitId ?? forecast!.refillByUnitId;
  const militaryByUnitId = context.militaryByUnitId ?? forecast!.militaryByUnitId;
  const productionByFacility = context.productionByFacility ?? new Map(
    forecastFacilityProduction(state).map((projection) => [projection.facilityId, projection] as const),
  );
  return { refillByUnitId, militaryByUnitId, productionByFacility };
}

function forecastUnitForecast(state: Readonly<GameState>): {
  refillByUnitId: ReadonlyMap<string, { demand: number; amount: number }>;
  militaryByUnitId: ReadonlyMap<string, EndTurnForecast['militaryGoods']['units'][number]>;
} {
  const refills = forecastUnitRefills(state);
  const forecast = forecastEndTurn(state);
  return {
    refillByUnitId: new Map(refills.map((refill) => [refill.unitId, refill] as const)),
    militaryByUnitId: new Map(forecast.militaryGoods.units.map((unit) => [unit.unitId, unit] as const)),
  };
}

/**
 * Project one public Human or Zombie unit.  Callers should pass the maps from
 * a shared Query Context when projecting several entities in one revision.
 */
export function createPublicUnitProjection(
  unit: UnitState,
  state: Readonly<GameState>,
  context: PublicEntityProjectionContext = {},
): PublicUnitProjection {
  const v15Unit = unit as UnitState & {
    proficiency?: UnitProficiency | null;
    recruitSurvivalTurns?: number;
    regularZombieKills?: number;
    veteranPromotionPending?: boolean;
    attackChargesRemaining?: number;
    maxAttackCharges?: number;
    recruitAttack?: number;
    baseRecruitAttack?: number;
    spawnGroupId?: string | null;
    hordeKind?: 'periodic' | 'final' | null;
  };
  const unitType = unitString(unit.type);
  const proficiency = isHumanUnitType(unitType) ? v15Unit.proficiency ?? 'regular' : null;
  const recruitSurvivalTurns = Math.max(0, Math.floor(finiteNumber(v15Unit.recruitSurvivalTurns, 0)));
  const regularZombieKills = Math.max(0, Math.floor(finiteNumber(v15Unit.regularZombieKills, 0)));
  const veteranPromotionPending = Boolean(v15Unit.veteranPromotionPending);
  const unitConfig = state.config.units[unit.type];
  const experience = state.config.unitExperience;
  const configuredMaxAttackCharges = 'maxAttackCharges' in unitConfig
    ? unitConfig.maxAttackCharges
    : proficiency === 'veteran' ? experience.veteranAttackCharges : 1;
  // Zombie charges are public unit state too: Horde Zombies retain their
  // configured shared two charges, while all other Zombie types use one.
  const maxAttackCharges = Math.max(1, Math.floor(finiteNumber(v15Unit.maxAttackCharges, configuredMaxAttackCharges)));
  const attackChargesRemaining = Math.max(
    0,
    Math.min(maxAttackCharges, Math.floor(finiteNumber(v15Unit.attackChargesRemaining, unit.canAttack ? maxAttackCharges : 0))),
  );
  const configuredRecruitAttack = isHumanUnitType(unitType) && 'recruitAttack' in unitConfig
    ? unitConfig.recruitAttack
    : unit.attack;
  const baseRecruitAttack = isHumanUnitType(unitType)
    ? finiteNumber(v15Unit.baseRecruitAttack ?? v15Unit.recruitAttack, configuredRecruitAttack)
    : null;
  const effectiveAttack = finiteNumber((v15Unit as unknown as Record<string, unknown>).effectiveAttack, unit.attack);
  const turnsUntilRegular = proficiency === 'recruit'
    ? Math.max(0, experience.recruitSurvivalTurnsRequired - recruitSurvivalTurns)
    : null;
  const killsUntilVeteran = proficiency === 'regular' || veteranPromotionPending
    ? Math.max(0, experience.veteranZombieKillsRequired - regularZombieKills)
    : null;
  const inSupply = isHexSupplied(state, unit.position);
  const suppression = forecastUnitSuppression(state, unit);
  const recovery = unit.isPlayerUnit
    ? deriveUnitRecovery(state, unit, { projectedSuppression: suppression !== null })
    : null;
  const currentRange = effectiveRange(state, unit);
  const positionTile = getTile(state.map, unit.position);
  const defense = terrainDefenseAt(state, unit);
  const maps = projectionMaps(state, context);
  const refill = maps.refillByUnitId.get(unit.id) ?? { demand: 0, amount: 0 };
  const military = maps.militaryByUnitId.get(unit.id);
  const fuelCostByLegalMove = (unit.isPlayerUnit ? getUnitLegalMoveFuelProjections(state, unit.id) : [])
    .sort((left, right) => left.destination.q - right.destination.q || left.destination.r - right.destination.r);
  const attackPreviews = unit.isPlayerUnit ? getUnitLegalAttackProjections(state, unit.id) : [];
  return {
    id: unit.id,
    type: unit.type,
    unitType: unit.type,
    proficiency,
    recruitSurvivalTurns,
    turnsUntilRegular,
    regularZombieKills,
    killsUntilVeteran,
    veteranPromotionPending,
    baseRecruitAttack,
    effectiveAttack,
    isScheduledWaveMember: !unit.isPlayerUnit && v15Unit.spawnGroupId !== null && v15Unit.spawnGroupId !== undefined,
    isFinalWaveMember: !unit.isPlayerUnit && v15Unit.hordeKind === 'final',
    position: { ...unit.position },
    vision: unit.vision,
    visionMode: 'ground',
    terrainLosBlocking: unit.isPlayerUnit,
    positionTerrain: positionTile?.terrain ?? 'plain',
    effectiveMovementCostAtPosition: effectiveMovementCost(state, unit.position),
    terrainDefenseSource: defense.source,
    terrainDamageMultiplier: defense.multiplier,
    hp: unit.hp,
    maxHp: unit.maxHp,
    attack: unit.attack,
    movement: unit.movement,
    range: unit.range,
    baseRange: unit.range,
    effectiveRange: currentRange,
    rangeModifierReason: unit.isPlayerUnit && currentRange < unit.range ? 'carried_military_goods_shortage' : null,
    population: unit.population,
    actionState: unit.actionState,
    canAttack: unit.canAttack,
    attackChargesRemaining,
    maxAttackCharges,
    canMove: unit.canMove,
    inSupply,
    currentFuel: unit.currentFuel,
    maxFuel: unit.maxFuel,
    currentMilitaryGoods: unit.currentMilitaryGoods,
    maxMilitaryGoods: unit.maxMilitaryGoods,
    fixedMilitaryGoodsUpkeepPerTurn: unitConfig.fixedMilitaryGoodsUpkeepPerTurn,
    attackMilitaryGoodsCostByRange: cloneJson(unitConfig.attackMilitaryGoodsCostByRange),
    suppressionMilitaryGoodsCost: unitConfig.suppressionMilitaryGoodsCost,
    emergencyMovementPoints: unitConfig.emergencyMovementPoints,
    emergencyMovementAvailable: unit.isPlayerUnit && unit.currentFuel === 0 && unit.canMove,
    fuelCostByLegalMove,
    attackPreviews: attackPreviews.map((preview) => ({
      ...preview,
      projectedAttackChargesRemaining: Math.max(0, attackChargesRemaining - 1),
    })),
    projectedRefillDemandIfTurnEndsNow: refill.demand,
    projectedRefillAmountIfTurnEndsNow: refill.amount,
    projectedMilitaryGoodsAfterFixedConsumption: military?.afterFixed ?? unit.currentMilitaryGoods,
    projectedMilitaryGoodsAfterRefill: military?.afterRefill ?? unit.currentMilitaryGoods,
    projectedMilitaryGoodsAfterSuppression: military?.afterSuppression ?? unit.currentMilitaryGoods,
    recoveryClassIfTurnEndsNow: recovery?.recoveryClass ?? null,
    recoveryRateIfTurnEndsNow: recovery?.rate ?? 0,
    recoveryBaseAmountIfTurnEndsNow: recovery?.baseAmount ?? 0,
    recoveryTiming: recovery?.timing ?? null,
    recoveryConditions: {
      requiresSurvival: recovery?.requiresSurvival ?? false,
      requiresSupplyAtRecovery: recovery?.requiresSupplyAtRecovery ?? false,
    },
    infectionContainmentCapable: unit.isPlayerUnit,
    suppressionPower: suppression?.suppressionPower ?? (unit.isPlayerUnit ? effectiveAttack : 0),
    suppressionCivilianDamage: suppression?.projectedCivilianDamage ?? 0,
    suppressionAvailableIfTurnEndsNow: military?.suppressionStatus === 'suppression',
    suppressionStatusIfTurnEndsNow: military?.suppressionStatus ?? 'none',
    suppressionTargetId: suppression?.targetId ?? null,
    suppressionChecksIfTurnEndsNow: attackChargesRemaining,
    suppressionMilitaryGoodsCostsIfTurnEndsNow: Array.from(
      { length: Math.max(0, attackChargesRemaining) },
      () => unitConfig.suppressionMilitaryGoodsCost,
    ),
    projectedSuppressionIfTurnEndsNow: suppression?.projectedSuppression ?? 0,
    projectedSuppressionCivilianDamageIfTurnEndsNow: suppression?.projectedCivilianDamage ?? 0,
  };
}

/** Project one public facility using the shared facility forecast map. */
export function createPublicFacilityProjection(
  facility: FacilityState,
  state: Readonly<GameState>,
  context: PublicEntityProjectionContext = {},
): PublicFacilityProjection {
  const maps = projectionMaps(state, context);
  const inSupply = isHexSupplied(state, facility.position);
  const unavailableForOperation = ['building', 'disabled', 'recovering'].includes(facility.operationalStatus);
  const populationOperational = facility.owner === 'player' && facility.status === 'owned' && facility.infected === 0 && !unavailableForOperation && facility.populationOperationalTurn <= state.turn;
  let populationUnavailableReason: string | null = null;
  if (facility.owner !== 'player') populationUnavailableReason = 'not_owned';
  else if (facility.status !== 'owned') populationUnavailableReason = 'facility_ruined';
  else if (facility.infected > 0) populationUnavailableReason = 'facility_infected';
  else if (facility.operationalStatus === 'building') populationUnavailableReason = 'building';
  else if (facility.operationalStatus === 'disabled') populationUnavailableReason = 'disabled';
  else if (facility.operationalStatus === 'recovering') populationUnavailableReason = 'recovering';
  else if (facility.populationOperationalTurn > state.turn) populationUnavailableReason = 'available_next_turn';
  const assignable = isProductionFacility(facility) && facility.owner === 'player' && facility.status === 'owned' && facility.infected === 0 && !unavailableForOperation && facility.populationOperationalTurn <= state.turn;
  const populationIncreaseAvailable = assignable && inSupply && state.population.cityResidents > 0;
  const populationDecreaseAvailable = assignable && facility.workers > 0;
  const recruitmentAvailable = isCityFacility(facility) && facility.owner === 'player' && facility.status === 'owned' && facility.infected === 0 && !unavailableForOperation && facility.populationOperationalTurn <= state.turn && inSupply;
  const rule = state.config.facilities[facility.type].production;
  const containingUnit = facility.infected > 0 ? containingUnitAt(state, facility.position.q, facility.position.r) : undefined;
  const suppression = containingUnit ? forecastUnitSuppression(state, containingUnit) : null;
  const productionProjection = maps.productionByFacility.get(facility.id);
  const currentWorkers = productionProjection?.operatingWorkers ?? 0;
  const estimatedInputs = productionProjection?.inputs ?? multiplyResources(rule.inputs, currentWorkers);
  const estimatedOutputs = productionProjection?.outputs ?? multiplyResources(rule.outputs, currentWorkers);
  const stoppedReason = productionProjection ? productionProjection.stoppedReason : 'stopped';
  return {
    id: facility.id,
    type: facility.type,
    position: { ...facility.position },
    owner: facility.owner,
    status: facility.status,
    operationalStatus: facility.operationalStatus,
    constructible: facility.constructible,
    builtTurn: facility.builtTurn,
    recoveryOperationalTurn: facility.recoveryOperationalTurn,
    vision: facility.owner === 'player' && facility.status !== 'ruined' && !unavailableForOperation
      ? facility.type === 'capital'
        ? state.config.vision.capital
        : facility.type === 'civilianDroneBase'
          ? facility.workers > 0 && facility.powerSupplyEnabled && facility.lastPowerSupplied === true ? facility.workers * 3 : 0
          : state.config.vision.ownedFacility
      : 0,
    visionMode: facility.type === 'civilianDroneBase' ? 'aerial' : 'ground',
    terrainLosBlocking: facility.type !== 'civilianDroneBase',
    healthyPopulation: facility.workers,
    zombieTargetValue: facilityZombieTargetValue(state, facility),
    infectedPopulation: facility.infected,
    populationCapacity: facility.workerCapacity,
    populationLimitKind: isCityFacility(facility) ? 'soft' : 'hard',
    populationOperational,
    populationUnavailableReason,
    inSupply,
    populationIncreaseAvailable,
    populationDecreaseAvailable,
    recruitmentAvailable,
    recruitmentUnavailableReason: recruitmentAvailable ? null : isCityFacility(facility) ? (
      facility.owner !== 'player' || facility.status !== 'owned' ? 'city_not_owned' : facility.infected > 0 ? 'city_infected' : facility.populationOperationalTurn > state.turn ? 'available_next_turn' : 'city_out_of_supply'
    ) : 'not_recruitment_hub',
    production: {
      inputsPerWorker: cloneJson(rule.inputs),
      outputsPerWorker: cloneJson(rule.outputs),
      requiresPower: rule.requiresPower,
      requiredPowerCapacity: rule.powerMode === 'required' ? rule.powerCapacity : 0,
      powerGenerationPerWorker: rule.powerGeneration,
      powerMode: rule.powerMode,
      powerDemand: rule.powerMode === 'required' ? rule.powerCapacity : 0,
      powerSupplyEnabled: rule.powerMode === 'required' && facility.powerSupplyEnabled,
      projectedPowerRequested: productionProjection?.projectedPowerRequested ?? false,
      projectedPowerSupplied: productionProjection?.projectedPowerSupplied ?? false,
      projectedPowerReason: productionProjection?.projectedPowerReason ?? 'not_applicable',
      lastPowerSupplied: facility.lastPowerSupplied,
      projectedProductionMultiplier: productionProjection?.productionMultiplier ?? 1,
      baseProduction: cloneJson(productionProjection?.baseOutputs ?? {}),
      projectedProduction: cloneJson(estimatedOutputs),
      estimatedInputConsumption: estimatedInputs,
      estimatedOutput: estimatedOutputs,
      estimatedPowerGeneration: productionProjection?.powerGeneration ?? 0,
      stoppedReason,
      projectedInputLossIfInfectedOrOverrun: cloneJson(estimatedInputs),
      projectedOutputLossIfInfectedOrOverrun: cloneJson(estimatedOutputs),
      projectedPowerLossIfInfectedOrOverrun: productionProjection?.powerGeneration ?? 0,
    },
    infectionContained: facility.infected > 0 && containingUnit !== undefined,
    containingUnitId: containingUnit?.id ?? null,
    projectedSuppression: suppression?.projectedSuppression ?? 0,
    projectedCivilianDamage: suppression?.projectedCivilianDamage ?? 0,
    decommissionRefundCivilianGoods: facility.constructible && facility.type === 'civilianDroneBase'
      ? Math.ceil(state.config.facilities.civilianDroneBase.buildCivilianGoods / 2)
      : null,
  };
}

/** Project one public checkpoint, including its branch and containment facts. */
export function createPublicCheckpointProjection(
  checkpoint: CheckpointState,
  state: Readonly<GameState>,
): PublicCheckpointProjection {
  const role = deriveCheckpointRole(state, checkpoint);
  const branch = state.roadBranches.find((candidate) => candidate.branchId === (checkpoint.branchId ?? checkpoint.direction));
  const containingUnit = checkpoint.infected > 0 ? containingUnitAt(state, checkpoint.position.q, checkpoint.position.r) : undefined;
  const suppression = containingUnit ? forecastUnitSuppression(state, containingUnit) : null;
  const queuePeople = checkpoint.waiting + checkpoint.screening + checkpoint.approved;
  const policy = branch?.currentPolicy ?? 'normal';
  return {
    id: checkpoint.id,
    branchId: checkpoint.branchId ?? checkpoint.direction,
    position: { ...checkpoint.position },
    direction: checkpoint.direction,
    vision: role === 'active' ? state.config.vision.operationalCheckpoint : 0,
    visionMode: 'ground',
    terrainLosBlocking: true,
    status: checkpoint.status,
    role,
    waiting: checkpoint.waiting,
    screening: checkpoint.screening,
    approved: checkpoint.approved,
    queuePeople,
    screeningCapacity: state.config.refugees.screeningCapacity,
    estimatedScreeningThroughput: state.config.refugees.screeningCapacity / Math.max(1, state.config.refugees.policies[policy].turns),
    arrivalIntervalMin: state.config.refugees.arrivalIntervalMin,
    arrivalIntervalMax: state.config.refugees.arrivalIntervalMax,
    arrivalPeopleMin: state.config.refugees.arrivalPeopleMin,
    arrivalPeopleMax: state.config.refugees.arrivalPeopleMax,
    queuePressureClass: getQueuePressureClass(queuePeople, state.config.refugees.screeningCapacity),
    healthyQueueConsumesMaintenance: true,
    queueMaintenanceFood: queuePeople * state.config.economy.populationConsumption.food,
    queueMaintenanceCivilianGoods: queuePeople * state.config.economy.populationConsumption.civilianGoods,
    infected: checkpoint.infected,
    remainingTurns: checkpoint.remainingTurns,
    currentPolicy: policy,
    currentPolicyTurns: state.config.refugees.policies[policy].turns,
    nextPolicy: checkpoint.screeningPolicy,
    nextArrivalTurn: checkpoint.nextArrivalTurn,
    providesSupply: role === 'active',
    infectionContained: checkpoint.infected > 0 && containingUnit !== undefined,
    containingUnitId: containingUnit?.id ?? null,
    projectedSuppression: suppression?.projectedSuppression ?? 0,
    projectedCivilianDamage: suppression?.projectedCivilianDamage ?? 0,
  };
}

function getQueuePressureClass(queuePeople: number, screeningCapacity: number): 'none' | 'low' | 'medium' | 'high' {
  if (queuePeople <= 0) return 'none';
  const ratio = queuePeople / Math.max(1, screeningCapacity);
  if (ratio >= 2) return 'high';
  if (ratio >= 1) return 'medium';
  return 'low';
}

/** Build all reusable maps needed to project several entities in one query. */
export function createPublicEntityProjectionContext(state: Readonly<GameState>): PublicEntityProjectionContext {
  const refills = forecastUnitRefills(state);
  const military = forecastEndTurn(state).militaryGoods.units;
  const production = forecastFacilityProduction(state);
  return {
    visibleTileKeys: undefined,
    refillByUnitId: new Map(refills.map((refill) => [refill.unitId, refill] as const)),
    militaryByUnitId: new Map(military.map((unit) => [unit.unitId, unit] as const)),
    productionByFacility: new Map(production.map((projection) => [projection.facilityId, projection] as const)),
  };
}
