import { expect, it } from 'vitest';
import { createInitialState } from '../core/state';
import { createDefaultConfig } from '../core/config';
import { createAgentObservation } from './observation';
import { deriveImportantChanges, summarizeImportantChanges } from './decision-summary';
import { facilityChanges } from './facility-changes';
import type { AgentPublicEvent } from './types';

it('keeps a staffed factory 30 to 19 loss with output deltas even when production continues', () => {
  const state = createInitialState(1, createDefaultConfig());
  const factory = state.facilities.find(f => f.id === 'civilian-factory-1')!;
  factory.workers = 30;
  const before = createAgentObservation(state);
  factory.workers = 19;
  const after = createAgentObservation(state);
  const events = [{ id: 'loss-1', turn: 1, phase: 'player', type: 'resource_shortage', payload: { facilityId: factory.id, people: 11 } }] as AgentPublicEvent[];
  const changes = deriveImportantChanges(before, after, events);
  expect(after.facilities.find(f => f.id === factory.id)!.production.stoppedReason).toBeNull();
  const expected = { facilityId: factory.id, healthyPopulation: { before: 30, after: 19, delta: -11, unintendedDelta: -11 }, infectedPopulation: { before: 0, after: 0 }, outputs: { civilianGoods: { before: 300, after: 190, delta: -110 } }, eventTypes: ['resource_shortage'] };
  expect(summarizeImportantChanges([{ decision: 1, changes }], 1, 1, 1).facilityChanges[0]).toMatchObject(expected);
  const intentional = [{ id: 'assign', turn: 1, phase: 'player', type: 'workers_assigned', payload: { facilityId: factory.id, difference: -11, workers: 19, movements: [{ facilityId: 'capital', people: 11 }] } }] as AgentPublicEvent[];
  expect(facilityChanges(before, after, intentional).find(change => change.facilityId === factory.id)).toBeUndefined();
  const mixed = [{ ...intentional[0]!, payload: { facilityId: factory.id, difference: -5, workers: 25, movements: [{ facilityId: 'capital', people: 5 }] } }, ...events];
  expect(facilityChanges(before, after, mixed).find(change => change.facilityId === factory.id)?.populationLoss?.healthyPopulation.unintendedDelta).toBe(-6);
});
