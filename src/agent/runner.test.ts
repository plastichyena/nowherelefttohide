import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from '../core/config';
import type { AgentGame } from './types';
import { createAgentGame } from './game';
import { BalancedAgent, RandomAgent, replayArtifact, runAgentGame } from './runner';
import { APP_VERSION, ARTIFACT_SCHEMA_VERSION, AGENT_API_VERSION, OBSERVATION_API_VERSION, BRIDGE_API_VERSION } from './types';

describe('unified Agent Runner', () => {
  it('runs a deterministic random game and records a replay artifact', () => {
    const config = createDefaultConfig({ maxTurns: 3, maxActionsPerTurn: 4 });
    const first = runAgentGame(11, { strategy: 'random', config, limits: { maxTurns: 8, maxDecisionsPerTurn: 4, maxDecisionsPerGame: 100 } });
    const second = runAgentGame(11, { strategy: 'random', config, limits: { maxTurns: 8, maxDecisionsPerTurn: 4, maxDecisionsPerGame: 100 } });
    expect(first.technicalFailure).toBe(false);
    expect(first.actions).toEqual(second.actions);
    expect(first.artifact.artifactType).toBe('replay');
    expect(first.artifact.artifactSchemaVersion).toBe(ARTIFACT_SCHEMA_VERSION);
    expect(first.artifact.appVersion).toBe(APP_VERSION);
    expect(first.artifact.agentApiVersion).toBe(AGENT_API_VERSION);
    expect(first.artifact.observationApiVersion).toBe(OBSERVATION_API_VERSION);
    expect(first.artifact.bridgeApiVersion).toBe(BRIDGE_API_VERSION);
    expect(first.artifact.initialRoadArrivalSchedule).toHaveLength(4);
    expect(first.artifact.observationTrace).toHaveLength(first.actions.length + 1);
    const replay = replayArtifact(first.artifact);
    expect(replay.reproduced).toBe(true);
    expect(replay.mismatch).toBeNull();
    expect(replay.actionsReplayed).toBe(first.actions.length);
  });

  it('rejects v1.2.5 artifacts before creating a v1.2.6 replay session', () => {
    const config = createDefaultConfig({ maxTurns: 1 });
    const run = runAgentGame(2, { strategy: 'random', config, limits: { maxTurns: 2, maxDecisionsPerTurn: 1, maxDecisionsPerGame: 3 } });
    const oldArtifact = {
      ...run.artifact,
      appVersion: '1.2.5',
      gameRulesVersion: '1.2.0',
      artifactSchemaVersion: '1.1.0',
      agentApiVersion: '1.1.0',
      observationApiVersion: '1.1.0',
      bridgeApiVersion: '1.1.0',
    };
    const replay = replayArtifact(oldArtifact);
    expect(replay.reproduced).toBe(false);
    expect(replay.error?.code).toBe('artifact_version_unsupported');
    expect(replay.actionsReplayed).toBe(0);
    expect(replay.observation).toBeNull();
  });

  it('forces EndTurn at the runner per-turn limit for agents without traces', () => {
    const config = createDefaultConfig({ maxTurns: 2, maxActionsPerTurn: 100 });
    const run = runAgentGame(12, {
      config,
      agent: new RandomAgent(12),
      limits: { maxTurns: 4, maxDecisionsPerTurn: 1, maxDecisionsPerGame: 20 },
    });
    expect(run.technicalFailure).toBe(false);
    expect(run.actions.filter((action) => action.type === 'EndTurn').length).toBeGreaterThan(0);
  });

  it('uses Observation only in the Balanced Agent decision contract', () => {
    const agent = new BalancedAgent();
    const observation = createAgentGame().reset({ seed: 1 });
    const action = { type: 'EndTurn' } as const;
    expect(agent.decide(observation, [action]).action).toEqual(action);
  });

  it('captures a debug state on technical failure without exposing it to the Agent', () => {
    let state = { value: 0 };
    const initialObservation = createAgentGame().reset({ seed: 1 });
    const game: AgentGame = {
      getApiInfo: () => createAgentGame().getApiInfo(),
      reset: () => initialObservation,
      getObservation: () => initialObservation,
      getLegalActions: () => [{ type: 'EndTurn' }],
      step: () => { state.value = 1; throw new Error('boom'); },
      isGameOver: () => false,
      getResult: () => null,
      getRunArtifact: () => ({}) as never,
    };
    const run = runAgentGame(1, {
      gameFactory: () => game,
      agent: { id: 'fake', version: '1.0.0', decide: () => ({ action: { type: 'EndTurn' } }) },
      config: createDefaultConfig({ maxTurns: 1 }),
      debugSnapshot: () => ({ value: state.value }),
      limits: { maxTurns: 2, maxDecisionsPerTurn: 2, maxDecisionsPerGame: 2 },
    });
    expect(run.technicalFailure).toBe(true);
    expect(run.failure?.code).toBe('STEP_THREW');
    expect(run.failure?.stateBeforeFailure).toEqual({ value: 0 });
    expect(run.failure?.stateAfterFailure).toEqual({ value: 1 });
  });
});
