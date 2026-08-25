import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from '../core/config';
import type { GameAction, GameResult, GameState, HeadlessGame, StepResult } from '../core/types';
import { replayFailure, runRandomGame } from './randomAgent';

function fakeState(turn = 1, gameOver = false): GameState {
  return {
    turn,
    gameOver,
    result: gameOver
      ? ({ outcome: 'won', reason: 'maxTurnsSurvived', turn, statistics: {} } as GameResult)
      : null,
  } as unknown as GameState;
}

class DeterministicFakeGame implements HeadlessGame {
  private state = fakeState();
  private actions = 0;

  reset(): Readonly<GameState> {
    this.state = fakeState();
    this.actions = 0;
    return this.state;
  }

  getState(): Readonly<GameState> {
    return this.state;
  }

  getLegalActions(): GameAction[] {
    if (this.state.gameOver) return [];
    if (this.actions === 0) return [{ type: 'AssignWorkers', facilityId: 'farm-1', workers: 1 }];
    return [{ type: 'EndTurn' }];
  }

  step(action: GameAction): StepResult {
    if (action.type === 'EndTurn') {
      this.state = fakeState(2, true);
    } else {
      this.actions += 1;
    }
    return { state: this.state, events: [], error: null, gameOver: this.state.gameOver, result: this.state.result };
  }

  isGameOver(): boolean {
    return this.state.gameOver;
  }

  getResult(): GameResult | null {
    return this.state.result;
  }
}

class FailingFakeGame extends DeterministicFakeGame {
  step(action: GameAction): StepResult {
    const result = super.step(action);
    if (action.type === 'AssignWorkers') {
      (result.state as GameState & { broken?: boolean }).broken = true;
    }
    return result;
  }
}

class ThrowingMutatingFakeGame extends DeterministicFakeGame {
  step(action: GameAction): StepResult {
    const result = super.step(action);
    if (action.type === 'AssignWorkers') {
      (result.state as GameState & { broken?: boolean }).broken = true;
      throw new Error('broken step');
    }
    return result;
  }
}

const factory = (GameClass: new () => HeadlessGame) => () => new GameClass();
const options = {
  gameIndex: 0,
  seed: 100,
  config: createDefaultConfig(),
  maxActionsPerTurn: 1,
  maxTurns: 2,
  maxGameActions: 10,
  actionRngSalt: 1,
  assertState: () => undefined,
};

describe('Random Test Agent', () => {
  it('uses only legal actions and forces EndTurn at the per-turn limit', () => {
    const first = runRandomGame(factory(DeterministicFakeGame), options, options.assertState);
    const second = runRandomGame(factory(DeterministicFakeGame), options, options.assertState);
    expect(first.failure).toBeNull();
    expect(first.actions).toEqual(second.actions);
    expect(first.actions.at(-1)).toEqual({ type: 'EndTurn' });
  });

  it('captures a failing action trace and reproduces the same failure', () => {
    const first = runRandomGame(
      factory(FailingFakeGame),
      options,
      (state) => {
        if ((state as GameState & { broken?: boolean }).broken) throw new Error('broken state');
      },
    );
    expect(first.failure).not.toBeNull();
    expect((first.failure?.stateBeforeFailure as (GameState & { broken?: boolean }) | null)?.broken).toBeUndefined();
    expect((first.failure?.stateAfterFailure as (GameState & { broken?: boolean }) | null)?.broken).toBe(true);
    expect(first.failure?.state).toEqual(first.failure?.stateAfterFailure);
    const replay = replayFailure(
      factory(FailingFakeGame),
      first.failure!,
      (state) => {
        if ((state as GameState & { broken?: boolean }).broken) throw new Error('broken state');
      },
    );
    expect(replay.reproduced).toBe(true);
    expect(replay.actionsReplayed).toBe(1);
  });

  it('keeps a clean pre-step snapshot when step mutates state before throwing', () => {
    const first = runRandomGame(factory(ThrowingMutatingFakeGame), options, options.assertState);
    expect(first.failure).not.toBeNull();
    expect(first.failure?.error.code).toBe('STEP_THREW');
    expect((first.failure?.stateBeforeFailure as (GameState & { broken?: boolean }) | null)?.broken).toBeUndefined();
    expect((first.failure?.stateAfterFailure as (GameState & { broken?: boolean }) | null)?.broken).toBe(true);

    const replay = replayFailure(factory(ThrowingMutatingFakeGame), first.failure!, options.assertState);
    expect(replay.reproduced).toBe(true);
    expect(replay.expectedState).toEqual(first.failure?.stateAfterFailure);
  });
});
