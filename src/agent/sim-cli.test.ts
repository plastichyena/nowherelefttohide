import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from '../core/config';
import { createAgentGame } from './game';
import {
  csvColumns,
  metricsToCsv,
  parseSimulationArgs,
  runSimulation,
  runSimulationToDirectory,
  writeSimulationOutput,
} from './sim-cli';
import type { AgentGame } from './types';

describe('Batch Simulation CLI', () => {
  it('accepts npm-normalized whitespace in agent and seed lists', () => {
    const parsed = parseSimulationArgs(['--agent=random balanced', '--seeds=1 2']);
    expect(parsed.agents).toEqual(['random', 'balanced']);
    expect(parsed.seeds).toEqual([1, 2]);
  });
  it('parses agents, explicit seeds, runner limits, fail-fast, and summary-only', () => {
    const parsed = parseSimulationArgs([
      '--agent=random,balanced', '--seeds=4,9', '--max-decisions-per-turn=3',
      '--max-decisions-per-game=30', '--max-turns=8', '--fail-fast', '--summary-only', '--out=out/sim',
    ]);
    expect(parsed.agents).toEqual(['random', 'balanced']);
    expect(parsed.seeds).toEqual([4, 9]);
    expect(parsed.limits).toEqual({ maxDecisionsPerTurn: 3, maxDecisionsPerGame: 30, maxTurns: 8 });
    expect(parsed.failFast).toBe(true);
    expect(parsed.summaryOnly).toBe(true);
  });

  it('runs multiple strategies against the same seed set and reports comparisons', () => {
    const config = createDefaultConfig({ maxActionsPerTurn: 1 });
    const report = runSimulation({ agents: ['random', 'balanced'], seeds: [1], config, limits: { maxTurns: 8, maxDecisionsPerTurn: 1, maxDecisionsPerGame: 100 } });
    expect(report.games).toHaveLength(2);
    expect(report.comparisons).toHaveLength(1);
    expect(Object.keys(report.comparisons[0]!.agents).sort()).toEqual(['balanced', 'random']);
    expect(report.technicalFailureCount).toBeGreaterThanOrEqual(0);
    expect(report.schemaVersion).toBe('7.0.0');
    expect(report.appVersion).toBe('1.5.1');
  // The v1.4.4 fixed 51×51 board deliberately raises deterministic run cost;
  // one shared seed still exercises both strategies and their comparison without
  // blocking Vitest's worker RPC heartbeat.
  }, 60_000);

  it('reports the runner default turn ceiling independently from finalHordeTurn', () => {
    const initial = createAgentGame().reset({ seed: 1 });
    const failingFactory = (): AgentGame => ({
      getApiInfo: () => createAgentGame().getApiInfo(),
      reset: () => initial,
      getObservation: () => initial,
      getLegalActions: () => { throw new Error('stop after report normalization'); },
      step: () => { throw new Error('unreachable'); },
      isGameOver: () => false,
      getResult: () => null,
      getRunArtifact: () => ({}) as never,
    });
    const report = runSimulation({
      agents: ['random'],
      seeds: [1],
      config: createDefaultConfig({ maxActionsPerTurn: 2 }),
      gameFactory: failingFactory,
    });
    expect(report.execution.limits).toMatchObject({ maxTurns: 100, maxDecisionsPerTurn: 2, maxDecisionsPerGame: 301 });
  });

  it('reports a maxTurns stop separately from losses and technical failures in JSON and CSV', () => {
    const initial = createAgentGame().reset({ seed: 1 });
    const overRunnerLimit = { ...initial, turn: 101, finalHordeTurn: 250 };
    const limitedFactory = (): AgentGame => ({
      getApiInfo: () => createAgentGame().getApiInfo(),
      reset: () => overRunnerLimit,
      getObservation: () => overRunnerLimit,
      getLegalActions: () => [{ type: 'EndTurn' }],
      step: () => { throw new Error('unreachable after the turn ceiling'); },
      isGameOver: () => false,
      getResult: () => null,
      getRunArtifact: () => ({}) as never,
    });
    const report = runSimulation({
      agents: ['random'],
      seeds: [1],
      config: createDefaultConfig(),
      gameFactory: limitedFactory,
    });
    expect(report.games[0]).toMatchObject({ outcome: 'limit_reached', limitReached: true, gameOverReason: null });
    expect(report.failures).toHaveLength(0);
    expect(report.limitReachedCount).toBe(1);
    expect(report.technicalFailureCount).toBe(0);
    expect(report.aggregate.random).toMatchObject({ completed: 0, limitReached: 1, technicalFailures: 0, wins: 0, losses: 0 });
    expect(report.exitCode).toBe(0);
    const [header, row] = metricsToCsv(report.games).trim().split('\n').map((line) => line.split(','));
    expect(header).toContain('limitReached');
    expect(row![header!.indexOf('outcome')]).toBe('limit_reached');
    expect(row![header!.indexOf('limitReached')]).toBe('true');
  });

  it('continues after a technical failure by default and stops only with fail-fast', () => {
    const initial = createAgentGame().reset({ seed: 1 });
    const failingFactory = (): AgentGame => ({
      getApiInfo: () => createAgentGame().getApiInfo(),
      reset: () => initial,
      getObservation: () => initial,
      getLegalActions: () => { throw new Error('legal actions unavailable'); },
      step: () => { throw new Error('unreachable'); },
      isGameOver: () => false,
      getResult: () => null,
      getRunArtifact: () => ({}) as never,
    });
    const config = createDefaultConfig();
    const continued = runSimulation({ agents: ['random'], seeds: [1, 2, 3], config, gameFactory: failingFactory });
    expect(continued.games).toHaveLength(3);
    expect(continued.technicalFailureCount).toBe(3);
    expect(continued.exitCode).toBe(1);
    const stopped = runSimulation({ agents: ['random'], seeds: [1, 2, 3], config, gameFactory: failingFactory, failFast: true });
    expect(stopped.games).toHaveLength(1);
    expect(stopped.exitCode).toBe(1);
  });

  it('writes UTF-8 JSON, fixed-column CSV, and full per-game artifacts without accidental overwrite', () => {
    const config = createDefaultConfig({ maxActionsPerTurn: 1 });
    const report = runSimulation({ agents: ['random'], seeds: [5], config, limits: { maxTurns: 8, maxDecisionsPerTurn: 1, maxDecisionsPerGame: 100 } });
    const output = mkdtempSync(join(tmpdir(), 'nlth-sim-'));
    const paths = writeSimulationOutput(report, output);
    expect(paths.artifacts).toHaveLength(1);
    expect(paths.runJson.endsWith('run.json')).toBe(true);
    expect(paths.gamesCsv.endsWith('games.csv')).toBe(true);
    expect(csvColumns()).toContain('arrivals.north');
    expect(csvColumns()).toContain('checkpointsRelocated');
    expect(csvColumns()).toEqual(expect.arrayContaining([
      'poweredIndustrialFacilityTurns',
      'unpoweredCityTurns',
      'refineryFacilitiesCaptured',
      'powerPlantFacilitiesCaptured',
      'finalHordeSpawned',
      'limitReached',
      'periodicHordeZombiesSpawned',
      'periodicNormalZombiesSpawned',
      'finalHordeZombiesSpawned',
      'finalNormalZombiesSpawned',
      'finalHordeDefeated',
      'terrainEntriesByType.forest',
      'hordeTargetClearedCount',
       'powerResourceLoss.food',
       'checkpointCapacityUtilization',
       'checkpointQueueFoodDemand',
       'checkpointQueueCivilianGoodsDemand',
       'checkpointQueueFoodConsumed',
       'checkpointQueueCivilianGoodsConsumed',
       'policeZombiesSpawned',
       'soldierZombiesFinal',
       'policeReanimations',
       'reanimationCheckpointInfections',
       'civilianDroneBasesDecommissioned',
       'civilianGoodsRefundedFromDecommission',
       'policeLongRangeMoves',
       'refugeesRejected.north.normal',
       'refugeesRejected.west.strict',
       'refugeesTurnedAway.east',
       'rejectedBonusZombies.south',
       'rejectedCounterResets.north',
       'hordeWave.1.spawnTurn',
    ]));
    const [header, row] = metricsToCsv(report.games).trim().split('\n').map((line) => line.split(','));
    expect(row).toHaveLength(header!.length);
    for (const key of [
      'poweredIndustrialFacilityTurns',
      'unpoweredCityTurns',
      'refineryFacilitiesCaptured',
      'powerPlantFacilitiesCaptured',
      'finalHordeSpawned',
      'periodicHordeZombiesSpawned',
      'periodicNormalZombiesSpawned',
      'finalHordeZombiesSpawned',
       'finalNormalZombiesSpawned',
       'hordeTargetClearedCount',
       'checkpointQueueFoodDemand',
       'checkpointQueueCivilianGoodsDemand',
       'checkpointQueueFoodConsumed',
       'checkpointQueueCivilianGoodsConsumed',
       'policeZombiesSpawned',
       'soldierZombiesSpawned',
       'policeZombiesKilled',
       'soldierZombiesKilled',
       'policeZombiesFinal',
       'soldierZombiesFinal',
       'preventedRefugeeArrivalsAfterFinal',
       'policeReanimations',
       'nationalGuardReanimations',
       'reanimationImmediateInfections',
       'reanimationFacilityInfections',
       'reanimationCheckpointInfections',
       'reanimationSiteFalls',
       'reanimationChainOverruns',
       'civilianDroneBasesDecommissioned',
       'civilianGoodsRefundedFromDecommission',
       'policeLongRangeMoves',
     ] as const) {
      expect(row![header!.indexOf(key)]).toBe(String(report.games[0]![key]));
    }
    for (const direction of ['north', 'east', 'south', 'west'] as const) {
      expect(row![header!.indexOf(`refugeesRejected.${direction}.normal`)]).toBe(String(report.games[0]!.refugeesRejectedByDirectionAndPolicy[direction].normal));
      expect(row![header!.indexOf(`refugeesRejected.${direction}.strict`)]).toBe(String(report.games[0]!.refugeesRejectedByDirectionAndPolicy[direction].strict));
      expect(row![header!.indexOf(`refugeesTurnedAway.${direction}`)]).toBe(String(report.games[0]!.refugeesTurnedAwayByDirection[direction]));
      expect(row![header!.indexOf(`rejectedBonusZombies.${direction}`)]).toBe(String(report.games[0]!.rejectedBonusZombiesByDirection[direction]));
      expect(row![header!.indexOf(`rejectedCounterResets.${direction}`)]).toBe(String(report.games[0]!.rejectedCounterResetsByDirection[direction]));
    }
    expect(() => writeSimulationOutput(report, output)).toThrow(/overwrite|empty/i);
  }, 20_000);

  it('streams CLI-scale artifacts to disk without retaining full runs in the report', () => {
    const config = createDefaultConfig({ maxActionsPerTurn: 1 });
    const output = mkdtempSync(join(tmpdir(), 'nlth-sim-stream-'));
    const { report, paths } = runSimulationToDirectory({
      agents: ['random'],
      seeds: [7],
      config,
      limits: { maxTurns: 8, maxDecisionsPerTurn: 1, maxDecisionsPerGame: 100 },
    }, output);
    expect(report.games).toHaveLength(1);
    expect(report._runs).toBeUndefined();
    expect(paths.artifacts).toHaveLength(1);
    expect(paths.runJson.endsWith('run.json')).toBe(true);
    expect(paths.gamesCsv.endsWith('games.csv')).toBe(true);
  }, 30_000);

  it('writes compact batch summaries without materializing full Replay JSON files', () => {
    const config = createDefaultConfig({ maxActionsPerTurn: 1 });
    const output = mkdtempSync(join(tmpdir(), 'nlth-sim-summary-'));
    const { report, paths } = runSimulationToDirectory({
      agents: ['random'],
      seeds: [10],
      config,
      limits: { maxTurns: 8, maxDecisionsPerTurn: 1, maxDecisionsPerGame: 100 },
    }, output, { summaryOnly: true });
    expect(report.games).toHaveLength(1);
    expect(paths.artifacts).toEqual([]);
    expect(paths.runJson.endsWith('run.json')).toBe(true);
    expect(paths.gamesCsv.endsWith('games.csv')).toBe(true);
  }, 20_000);
});
