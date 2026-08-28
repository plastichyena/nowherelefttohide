import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from '../core/config';
import { collectGameMetrics, aggregateMetrics } from './metrics';
import { runAgentGame } from './runner';

describe('Agent Metrics', () => {
  it('collects required game-level values and deterministic action counts', () => {
    const config = createDefaultConfig({ maxTurns: 1, maxActionsPerTurn: 2 });
    const run = runAgentGame(7, { strategy: 'random', config, limits: { maxTurns: 2, maxDecisionsPerTurn: 2, maxDecisionsPerGame: 5 } });
    expect(run.technicalFailure).toBe(false);
    expect(run.metrics.seed).toBe(7);
    expect(run.metrics.actionCounts.EndTurn).toBe(1);
    expect(run.metrics.initialPopulation).toBeGreaterThan(0);
    expect(run.metrics.finalFood).toBeTypeOf('number');
    expect(run.metrics.bridgeApiVersion).toBe('1.1.0');
    expect(run.metrics.refugeeArrivalsByBranch).toHaveProperty('north');
    expect(run.metrics.totalRefugeeArrivals).toBeGreaterThanOrEqual(0);
    expect(run.metrics.maxSupplyRadius).toBeGreaterThan(0);
  });

  it('keeps branch, policy, checkpoint, and supply metrics in the public result', () => {
    const config = createDefaultConfig({ maxTurns: 1, maxActionsPerTurn: 1 });
    const run = runAgentGame(4, { strategy: 'random', config, limits: { maxTurns: 2, maxDecisionsPerTurn: 1, maxDecisionsPerGame: 3 } });
    expect(Object.keys(run.metrics.refugeesScreenedByPolicy).sort()).toEqual(['normal', 'passThrough', 'strict']);
    expect(run.metrics.checkpointsBuilt).toBeGreaterThanOrEqual(0);
    expect(run.metrics.checkpointsRelocated).toBeGreaterThanOrEqual(0);
    expect(run.metrics.supplyRejections).toBeGreaterThanOrEqual(0);
  });

  it('aggregates averages, percentiles, outcomes, and action totals', () => {
    const config = createDefaultConfig({ maxTurns: 1, maxActionsPerTurn: 1 });
    const first = runAgentGame(1, { strategy: 'random', config, limits: { maxTurns: 2, maxDecisionsPerTurn: 1, maxDecisionsPerGame: 3 } }).metrics;
    const second = runAgentGame(2, { strategy: 'random', config, limits: { maxTurns: 2, maxDecisionsPerTurn: 1, maxDecisionsPerGame: 3 } }).metrics;
    const aggregate = aggregateMetrics([first, second]);
    expect(aggregate.executions).toBe(2);
    expect(aggregate.completed).toBe(2);
    expect(aggregate.metrics.finalTurn.average).toBeGreaterThan(0);
    expect(aggregate.metrics.finalTurn.p10).toBeLessThanOrEqual(aggregate.metrics.finalTurn.p90);
    expect(aggregate.actionCounts.EndTurn).toBe(2);
  });

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
