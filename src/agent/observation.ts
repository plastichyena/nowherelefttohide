import {
  deriveVictoryProgress,
  effectiveRange,
  forecastEndTurn,
  forecastFacilityProduction,
  forecastUnitSuppression,
} from '../core/engine';
import { deriveUnitRecovery } from '../core/recovery';
import { hexKey } from '../core/hex';
import { getTile } from '../core/map';
import { isCityFacility, isProductionFacility } from '../core/state';
import {
  deriveSupplySnapshot,
  isHexSupplied,
} from '../core/supply';
import { effectiveMovementCost, isUrbanHex, terrainDefenseAt } from '../core/terrain';
import { getPlayerVisibleTileKeys } from '../core/visibility';
import type {
  GameResult,
  GameState,
  HexTile,
  JsonValue,
  ResourceType,
  TerrainDefenseSource,
  UnitState,
} from '../core/types';
import {
  OBSERVATION_API_VERSION,
  type AgentGameResult,
  type AgentObservation,
  type AgentUnitObservation,
} from './types';

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function publicResult(result: GameResult | null): AgentGameResult | null {
  return result ? cloneJson(result) : null;
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

function publicUnit(unit: UnitState, state: Readonly<GameState>): AgentUnitObservation {
  const inSupply = isHexSupplied(state, unit.position);
  const suppression = forecastUnitSuppression(state, unit);
  const recovery = unit.isPlayerUnit
    ? deriveUnitRecovery(state, unit, { projectedSuppression: suppression !== null })
    : null;
  const currentRange = effectiveRange(state, unit);
  const positionTile = tileAt(state, unit.position);
  const defense = terrainDefenseAt(state, unit);
  return {
    id: unit.id,
    type: unit.type,
    unitType: unit.type,
    position: { ...unit.position },
    vision: unit.vision,
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
    rangeModifierReason: unit.type === 'nationalGuard' && currentRange < unit.range
      ? 'military_supply_shortage'
      : null,
    population: unit.population,
    actionState: unit.actionState,
    canAttack: unit.canAttack,
    canMove: unit.canMove,
    inSupply,
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
    suppressionAvailableIfTurnEndsNow: suppression !== null,
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

/** Build the stable public-information view used by every v1.4 Agent. */
export function createAgentObservation(state: Readonly<GameState>): AgentObservation {
  const supply = deriveSupplySnapshot(state);
  const visibleTileKeys = getPlayerVisibleTileKeys(state);
  const productionByFacility = new Map(
    forecastFacilityProduction(state).map((projection) => [projection.facilityId, projection]),
  );
  const roadBranches = [...state.map.roadBranches]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((definition) => {
      const branchState = state.roadBranches.find((candidate) => candidate.branchId === definition.id);
      const activeCheckpoint = branchState?.activeCheckpointId
        ? state.checkpoints.find((checkpoint) => checkpoint.id === branchState.activeCheckpointId)
        : state.checkpoints.find(
          (checkpoint) => checkpoint.status === 'operational' && (checkpoint.branchId ?? checkpoint.direction) === definition.id,
        );
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
        checkpointActionsThisTurn: branchState?.checkpointActionsThisTurn ?? 0,
        checkpointActionAvailable: (branchState?.checkpointActionsThisTurn ?? 0) < 1,
      };
    });
  const facilities = [...state.facilities]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((facility) => {
      const inSupply = isHexSupplied(state, facility.position);
      const populationOperational =
        facility.owner === 'player' &&
        facility.status === 'owned' &&
        facility.infected === 0 &&
        facility.populationOperationalTurn <= state.turn;
      let populationUnavailableReason: string | null = null;
      if (facility.owner !== 'player') populationUnavailableReason = 'not_owned';
      else if (facility.status !== 'owned') populationUnavailableReason = 'facility_ruined';
      else if (facility.infected > 0) populationUnavailableReason = 'facility_infected';
      else if (facility.populationOperationalTurn > state.turn) populationUnavailableReason = 'available_next_turn';
      const assignable =
        isProductionFacility(facility) &&
        facility.owner === 'player' &&
        facility.status === 'owned' &&
        facility.infected === 0 &&
        facility.populationOperationalTurn <= state.turn;
      const populationIncreaseAvailable = assignable && inSupply && state.population.cityResidents > 0;
      const populationDecreaseAvailable = assignable && facility.workers > 0;
      const recruitmentAvailable =
        isCityFacility(facility) &&
        facility.owner === 'player' &&
        facility.status === 'owned' &&
        facility.infected === 0 &&
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
        vision: facility.owner === 'player' && facility.status !== 'ruined'
          ? facility.type === 'capital'
            ? state.config.checkpoint.initialSupplyRadius
            : state.config.vision.ownedFacility
          : 0,
        healthyPopulation: facility.workers,
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
          requiredPowerCapacity: rule.powerCapacity,
          powerGenerationPerWorker: rule.powerGeneration,
          powerMode: rule.powerMode,
          powerDemand: rule.powerCapacity,
          powerSupplyEnabled: facility.powerSupplyEnabled,
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
  // Before a spawn this is the warned future turn. Once the Final Horde has
  // spawned, nextSpawnTurn is null, so retain the actual public spawn turn.
  const publicSpawnTurn = state.horde.warningType === 'none'
    ? state.horde.lastSpawnTurn
    : state.horde.nextSpawnTurn;
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
          };
        }),
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
    units: orderedUnits.filter((unit) => unit.isPlayerUnit).map((unit) => publicUnit(unit, state)),
    zombies: visibleEnemyUnits.map((unit) => publicUnit(unit, state)),
    checkpoints: [...state.checkpoints]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((checkpoint) => {
        const containingUnit = checkpoint.infected > 0
          ? containingUnitAt(state, checkpoint.position.q, checkpoint.position.r)
          : undefined;
        const suppression = containingUnit ? forecastUnitSuppression(state, containingUnit) : null;
        return {
          id: checkpoint.id,
          branchId: checkpoint.branchId ?? checkpoint.direction,
          position: { ...checkpoint.position },
          direction: checkpoint.direction,
          vision: checkpoint.status === 'operational' ? state.config.vision.operationalCheckpoint : 0,
          status: checkpoint.status,
          waiting: checkpoint.waiting,
          screening: checkpoint.screening,
          approved: checkpoint.approved,
          infected: checkpoint.infected,
          remainingTurns: checkpoint.remainingTurns,
          currentPolicy: checkpoint.currentPolicy,
          nextPolicy: checkpoint.screeningPolicy,
          nextArrivalTurn: checkpoint.nextArrivalTurn,
          providesSupply: checkpoint.status === 'operational',
          infectionContained: checkpoint.infected > 0 && containingUnit !== undefined,
          containingUnitId: containingUnit?.id ?? null,
          projectedSuppression: suppression?.projectedSuppression ?? 0,
          projectedCivilianDamage: suppression?.projectedCivilianDamage ?? 0,
        };
      }),
    roadBranches,
    supply: {
      initialRadius: supply.initialRadius,
      suppliedTileKeys: [...supply.suppliedTileKeys],
      branchRadii: supply.branchRadii.map((branch) => ({ ...branch })),
    },
    horde: {
      warningType: state.horde.warningType,
      warningDirection: state.horde.nextDirection,
      spawnTurn: publicSpawnTurn,
      finalHordeStatus: publicFinalHordeStatus,
      direction: state.horde.nextDirection,
      turnsRemaining: state.horde.turnsRemaining,
      nextSpawnTurn: state.horde.nextSpawnTurn,
    },
    victory,
    finalHordeDefeated: victory.finalHordeDefeated,
    suppliedAreaZombieClear: victory.suppliedAreaZombieClear,
    suppliedAreaInfectionClear: victory.suppliedAreaInfectionClear,
    endTurnForecast: forecastEndTurn(state),
    gameOver: state.gameOver,
    result: publicResult(state.result),
  } satisfies AgentObservation as unknown as JsonValue) as unknown as AgentObservation;
}

export function createAgentResult(result: GameResult | null): AgentGameResult | null {
  return publicResult(result);
}
