import {
  deriveVictoryProgress,
  forecastEndTurn,
  forecastFacilityProduction,
  forecastUnitRefills,
  getConstructibleFacilityPositionCandidates,
  getCheckpointPositionCandidates,
} from '../core/engine';
import { deriveStrategicForecast } from '../core/forecast';
import { hexKey } from '../core/hex';
import {
  deriveCheckpointRole,
  deriveSupplySnapshot,
} from '../core/supply';
import { effectiveMovementCost, isUrbanHex } from '../core/terrain';
import { getPlayerVisibleTileKeys } from '../core/visibility';
import { deriveCrisisSummary as deriveCoreCrisisSummary, deriveEndTurnRisk as deriveCoreEndTurnRisk } from '../core/crisis';
import { withReadOnlyQueryScope } from '../core/query-cache';
import {
  createPublicCheckpointProjection,
  createPublicFacilityProjection,
  createPublicUnitProjection,
} from '../core/public-entities';
import type {
  GameResult,
  GameState,
  HexTile,
  JsonValue,
  TerrainDefenseSource,
  UnitType,
} from '../core/types';
import {
  HIDDEN_NOISE_METRIC_KEYS,
  HIDDEN_REJECTED_REFUGEE_METRIC_KEYS,
  OBSERVATION_API_VERSION,
  type AgentGameResult,
  type AgentArtifactObservation,
  type AgentMapObservation,
  type AgentObservation,
  type AgentPublicEvent,
  type CrisisSummary,
  type EndTurnRisk,
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
  for (const key of HIDDEN_REJECTED_REFUGEE_METRIC_KEYS) delete statistics[key];
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

function samePosition(left: { q: number; r: number }, right: { q: number; r: number }): boolean {
  return left.q === right.q && left.r === right.r;
}

function finiteNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
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

/**
 * Immutable Core projections supplied by the Adapter for the current state.
 * This keeps the standalone Observation factory fully self-contained while
 * allowing the state-changing boundary to reuse projections whose inputs did
 * not change between non-checkpoint actions.
 */
export interface AgentObservationProjectionCache {
  checkpointPositionCandidates?: ReturnType<typeof getCheckpointPositionCandidates>;
}

type PublicCheckpoint = AgentObservation['checkpoints'][number];

function publicCrisisSummary(state: Readonly<GameState>): CrisisSummary {
  const alerts = deriveCoreCrisisSummary(state);
  return {
    alerts,
    criticalCount: alerts.filter((entry) => entry.severity === 'critical').length,
    warningCount: alerts.filter((entry) => entry.severity === 'warning').length,
    advisoryCount: alerts.filter((entry) => entry.severity === 'advisory').length,
  };
}

function publicEndTurnRisk(state: Readonly<GameState>): EndTurnRisk {
  const risk = deriveCoreEndTurnRisk(state);
  // Keep this Projection byte-for-byte compatible with Core. The Adapter may
  // clone the value at its boundary, but field renaming or ID reduction here
  // would make Human UI and Agent callers observe different risk semantics.
  return cloneJson(risk) as unknown as EndTurnRisk;
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
  return withReadOnlyQueryScope(state, () => createAgentObservationInScope(state, projectionCache));
}

function createAgentObservationInScope(
  state: Readonly<GameState>,
  projectionCache: AgentObservationProjectionCache,
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
      const nextArrivalTurn = branchState?.nextArrivalTurn ?? null;
      return {
        branchId: definition.id,
        direction: definition.direction,
        capitalConnection: { ...definition.capitalConnection },
        roadTiles: definition.roadTiles.map((position) => ({ ...position })),
        entrance: { ...definition.entrance },
        nextArrivalTurn,
        turnsUntilArrival: nextArrivalTurn === null ? null : Math.max(0, nextArrivalTurn - state.turn),
        arrivalsEnded: state.horde.finalHordeStatus !== 'notStarted',
        checkpointBuildCost: branchState?.hasBuiltCheckpoint
          ? state.config.checkpoint.subsequentConstructionCivilianGoods
          : state.config.checkpoint.constructionCivilianGoods,
        checkpointRelocateCost: state.config.checkpoint.relocationCivilianGoods,
        rejectionMayStrengthenFutureHorde: true as const,
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
  const entityProjectionContext = {
    visibleTileKeys,
    refillByUnitId,
    militaryByUnitId,
    productionByFacility,
  };
  const facilities = [...state.facilities]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((facility) => createPublicFacilityProjection(facility, state, entityProjectionContext));

  const orderedUnits = [...state.units].sort((left, right) => left.id.localeCompare(right.id));
  const visibleEnemyUnits = orderedUnits.filter(
    (unit) => !unit.isPlayerUnit && visibleTileKeys.has(hexKey(unit.position)),
  );
  const units = orderedUnits
    .filter((unit) => unit.isPlayerUnit)
    .map((unit) => createPublicUnitProjection(unit, state, entityProjectionContext));
  const zombies = visibleEnemyUnits.map((unit) => createPublicUnitProjection(unit, state, entityProjectionContext));
  const checkpoints: PublicCheckpoint[] = [...state.checkpoints]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((checkpoint) => createPublicCheckpointProjection(checkpoint, state));

  const victory = deriveVictoryProgress(state);
  const publicFinalHordeStatus = victory.finalHordeDefeated
    ? 'defeated' as const
    : state.horde.finalHordeStatus;
  const nextWave = state.horde.nextWaveIndex === null
    ? null
    : state.config.horde.waves[state.horde.nextWaveIndex - 1] ?? null;
  const nextWaveRecord = nextWave as unknown as Record<string, unknown> | null;
  const compositionRecord = (nextWaveRecord?.compositionPerDirection && typeof nextWaveRecord.compositionPerDirection === 'object'
    ? nextWaveRecord.compositionPerDirection
    : {}) as Record<string, unknown>;
  const nonHordeSlotCountPerDirection = Math.max(0, Math.floor(finiteNumber(
    nextWaveRecord?.nonHordeSlotCountPerDirection ?? nextWaveRecord?.nonHordeSlotsPerDirection ?? compositionRecord.zombie,
    0,
  )));
  const possibleNonHordeTypes = Array.isArray(nextWaveRecord?.possibleNonHordeTypes)
    ? nextWaveRecord!.possibleNonHordeTypes.filter((value): value is UnitType => typeof value === 'string')
    : ['zombie', 'policeZombie', 'soldierZombie', 'riotZombie', 'hunterZombie'].filter((value) => value in state.config.units) as UnitType[];
  // The schedule turn is public even before a warning starts. The selected
  // directions remain private until the warning event/observation is active.
  const publicSpawnTurn = nextWave?.turn ?? state.horde.lastSpawnTurn;
  const strategicForecast = deriveStrategicForecast(state);
  // Crisis and EndTurn projections are owned by Core so Human UI and every
  // Agent boundary consume exactly the same pure public calculation.
  const crisisSummary = publicCrisisSummary(state);
  const endTurnRisk = publicEndTurnRisk(state);
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
    units,
    zombies,
    checkpoints,
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
        nonHordeSlotCountPerDirection,
        possibleNonHordeTypes,
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
    crisisSummary,
    endTurnRisk,
    endTurnForecast,
    strategicForecast,
    gameOver: state.gameOver,
    result: publicResult(state.result),
  } satisfies AgentObservation as unknown as JsonValue) as unknown as AgentObservation;
}

/** Remove fixed topology from one Artifact Schema 6.0.0 trace entry. */
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
