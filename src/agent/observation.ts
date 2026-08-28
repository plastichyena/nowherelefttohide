import { forecastEndTurn } from '../core/engine';
import { isCityFacility, isProductionFacility } from '../core/state';
import {
  deriveSupplySnapshot,
  isHexSupplied,
} from '../core/supply';
import type { GameResult, GameState, JsonValue, UnitState } from '../core/types';
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

function publicUnit(unit: UnitState, state: Readonly<GameState>): AgentUnitObservation {
  const inSupply = isHexSupplied(state, unit.position);
  const recoveryAvailable = inSupply && unit.hp < unit.maxHp && unit.actionState === 'ready';
  return {
    id: unit.id,
    type: unit.type,
    position: { ...unit.position },
    hp: unit.hp,
    maxHp: unit.maxHp,
    attack: unit.attack,
    movement: unit.movement,
    range: unit.range,
    population: unit.population,
    actionState: unit.actionState,
    canAttack: unit.canAttack,
    canMove: unit.canMove,
    inSupply,
    recoveryAvailable,
    recoveryUnavailableReason: unit.hp >= unit.maxHp
      ? null
      : inSupply
        ? unit.actionState === 'ready' ? null : 'unit_already_acted'
        : 'unit_out_of_supply',
  };
}

/** Build the stable public-information view used by every v1.2 Agent. */
export function createAgentObservation(state: Readonly<GameState>): AgentObservation {
  const supply = deriveSupplySnapshot(state);
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
      return {
        id: facility.id,
        type: facility.type,
        position: { ...facility.position },
        owner: facility.owner,
        status: facility.status,
        operationalStatus: facility.operationalStatus,
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
      };
    });
  const orderedUnits = [...state.units].sort((left, right) => left.id.localeCompare(right.id));
  return cloneJson({
    apiVersion: OBSERVATION_API_VERSION,
    gameRulesVersion: state.gameVersion,
    turn: state.turn,
    maxTurns: state.maxTurns,
    phase: state.phase,
    map: {
      id: state.mapId,
      width: state.map.width,
      height: state.map.height,
      coordinateSystem: 'axial-q-r' as const,
      tiles: [...state.map.tiles]
        .sort((left, right) => left.q - right.q || left.r - right.r)
        .map((tile) => ({
          q: tile.q,
          r: tile.r,
          passable: tile.terrain === 'land' || tile.terrain === 'road',
          road: tile.road,
          facilityId: tile.facilityId,
          hordeEntranceDirections: [...tile.hordeEntranceDirections].sort(),
        })),
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
    zombies: orderedUnits.filter((unit) => !unit.isPlayerUnit).map((unit) => publicUnit(unit, state)),
    checkpoints: [...state.checkpoints]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((checkpoint) => ({
        id: checkpoint.id,
        branchId: checkpoint.branchId ?? checkpoint.direction,
        position: { ...checkpoint.position },
        direction: checkpoint.direction,
        status: checkpoint.status,
        waiting: checkpoint.waiting,
        screening: checkpoint.screening,
        approved: checkpoint.approved,
        infected: checkpoint.infected,
        remainingTurns: checkpoint.remainingTurns,
        currentPolicy: checkpoint.currentPolicy,
        nextPolicy: checkpoint.screeningPolicy,
        nextArrivalTurn: checkpoint.nextArrivalTurn,
      })),
    roadBranches,
    supply: {
      initialRadius: supply.initialRadius,
      suppliedTileKeys: [...supply.suppliedTileKeys],
      branchRadii: supply.branchRadii.map((branch) => ({ ...branch })),
    },
    horde: {
      direction: state.horde.nextDirection,
      turnsRemaining: state.horde.turnsRemaining,
      nextSpawnTurn: state.horde.nextSpawnTurn,
    },
    endTurnForecast: forecastEndTurn(state),
    gameOver: state.gameOver,
    result: publicResult(state.result),
  } satisfies AgentObservation as unknown as JsonValue) as unknown as AgentObservation;
}

export function createAgentResult(result: GameResult | null): AgentGameResult | null {
  return publicResult(result);
}
