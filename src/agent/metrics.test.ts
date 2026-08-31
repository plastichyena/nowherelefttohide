import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from '../core/config';
import { collectGameMetrics, aggregateMetrics } from './metrics';
import { runAgentGame } from './runner';

describe('Agent Metrics', () => {
  it('collects required game-level values and deterministic action counts', () => {
    const config = createDefaultConfig({ finalHordeTurn: 3, maxActionsPerTurn: 4 });
    const run = runAgentGame(11, { strategy: 'random', config, limits: { maxTurns: 8, maxDecisionsPerTurn: 4, maxDecisionsPerGame: 100 } });
    expect(run.failure).toBeNull();
    expect(run.technicalFailure).toBe(false);
    expect(run.metrics.seed).toBe(11);
    expect(run.metrics.actionCounts.EndTurn).toBeGreaterThan(0);
    expect(run.metrics.initialPopulation).toBeGreaterThan(0);
    expect(run.metrics.finalFood).toBeTypeOf('number');
    expect(run.metrics.bridgeApiVersion).toBe('1.4.2');
    expect(run.metrics.refugeeArrivalsByBranch).toHaveProperty('north');
    expect(run.metrics.totalRefugeeArrivals).toBeGreaterThanOrEqual(0);
    expect(run.metrics.maxWorkersInSingleFacility).toBeGreaterThanOrEqual(0);
    expect(run.metrics.maxTotalProductionWorkers).toBeGreaterThanOrEqual(run.metrics.maxWorkersInSingleFacility);
    expect(run.metrics.policeSurvivalRate).toBeGreaterThanOrEqual(0);
    expect(run.metrics.nationalGuardSurvivalRate).toBeGreaterThanOrEqual(0);
    expect(run.metrics.combatRecoverySelections).toBeGreaterThanOrEqual(0);
    expect(run.metrics.restRecoverySelections).toBeGreaterThanOrEqual(0);
    expect(run.metrics.maxSupplyRadius).toBeGreaterThan(0);
    expect(run.metrics.terrainEntriesByType).toMatchObject({ plain: expect.any(Number), forest: expect.any(Number), mountain: expect.any(Number), water: 0 });
    expect(run.metrics.finalHordeDefeated).toBeTypeOf('boolean');
    expect(run.metrics.maxVisibleZombies).toBeGreaterThanOrEqual(0);
    expect(run.metrics.normalZombieIdleCount).toBeGreaterThanOrEqual(0);
    for (const key of [
      'finalHordeSpawned', 'finalHordeKilled', 'finalHordeDefeated',
      'periodicHordeZombiesSpawned', 'periodicNormalZombiesSpawned',
      'finalHordeZombiesSpawned', 'finalNormalZombiesSpawned',
      'normalZombiesKilled', 'hordeZombiesKilled', 'maxVisibleZombies', 'turnsAfterFinalHorde',
      'suppliedAreaZombieClearTurn', 'suppliedAreaInfectionClearTurn', 'victoryTurn',
      'terrainEntriesByType', 'urbanDefenseApplications', 'urbanDefenseDamagePrevented',
      'forestDefenseApplications', 'forestDefenseDamagePrevented', 'normalZombieIdleCount',
      'hordeTargetInheritedCount', 'hordeTargetClearedCount',
    ]) expect(run.metrics).toHaveProperty(key);
    for (const hiddenNoiseMetric of [
      'normalZombiesNoiseTargeted',
      'noiseTargetsReached',
      'noiseTargetsOverriddenByHorde',
      'noiseTargetsOverriddenByVisiblePopulation',
    ]) {
      expect(run.metrics).toHaveProperty(hiddenNoiseMetric);
      expect(run.result!.statistics).not.toHaveProperty(hiddenNoiseMetric);
    }
    expect(run.result).not.toBeNull();
    expect(run.metrics.periodicHordeZombiesSpawned).toBe(run.result!.statistics.periodicHordeZombiesSpawned);
    expect(run.metrics.periodicNormalZombiesSpawned).toBe(run.result!.statistics.periodicNormalZombiesSpawned);
    expect(run.metrics.finalHordeZombiesSpawned).toBe(run.result!.statistics.finalHordeZombiesSpawned);
    expect(run.metrics.finalNormalZombiesSpawned).toBe(run.result!.statistics.finalNormalZombiesSpawned);
    expect(run.metrics.finalHordeSpawned).toBe(
      run.metrics.finalHordeZombiesSpawned + run.metrics.finalNormalZombiesSpawned,
    );
  });

  it('keeps branch, policy, checkpoint, and supply metrics in the public result', () => {
    const config = createDefaultConfig({ finalHordeTurn: 3, maxActionsPerTurn: 1 });
    const run = runAgentGame(4, { strategy: 'random', config, limits: { maxTurns: 8, maxDecisionsPerTurn: 1, maxDecisionsPerGame: 100 } });
    expect(Object.keys(run.metrics.refugeesScreenedByPolicy).sort()).toEqual(['normal', 'passThrough', 'strict']);
    expect(run.metrics.checkpointsBuilt).toBeGreaterThanOrEqual(0);
    expect(run.metrics.checkpointsRelocated).toBeGreaterThanOrEqual(0);
    expect(run.metrics.supplyRejections).toBeGreaterThanOrEqual(0);
  });

  it('counts policy branch-turns from the Active post only', () => {
    const config = createDefaultConfig({ finalHordeTurn: 3, maxActionsPerTurn: 1 });
    const run = runAgentGame(4, { strategy: 'random', config, limits: { maxTurns: 2, maxDecisionsPerTurn: 1, maxDecisionsPerGame: 10 } });
    const observation = structuredClone(run.initialObservation!);
    const baseCheckpoint = {
      branchId: 'west',
      direction: 'west' as const,
      vision: 1,
      status: 'operational' as const,
      waiting: 0,
      screening: 0,
      approved: 0,
      infected: 0,
      remainingTurns: 0,
      nextPolicy: 'normal' as const,
      nextArrivalTurn: null,
      providesSupply: false,
      infectionContained: true,
      containingUnitId: null,
      projectedSuppression: 0,
      projectedCivilianDamage: 0,
    };
    observation.checkpoints = [
      { ...baseCheckpoint, id: 'active', position: { q: 3, r: 7 }, role: 'active', currentPolicy: 'normal', providesSupply: true },
      { ...baseCheckpoint, id: 'standby', position: { q: 2, r: 7 }, role: 'standby', currentPolicy: 'strict' },
      { ...baseCheckpoint, id: 'dormant', position: { q: 1, r: 7 }, role: 'dormant', currentPolicy: 'passThrough' },
    ];
    const metrics = collectGameMetrics({
      initialObservation: observation,
      finalObservation: observation,
      observations: [observation],
      actions: [],
      result: null,
      agent: { id: 'metrics-test', version: '1' },
      config,
    });
    expect(metrics.checkpointNormalBranchTurns).toBe(1);
    expect(metrics.checkpointStrictBranchTurns).toBe(0);
    expect(metrics.checkpointPassThroughBranchTurns).toBe(0);
  });

  it('aggregates averages, percentiles, outcomes, and action totals', () => {
    const config = createDefaultConfig({ finalHordeTurn: 3, maxActionsPerTurn: 4 });
    const first = runAgentGame(11, { strategy: 'random', config, limits: { maxTurns: 8, maxDecisionsPerTurn: 4, maxDecisionsPerGame: 100 } }).metrics;
    const second = runAgentGame(11, { strategy: 'random', config, limits: { maxTurns: 8, maxDecisionsPerTurn: 4, maxDecisionsPerGame: 100 } }).metrics;
    const aggregate = aggregateMetrics([first, second]);
    expect(aggregate.executions).toBe(2);
    expect(aggregate.completed).toBe(2);
    expect(aggregate.metrics.finalTurn.average).toBeGreaterThan(0);
    expect(aggregate.metrics.finalTurn.p10).toBeLessThanOrEqual(aggregate.metrics.finalTurn.p90);
    expect(aggregate.actionCounts.EndTurn).toBe(first.actionCounts.EndTurn + second.actionCounts.EndTurn);
  }, 15_000);

  it('can collect a technical-failure metric without pretending it is an in-game loss', () => {
    const config = createDefaultConfig();
    const run = runAgentGame(3, {
      strategy: 'random',
      config,
      limits: { maxTurns: 1, maxDecisionsPerTurn: 1, maxDecisionsPerGame: 1 },
    });
    expect(run.metrics.outcome).toBe('technical_failure');
    expect(run.metrics.failure?.code).toBeTruthy();
    expect(run.metrics.gameOverReason).toBeNull();
  });
});
