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
import { forecastArmyBaseRecruitmentPower, forecastEndTurn, forecastFacilityProduction, forecastUnitRefills } from './economy-query';
import { getUnitLegalMoveFuelProjections } from './movement-query';
import { deriveUnitRecovery } from './recovery';
import { facilityZombieTargetValue, isCityFacility, isProductionFacility } from './state';
import { deriveCheckpointRole, isHexSupplied } from './supply';
import { effectiveMovementCost, terrainDefenseAt, terrainAdjustedDamage } from './terrain';
import { getTile } from './map';
import { getPlayerVisibleTileKeys } from './visibility';
import { hexDistance, hexKey } from './hex';
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
): { refillByUnitId: ReadonlyMap<string, { demand: number; amount: number }>; militaryByUnitId: ReadonlyMap<string, EndTurnForecast['militaryGoods']['units'][number]>; productionByFacility: ReadonlyMap<string, ReturnType<typeof forecastFacilityProduction>[number]>; housingOutageByFacilityId: ReadonlyMap<string, 'power_shortage' | 'supply_disconnected'> } {
  const needsForecast = !context.refillByUnitId || !context.militaryByUnitId;
  const forecast = needsForecast ? forecastUnitForecast(state) : null;
  const refillByUnitId = context.refillByUnitId ?? forecast!.refillByUnitId;
  const militaryByUnitId = context.militaryByUnitId ?? forecast!.militaryByUnitId;
  const productionByFacility = context.productionByFacility ?? new Map(
    forecastFacilityProduction(state).map((projection) => [projection.facilityId, projection] as const),
  );
  const housingOutageByFacilityId = new Map(
    forecastEndTurn(state).housingOutage.facilities.map((entry) => [entry.facilityId, entry.reason] as const),
  );
  return { refillByUnitId, militaryByUnitId, productionByFacility, housingOutageByFacilityId };
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
    ...(unit.type === 'gasZombie' ? { deathExplosion: {
      radius:1, excludesCenter:true as const, baseUnitDamage:state.config.units.gasZombie.explosionDamage, maxSiteInfection:state.config.units.gasZombie.explosionInfection,
      units:state.units.filter(target=>hexDistance(target.position,unit.position)===1 && (target.isPlayerUnit || (context.visibleTileKeys ?? getPlayerVisibleTileKeys(state)).has(hexKey(target.position)))).map(target=>({unitId:target.id,damage:Math.min(target.hp,terrainAdjustedDamage(state,target,state.config.units.gasZombie.explosionDamage).finalDamage)})),
      sites:[...state.facilities.filter(f=>hexDistance(f.position,unit.position)===1 && (context.visibleTileKeys ?? getPlayerVisibleTileKeys(state)).has(hexKey(f.position))).map(f=>({siteId:f.id,infection:Math.min(f.workers,state.config.units.gasZombie.explosionInfection)})),...state.checkpoints.filter(c=>hexDistance(c.position,unit.position)===1 && (context.visibleTileKeys ?? getPlayerVisibleTileKeys(state)).has(hexKey(c.position))).map(c=>({siteId:c.id,infection:Math.min(c.waiting+c.screening+c.approved,state.config.units.gasZombie.explosionInfection)}))],
    } } : {}),
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

export function facilityRecoveryProjection(state: Readonly<GameState>, facility: FacilityState) {
  const visible = getPlayerVisibleTileKeys(state);
  const enemies = state.units.some(u => !u.isPlayerUnit && visible.has(hexKey(u.position)) && hexKey(u.position) === hexKey(facility.position));
  const needed: string[] = [];
  if (facility.infected > 0) needed.push('suppress_infection');
  if (enemies) needed.push('clear_visible_enemy');
  if (facility.owner !== 'player' || facility.operationalStatus === 'disabled') needed.push('station_human_unit');
  if (facility.operationalStatus === 'recovering' || facility.operationalStatus === 'building' || facility.populationOperationalTurn > state.turn) needed.push('wait_until_operational');
  const recoverable = !(facility.constructible && facility.status === 'ruined');
  const productionRequirements: string[] = [];
  if (facility.workers === 0 && facility.type !== 'windPowerPlant') productionRequirements.push('healthy_population');
  if (facility.type === 'temporaryHousing' && !isHexSupplied(state, facility.position)) productionRequirements.push('supply');
  if (state.config.facilities[facility.type].production.powerMode === 'required') productionRequirements.push('allocated_power');
  return { recoverable, status: !recoverable ? 'cannot_recover' : needed.length ? 'conditions_required' : 'ready', missingConditions: needed, scheduledOperationalTurn: facility.recoveryOperationalTurn, productionRequirements, terrainDefense: { source: 'urban', multiplier: state.config.terrain.damageMultiplier.urban, reason: 'facility_urban_overlay' } };
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
  const recruitmentAvailable = (isCityFacility(facility) || facility.type === 'armyBase') && facility.owner === 'player' && facility.status === 'owned' && facility.infected === 0 && !unavailableForOperation && facility.populationOperationalTurn <= state.turn && inSupply && !state.pendingUnitProductions.some(order => order.cityFacilityId === facility.id);
  const rule = state.config.facilities[facility.type].production;
  const containingUnit = facility.infected > 0 ? containingUnitAt(state, facility.position.q, facility.position.r) : undefined;
  const suppression = containingUnit ? forecastUnitSuppression(state, containingUnit) : null;
  const productionProjection = maps.productionByFacility.get(facility.id);
  const housingOutageReason = maps.housingOutageByFacilityId.get(facility.id) ?? null;
  const currentWorkers = productionProjection?.operatingWorkers ?? 0;
  const estimatedInputs = productionProjection?.inputs ?? multiplyResources(rule.inputs, currentWorkers);
  const estimatedOutputs = productionProjection?.outputs ?? multiplyResources(rule.outputs, currentWorkers);
  const stoppedReason = productionProjection ? productionProjection.stoppedReason : 'stopped';
  return {
    recovery: facilityRecoveryProjection(state, facility),
    armyBase: armyBaseProjection(state, facility, productionProjection),
    id: facility.id,
    type: facility.type,
    position: { ...facility.position },
    owner: facility.owner,
    status: facility.status,
    operationalStatus: facility.operationalStatus,
    constructible: facility.constructible,
    builtTurn: facility.builtTurn,
    recoveryOperationalTurn: facility.recoveryOperationalTurn,
    vision: facility.type === 'armyBase' ? (facility.owner === 'player' && facility.status !== 'ruined' ? (facility.workers > 0 ? state.config.armyBase.staffedVision : state.config.facilities.armyBase.visionRadius) : 0) : facility.owner === 'player' && facility.status !== 'ruined' && !unavailableForOperation
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
    recruitmentUnavailableReason: recruitmentAvailable ? null : facility.type === 'armyBase' ? (populationUnavailableReason ?? (!inSupply ? 'recruitment_out_of_supply' : 'city_busy')) : isCityFacility(facility) ? (
      facility.owner !== 'player' || facility.status !== 'owned' ? 'city_not_owned' : facility.infected > 0 ? 'city_infected' : facility.populationOperationalTurn > state.turn ? 'available_next_turn' : 'city_out_of_supply'
    ) : 'not_recruitment_hub',
    production: {
      inputsPerWorker: cloneJson(rule.inputs),
      outputsPerWorker: cloneJson(rule.outputs),
      requiresPower: (productionProjection?.powerMode ?? rule.powerMode) === 'required',
      requiredPowerCapacity: productionProjection?.requiredPowerCapacity ?? (rule.powerMode === 'required' ? rule.powerCapacity : 0),
      powerGenerationPerWorker: rule.powerGeneration,
      powerMode: productionProjection?.powerMode ?? rule.powerMode,
      powerDemand: productionProjection?.requiredPowerCapacity ?? (rule.powerMode === 'required' ? rule.powerCapacity : 0),
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
    temporaryHousing: facility.type === 'temporaryHousing'
      ? {
        softCapacity: facility.workerCapacity,
        totalResidents: facility.workers + facility.infected,
        occupied: facility.workers > 0,
        populationPoolEligible: populationOperational && inSupply,
        outageReason: housingOutageReason,
      }
      : null,
    windPower: facility.type === 'windPowerPlant'
      ? {
        operational: facility.owner === 'player' && facility.status === 'owned' && facility.operationalStatus === 'operational',
        generation: facility.owner === 'player' && facility.status === 'owned' && facility.operationalStatus === 'operational'
          ? state.config.facilities.windPowerPlant.production.fixedPowerGeneration
          : 0,
        emitsNoise: facility.owner === 'player' && facility.status === 'owned' && facility.operationalStatus === 'operational',
        playerBuildLimit: state.map.roadBranches.length,
        playerBuiltCount: state.facilities.filter((candidate) => candidate.type === 'windPowerPlant' && candidate.constructible).length,
      }
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
    turnAwayPreview: { waitingOnly: true, maxPeople: checkpoint.waiting, foodMaintenanceReduction: checkpoint.waiting * state.config.economy.populationConsumption.food, civilianGoodsMaintenanceReduction: checkpoint.waiting * state.config.economy.populationConsumption.civilianGoods, additionalPenalties: 'recalculated_after_action', futureWaveRisk: state.horde.finalHordeStatus === 'notStarted' },
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

function armyBaseProjection(state: Readonly<GameState>, facility: FacilityState, projection: ReturnType<typeof forecastFacilityProduction>[number] | undefined): AgentFacilityObservation['armyBase'] {
  if (!facility.armyBase) return null;
  const settings=state.config.armyBase;
  const normal=facility.owner==='player' && facility.status==='owned' && facility.infected===0 && facility.operationalStatus==='operational';
  const operationReason=facility.owner!=='player'?'not_owned':facility.status!=='owned'?'facility_ruined':facility.infected>0?'facility_infected':facility.operationalStatus!=='operational'?facility.operationalStatus:null;
  const order=state.pendingUnitProductions.find(o=>o.cityFacilityId===facility.id);
  const powerPreview=forecastArmyBaseRecruitmentPower(state,facility.id);
  const refill=projection?.armyBaseMilitaryGoods;
  const reward=facility.armyBase.reward==='unclaimed' && state.turn>settings.rewardLastTurn?'expired':facility.armyBase.reward;
  const interceptionReason=operationReason ?? (facility.workers<=0?'no_workers':facility.armyBase.interceptionsRemaining<=0?'no_interceptions':facility.armyBase.militaryGoods<settings.interceptionCost?'insufficient_military_goods':null);
  return {militaryGoods:facility.armyBase.militaryGoods,maxMilitaryGoods:settings.maxMilitaryGoods,interceptionsRemaining:Math.min(facility.armyBase.interceptionsRemaining,facility.workers),interceptionsRefresh:'zombie_phase_start',interceptionAttack:settings.attack,interceptionRange:settings.range,interceptionCost:settings.interceptionCost,interceptionNoiseRadius:settings.noiseRadius,interceptionAvailable:interceptionReason===null,interceptionUnavailableReason:interceptionReason,projectedMilitaryGoodsRefill:refill?.projectedRefillAmount??0,refillAvailable:refill?.refillEligible??false,refillUnavailableReason:refill?.refillEligible?null:refill?.refillReason??operationReason,rewardStatus:reward,rewardLastTurn:settings.rewardLastTurn,rewardAvailable:reward==='unclaimed'||reward==='pending',rewardUnavailableReason:reward==='claimed'?'claimed':reward==='expired'?'expired':null,pendingRecruitment:order?{unitType:order.unitType,readyTurn:order.readyTurn,powerDemand:projection?.requiredPowerCapacity??0,powerAllocated:order.powerReady===true,status:!normal?'paused':order.powerReady?'ready':'waiting_power',reason:operationReason??(order.powerReady?null:projection?.projectedPowerReason??'not_applicable')}:null,recruitmentPowerDemand:state.config.facilities.armyBase.production.powerCapacity,recruitmentPowerAllocated:powerPreview?.supplied??false,recruitmentPowerReason:powerPreview?.reason??'not_applicable'};
}
