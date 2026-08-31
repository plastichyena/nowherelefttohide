import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from '../core/config';
import type { AgentGame } from './types';
import { createAgentGame } from './game';
import { BalancedAgent, RandomAgent, replayArtifact, runAgentGame } from './runner';
import { APP_VERSION, ARTIFACT_SCHEMA_VERSION, AGENT_API_VERSION, OBSERVATION_API_VERSION, BRIDGE_API_VERSION } from './types';

describe('unified Agent Runner', () => {
  it('runs a deterministic random game and records a replay artifact', () => {
    const config = createDefaultConfig({ finalHordeTurn: 3, maxActionsPerTurn: 4 });
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
    expect(first.artifact.config.finalHordeTurn).toBe(3);
    expect(first.artifact.observationTrace?.[0]?.map.tiles.some((tile) => tile.terrain === 'forest')).toBe(true);
    expect(first.artifact.observationTrace?.[0]?.checkpointPositionCandidates).toHaveLength(28);
    expect(first.artifact.observationTrace?.some((observation) => observation.horde.finalHordeStatus !== 'notStarted')).toBe(true);
    expect(first.artifact.initialRoadArrivalSchedule).toHaveLength(4);
    expect(first.artifact.observationTrace).toHaveLength(first.actions.length + 1);
    const fullHordeEvent = first.artifact.verificationEvents?.find((event) => (
      event.type === 'horde_spawned' && Array.isArray(event.payload.units)
    ));
    expect(fullHordeEvent?.payload).toMatchObject({
      spawnGroupId: expect.any(String),
      hordeZombieCount: expect.any(Number),
      normalZombieCount: expect.any(Number),
      units: expect.arrayContaining([
        expect.objectContaining({ unitId: expect.any(String), unitType: expect.any(String), spawnGroupId: expect.any(String) }),
      ]),
    });
    const replay = replayArtifact(first.artifact);
    expect(replay.reproduced).toBe(true);
    expect(replay.mismatch).toBeNull();
    expect(replay.actionsReplayed).toBe(first.actions.length);
    const corruptedVerificationEvents = first.artifact.verificationEvents?.map((event) => (
      event === fullHordeEvent
        ? { ...event, payload: { ...event.payload, hordeZombieCount: 999 } }
        : event
    ));
    const corruptedReplay = replayArtifact({ ...first.artifact, verificationEvents: corruptedVerificationEvents });
    expect(corruptedReplay.reproduced).toBe(false);
    expect(corruptedReplay.mismatch).toBe('Replay internal verification events differ from the artifact');
    const previousAppReplay = replayArtifact({ ...first.artifact, appVersion: '1.3.1' });
    expect(previousAppReplay.reproduced).toBe(true);
    expect(previousAppReplay.error).toBeNull();
    const missingAppMetadataReplay = replayArtifact({ ...first.artifact, appVersion: '' });
    expect(missingAppMetadataReplay.reproduced).toBe(false);
    expect(missingAppMetadataReplay.error?.code).toBe('artifact_invalid');
  }, 30_000);

  it('rejects v1.3 and earlier artifacts before creating a v1.4 replay session', () => {
    const config = createDefaultConfig({ finalHordeTurn: 1 });
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
    const v126Replay = replayArtifact({
      ...run.artifact,
      appVersion: '1.2.6',
      gameRulesVersion: '1.2.1',
      artifactSchemaVersion: '1.2.0',
      agentApiVersion: '1.2.0',
      observationApiVersion: '1.2.0',
      bridgeApiVersion: '1.2.0',
    });
    expect(v126Replay).toMatchObject({ reproduced: false, actionsReplayed: 0, error: { code: 'artifact_version_unsupported' } });
    const v13Replay = replayArtifact({
      ...run.artifact,
      appVersion: '1.3.0',
      gameRulesVersion: '1.3.0',
      artifactSchemaVersion: '1.3.0',
      agentApiVersion: '1.3.0',
      observationApiVersion: '1.3.0',
      bridgeApiVersion: '1.3.0',
    });
    expect(v13Replay).toMatchObject({ reproduced: false, actionsReplayed: 0, error: { code: 'artifact_version_unsupported' } });
  });

  it('forces EndTurn at the runner per-turn limit for agents without traces', () => {
    const config = createDefaultConfig({ finalHordeTurn: 30, maxActionsPerTurn: 100, economy: { initialZombieCount: 0 } });
    const run = runAgentGame(12, {
      config,
      agent: new RandomAgent(12),
      limits: { maxTurns: 1, maxDecisionsPerTurn: 1, maxDecisionsPerGame: 100 },
    });
    expect(run.technicalFailure).toBe(true);
    expect(run.failure?.code).toBe('TURN_SAFETY_LIMIT');
    expect(run.actions.filter((action) => action.type === 'EndTurn').length).toBeGreaterThan(0);
  });

  it('keeps the default runner turn safety limit at 100 when the Final Horde is later', () => {
    const initial = createAgentGame().reset({ seed: 1 });
    const overRunnerLimit = { ...initial, turn: 101, finalHordeTurn: 250 };
    const game: AgentGame = {
      getApiInfo: () => createAgentGame().getApiInfo(),
      reset: () => overRunnerLimit,
      getObservation: () => overRunnerLimit,
      getLegalActions: () => [{ type: 'EndTurn' }],
      step: () => { throw new Error('must not step after the runner turn limit'); },
      isGameOver: () => false,
      getResult: () => null,
      getRunArtifact: () => ({}) as never,
    };
    const run = runAgentGame(1, {
      config: createDefaultConfig({ finalHordeTurn: 250 }),
      agent: { id: 'fake', version: '1.0.0', decide: () => ({ action: { type: 'EndTurn' } }) },
      gameFactory: () => game,
    });
    expect(run.technicalFailure).toBe(true);
    expect(run.failure?.code).toBe('TURN_SAFETY_LIMIT');
    expect(run.failure?.message).toContain('(100)');
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
      config: createDefaultConfig({ finalHordeTurn: 1 }),
      debugSnapshot: () => ({ value: state.value }),
      limits: { maxTurns: 2, maxDecisionsPerTurn: 2, maxDecisionsPerGame: 2 },
    });
    expect(run.technicalFailure).toBe(true);
    expect(run.failure?.code).toBe('STEP_THREW');
    expect(run.failure?.stateBeforeFailure).toEqual({ value: 0 });
    expect(run.failure?.stateAfterFailure).toEqual({ value: 1 });
  });
});
