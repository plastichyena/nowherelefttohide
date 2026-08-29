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
  it('parses agents, explicit seeds, runner limits, and fail-fast', () => {
    const parsed = parseSimulationArgs([
      '--agent=random,balanced', '--seeds=4,9', '--max-decisions-per-turn=3',
      '--max-decisions-per-game=30', '--max-turns=8', '--fail-fast', '--out=out/sim',
    ]);
    expect(parsed.agents).toEqual(['random', 'balanced']);
    expect(parsed.seeds).toEqual([4, 9]);
    expect(parsed.limits).toEqual({ maxDecisionsPerTurn: 3, maxDecisionsPerGame: 30, maxTurns: 8 });
    expect(parsed.failFast).toBe(true);
  });

  it('runs multiple strategies against the same seed set and reports comparisons', () => {
    const config = createDefaultConfig({ maxTurns: 1, maxActionsPerTurn: 1 });
    const report = runSimulation({ agents: ['random', 'balanced'], seeds: [1, 2], config, limits: { maxTurns: 2, maxDecisionsPerTurn: 1, maxDecisionsPerGame: 4 } });
    expect(report.games).toHaveLength(4);
    expect(report.comparisons).toHaveLength(2);
    expect(Object.keys(report.comparisons[0]!.agents).sort()).toEqual(['balanced', 'random']);
    expect(report.exitCode).toBe(0);
    expect(report.schemaVersion).toBe('1.3.0');
    expect(report.appVersion).toBe('1.2.7');
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
    const config = createDefaultConfig({ maxTurns: 1 });
    const continued = runSimulation({ agents: ['random'], seeds: [1, 2, 3], config, gameFactory: failingFactory });
    expect(continued.games).toHaveLength(3);
    expect(continued.technicalFailureCount).toBe(3);
    expect(continued.exitCode).toBe(1);
    const stopped = runSimulation({ agents: ['random'], seeds: [1, 2, 3], config, gameFactory: failingFactory, failFast: true });
    expect(stopped.games).toHaveLength(1);
    expect(stopped.exitCode).toBe(1);
  });

  it('writes UTF-8 JSON, fixed-column CSV, and full per-game artifacts without accidental overwrite', () => {
    const config = createDefaultConfig({ maxTurns: 1, maxActionsPerTurn: 1 });
    const report = runSimulation({ agents: ['random'], seeds: [5], config, limits: { maxTurns: 2, maxDecisionsPerTurn: 1, maxDecisionsPerGame: 4 } });
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
    ]));
    const [header, row] = metricsToCsv(report.games).trim().split('\n').map((line) => line.split(','));
    expect(row).toHaveLength(header!.length);
    for (const key of [
      'poweredIndustrialFacilityTurns',
      'unpoweredCityTurns',
      'refineryFacilitiesCaptured',
      'powerPlantFacilitiesCaptured',
    ] as const) {
      expect(row![header!.indexOf(key)]).toBe(String(report.games[0]![key]));
    }
    expect(() => writeSimulationOutput(report, output)).toThrow(/overwrite|empty/i);
  });

  it('streams CLI-scale artifacts to disk without retaining full runs in the report', () => {
    const config = createDefaultConfig({ maxTurns: 1, maxActionsPerTurn: 1 });
    const output = mkdtempSync(join(tmpdir(), 'nlth-sim-stream-'));
    const { report, paths } = runSimulationToDirectory({
      agents: ['random'],
      seeds: [7, 8, 9],
      config,
      limits: { maxTurns: 2, maxDecisionsPerTurn: 1, maxDecisionsPerGame: 4 },
    }, output);
    expect(report.games).toHaveLength(3);
    expect(report._runs).toBeUndefined();
    expect(paths.artifacts).toHaveLength(3);
    expect(paths.runJson.endsWith('run.json')).toBe(true);
    expect(paths.gamesCsv.endsWith('games.csv')).toBe(true);
  });
});
