import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from './config';
import { createInitialState } from './state';
import { workerAssignmentCandidates, populationTransferCandidates } from './engine';
import { createPublicFacilityProjection } from './public-entities';
import { prepareTestSnapshot } from './testConfig';
import { createAgentObservation } from '../agent/observation';

describe('v1.6.7 unowned population boundary', () => {
  function pair() {
    const left = createInitialState(4, createDefaultConfig());
    const right = structuredClone(left);
    for (const f of right.facilities.filter(f => f.owner !== 'player')) f.workers = f.workerCapacity;
    for (const f of left.facilities.filter(f => f.owner !== 'player')) f.workers = 0;
    prepareTestSnapshot(left, true); prepareTestSnapshot(right, true);
    return [left, right] as const;
  }
  it('does not expose survivors through worker candidates, sources or transfer reasons', () => {
    const [left, right] = pair();
    expect(workerAssignmentCandidates(left)).toEqual(workerAssignmentCandidates(right));
    expect(populationTransferCandidates(left)).toEqual(populationTransferCandidates(right));
    const hidden = workerAssignmentCandidates(right).find(f => right.facilities.find(s => s.id === f.facilityId)!.owner !== 'player')!;
    expect(hidden.currentWorkers).toBeNull();
    expect(hidden.populationSources.find(f => right.facilities.find(s => s.id === f.facilityId)!.owner !== 'player')!.healthyPopulation).toBeNull();
  });
  it('does not expose survivors in facility production or recovery conditions', () => {
    const [left, right] = pair();
    expect(left.facilities.map(f => createPublicFacilityProjection(f, left)))
      .toEqual(right.facilities.map(f => createPublicFacilityProjection(f, right)));
    expect(createPublicFacilityProjection(right.facilities.find(f => f.owner !== 'player')!, right).healthyPopulation).toBeNull();
  });
  it('keeps the entire initial public observation independent of hidden counts', () => {
    const [left, right] = pair();
    expect(createAgentObservation(left)).toEqual(createAgentObservation(right));
  });
  it('reveals actual survivors only after ownership changes', () => {
    const [, state] = pair();
    const candidate = workerAssignmentCandidates(state).find(c => state.facilities.find(f => f.id === c.facilityId)!.owner !== 'player')!;
    const facility = state.facilities.find(f => f.id === candidate.facilityId)!;
    expect(createPublicFacilityProjection(facility, state).healthyPopulation).toBeNull();
    facility.owner = 'player';
    expect(createPublicFacilityProjection(facility, state).healthyPopulation).toBe(facility.workers);
    expect(workerAssignmentCandidates(state).find(f => f.facilityId === facility.id)!.currentWorkers).toBe(facility.workers);
  });
});
