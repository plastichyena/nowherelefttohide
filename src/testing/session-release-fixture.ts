import { createAgentGame } from '../agent/game';
import type { AgentGame } from '../agent/types';
import { createDefaultConfig } from '../core/config';
import { hexKey } from '../core/hex';
import { isHordeSpawnReserve } from '../core/map';
import { createUnit, populationLedgerTotal, synchronizePopulation } from '../core/state';
import type { DeepPartial, GameConfig, GameState, HexCoord, JsonValue, UnitType } from '../core/types';
import type { SessionGameFactory, SessionGameRuntime } from '../session/types';

interface SessionCapableAgentGame extends AgentGame {
  exportPrivateSessionState(): GameState;
  restorePrivateSessionState(snapshot: GameState, options?: { agentId?: string }): unknown;
}

const INITIAL_HUMAN_TYPES: readonly UnitType[] = ['police', 'nationalGuard', 'riotPolice'];

/**
 * Quiet, valid Core configuration for the Session release fixture. The Final
 * Wave remains in the actual rules/config but is scheduled outside this long
 * controlled window; all 1,000+ actions still flow through GameEngine.
 */
export function createSessionReleaseConfig(): GameConfig {
  return createDefaultConfig({
    maxActionsPerTurn: 100,
    economy: {
      initialZombieCount: 0,
      initialHunterCount: { min: 0, max: 0 },
      initialResources: { food: 1_000_000, civilianGoods: 1_000_000, militaryGoods: 1_000_000, fuel: 1_000_000 },
    },
    refugees: { arrivalIntervalMin: 1_000_000, arrivalIntervalMax: 1_000_000 },
    units: {
      police: { movement: 1, vision: 1 },
      nationalGuard: { movement: 1, vision: 1 },
      riotPolice: { movement: 1, vision: 1 },
    },
    horde: {
      waves: [{ turn: 1_000_000, directionCount: 1, compositionPerDirection: { hordeZombie: 1, zombie: 0 }, final: true }],
    },
  } satisfies DeepPartial<GameConfig>);
}

function availablePlayerPositions(state: GameState): HexCoord[] {
  const occupied = new Set([
    ...state.units.map((unit) => hexKey(unit.position)),
    ...state.facilities.map((facility) => hexKey(facility.position)),
    ...state.checkpoints.map((checkpoint) => hexKey(checkpoint.position)),
  ]);
  return state.map.tiles
    .filter((tile) => tile.movementCost !== null && tile.playerOccupancyAllowed && !isHordeSpawnReserve(state.map, tile) && !occupied.has(hexKey(tile)))
    .sort((left, right) => left.q - right.q || left.r - right.r)
    .map((tile) => ({ q: tile.q, r: tile.r }));
}

/** Adds actual Core human units, then restores through LoadSnapshot validation. */
function prepareReleaseState(game: SessionCapableAgentGame, agentId: string): void {
  const state = game.exportPrivateSessionState();
  const positions = availablePlayerPositions(state);
  const requiredAdditionalUnits = 19;
  if (positions.length < requiredAdditionalUnits) throw new Error('Release fixture has insufficient legal positions for 21 human units');
  for (let index = 0; index < requiredAdditionalUnits; index += 1) {
    const type = INITIAL_HUMAN_TYPES[index % INITIAL_HUMAN_TYPES.length]!;
    state.units.push(createUnit(state, `release-fixture-${type}-${index + 1}`, type, positions[index]!));
  }
  state.nextUnitNumber += requiredAdditionalUnits;
  synchronizePopulation(state);
  state.population.initialPopulation = populationLedgerTotal(state);
  game.restorePrivateSessionState(state, { agentId });
}

function adapt(game: SessionCapableAgentGame): SessionGameRuntime {
  return {
    getApiInfo: () => game.getApiInfo(),
    getObservation: () => game.getObservation(),
    getLegalActions: () => game.getLegalActions(),
    step: (input) => game.step(input.action),
    isGameOver: () => game.isGameOver(),
    getResult: () => game.getResult(),
    getRunArtifact: () => game.getRunArtifact(),
    exportPrivateState: () => game.exportPrivateSessionState() as unknown as JsonValue,
  };
}

function createPreparedGame(seed: number, agentId: string, buildId: string): SessionCapableAgentGame {
  const game = createAgentGame({ buildId, recordHistory: false }) as SessionCapableAgentGame;
  game.reset({ seed, agent: { id: agentId }, configOverrides: createSessionReleaseConfig() });
  prepareReleaseState(game, agentId);
  return game;
}

/**
 * Uses AgentGameAdapter and GameEngine for all state transitions. This fixture
 * deliberately does not emulate actions, observations, or persistence.
 */
export function createSessionReleaseFixtureFactory(buildId: string): SessionGameFactory {
  return {
    createNew: ({ seed, agentId }) => adapt(createPreparedGame(seed, agentId, buildId)),
    restore: ({ privateState, agentId }) => {
      const game = createAgentGame({ buildId, recordHistory: false }) as SessionCapableAgentGame;
      game.restorePrivateSessionState(privateState as unknown as GameState, { agentId });
      return adapt(game);
    },
  };
}