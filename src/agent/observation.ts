import { forecastEndTurn } from '../core/engine';
import { isCityFacility } from '../core/state';
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

function publicUnit(unit: UnitState): AgentUnitObservation {
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
  };
}

/** Build the stable public-information view used by every v1.2 Agent. */
export function createAgentObservation(state: Readonly<GameState>): AgentObservation {
  const facilities = [...state.facilities]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map((facility) => {
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
    units: orderedUnits.filter((unit) => unit.isPlayerUnit).map(publicUnit),
    zombies: orderedUnits.filter((unit) => !unit.isPlayerUnit).map(publicUnit),
    checkpoints: [...state.checkpoints]
      .sort((left, right) => left.id.localeCompare(right.id))
      .map((checkpoint) => ({
        id: checkpoint.id,
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
      })),
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

