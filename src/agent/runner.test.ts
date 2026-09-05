import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from '../core/config';
import type { AgentGame } from './types';
import { createAgentGame } from './game';
import { BalancedAgent, RandomAgent, runAgentGame } from './runner';

describe('unified Agent Runner', () => {
  it('forces EndTurn at the runner per-turn limit and classifies maxTurns as neutral', () => {
    const config = createDefaultConfig({
      horde: { warningLeadTurns: 1, waves: [{ turn: 30, directionCount: 1, compositionPerDirection: { hordeZombie: 1, zombie: 0 }, final: true }] },
      maxActionsPerTurn: 100,
      economy: { initialZombieCount: 0, initialHunterCount: { min: 0, max: 0 } },
    });
    const run = runAgentGame(12, {
      config,
      agent: new RandomAgent(12),
      limits: { maxTurns: 1, maxDecisionsPerTurn: 1, maxDecisionsPerGame: 100 },
    });
    expect(run.result).toBeNull();
    expect(run.failure).toBeNull();
    expect(run.technicalFailure).toBe(false);
    expect(run.limitReached).toBe(true);
    expect(run.metrics.outcome).toBe('limit_reached');
    expect(run.metrics.limitReached).toBe(true);
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
      observation.supply.suppliedTileKeys.length > 0 &&
      observation.constructibleFacilityPositionCandidates.length === 0
    ))).toBe(true);
    expect(summary.artifact.observationTrace).toHaveLength(2);
    expect(summary.artifact.fixedMap).toBeUndefined();
  }, 30_000);

  it('keeps the default runner turn ceiling at 100 when the Final Horde is later', () => {
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
    expect(run.result).toBeNull();
    expect(run.failure).toBeNull();
    expect(run.technicalFailure).toBe(false);
    expect(run.limitReached).toBe(true);
    expect(run.metrics.outcome).toBe('limit_reached');
    expect(run.finalObservation?.turn).toBe(101);
  });

  it('keeps the whole-game decision safety limit as a technical failure', () => {
    const initialObservation = createAgentGame().reset({ seed: 1 });
    const game: AgentGame = {
      getApiInfo: () => createAgentGame().getApiInfo(),
      reset: () => initialObservation,
      getObservation: () => initialObservation,
      getLegalActions: () => [{ type: 'EndTurn' }],
      step: () => ({
        observation: initialObservation,
        events: [],
        error: null,
        gameOver: false,
        result: null,
      }),
      isGameOver: () => false,
      getResult: () => null,
      getRunArtifact: () => ({}) as never,
    };
    const run = runAgentGame(1, {
      config: createDefaultConfig(),
      agent: { id: 'fake', version: '1.0.0', decide: () => ({ action: { type: 'EndTurn' } }) },
      gameFactory: () => game,
      limits: { maxTurns: 100, maxDecisionsPerTurn: 100, maxDecisionsPerGame: 1 },
    });
    expect(run.result).toBeNull();
    expect(run.failure?.code).toBe('GAME_DECISION_SAFETY_LIMIT');
    expect(run.technicalFailure).toBe(true);
    expect(run.limitReached).toBe(false);
    expect(run.metrics.outcome).toBe('technical_failure');
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
