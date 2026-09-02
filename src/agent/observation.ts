import {
  deriveVictoryProgress,
  effectiveRange,
  forecastEndTurn,
  forecastFacilityProduction,
  forecastUnitSuppression,
  forecastUnitRefills,
  getConstructibleFacilityPositionCandidates,
  getCheckpointPositionCandidates,
  getUnitLegalMoveFuelProjections,
  getUnitLegalAttackProjections,
} from '../core/engine';
import { deriveStrategicForecast, getQueuePressureClass } from '../core/forecast';
import { deriveUnitRecovery } from '../core/recovery';
import { hexKey } from '../core/hex';
import { getTile } from '../core/map';
import { facilityZombieTargetValue, isCityFacility, isProductionFacility } from '../core/state';
import {
  deriveCheckpointRole,
  deriveSupplySnapshot,
  isHexSupplied,
} from '../core/supply';
import { effectiveMovementCost, isUrbanHex, terrainDefenseAt } from '../core/terrain';
import { getPlayerVisibleTileKeys } from '../core/visibility';
import type {
  GameResult,
  GameState,
  EndTurnForecast,
  HexTile,
  JsonValue,
  ResourceType,
  TerrainDefenseSource,
  UnitState,
} from '../core/types';
import {
  HIDDEN_NOISE_METRIC_KEYS,
  OBSERVATION_API_VERSION,
  type AgentGameResult,
  type AgentArtifactObservation,
  type AgentMapObservation,
  type AgentObservation,
  type AgentPublicEvent,
  type AgentUnitObservation,
} from './types';

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const IMPORTANT_SITE_EVENT_TYPES = new Set([
  'site_infection_started',
  'site_fallen',
  'site_chain_fallen',
  'site_zombies_spawned',
  'site_immediate_infection',
  'site_noise_respawn',
]);

const IMPORTANT_SITE_EVENT_FIELDS = new Set([
  'siteKind', 'siteId', 'siteType', 'q', 'r', 'cause', 'amount',
  'infectedAtFall', 'requestedSpawnCount', 'actualSpawnCount',
  'remainingInfected', 'remainingHealthy', 'infected',
  'constructibleInfectedDeaths', 'chainOriginEventId', 'chainDepth',
  'sourceUnitType',
]);

/** Public site history never includes generated Zombie IDs or exact Spawn hexes. */
function importantSiteEvents(state: Readonly<GameState>): AgentPublicEvent[] {
  return state.events
    .filter((event) => IMPORTANT_SITE_EVENT_TYPES.has(event.type))
    .slice(-50)
    .map((event) => ({
      ...event,
      payload: Object.fromEntries(
        Object.entries(event.payload).filter(([field]) => IMPORTANT_SITE_EVENT_FIELDS.has(field)),
      ),
    })) as AgentPublicEvent[];
}

function publicResult(result: GameResult | null): AgentGameResult | null {
  if (!result) return null;
  const statistics = cloneJson(result.statistics) as unknown as Record<string, unknown>;
  for (const key of HIDDEN_NOISE_METRIC_KEYS) delete statistics[key];
  return cloneJson({
    outcome: result.outcome,
    reason: result.reason,
    turn: result.turn,
    statistics,
  }) as AgentGameResult;
}

interface PublicTerrainProjection {
  source: TerrainDefenseSource;
  multiplier: number;
}

function tileAt(state: Readonly<GameState>, position: { q: number; r: number }): HexTile | undefined {
  return getTile(state.map, position);
}

function samePosition(left: { q: number; r: number }, right: { q: number; r: number }): boolean {
  return left.q === right.q && left.r === right.r;
}

/**
 * A map tile has no attacking unit type, so its defense projection describes
 * the terrain/overlay rule itself. Unit observations below use terrainDefenseAt
 * to expose the exact modifier for that unit type.
 */
function publicTileDefense(state: Readonly<GameState>, tile: HexTile): PublicTerrainProjection {
  if (isUrbanHex(state, tile)) {
    return { source: 'urban', multiplier: state.config.terrain.damageMultiplier.urban };
  }
  if (tile.terrain === 'forest') {
    return { source: 'forest', multiplier: state.config.terrain.damageMultiplier.forestZombie };
  }
  return { source: 'none', multiplier: 1 };
}

function publicUnit(
  unit: UnitState,
  state: Readonly<GameState>,
  refillByUnitId: ReadonlyMap<string, { demand: number; amount: number }>,
  militaryByUnitId: ReadonlyMap<string, EndTurnForecast['militaryGoods']['units'][number]>,
): AgentUnitObservation {
  const inSupply = isHexSupplied(state, unit.position);
  const suppression = forecastUnitSuppression(state, unit);
  const recovery = unit.isPlayerUnit
    ? deriveUnitRecovery(state, unit, { projectedSuppression: suppression !== null })
    : null;
  const currentRange = effectiveRange(state, unit);
  const positionTile = tileAt(state, unit.position);
  const defense = terrainDefenseAt(state, unit);
  const refill = refillByUnitId.get(unit.id) ?? { demand: 0, amount: 0 };
  const military = militaryByUnitId.get(unit.id);
  const unitConfig = state.config.units[unit.type];
  const fuelCostByLegalMove = (unit.isPlayerUnit
    ? getUnitLegalMoveFuelProjections(state, unit.id)
    : [])
    .sort((left, right) => left.destination.q - right.destination.q || left.destination.r - right.destination.r);
  const attackPreviews = unit.isPlayerUnit
    ? getUnitLegalAttackProjections(state, unit.id)
    : [];
  return {
    id: unit.id,
    type: unit.type,
    unitType: unit.type,
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
    rangeModifierReason: unit.isPlayerUnit && currentRange < unit.range
      ? 'carried_military_goods_shortage'
      : null,
    population: unit.population,
    actionState: unit.actionState,
    canAttack: unit.canAttack,
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
    attackPreviews,
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
    suppressionPower: suppression?.suppressionPower ?? (
      unit.type === 'police'
        ? state.config.infection.policeSuppression
        : unit.type === 'nationalGuard'
          ? state.config.infection.nationalGuardSuppression
          : 0
    ),
    suppressionCivilianDamage: suppression?.projectedCivilianDamage ?? 0,
    suppressionAvailableIfTurnEndsNow: military?.suppressionStatus === 'suppression',
    suppressionStatusIfTurnEndsNow: military?.suppressionStatus ?? 'none',
    suppressionTargetId: suppression?.targetId ?? null,
  };
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

/**
 * Immutable Core projections supplied by the Adapter for the current state.
 * This keeps the standalone Observation factory fully self-contained while
 * allowing the state-changing boundary to reuse projections whose inputs did
 * not change between non-checkpoint actions.
 */
export interface AgentObservationProjectionCache {
  checkpointPositionCandidates?: ReturnType<typeof getCheckpointPositionCandidates>;
}

/**
 * Build the stable public-information view used by every Agent entry point.
 * Fuel projections use the Core's state-only legal-move helper, so every
 * consumer receives the exact action-cost preview without enumerating all
 * non-move legal actions.
 */
export function createAgentObservation(
  state: Readonly<GameState>,
  projectionCache: AgentObservationProjectionCache = {},
): AgentObservation {
  const supply = deriveSupplySnapshot(state);
  const visibleTileKeys = getPlayerVisibleTileKeys(state);
  const refillByUnitId = new Map(
    forecastUnitRefills(state).map((refill) => [refill.unitId, refill] as const),
  );
  const endTurnForecast = forecastEndTurn(state);
  const militaryByUnitId = new Map(
    endTurnForecast.militaryGoods.units.map((unit) => [unit.unitId, unit] as const),
  );
  const productionByFacility = new Map(
    forecastFacilityProduction(state).map((projection) => [projection.facilityId, projection]),
  );
  const branchStatesById = new Map(state.roadBranches.map((branch) => [branch.branchId, branch] as const));
  const checkpointRoleById = new Map(
    state.checkpoints.map((checkpoint) => [checkpoint.id, deriveCheckpointRole(state, checkpoint)] as const),
  );
  const roadBranches = [...state.map.roadBranches]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((definition) => {
      const branchState = branchStatesById.get(definition.id);
      const activeCheckpoint = branchState?.activeCheckpointId
        ? state.checkpoints.find((checkpoint) => checkpoint.id === branchState.activeCheckpointId)
        : undefined;
      const standbyCheckpointIds = [...(branchState?.standbyCheckpointIds ?? [])].sort();
      const dormantCheckpointIds = state.checkpoints
        .filter((checkpoint) =>
          (checkpoint.branchId ?? checkpoint.direction) === definition.id &&
          checkpointRoleById.get(checkpoint.id) === 'dormant',
        )
        .map((checkpoint) => checkpoint.id)
        .sort();
      const activeRoadIndex = activeCheckpoint
        ? definition.roadTiles.findIndex((position) => hexKey(position) === hexKey(activeCheckpoint.position))
        : -1;
      const fallbackAvailable = activeRoadIndex > 0 && state.checkpoints.some((checkpoint) => {
        const role = checkpointRoleById.get(checkpoint.id);
        if (
          (checkpoint.branchId ?? checkpoint.direction) !== definition.id ||
          checkpoint.status !== 'operational' ||
          (role !== 'standby' && role !== 'dormant')
        ) return false;
        const checkpointRoadIndex = definition.roadTiles.findIndex(
          (position) => hexKey(position) === hexKey(checkpoint.position),
        );
        return checkpointRoadIndex >= 0 && checkpointRoadIndex < activeRoadIndex;
      });
      const preparedPostCount = (activeCheckpoint ? 1 : 0) + standbyCheckpointIds.length;
      const nextArrivalTurn = branchState?.nextArrivalTurn ?? state.turn;
      return {
        branchId: definition.id,
        direction: definition.direction,
        capitalConnection: { ...definition.capitalConnection },
        roadTiles: definition.roadTiles.map((position) => ({ ...position })),
        entrance: { ...definition.entrance },
        nextArrivalTurn,
        turnsUntilArrival: Math.max(0, nextArrivalTurn - state.turn),
        activeCheckpointId: activeCheckpoint?.id ?? null,
        activeCheckpointStatus: activeCheckpoint?.status ?? null,
        standbyCheckpointIds,
        dormantCheckpointIds,
        fallbackAvailable,
        currentPolicy: branchState?.currentPolicy ?? 'normal',
        currentPolicyTurns: state.config.refugees.policies[branchState?.currentPolicy ?? 'normal'].turns,
        preparedPostCount,
        preparedPostLimit: state.config.checkpoint.maxPreparedPostsPerDirection,
        checkpointActionsThisTurn: branchState?.checkpointActionsThisTurn ?? 0,
        checkpointActionAvailable: (branchState?.checkpointActionsThisTurn ?? 0) < 1,
      };
    });
  const facilities = [...state.facilities]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((facility) => {
      const inSupply = isHexSupplied(state, facility.position);
      const unavailableForOperation = ['building', 'disabled', 'recovering'].includes(facility.operationalStatus);
      const populationOperational =
        facility.owner === 'player' &&
        facility.status === 'owned' &&
        facility.infected === 0 &&
        !unavailableForOperation &&
        facility.populationOperationalTurn <= state.turn;
      let populationUnavailableReason: string | null = null;
      if (facility.owner !== 'player') populationUnavailableReason = 'not_owned';
      else if (facility.status !== 'owned') populationUnavailableReason = 'facility_ruined';
      else if (facility.infected > 0) populationUnavailableReason = 'facility_infected';
      else if (facility.operationalStatus === 'building') populationUnavailableReason = 'building';
      else if (facility.operationalStatus === 'disabled') populationUnavailableReason = 'disabled';
      else if (facility.operationalStatus === 'recovering') populationUnavailableReason = 'recovering';
      else if (facility.populationOperationalTurn > state.turn) populationUnavailableReason = 'available_next_turn';
      const assignable =
        isProductionFacility(facility) &&
        facility.owner === 'player' &&
        facility.status === 'owned' &&
        facility.infected === 0 &&
        !unavailableForOperation &&
        facility.populationOperationalTurn <= state.turn;
      const populationIncreaseAvailable = assignable && inSupply && state.population.cityResidents > 0;
      const populationDecreaseAvailable = assignable && facility.workers > 0;
      const recruitmentAvailable =
        isCityFacility(facility) &&
        facility.owner === 'player' &&
        facility.status === 'owned' &&
        facility.infected === 0 &&
        !unavailableForOperation &&
        facility.populationOperationalTurn <= state.turn &&
        inSupply;
      const rule = state.config.facilities[facility.type].production;
      const containingUnit = facility.infected > 0
        ? containingUnitAt(state, facility.position.q, facility.position.r)
        : undefined;
      const suppression = containingUnit ? forecastUnitSuppression(state, containingUnit) : null;
      const productionProjection = productionByFacility.get(facility.id);
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
              ? facility.workers > 0 && facility.powerSupplyEnabled && facility.lastPowerSupplied === true
                ? facility.workers * 2
                : 0
              : state.config.vision.ownedFacility
          : 0,
        visionMode: facility.type === 'civilianDroneBase' ? 'aerial' as const : 'ground' as const,
        terrainLosBlocking: facility.type !== 'civilianDroneBase',
        healthyPopulation: facility.workers,
        zombieTargetValue: facilityZombieTargetValue(state, facility),
        infectedPopulation: facility.infected,
        populationCapacity: facility.workerCapacity,
        populationLimitKind: isCityFacility(facility) ? 'soft' as const : 'hard' as const,
        populationOperational,
        populationUnavailableReason,
        inSupply,
        populationIncreaseAvailable,
        populationDecreaseAvailable,
        recruitmentAvailable,
        recruitmentUnavailableReason: recruitmentAvailable ? null : isCityFacility(facility) ? (
          facility.owner !== 'player' || facility.status !== 'owned'
            ? 'city_not_owned'
            : facility.infected > 0
              ? 'city_infected'
              : facility.populationOperationalTurn > state.turn
                ? 'available_next_turn'
                : 'city_out_of_supply'
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
      };
    });
  const orderedUnits = [...state.units].sort((left, right) => left.id.localeCompare(right.id));
  const visibleEnemyUnits = orderedUnits.filter(
    (unit) => !unit.isPlayerUnit && visibleTileKeys.has(hexKey(unit.position)),
  );
  const victory = deriveVictoryProgress(state);
  const publicFinalHordeStatus = victory.finalHordeDefeated
    ? 'defeated' as const
    : state.horde.finalHordeStatus;
  const nextWave = state.horde.nextWaveIndex === null
    ? null
    : state.config.horde.waves[state.horde.nextWaveIndex - 1] ?? null;
  // The schedule turn is public even before a warning starts. The selected
  // directions remain private until the warning event/observation is active.
  const publicSpawnTurn = nextWave?.turn ?? state.horde.lastSpawnTurn;
  return cloneJson({
    apiVersion: OBSERVATION_API_VERSION,
    gameRulesVersion: state.gameVersion,
    turn: state.turn,
    finalHordeTurn: state.finalHordeTurn,
    phase: state.phase,
    map: {
      id: state.mapId,
      width: state.map.width,
      height: state.map.height,
      coordinateSystem: 'axial-q-r' as const,
      tiles: [...state.map.tiles]
        .sort((left, right) => left.q - right.q || left.r - right.r)
        .map((tile) => {
          const checkpoint = state.checkpoints.find((candidate) => samePosition(candidate.position, tile));
          const defense = publicTileDefense(state, tile);
          const movementCost = effectiveMovementCost(state, tile);
          return {
            q: tile.q,
            r: tile.r,
            terrain: tile.terrain,
            passable: movementCost !== null,
            road: tile.road,
            urban: isUrbanHex(state, tile),
            facilityId: tile.facilityId,
            checkpointId: checkpoint?.id ?? null,
            effectiveMovementCost: movementCost,
            terrainDefenseSource: defense.source,
            terrainDamageMultiplier: defense.multiplier,
             visibleToPlayer: visibleTileKeys.has(tile.key),
             hordeEntranceDirections: [...tile.hordeEntranceDirections].sort(),
             playerOccupancyAllowed: tile.playerOccupancyAllowed,
           };
         }),
       hordeSpawnReserve: state.map.hordeSpawnReserve.map((position) => ({ ...position })),
    },
    resources: cloneJson(state.resources),
    population: {
      healthyCivilians: state.population.healthyCivilians,
      cityResidents: state.population.cityResidents,
      productionWorkers: state.population.productionWorkers,
      unitPopulation: state.population.unitPopulation,
      waitingRefugees: state.population.waitingRefugees,
      screeningRefugees: state.population.screeningRefugees,
      approvedRefugees: state.population.approvedRefugees,
      infected: state.population.facilityInfected + state.population.checkpointInfected,
    },
    facilities,
    units: orderedUnits
      .filter((unit) => unit.isPlayerUnit)
      .map((unit) => publicUnit(unit, state, refillByUnitId, militaryByUnitId)),
    zombies: visibleEnemyUnits.map((unit) => publicUnit(unit, state, refillByUnitId, militaryByUnitId)),
    checkpoints: [...state.checkpoints]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((checkpoint) => {
        const role = checkpointRoleById.get(checkpoint.id) ?? 'abandoned';
        const branch = branchStatesById.get(checkpoint.branchId ?? checkpoint.direction);
        const containingUnit = checkpoint.infected > 0
          ? containingUnitAt(state, checkpoint.position.q, checkpoint.position.r)
          : undefined;
        const suppression = containingUnit ? forecastUnitSuppression(state, containingUnit) : null;
        return {
          id: checkpoint.id,
          branchId: checkpoint.branchId ?? checkpoint.direction,
          position: { ...checkpoint.position },
          direction: checkpoint.direction,
          vision: role === 'active' ? state.config.vision.operationalCheckpoint : 0,
          visionMode: 'ground' as const,
          terrainLosBlocking: true as const,
          status: checkpoint.status,
          role,
          waiting: checkpoint.waiting,
          screening: checkpoint.screening,
          approved: checkpoint.approved,
          queuePeople: checkpoint.waiting + checkpoint.screening + checkpoint.approved,
          screeningCapacity: state.config.refugees.screeningCapacity,
          estimatedScreeningThroughput: state.config.refugees.screeningCapacity / Math.max(
            1,
            state.config.refugees.policies[branch?.currentPolicy ?? 'normal'].turns,
          ),
          arrivalIntervalMin: state.config.refugees.arrivalIntervalMin,
          arrivalIntervalMax: state.config.refugees.arrivalIntervalMax,
          arrivalPeopleMin: state.config.refugees.arrivalPeopleMin,
          arrivalPeopleMax: state.config.refugees.arrivalPeopleMax,
          queuePressureClass: getQueuePressureClass(
            checkpoint.waiting + checkpoint.screening + checkpoint.approved,
            state.config.refugees.screeningCapacity,
          ),
          infected: checkpoint.infected,
          remainingTurns: checkpoint.remainingTurns,
          currentPolicy: branch?.currentPolicy ?? 'normal',
          currentPolicyTurns: state.config.refugees.policies[branch?.currentPolicy ?? 'normal'].turns,
          nextPolicy: checkpoint.screeningPolicy,
          nextArrivalTurn: checkpoint.nextArrivalTurn,
          providesSupply: role === 'active',
          infectionContained: checkpoint.infected > 0 && containingUnit !== undefined,
          containingUnitId: containingUnit?.id ?? null,
          projectedSuppression: suppression?.projectedSuppression ?? 0,
          projectedCivilianDamage: suppression?.projectedCivilianDamage ?? 0,
        };
      }),
    importantSiteEvents: importantSiteEvents(state),
    checkpointPositionCandidates: projectionCache.checkpointPositionCandidates ?? getCheckpointPositionCandidates(state),
    constructibleFacilityPositionCandidates: (['simpleFarm', 'civilianDroneBase'] as const)
      .flatMap((facilityType) => getConstructibleFacilityPositionCandidates(state, facilityType))
      .sort((left, right) =>
        left.facilityType.localeCompare(right.facilityType) ||
        left.position.q - right.position.q || left.position.r - right.position.r,
      ),
    roadBranches,
    supply: {
      initialRadius: supply.initialRadius,
      suppliedTileKeys: [...supply.suppliedTileKeys],
      branchRadii: supply.branchRadii.map((branch) => ({ ...branch })),
    },
    horde: {
      warningType: state.horde.warningType,
      warningDirections: [...state.horde.warningDirections],
      nextWaveIndex: state.horde.nextWaveIndex,
      nextWave: nextWave ? {
        index: state.horde.nextWaveIndex!,
        spawnTurn: nextWave.turn,
        directionCount: nextWave.directionCount,
        compositionPerDirection: cloneJson(nextWave.compositionPerDirection),
        final: nextWave.final,
      } : null,
      spawnTurn: publicSpawnTurn,
      finalHordeStatus: publicFinalHordeStatus,
      turnsRemaining: state.horde.turnsRemaining,
      nextSpawnTurn: state.horde.nextSpawnTurn,
    },
    victory,
    finalHordeDefeated: victory.finalHordeDefeated,
    suppliedAreaZombieClear: victory.suppliedAreaZombieClear,
    suppliedAreaInfectionClear: victory.suppliedAreaInfectionClear,
    endTurnForecast,
    strategicForecast: deriveStrategicForecast(state),
    gameOver: state.gameOver,
    result: publicResult(state.result),
  } satisfies AgentObservation as unknown as JsonValue) as unknown as AgentObservation;
}

/** Remove fixed topology from one Artifact Schema 4.0.0 trace entry. */
export function compactArtifactObservation(observation: AgentObservation): AgentArtifactObservation {
  const copy = cloneJson(observation);
  const { map, ...dynamic } = copy;
  return {
    ...dynamic,
    mapId: map.id,
    visibleTileKeys: map.tiles
      .filter((tile) => tile.visibleToPlayer)
      .map((tile) => `${tile.q},${tile.r}`)
      .sort(),
  };
}

/**
 * Recreate a complete public observation for replay comparison from its
 * fixed map and dynamic trace. Live Agent/Bridge observations are never
 * compacted, only artifacts are.
 */
export function restoreArtifactObservation(
  trace: AgentArtifactObservation,
  fixedMap: AgentMapObservation,
): AgentObservation {
  if (trace.mapId !== fixedMap.id) throw new Error('Artifact trace mapId does not match fixedMap.id');
  const visible = new Set(trace.visibleTileKeys);
  const facilityByPosition = new Map(trace.facilities.map((facility) => [hexKey(facility.position), facility.id] as const));
  const checkpointByPosition = new Map(trace.checkpoints.map((checkpoint) => [hexKey(checkpoint.position), checkpoint.id] as const));
  const terrainMovement = new Map<string, number | null>();
  const terrainDefense = new Map<string, { source: TerrainDefenseSource; multiplier: number }>();
  for (const tile of fixedMap.tiles) {
    if (!terrainMovement.has(tile.terrain) && !tile.road && !tile.urban) {
      terrainMovement.set(tile.terrain, tile.effectiveMovementCost);
    }
    if (!terrainDefense.has(tile.terrain) && !tile.urban) {
      terrainDefense.set(tile.terrain, { source: tile.terrainDefenseSource, multiplier: tile.terrainDamageMultiplier });
    }
  }
  const urbanMultiplier = fixedMap.tiles.find((tile) => tile.urban)?.terrainDamageMultiplier ?? 0.5;
  const map: AgentMapObservation = {
    ...cloneJson(fixedMap),
    tiles: fixedMap.tiles.map((tile) => {
      const key = `${tile.q},${tile.r}`;
      // `tile.facilityId` belongs to the immutable map's permanent Facility
      // definition. Constructible Facilities make a Hex urban but never
      // mutate that static ID, so retain it exactly as a live Observation
      // does while using the dynamic list only for the urban overlay.
      const dynamicFacilityId = facilityByPosition.get(key) ?? null;
      const facilityId = tile.facilityId;
      const checkpointId = checkpointByPosition.get(key) ?? null;
      const urban = facilityId !== null || dynamicFacilityId !== null || checkpointId !== null;
      const effectiveMovementCost = urban || tile.road
        ? 1
        : terrainMovement.get(tile.terrain) ?? tile.effectiveMovementCost;
      const defense = urban
        ? { source: 'urban' as const, multiplier: urbanMultiplier }
        : terrainDefense.get(tile.terrain) ?? { source: 'none' as const, multiplier: 1 };
      return {
        ...tile,
        urban,
        facilityId,
        checkpointId,
        passable: effectiveMovementCost !== null,
        effectiveMovementCost,
        terrainDefenseSource: defense.source,
        terrainDamageMultiplier: defense.multiplier,
        visibleToPlayer: visible.has(key),
      };
    }),
  };
  const { mapId: _mapId, visibleTileKeys: _visibleTileKeys, ...dynamic } = cloneJson(trace);
  return { ...dynamic, map } as AgentObservation;
}

export function createAgentResult(result: GameResult | null): AgentGameResult | null {
  return publicResult(result);
}
