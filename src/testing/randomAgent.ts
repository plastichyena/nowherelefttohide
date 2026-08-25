import { cloneConfig, createDefaultConfig } from '../core/config';
import { assertInvariants } from '../core/invariants';
import { SeededRng } from '../core/rng';
import type {
  GameAction,
  GameConfig,
  GameState,
  HeadlessGame,
  JsonValue,
  StepResult,
} from '../core/types';

const DEFAULT_MAX_ACTIONS_PER_TURN = 100;
const DEFAULT_MAX_TURNS = 100;
const DEFAULT_ACTION_RNG_SALT = 0x9e3779b9;

export type HeadlessGameFactory = (config: GameConfig, seed: number) => HeadlessGame;

export interface RandomAgentOptions {
  games?: number;
  /** Explicit seeds take precedence over seed/games. */
  seeds?: number[];
  seed?: number;
  maxActionsPerTurn?: number;
  maxTurns?: number;
  maxGameActions?: number;
  config?: GameConfig;
  actionRngSalt?: number;
  stopOnFailure?: boolean;
}

export interface RandomAgentRunOptions extends Required<
  Pick<RandomAgentOptions, 'maxActionsPerTurn' | 'maxTurns' | 'maxGameActions' | 'actionRngSalt'>
> {
  config: GameConfig;
}

export interface RandomAgentError {
  code: string;
  message: string;
  stack?: string;
}

export interface RandomAgentFailure {
  gameIndex: number;
  seed: number;
  version: string | null;
  config: GameConfig;
  mapId: string | null;
  actions: GameAction[];
  failedAfterAction: number;
  error: RandomAgentError;
  /**
   * Deep snapshot of the last state that passed the invariant check before
   * the failing operation. This is deliberately separate from the post-step
   * state: a HeadlessGame is allowed to mutate its state before throwing or
   * returning an error.
   */
  stateBeforeFailure: GameState | null;
  /** State observed after the failing operation, when it is available. */
  stateAfterFailure: GameState | null;
  /** @deprecated Use stateAfterFailure; kept for older failure artifacts. */
  state: GameState | null;
  /** Replay input is intentionally redundant so it can be copied directly. */
  replay: {
    seed: number;
    config: GameConfig;
    actions: GameAction[];
  };
}

export interface RandomAgentRunReport {
  ok: boolean;
  gamesRequested: number;
  gamesCompleted: number;
  failures: RandomAgentFailure[];
  durationMs: number;
  options: {
    maxActionsPerTurn: number;
    maxTurns: number;
    maxGameActions: number;
    actionRngSalt: number;
  };
}

export interface ReplayReport {
  reproduced: boolean;
  seed: number;
  actionsReplayed: number;
  expectedError: RandomAgentError;
  actualError: RandomAgentError | null;
  expectedState: GameState | null;
  actualState: GameState | null;
  mismatch: string | null;
}

interface SingleGameResult {
  failure: RandomAgentFailure | null;
  actions: GameAction[];
}

interface ExecuteOptions {
  gameIndex: number;
  seed: number;
  config: GameConfig;
  maxActionsPerTurn: number;
  maxTurns: number;
  maxGameActions: number;
  actionRngSalt: number;
  assertState: (state: Readonly<GameState>) => void;
  forcedActions?: readonly GameAction[];
}

function cloneJson<T extends JsonValue>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function cloneAction(action: GameAction): GameAction {
  return cloneJson(action as unknown as JsonValue) as unknown as GameAction;
}

function cloneState(state: Readonly<GameState> | null | undefined): GameState | null {
  return state === null || state === undefined ? null : cloneJson(state as unknown as JsonValue) as unknown as GameState;
}

function errorFromUnknown(error: unknown, fallbackCode = 'RANDOM_AGENT_ERROR'): RandomAgentError {
  if (error instanceof Error) {
    return { code: fallbackCode, message: error.message, ...(error.stack ? { stack: error.stack } : {}) };
  }
  return { code: fallbackCode, message: String(error) };
}

function actionKey(action: GameAction): string {
  if (action.type === 'Move') return `Move|${action.unitId}|${action.destination.q},${action.destination.r}`;
  if (action.type === 'Attack') return `Attack|${action.attackerId}|${action.targetId}`;
  if (action.type === 'Wait') return `Wait|${action.unitId}`;
  if (action.type === 'SuppressInfection') return `SuppressInfection|${action.unitId}|${action.facilityId}`;
  if (action.type === 'AssignWorkers') return `AssignWorkers|${action.facilityId}|${action.workers}`;
  if (action.type === 'SetCheckpointPolicy') return `SetCheckpointPolicy|${action.checkpointId}|${action.policy}`;
  if (action.type === 'BuildCheckpoint') return `BuildCheckpoint|${action.position.q},${action.position.r}`;
  if (action.type === 'ProduceUnit') {
    const destination = action.destination ? `${action.destination.q},${action.destination.r}` : '';
    return `ProduceUnit|${action.unitType}|${destination}`;
  }
  if (action.type === 'EndTurn') return 'EndTurn';
  if (action.type === 'StartNewGame') return `StartNewGame|${action.seed}`;
  return 'LoadSnapshot';
}

function sortActions(actions: readonly GameAction[]): GameAction[] {
  return [...actions].sort((left, right) => actionKey(left).localeCompare(actionKey(right)));
}

function chooseAction(actions: readonly GameAction[], rng: SeededRng): GameAction {
  const ordered = sortActions(actions);
  return ordered[rng.nextInt(0, ordered.length - 1)]!;
}

function isEndTurn(action: GameAction): boolean {
  return action.type === 'EndTurn';
}

function findMatchingAction(actions: readonly GameAction[], expected: GameAction): GameAction | undefined {
  const expectedKey = actionKey(expected);
  return actions.find((action) => actionKey(action) === expectedKey);
}

function failure(
  options: ExecuteOptions,
  actions: readonly GameAction[],
  error: RandomAgentError,
  stateBeforeFailure: Readonly<GameState> | null,
  stateAfterFailure: Readonly<GameState> | null = stateBeforeFailure,
  failedAfterAction = actions.length,
): RandomAgentFailure {
  const config = cloneConfig(options.config);
  const safeStateBeforeFailure = cloneState(stateBeforeFailure);
  const safeStateAfterFailure = cloneState(stateAfterFailure);
  const stateForMetadata = safeStateAfterFailure ?? safeStateBeforeFailure;
  return {
    gameIndex: options.gameIndex,
    seed: options.seed,
    version: stateForMetadata?.gameVersion ?? config.version ?? null,
    config,
    mapId: stateForMetadata?.mapId ?? config.mapId ?? null,
    actions: actions.map(cloneAction),
    failedAfterAction,
    error,
    stateBeforeFailure: safeStateBeforeFailure,
    stateAfterFailure: safeStateAfterFailure,
    // Keep the old top-level field readable by older tooling while making
    // the post-failure meaning explicit for new artifacts.
    state: safeStateAfterFailure,
    replay: {
      seed: options.seed,
      config: cloneConfig(config),
      actions: actions.map(cloneAction),
    },
  };
}

function normalizeStepState(result: StepResult, fallback: Readonly<GameState>): Readonly<GameState> {
  return result.state ?? fallback;
}

/**
 * Capture the engine's current state without allowing a broken getState()
 * implementation to hide the last known-good snapshot.
 */
function captureCurrentState(game: HeadlessGame | null, fallback: Readonly<GameState> | null): GameState | null {
  if (game) {
    try {
      return cloneState(game.getState());
    } catch {
      // Fall through to the last state that passed the invariant check.
    }
  }
  return cloneState(fallback);
}

function failureAfterState(original: RandomAgentFailure): GameState | null {
  // Artifacts generated before stateAfterFailure was introduced only have
  // `state`; use it as a compatibility fallback when replaying them.
  return original.stateAfterFailure ?? original.state ?? original.stateBeforeFailure ?? null;
}

/**
 * Execute one game using only HeadlessGame and its legal-action list.
 *
 * `assertState` is injectable for this module's unit tests; production callers
 * leave it unset and get the core assertInvariants function above.
 */
export function runRandomGame(
  factory: HeadlessGameFactory,
  options: ExecuteOptions,
  assertState: (state: Readonly<GameState>) => void = assertInvariants,
): SingleGameResult {
  const actions: GameAction[] = [];
  let game: HeadlessGame | null = null;
  let state: Readonly<GameState> | null = null;
  let lastNormalState: GameState | null = null;
  try {
    game = factory(options.config, options.seed);
    state = cloneState(game.reset(options.seed, cloneConfig(options.config)));
    if (!state) throw new Error('Headless game reset returned no state');
    assertState(state);
    lastNormalState = cloneState(state);
  } catch (error) {
    return {
      failure: failure(
        options,
        actions,
        errorFromUnknown(error, 'GAME_INITIALIZATION_FAILED'),
        null,
        captureCurrentState(game, state),
      ),
      actions,
    };
  }

  // The successful initialization path above always establishes both
  // references. Keep the guard explicit for TypeScript and for a defensive
  // failure artifact if a custom factory violates that expectation.
  if (!game || !state) {
    return {
      failure: failure(
        options,
        actions,
        { code: 'GAME_INITIALIZATION_FAILED', message: 'Headless game did not initialize a state' },
        null,
        captureCurrentState(game, state),
      ),
      actions,
    };
  }

  // `game` is assigned by the successful initialization block above. Keep a
  // local non-null alias so the loop can continue to snapshot it defensively.
  const runningGame: HeadlessGame = game!;

  const actionRng = new SeededRng((options.seed ^ options.actionRngSalt) >>> 0);
  let currentTurn = state.turn;
  let actionsThisTurn = 0;
  let actionCount = 0;

  while (!runningGame.isGameOver() && !state.gameOver) {
    if (state.turn > options.maxTurns) {
      return {
        failure: failure(
          options,
          actions,
          { code: 'TURN_SAFETY_LIMIT', message: `Turn ${state.turn} exceeded safety limit ${options.maxTurns}` },
          lastNormalState,
          captureCurrentState(runningGame, lastNormalState),
        ),
        actions,
      };
    }
    if (actionCount >= options.maxGameActions) {
      return {
        failure: failure(
          options,
          actions,
          {
            code: 'GAME_ACTION_SAFETY_LIMIT',
            message: `Action count ${actionCount} exceeded safety limit ${options.maxGameActions}`,
          },
          lastNormalState,
          captureCurrentState(runningGame, lastNormalState),
        ),
        actions,
      };
    }

    let legalActions: GameAction[];
    try {
      legalActions = runningGame.getLegalActions();
    } catch (error) {
      return {
        failure: failure(
          options,
          actions,
          errorFromUnknown(error, 'LEGAL_ACTIONS_FAILED'),
          lastNormalState,
          captureCurrentState(runningGame, lastNormalState),
        ),
        actions,
      };
    }
    if (legalActions.length === 0) {
      return {
        failure: failure(
          options,
          actions,
          { code: 'NO_LEGAL_ACTIONS', message: 'Headless game was not over but returned no legal actions' },
          lastNormalState,
          captureCurrentState(runningGame, lastNormalState),
        ),
        actions,
      };
    }

    const endTurns = legalActions.filter(isEndTurn);
    let action: GameAction;
    if (actionsThisTurn >= options.maxActionsPerTurn) {
      if (endTurns.length === 0) {
        return {
          failure: failure(
            options,
            actions,
            {
              code: 'END_TURN_NOT_LEGAL_AT_LIMIT',
              message: `Reached ${options.maxActionsPerTurn} actions in turn ${state.turn}, but EndTurn is not legal`,
            },
            lastNormalState,
            captureCurrentState(runningGame, lastNormalState),
          ),
          actions,
        };
      }
      action = sortActions(endTurns)[0]!;
    } else {
      action = chooseAction(legalActions, actionRng);
    }

    const actionIndex = actions.length;
    // This snapshot must be taken before step(). Some engines mutate their
    // internal state in place before returning an error or throwing.
    const stateBeforeStep: GameState = cloneState(lastNormalState ?? state) ?? state;
    actions.push(cloneAction(action));
    let result: StepResult;
    try {
      result = runningGame.step(action);
    } catch (error) {
      return {
        failure: failure(
          options,
          actions,
          errorFromUnknown(error, 'STEP_THREW'),
          stateBeforeStep,
          captureCurrentState(runningGame, stateBeforeStep),
          actionIndex + 1,
        ),
        actions,
      };
    }
    const stateAfterStep = cloneState(normalizeStepState(result, stateBeforeStep));
    const stateAfterAction: GameState = stateAfterStep ?? stateBeforeStep;
    state = stateAfterAction;
    if (result.error) {
      return {
        failure: failure(
          options,
          actions,
          {
            code: result.error.code || 'STEP_RETURNED_ERROR',
            message: result.error.message,
          },
          stateBeforeStep,
          stateAfterAction,
          actionIndex + 1,
        ),
        actions,
      };
    }
    try {
      assertState(stateAfterAction);
    } catch (error) {
      return {
        failure: failure(
          options,
          actions,
          errorFromUnknown(error, 'INVARIANT_VIOLATION_AFTER_ACTION'),
          stateBeforeStep,
          stateAfterAction,
          actionIndex + 1,
        ),
        actions,
      };
    }

    // From here on, this state is the latest state known to satisfy all
    // invariants. It becomes the pre-step snapshot for the next action.
    lastNormalState = cloneState(stateAfterAction);
    actionCount += 1;
    if (stateAfterAction.turn !== currentTurn) {
      currentTurn = stateAfterAction.turn;
      actionsThisTurn = 0;
      try {
        // Keep the explicit turn-level assertion even though the action-level
        // assertion above already checked the same state.
        assertState(stateAfterAction);
      } catch (error) {
        return {
          failure: failure(
            options,
            actions,
            errorFromUnknown(error, 'INVARIANT_VIOLATION_AFTER_TURN'),
            lastNormalState,
            stateAfterAction,
            actionIndex + 1,
          ),
          actions,
        };
      }
    } else {
      actionsThisTurn += 1;
    }
  }

  return { failure: null, actions };
}

function normalizedOptions(options: RandomAgentOptions): RandomAgentRunOptions {
  const config = cloneConfig(options.config ?? createDefaultConfig());
  const maxActionsPerTurn = options.maxActionsPerTurn ?? config.maxActionsPerTurn ?? DEFAULT_MAX_ACTIONS_PER_TURN;
  const maxTurns = options.maxTurns ?? Math.max(config.maxTurns, DEFAULT_MAX_TURNS);
  const maxGameActions = options.maxGameActions ?? maxTurns * maxActionsPerTurn + maxTurns;
  if (!Number.isSafeInteger(maxActionsPerTurn) || maxActionsPerTurn < 1) {
    throw new Error('--maxActions must be a positive integer');
  }
  if (!Number.isSafeInteger(maxTurns) || maxTurns < 1) {
    throw new Error('--maxTurns must be a positive integer');
  }
  if (!Number.isSafeInteger(maxGameActions) || maxGameActions < 1) {
    throw new Error('--maxGameActions must be a positive integer');
  }
  const actionRngSalt = options.actionRngSalt ?? DEFAULT_ACTION_RNG_SALT;
  if (!Number.isSafeInteger(actionRngSalt)) {
    throw new Error('actionRngSalt must be a safe integer');
  }
  return { config, maxActionsPerTurn, maxTurns, maxGameActions, actionRngSalt };
}

function seedList(options: RandomAgentOptions): number[] {
  if (options.seeds && options.seeds.length > 0) {
    return options.seeds.map((seed) => {
      if (!Number.isSafeInteger(seed)) throw new Error('Every seed must be a safe integer');
      return seed;
    });
  }
  const games = options.games ?? 100;
  if (!Number.isSafeInteger(games) || games < 1) {
    throw new Error('--games must be a positive integer');
  }
  const start = options.seed ?? 1;
  if (!Number.isSafeInteger(start)) {
    throw new Error('--seed must be a safe integer');
  }
  return Array.from({ length: games }, (_, index) => start + index);
}

/** Run distinct deterministic seeds and retain complete failure artifacts. */
export function runRandomGames(
  factory: HeadlessGameFactory,
  options: RandomAgentOptions = {},
  assertState: (state: Readonly<GameState>) => void = assertInvariants,
): RandomAgentRunReport {
  const started = Date.now();
  const runOptions = normalizedOptions(options);
  const seeds = seedList(options);
  const failures: RandomAgentFailure[] = [];
  let gamesCompleted = 0;
  for (let gameIndex = 0; gameIndex < seeds.length; gameIndex += 1) {
    const seed = seeds[gameIndex]!;
    const result = runRandomGame(
      factory,
      {
        ...runOptions,
        gameIndex,
        seed,
        assertState,
      },
      assertState,
    );
    gamesCompleted += 1;
    if (result.failure) {
      failures.push(result.failure);
      if (options.stopOnFailure) break;
    }
  }
  return {
    ok: failures.length === 0 && gamesCompleted === seeds.length,
    gamesRequested: seeds.length,
    gamesCompleted,
    failures,
    durationMs: Date.now() - started,
    options: {
      maxActionsPerTurn: runOptions.maxActionsPerTurn,
      maxTurns: runOptions.maxTurns,
      maxGameActions: runOptions.maxGameActions,
      actionRngSalt: runOptions.actionRngSalt,
    },
  };
}

/** Replay one failure artifact with the original Seed, Config, and Action列. */
export function replayFailure(
  factory: HeadlessGameFactory,
  original: RandomAgentFailure,
  assertState: (state: Readonly<GameState>) => void = assertInvariants,
): ReplayReport {
  let game: HeadlessGame | null = null;
  let state: Readonly<GameState> | null = null;
  let actualError: RandomAgentError | null = null;
  let mismatch: string | null = null;
  try {
    game = factory(original.replay.config, original.replay.seed);
    state = cloneState(game.reset(original.replay.seed, cloneConfig(original.replay.config)));
    if (!state) throw new Error('Headless game reset returned no state');
    assertState(state);
  } catch (error) {
    actualError = errorFromUnknown(error, 'REPLAY_INITIALIZATION_FAILED');
    return {
      reproduced: false,
      seed: original.seed,
      actionsReplayed: 0,
      expectedError: original.error,
      actualError,
      expectedState: failureAfterState(original),
      actualState: captureCurrentState(game, state),
      mismatch: actualError.message,
    };
  }

  const replayGame: HeadlessGame = game!;

  for (let index = 0; index < original.replay.actions.length; index += 1) {
    const expectedAction = original.replay.actions[index]!;
    let legal: GameAction[];
    try {
      legal = replayGame.getLegalActions();
    } catch (error) {
      actualError = errorFromUnknown(error, 'REPLAY_LEGAL_ACTIONS_FAILED');
      state = captureCurrentState(replayGame, state);
      mismatch = actualError.message;
      break;
    }
    const legalAction = findMatchingAction(legal, expectedAction);
    if (!legalAction) {
      actualError = {
        code: 'REPLAY_ACTION_NOT_LEGAL',
        message: `Action ${index + 1} (${actionKey(expectedAction)}) was not legal during replay`,
      };
      mismatch = actualError.message;
      break;
    }
    const stateBeforeStep = cloneState(state);
    try {
      const result = replayGame.step(legalAction);
      state = cloneState(normalizeStepState(result, stateBeforeStep ?? state));
      if (result.error) {
        actualError = { code: result.error.code, message: result.error.message };
        break;
      }
    } catch (error) {
      actualError = errorFromUnknown(error, original.error.code);
      state = captureCurrentState(replayGame, stateBeforeStep);
      break;
    }
    if (!state) {
      actualError = { code: original.error.code, message: 'Replay step returned no state' };
      break;
    }
    try {
      assertState(state);
    } catch (error) {
      // Preserve the original error code so the replay result answers the
      // useful question: did the same invariant/step failure recur?
      actualError = errorFromUnknown(error, original.error.code);
      break;
    }
  }

  const expectedFailureState = failureAfterState(original);
  // Compare the post-failure snapshot even when the replay raised the same
  // error code/message. A matching exception with a different mutated state
  // is not a deterministic reproduction.
  if (!mismatch && expectedFailureState && state) {
    const expectedJson = JSON.stringify(expectedFailureState);
    const actualJson = JSON.stringify(state);
    if (expectedJson !== actualJson) {
      mismatch = 'Final replay state differs from the original failure state';
    }
  }
  const safetyFailure = new Set([
    'TURN_SAFETY_LIMIT',
    'GAME_ACTION_SAFETY_LIMIT',
    'END_TURN_NOT_LEGAL_AT_LIMIT',
  ]).has(original.error.code);
  if (
    !mismatch &&
    !actualError &&
    !safetyFailure &&
    original.failedAfterAction === original.replay.actions.length &&
    (original.error.code === 'LEGAL_ACTIONS_FAILED' || original.error.code === 'NO_LEGAL_ACTIONS')
  ) {
    try {
      const legalAtFailure = replayGame.getLegalActions();
      if (original.error.code === 'NO_LEGAL_ACTIONS' && legalAtFailure.length === 0) {
        actualError = { code: original.error.code, message: original.error.message };
      } else {
        mismatch = 'Expected the legal-action query to fail during replay, but it returned normally';
      }
    } catch (error) {
      actualError = errorFromUnknown(error, original.error.code);
    }
  }
  if (!mismatch && !actualError && !safetyFailure && original.failedAfterAction !== original.replay.actions.length) {
    mismatch = `Expected failure after action ${original.failedAfterAction}, but replay completed`;
  }
  const errorMatches =
    actualError !== null &&
    actualError.code === original.error.code &&
    actualError.message === original.error.message;
  const stateMatches =
    expectedFailureState !== null &&
    state !== null &&
    JSON.stringify(expectedFailureState) === JSON.stringify(state);
  return {
    // A safety-limit failure is reproduced when the same deterministic Action
    //列 reaches the same final state; no engine exception is expected there.
    reproduced: !mismatch && (errorMatches || (safetyFailure && stateMatches)),
    seed: original.seed,
    actionsReplayed: original.replay.actions.length,
    expectedError: original.error,
    actualError,
    expectedState: expectedFailureState,
    actualState: cloneState(state),
    mismatch,
  };
}

export function randomAgentInvariantChecker(state: Readonly<GameState>): void {
  assertInvariants(state);
}
