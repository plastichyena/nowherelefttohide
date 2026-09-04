import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from '../core/config';
import { replayArtifact, runAgentGame } from './runner';

describe('Agent replay version boundaries', () => {
  it('accepts release-only App metadata changes and rejects missing App metadata', () => {
    const config = createDefaultConfig({
      maxActionsPerTurn: 4,
      economy: { initialZombieCount: 0 },
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
    const run = runAgentGame(2, {
      strategy: 'random',
      config,
      limits: { maxTurns: 8, maxDecisionsPerTurn: 4, maxDecisionsPerGame: 100 },
    });

    const previousAppReplay = replayArtifact({ ...run.artifact, appVersion: '1.3.1' });
    expect(previousAppReplay.reproduced).toBe(true);
    expect(previousAppReplay.error).toBeNull();
    const missingAppMetadataReplay = replayArtifact({ ...run.artifact, appVersion: '' });
    expect(missingAppMetadataReplay.reproduced).toBe(false);
    expect(missingAppMetadataReplay.error?.code).toBe('artifact_invalid');
  }, 30_000);

  it('rejects legacy artifacts before creating a v1.5.0 replay session', () => {
    const config = createDefaultConfig({
      horde: {
        warningLeadTurns: 1,
        waves: [{
          turn: 1,
          directionCount: 1,
          compositionPerDirection: { hordeZombie: 1, zombie: 0 },
          final: true,
        }],
      },
    });
    const run = runAgentGame(2, {
      strategy: 'random',
      config,
      limits: { maxTurns: 2, maxDecisionsPerTurn: 1, maxDecisionsPerGame: 3 },
    });
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

    for (const versions of [
      ['1.2.6', '1.2.1', '1.2.0'],
      ['1.3.0', '1.3.0', '1.3.0'],
      ['1.4.0', '2.0.0', '2.0.0'],
    ] as const) {
      const [appVersion, gameRulesVersion, schemaVersion] = versions;
      const result = replayArtifact({
        ...run.artifact,
        appVersion,
        gameRulesVersion,
        artifactSchemaVersion: schemaVersion,
        agentApiVersion: schemaVersion,
        observationApiVersion: schemaVersion,
        bridgeApiVersion: schemaVersion,
      });
      expect(result).toMatchObject({
        reproduced: false,
        actionsReplayed: 0,
        error: { code: 'artifact_version_unsupported' },
      });
    }
  }, 30_000);
});
