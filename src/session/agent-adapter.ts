import { execFileSync } from 'node:child_process';
import type { GameState, JsonValue } from '../core/types';
import { DEFAULT_MAP_ID } from '../core/config';
import { SAVE_FORMAT_VERSION as NUMERIC_SAVE_FORMAT_VERSION } from '../persistence/save';
import { createAgentGame } from '../agent/game';
import {
  AGENT_API_VERSION,
  APP_VERSION,
  ARTIFACT_SCHEMA_VERSION,
  BRIDGE_API_VERSION,
  GAME_RULES_VERSION,
  OBSERVATION_API_VERSION,
  type AgentGame,
} from '../agent/types';
import type {
  SessionGameFactory,
  SessionGameRuntime,
  SessionStepInput,
  SessionVersionIdentity,
} from './types';
import { SessionError } from './types';

type SessionCapableAgentGame = AgentGame & {
  exportPrivateSessionState(): GameState;
  restorePrivateSessionState(snapshot: GameState, options?: { agentId?: string }): unknown;
};

function adapt(game: SessionCapableAgentGame): SessionGameRuntime {
  return {
    getObservation: () => game.getObservation(),
    getLegalActions: () => game.getLegalActions(),
    // Session owns decisionSummary validation and persistence. GameEngine still
    // receives exactly one existing GameAction through AgentGame.
    step: (input: SessionStepInput) => game.step(input.action),
    isGameOver: () => game.isGameOver(),
    getResult: () => game.getResult(),
    getRunArtifact: () => game.getRunArtifact(),
    exportPrivateState: () => game.exportPrivateSessionState() as unknown as JsonValue,
  };
}

export function createAgentSessionGameFactory(buildId: string): SessionGameFactory {
  return {
    createNew: ({ seed, agentId }) => {
      const game = createAgentGame({ buildId }) as SessionCapableAgentGame;
      game.reset({ seed, agent: { id: agentId } });
      return adapt(game);
    },
    restore: ({ privateState, agentId }) => {
      const game = createAgentGame({ buildId }) as SessionCapableAgentGame;
      if (typeof game.restorePrivateSessionState !== 'function' || typeof game.exportPrivateSessionState !== 'function') {
        throw new SessionError('session_integration_unavailable', 'AgentGameAdapter does not provide Private Session persistence hooks');
      }
      game.restorePrivateSessionState(privateState as unknown as GameState, { agentId });
      return adapt(game);
    },
  };
}

function gitCommit(): string | null {
  try {
    const value = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    return /^[0-9a-f]{40}$/u.test(value) ? value : null;
  } catch {
    return null;
  }
}

function gitDirty(): boolean {
  try {
    execFileSync('git', ['diff', '--quiet', '--ignore-submodules', 'HEAD'], { stdio: 'ignore' });
    return false;
  } catch {
    return true;
  }
}

export function resolveSessionIdentity(environment: NodeJS.ProcessEnv = process.env): SessionVersionIdentity {
  const commit = environment.NLTH_GIT_COMMIT?.trim() || gitCommit() || 'local-unknown';
  const buildId = environment.NLTH_BUILD_ID?.trim() || (commit === 'local-unknown' ? commit : `${commit}${gitDirty() ? '-dirty' : ''}`);
  return {
    appVersion: APP_VERSION,
    gameRulesVersion: GAME_RULES_VERSION,
    saveFormatVersion: NUMERIC_SAVE_FORMAT_VERSION,
    artifactSchemaVersion: ARTIFACT_SCHEMA_VERSION,
    agentApiVersion: AGENT_API_VERSION,
    observationApiVersion: OBSERVATION_API_VERSION,
    bridgeApiVersion: BRIDGE_API_VERSION,
    buildId,
    gitCommit: commit,
    mapId: DEFAULT_MAP_ID,
  };
}
