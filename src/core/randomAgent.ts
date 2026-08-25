import { createDefaultConfig } from './config';
import { GameEngine } from './engine';
import { validateInvariants } from './invariants';
import { SeededRng } from './rng';
import type { GameAction, GameConfig, GameState } from './types';

export interface RandomAgentFailure {
  version: string;
  config: GameConfig;
  mapId: string;
  seed: number;
  actions: GameAction[];
  error: string;
  stateBeforeFailure: GameState;
}

export interface RandomAgentRun {
  seed: number;
  actions: GameAction[];
  result: ReturnType<GameEngine['getResult']>;
  failure: RandomAgentFailure | null;
}

/**
 * Development-only destruction test. It deliberately has no strategy: it
 * chooses from the Engine's legal atomic actions with its own deterministic
 * RNG, verifies invariants after every step, and records enough data to replay
 * a failure without a rendering runtime.
 */
export function runRandomTestGame(
  seed: number,
  config: GameConfig = createDefaultConfig(),
): RandomAgentRun {
  const engine = new GameEngine(seed, config);
  const chooser = new SeededRng(seed ^ 0x51f15e);
  const actions: GameAction[] = [];
  const actionLimit = config.maxTurns * (config.maxActionsPerTurn + 1) + 1;
  const fail = (message: string): RandomAgentRun => {
    const state = engine.getState() as GameState;
    return {
      seed,
      actions,
      result: engine.getResult(),
      failure: {
        version: state.gameVersion,
        config: JSON.parse(JSON.stringify(state.config)) as GameConfig,
        mapId: state.mapId,
        seed,
        actions: JSON.parse(JSON.stringify(actions)) as GameAction[],
        error: message,
        stateBeforeFailure: state,
      },
    };
  };

  for (let step = 0; !engine.isGameOver() && step < actionLimit; step += 1) {
    const before = engine.getState() as GameState;
    const beforeInvariant = validateInvariants(before);
    if (!beforeInvariant.valid) return fail(`Invariant before action: ${beforeInvariant.errors.join('; ')}`);
    const legal = engine.getLegalActions();
    if (legal.length === 0) return fail('No legal actions before Game Over');
    const endTurn = legal.find((action) => action.type === 'EndTurn');
    const action = legal.length === 1 && endTurn ? endTurn : chooser.pick(legal);
    actions.push(JSON.parse(JSON.stringify(action)) as GameAction);
    const result = engine.step(action);
    if (result.error) return fail(`Legal action was rejected: ${result.error.code}: ${result.error.message}`);
    const invariant = validateInvariants(result.state as GameState);
    if (!invariant.valid) return fail(`Invariant after action: ${invariant.errors.join('; ')}`);
  }
  if (!engine.isGameOver()) return fail(`Action safety limit (${actionLimit}) reached`);
  return { seed, actions, result: engine.getResult(), failure: null };
}

export function runRandomTestGames(
  seeds: readonly number[],
  config: GameConfig = createDefaultConfig(),
): RandomAgentFailure[] {
  const failures: RandomAgentFailure[] = [];
  for (const seed of seeds) {
    const run = runRandomTestGame(seed, config);
    if (run.failure) failures.push(run.failure);
  }
  return failures;
}

/** Re-run a recorded action sequence through the public Headless interface. */
export function replayRandomFailure(failure: RandomAgentFailure): ReturnType<GameEngine['getState']> {
  const engine = new GameEngine(failure.seed, failure.config);
  for (const action of failure.actions) {
    const result = engine.step(action);
    if (result.error) break;
  }
  return engine.getState();
}
