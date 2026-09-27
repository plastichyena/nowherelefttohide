import type { GameState, GameEventType, JsonObject, GameEvent } from './types';
import { capturePresentation } from './presentation';

/** Mutation helper for Engine-controlled effects only. */
export function emit(state: GameState, type: GameEventType, payload: JsonObject): GameEvent {
  const event: GameEvent = {
    id: `event-${state.nextEventNumber}`,
    turn: state.turn,
    phase: state.phase,
    type,
    payload,
  };
  state.events.push(event);
  state.nextEventNumber += 1;
  capturePresentation(state, event);
  return event;
}
