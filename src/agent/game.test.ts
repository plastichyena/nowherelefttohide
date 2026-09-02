import { describe, expect, it } from 'vitest';
import { createAgentGame } from './game';
import { createAgentResult } from './observation';
import { APP_VERSION, ARTIFACT_SCHEMA_VERSION, GAME_RULES_VERSION, OBSERVATION_API_VERSION } from './types';
import packageMetadata from '../../package.json';

describe('AgentGame public boundary', () => {
  it('keeps package and public App release metadata aligned', () => {
    expect(APP_VERSION).toBe('1.4.2');
    expect(packageMetadata.version).toBe(APP_VERSION);
  });
  it('returns a deterministic JSON observation without private random state', () => {
    const game = createAgentGame();
    const first = game.reset({ seed: 42, agent: { id: 'boundary-test' } });
    const second = game.reset({ seed: 42, agent: { id: 'boundary-test' } });
    expect(second).toEqual(first);
    const encoded = JSON.stringify(first);
    expect(JSON.parse(encoded)).toEqual(first);
    expect(encoded).not.toContain('rngState');
    expect(encoded).not.toContain('spawnedCount');
    expect(first.map.tiles).toHaveLength(961);
    expect(first).not.toHaveProperty('maxTurns');
    expect(first.finalHordeTurn).toBe(50);
    expect(first.apiVersion).toBe(OBSERVATION_API_VERSION);
    expect(first.roadBranches).toHaveLength(4);
    expect(first.checkpointPositionCandidates).toHaveLength(60);
    expect(first.checkpointPositionCandidates.every((candidate) =>
      typeof candidate.legal === 'boolean' && (candidate.reasonCode === null || typeof candidate.reasonCode === 'string'),
    )).toBe(true);
    expect(first.roadBranches.every((branch) => branch.turnsUntilArrival >= 0)).toBe(true);
    expect(first.roadBranches.every((branch) =>
      branch.currentPolicy === 'normal' &&
      branch.preparedPostCount === 0 &&
      branch.preparedPostLimit === 3 &&
      branch.standbyCheckpointIds.length === 0 &&
      branch.dormantCheckpointIds.length === 0 &&
      branch.fallbackAvailable === false,
    )).toBe(true);
    expect(first.supply.initialRadius).toBeGreaterThan(0);
    expect(first.units.every((unit) => typeof unit.inSupply === 'boolean')).toBe(true);
    expect(first.units.every((unit) => unit.baseRange >= unit.effectiveRange)).toBe(true);
    expect(first.units.every((unit) => unit.unitType === unit.type && unit.vision > 0)).toBe(true);
    expect(first.map.tiles.every((tile) =>
      typeof tile.terrain === 'string' &&
      typeof tile.road === 'boolean' &&
      typeof tile.visibleToPlayer === 'boolean' &&
      typeof tile.playerOccupancyAllowed === 'boolean',
    )).toBe(true);
    expect(first.map.hordeSpawnReserve).toHaveLength(120);
    expect(first.zombies.every((unit) => unit.type === 'zombie' || unit.type === 'hordeZombie')).toBe(true);
    // The fixed v1.4 initial Zombies are outside initial shared vision; only
    // visible enemies may enter the public Observation.
    expect(first.zombies).toHaveLength(0);
    expect(first.horde).toMatchObject({
      warningType: 'none',
      warningDirections: [],
      nextWaveIndex: 1,
      nextWave: { index: 1, spawnTurn: 5, directionCount: 1, final: false },
      spawnTurn: 5,
      finalHordeStatus: 'notStarted',
    });
    expect(first.victory).toEqual({
      finalHordeDefeated: first.finalHordeDefeated,
      suppliedAreaZombieClear: first.suppliedAreaZombieClear,
      suppliedAreaInfectionClear: first.suppliedAreaInfectionClear,
    });
    expect(first.units.every((unit) => ['combat', 'rest', 'outOfSupply'].includes(unit.recoveryClassIfTurnEndsNow!))).toBe(true);
    expect(first.facilities.every((facility) => facility.production && typeof facility.infectionContained === 'boolean')).toBe(true);
  });

  it('describes the v1.4.2 API, checkpoint candidates, logistics rules, Noise rules, and fixed Horde schedule from the same adapter boundary', () => {
    const game = createAgentGame({ buildId: 'api-info-test' });
    game.reset({ seed: 2, configOverrides: { naturalRecovery: { combatRate: 0.15, restRate: 0.3 } } });
    const info = game.getApiInfo();
    expect(info.appVersion).toBe(APP_VERSION);
    expect(info.gameRulesVersion).toBe(GAME_RULES_VERSION);
    expect(info.observationApiVersion).toBe(OBSERVATION_API_VERSION);
    expect(info.saveFormatVersion).toBe('7');
    expect(info.artifactSchemaVersion).toBe(ARTIFACT_SCHEMA_VERSION);
    expect(info.buildId).toBe('api-info-test');
    expect(info.rules.recovery).toMatchObject({ combatRate: 0.15, restRate: 0.3, timing: 'nextPlayerTurnStart' });
    expect(info.rules.production.workerCapacityByFacilityType.farm).toBe(30);
    expect(info.rules.production).toMatchObject({
      powerPlantsGenerateCapacityPerWorker: 10,
      fuelPerFiveElectricity: 1,
      sameTurnProductionCanCoverMaintenance: true,
      sameTurnProductionCanCoverProductionInputs: false,
    });
    expect(info.rules.ranges.hordeZombie.baseRange).toBe(1);
    expect(info.rules.terrain).toMatchObject({
      movementCost: { plain: 1, forest: 2, mountain: 3, water: null },
      roadAndUrbanMovementCost: 1,
      defenseRounding: 'ceil',
      minimumDamage: 1,
    });
    expect(info.rules.vision).toMatchObject({ capital: 5, ownedFacility: 1, operationalCheckpoint: 1, distance: 'hex' });
    expect(info.rules.fogOfWar).toMatchObject({ enemyVisibility: 'visible_only', hiddenEnemyPositionPublic: false });
    expect(info.rules.victory.progressFields).toEqual([
      'finalHordeDefeated',
      'suppliedAreaZombieClear',
      'suppliedAreaInfectionClear',
    ]);
    expect(info.rules.map).toMatchObject({ id: 'fixed-31x31-v1', width: 31, height: 31 });
    expect(info.rules.map.hordeSpawnReserve).toHaveLength(120);
    expect(info.rules.horde).toMatchObject({ warningLeadTurns: 2, finalHordeTurn: 50 });
    expect(info.rules.horde.waves).toEqual([
      expect.objectContaining({ index: 1, turn: 5, directionCount: 1, compositionPerDirection: { hordeZombie: 2, zombie: 1 }, final: false }),
      expect.objectContaining({ index: 2, turn: 10, directionCount: 2, compositionPerDirection: { hordeZombie: 1, zombie: 2 }, final: false }),
      expect.objectContaining({ index: 3, turn: 20, directionCount: 1, compositionPerDirection: { hordeZombie: 4, zombie: 4 }, final: false }),
      expect.objectContaining({ index: 4, turn: 35, directionCount: 3, compositionPerDirection: { hordeZombie: 2, zombie: 4 }, final: false }),
      expect.objectContaining({ index: 5, turn: 50, directionCount: 4, compositionPerDirection: { hordeZombie: 4, zombie: 5 }, final: true }),
    ]);
    expect(info.rules.checkpointPositionCandidates).toMatchObject({
      observationField: 'checkpointPositionCandidates',
      includesIllegalCandidates: true,
      fairPlay: { hiddenEnemiesBlock: false, blockerUnitIdsPublic: false },
    });
    expect(info.rules.checkpointPositionCandidates.reasonCodes).toHaveProperty('checkpoint_supply_zombie_blocked');
    expect(info.rules.checkpoint).toMatchObject({
      activePerBranchLimit: 1,
      preparedPostLimit: 3,
      policyOwner: 'road_branch',
      fallbackPriority: ['capital_side_standby', 'capital_side_dormant'],
    });
    expect(info.rules.noise).toEqual({
      classes: ['small', 'medium', 'large', 'extraLarge'],
      policeClass: 'medium',
      nationalGuardClass: 'medium',
      distance: 'hex',
      terrainAttenuation: false,
      normalZombieAffected: true,
      hordeZombieAffected: false,
      targetPriority: ['visible_population', 'inherited_horde', 'noise', 'idle'],
    });
    expect(info.prohibited.join(' ')).toContain('SuppressInfection');
    expect(info.prohibited.join(' ')).toContain('exact Noise Radius');
    info.methods.pop();
    expect(game.getApiInfo().methods).toContain('getRunArtifact');
  });

  it('does not share returned references with the private engine state', () => {
    const game = createAgentGame();
    const observation = game.reset({ seed: 3 });
    observation.resources.food = -999;
    observation.facilities[0]!.healthyPopulation = -999;
    const fresh = game.getObservation();
    expect(fresh.resources.food).toBeGreaterThanOrEqual(0);
    expect(fresh.facilities[0]!.healthyPopulation).toBeGreaterThanOrEqual(0);
  });

  it('removes hidden Noise reaction metrics from a production result', () => {
    const result = createAgentResult({
      outcome: 'lost',
      reason: 'test',
      turn: 1,
      statistics: {
        noisePulsesEmitted: 1,
        normalZombiesNoiseTargeted: 3,
        noiseTargetsReached: 2,
        noiseTargetsOverriddenByHorde: 1,
        noiseTargetsOverriddenByVisiblePopulation: 1,
      },
    } as unknown as Parameters<typeof createAgentResult>[0])!;
    expect(result.statistics).toMatchObject({ noisePulsesEmitted: 1 });
    for (const key of [
      'normalZombiesNoiseTargeted',
      'noiseTargetsReached',
      'noiseTargetsOverriddenByHorde',
      'noiseTargetsOverriddenByVisiblePopulation',
    ]) expect(result.statistics).not.toHaveProperty(key);
  });

  it('rejects illegal actions and invalid reset input without changing the session', () => {
    const game = createAgentGame();
    const before = game.reset({ seed: 9, agent: { id: 'safe-agent' } });
    const rejected = game.step({ type: 'Wait', unitId: 'does-not-exist' });
    expect(rejected.error?.code).toBe('action_not_legal');
    expect(rejected.observation).toEqual(before);
    expect(game.getRunArtifact().acceptedActions).toHaveLength(0);
    expect(game.getRunArtifact().artifactSchemaVersion).toBe(ARTIFACT_SCHEMA_VERSION);
    expect(game.getRunArtifact().appVersion).toBe(APP_VERSION);
    expect(game.getRunArtifact().invalidAttempts).toHaveLength(1);
    expect(game.getRunArtifact().config.noise).toEqual({ publicClass: { police: 'medium', nationalGuard: 'medium' } });
    expect(game.getRunArtifact().metrics?.config.noise).toEqual({ publicClass: { police: 'medium', nationalGuard: 'medium' } });
    expect(JSON.stringify(game.getRunArtifact())).not.toContain('"police":4');
    expect(() => game.reset({ seed: 10, configOverrides: { unknown: 1 } as never })).toThrow(/Unknown field/);
    expect(game.getObservation()).toEqual(before);
  });

  it('returns only engine-legal actions and never exposes GameState in step results', () => {
    const game = createAgentGame();
    game.reset({ seed: 11 });
    const actions = game.getLegalActions();
    expect(actions.length).toBeGreaterThan(0);
    const representativeActions = [
      actions.find((action) => action.type === 'Wait'),
      actions.find((action) => action.type === 'Move'),
      actions.find((action) => action.type === 'BuildConstructibleFacility'),
      actions.find((action) => action.type === 'EndTurn'),
    ];
    for (const action of representativeActions) {
      if (!action) continue;
      const isolated = createAgentGame();
      isolated.reset({ seed: 11 });
      const result = isolated.step(action);
      expect(result.error).toBeNull();
      expect(result).not.toHaveProperty('state');
      expect(result.observation).not.toHaveProperty('rngState');
    }
  });

  it('publishes fixed-wave Horde facts without leaking spawn identity or coordinates', () => {
    const game = createAgentGame();
    game.reset({
      seed: 21,
      configOverrides: {
        horde: {
          warningLeadTurns: 1,
          waves: [{ turn: 1, directionCount: 1, compositionPerDirection: { hordeZombie: 1, zombie: 3 }, final: true }],
        },
        economy: { initialZombieCount: 0 },
        units: { police: { vision: 0 }, nationalGuard: { vision: 0 } },
      },
    });
    const result = game.step({ type: 'EndTurn' });
    expect(result.error).toBeNull();
    expect(result.observation.zombies).toHaveLength(0);
    const hordeEvents = result.events.filter((event) => event.type === 'horde_spawned');
    expect(hordeEvents).toHaveLength(1);
    expect(hordeEvents[0]!.payload).toMatchObject({
      hordeKind: 'final', waveIndex: 1, spawnTurn: 1, final: true,
      directions: expect.any(Array), compositionPerDirection: { hordeZombie: 1, zombie: 3 },
      hordeZombieCount: 1, normalZombieCount: 3,
    });
    for (const hiddenField of [
      'zombieId', 'q', 'r', 'spawnGroupId', 'spawnGroupIds', 'units', 'position',
    ]) {
      expect(hordeEvents[0]!.payload).not.toHaveProperty(hiddenField);
    }
    expect(JSON.stringify(hordeEvents)).not.toContain('final-horde-1');
  });

  it('does not canonicalize a checkpoint action with the wrong branch', () => {
    const game = createAgentGame();
    const before = game.reset({ seed: 12, configOverrides: { economy: { initialZombieCount: 0 } } });
    const privateBefore = game.getDebugState();
    const legalBuild = game.getLegalActions().find((action) => action.type === 'BuildCheckpoint');
    expect(legalBuild).toBeDefined();
    const wrongBranch = before.roadBranches.find((branch) => branch.branchId !== legalBuild!.branchId)!.branchId;
    const result = game.step({ ...legalBuild!, branchId: wrongBranch });
    expect(result.error?.code).toBe('invalid_checkpoint_branch');
    expect(game.getObservation()).toEqual(before);
    expect(game.getDebugState()).toEqual(privateBefore);
    expect(game.getRunArtifact().acceptedActions).toHaveLength(0);
  });
});
