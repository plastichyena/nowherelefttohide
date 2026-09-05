import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from '../core/config';
import { replayArtifact, runAgentGame } from './runner';
import {
  AGENT_API_VERSION,
  APP_VERSION,
  ARTIFACT_SCHEMA_VERSION,
  BRIDGE_API_VERSION,
  OBSERVATION_API_VERSION,
} from './types';

describe('Agent Runner replay artifacts', () => {
  it('runs a deterministic random game and records a replay artifact', () => {
    const config = createDefaultConfig({
      maxActionsPerTurn: 4,
      economy: { initialZombieCount: 0, initialHunterCount: { min: 0, max: 0 } },
      units: { hordeZombie: { movement: 20, attack: 100 } },
      horde: {
        warningLeadTurns: 1,
        waves: [{
          turn: 1,
          directionCount: 4,
          compositionPerDirection: { hordeZombie: 1, zombie: 0 },
          final: true,
        }],
      },
    });
    const limits = { maxTurns: 8, maxDecisionsPerTurn: 4, maxDecisionsPerGame: 100 };
    const first = runAgentGame(11, { strategy: 'random', config, limits });
    const second = runAgentGame(11, { strategy: 'random', config, limits });
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
    expect(first.artifact.observationTrace?.[0]?.checkpointPositionCandidates).toHaveLength(100);
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
        expect.objectContaining({
          unitId: expect.any(String),
          unitType: expect.any(String),
          spawnGroupId: expect.any(String),
        }),
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
    const corruptedReplay = replayArtifact({
      ...first.artifact,
      verificationEvents: corruptedVerificationEvents,
    });
    expect(corruptedReplay.reproduced).toBe(false);
    expect(corruptedReplay.mismatch).toBe('Replay internal verification events differ from the artifact');
  }, 90_000);
});
