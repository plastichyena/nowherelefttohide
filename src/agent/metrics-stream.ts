import type { GameAction } from '../core/types';
import type { PublicDecisionRecord } from '../session/types';
import type { AgentGameResult, AgentObservation, AgentPublicEvent, InvalidActionAttempt } from './types';
import { cloneJson } from './action';
import { ObservationHistory, metricObservation } from './history';
import { collectGameMetrics, type GameMetricsInput } from './metrics';

export type GameMetricsStreamMetadata = Omit<GameMetricsInput,
  'initialObservation' | 'finalObservation' | 'observations' | 'actions' | 'events'
  | 'invalidAttempts' | 'invalidAttemptCount' | 'totalAgentDecisions' | 'result'>;

/**
 * Consume Session records one at a time. Only the current projection is
 * expanded; historic projections use compressed snapshots/diffs and a lazy
 * view. collectGameMetrics also retains turn indices instead of observations.
 */
export function createGameMetricsAccumulator(metadata: GameMetricsStreamMetadata, initialObservation: AgentObservation) {
  const initial = metricObservation(initialObservation);
  const history = new ObservationHistory();
  history.push(initial);
  const actions: GameAction[] = [];
  const events: AgentPublicEvent[] = [];
  const invalidAttempts: InvalidActionAttempt[] = [];
  let decisions = 0;
  return {
    pushDecision({ record, observationAfter }: { record: Pick<PublicDecisionRecord, 'decision' | 'inputAction' | 'accepted' | 'error' | 'events'>; observationAfter?: AgentObservation }) {
      if (record.accepted && !observationAfter) throw new Error('Accepted metrics Decision requires its public Observation');
      decisions += 1;
      events.push(...cloneJson(record.events));
      if (record.accepted) {
        actions.push(cloneJson(record.inputAction));
        history.push(metricObservation(observationAfter!));
      } else if (record.error) {
        invalidAttempts.push({ decision: record.decision, action: cloneJson(record.inputAction), error: cloneJson(record.error) });
      }
    },
    finish(finalObservation: AgentObservation, result: AgentGameResult | null) {
      return collectGameMetrics({ ...metadata, initialObservation: initial,
        finalObservation: metricObservation(finalObservation), observations: history.view(),
        actions, events, invalidAttempts, invalidAttemptCount: invalidAttempts.length,
        totalAgentDecisions: decisions, result });
    },
  };
}
