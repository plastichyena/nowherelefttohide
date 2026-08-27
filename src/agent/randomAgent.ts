import { SeededRng } from '../core/rng';
import type { GameAction } from '../core/types';
import { actionKey, cloneAction, sortActions } from './action';
import {
  RANDOM_AGENT_VERSION,
  type AgentDecision,
  type AgentObservation,
  type GameAgent,
} from './types';

/**
 * A deterministic, deliberately strategy-free Agent.
 *
 * The stream used for choosing an action is kept outside GameEngine.  This is
 * important for replay: changing the random chooser must never change the
 * rules RNG stored in GameState.  The runner creates one instance per game,
 * so a seed is enough to reproduce the complete action sequence.
 */
export class RandomAgent implements GameAgent {
  public readonly id = 'random';
  public readonly version = RANDOM_AGENT_VERSION;

  private readonly chooser: SeededRng;

  public constructor(seed = 1) {
    if (!Number.isSafeInteger(seed)) {
      throw new Error('Random Agent seed must be a safe integer');
    }
    // Keep the agent stream independent from the game stream even when the
    // same seed is supplied to both.
    this.chooser = new SeededRng((seed ^ 0x51f15e) >>> 0);
  }

  public decide(_observation: AgentObservation, legalActions: readonly GameAction[]): AgentDecision {
    if (legalActions.length === 0) {
      throw new Error('Random Agent cannot decide without a legal action');
    }
    const ordered = sortActions(legalActions);
    // EndTurn is the only safe action at the engine action limit.  Prefer it
    // when it is the sole candidate; this also makes small fake games useful
    // in unit tests and avoids consuming a chooser draw unnecessarily.
    const selected = ordered.length === 1
      ? ordered[0]!
      : ordered[this.chooser.nextInt(0, ordered.length - 1)]!;
    return { action: cloneAction(selected) };
  }
}

export function createRandomAgent(seed = 1): RandomAgent {
  return new RandomAgent(seed);
}

/** Stable key exposed for callers that need to compare recorded actions. */
export { actionKey };

