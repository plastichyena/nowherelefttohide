import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from '../core/config';
import type { AgentGame } from './types';
import { createAgentGame } from './game';
import { BalancedAgent, RandomAgent, replayArtifact, runAgentGame } from './runner';
import { APP_VERSION, ARTIFACT_SCHEMA_VERSION, AGENT_API_VERSION, OBSERVATION_API_VERSION, BRIDGE_API_VERSION } from './types';

describe('unified Agent Runner', () => {
  it('runs a deterministic random game and records a replay artifact', () => {
    const config = createDefaultConfig({
      maxActionsPerTurn: 4,
      economy: { initialZombieCount: 0 },
      units: { hordeZombie: { movement: 20, attack: 100 } },
      horde: { warningLeadTurns: 1, waves: [{ turn: 1, directionCount: 4, compositionPerDirection: { hordeZombie: 1, zombie: 0 }, final: true }] },
    });
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
    expect(first.artifact.config.horde.waves.find((wave) => wave.final)?.turn).toBe(1);
    expect(first.artifact.fixedMap?.tiles.some((tile) => tile.terrain === 'forest')).toBe(true);
    expect(first.artifact.observationTrace?.[0]?.mapId).toBe(first.artifact.mapId);
    expect(first.artifact.observationTrace?.[0]).not.toHaveProperty('map');
    expect(first.artifact.observationTrace?.[0]?.checkpointPositionCandidates).toHaveLength(60);
    expect(first.artifact.observationTrace?.some((observation) => observation.horde.nextWaveIndex === 1)).toBe(true);
    expect(first.artifact.initialRoadArrivalSchedule).toHaveLength(4);
    expect(first.artifact.observationTrace).toHaveLength(first.actions.length + 1);
    const fullHordeEvent = first.artifact.verificationEvents?.find((event) => (
      event.type === 'horde_spawned' && Array.isArray(event.payload.units)
    ));
    expect(fullHordeEvent?.payload).toMatchObject({
      spawnGroupIds: expect.arrayContaining([expect.any(String)]),
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
  }, 90_000);

  it('rejects pre-v1.4.3 artifacts before creating a v1.4.3 replay session', () => {
    const config = createDefaultConfig({ horde: { warningLeadTurns: 1, waves: [{ turn: 1, directionCount: 1, compositionPerDirection: { hordeZombie: 1, zombie: 0 }, final: true }] } });
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
    const v140Replay = replayArtifact({
      ...run.artifact,
      appVersion: '1.4.0',
      gameRulesVersion: '2.0.0',
      artifactSchemaVersion: '2.0.0',
      agentApiVersion: '2.0.0',
      observationApiVersion: '2.0.0',
      bridgeApiVersion: '2.0.0',
    });
    expect(v140Replay).toMatchObject({ reproduced: false, actionsReplayed: 0, error: { code: 'artifact_version_unsupported' } });
  }, 30_000);

  it('forces EndTurn at the runner per-turn limit for agents without traces', () => {
    const config = createDefaultConfig({
      horde: { warningLeadTurns: 1, waves: [{ turn: 30, directionCount: 1, compositionPerDirection: { hordeZombie: 1, zombie: 0 }, final: true }] },
      maxActionsPerTurn: 100,
      economy: { initialZombieCount: 0 },
    });
    const run = runAgentGame(12, {
      config,
      agent: new RandomAgent(12),
      limits: { maxTurns: 1, maxDecisionsPerTurn: 1, maxDecisionsPerGame: 100 },
    });
    expect(run.technicalFailure).toBe(true);
    expect(run.failure?.code).toBe('TURN_SAFETY_LIMIT');
    expect(run.actions.filter((action) => action.type === 'EndTurn').length).toBeGreaterThan(0);
  });

  it('keeps summary-only metrics identical while discarding heavyweight projections', () => {
    const config = createDefaultConfig({
      horde: { warningLeadTurns: 1, waves: [{ turn: 2, directionCount: 1, compositionPerDirection: { hordeZombie: 1, zombie: 0 }, final: true }] },
      maxActionsPerTurn: 2,
    });
    const options = {
      strategy: 'random' as const,
      config,
      limits: { maxTurns: 4, maxDecisionsPerTurn: 2, maxDecisionsPerGame: 20 },
    };
    const full = runAgentGame(17, options);
    const summary = runAgentGame(17, { ...options, summaryOnly: true });

    expect(summary.metrics).toEqual(full.metrics);
    expect(summary.actions).toEqual(full.actions);
    expect(summary.observations.every((observation) => (
      observation.map.tiles.length === 0 &&
      observation.supply.suppliedTileKeys.length === 0 &&
      observation.constructibleFacilityPositionCandidates.length === 0
    ))).toBe(true);
    expect(summary.artifact.observationTrace).toHaveLength(2);
    expect(summary.artifact.fixedMap).toBeUndefined();
  }, 30_000);

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
       config: createDefaultConfig({ horde: { warningLeadTurns: 1, waves: [{ turn: 250, directionCount: 1, compositionPerDirection: { hordeZombie: 1, zombie: 0 }, final: true }] } }),
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
      config: createDefaultConfig({ horde: { warningLeadTurns: 1, waves: [{ turn: 1, directionCount: 1, compositionPerDirection: { hordeZombie: 1, zombie: 0 }, final: true }] } }),
      debugSnapshot: () => ({ value: state.value }),
      limits: { maxTurns: 2, maxDecisionsPerTurn: 2, maxDecisionsPerGame: 2 },
    });
    expect(run.technicalFailure).toBe(true);
    expect(run.failure?.code).toBe('STEP_THREW');
    expect(run.failure?.stateBeforeFailure).toEqual({ value: 0 });
    expect(run.failure?.stateAfterFailure).toEqual({ value: 1 });
  });
});
