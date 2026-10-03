import { describe, it, expect } from 'vitest';
import { createDefaultConfig } from './config';
import { beginTurnPresentation, capturePresentation, finishTurnPresentation } from './presentation';
import { createInitialState } from './state';
import { deriveCrisisSummary } from './crisis';
import { createPublicFacilityProjection } from './public-entities';

describe('v1.6.9 public regressions', () => {
  it('keeps a critical missing-active warning without a loss event, until restored', () => {
    const state = createInitialState(6, createDefaultConfig({mapMode:'fixed'}));
    const branch = state.roadBranches[0]!;
    const active = branch.activeCheckpointId;
    branch.activeCheckpointId = null;
    state.events = [];
    for (const turn of [2, 3, 4]) {
      state.turn = turn;
      const before = JSON.stringify(state);
      expect(deriveCrisisSummary(state)).toContainEqual(expect.objectContaining({
        reasonCode: 'checkpoint_active_missing', severity: 'critical', entityIds: [branch.branchId],
      }));
      expect(JSON.stringify(state)).toBe(before);
    }
    branch.activeCheckpointId = active;
    expect(deriveCrisisSummary(state).some(a => a.reasonCode === 'checkpoint_active_missing' && a.entityIds.includes(branch.branchId))).toBe(false);
  });
  it('distinguishes private infection counts from a known zero', () => {
    const state = createInitialState(6, createDefaultConfig({mapMode:'fixed'}));
    const facility = state.facilities.find(f => f.owner !== 'player')!;
    expect(createPublicFacilityProjection(facility, state).infectedPopulation).toBeNull();
    facility.owner = 'player'; facility.infected = 0;
    expect(createPublicFacilityProjection(facility, state).infectedPopulation).toBe(0);
    facility.infected = 7;
    expect(createPublicFacilityProjection(facility, state).infectedPopulation).toBe(7);
  });
});



it('keeps unknown infection null in visible playback snapshots and deltas',()=>{
  const state=createInitialState(6,createDefaultConfig({mapMode:'fixed'}));
  const facility=state.facilities.find(f=>f.owner!=='player')!;
  state.units.find(u=>u.isPlayerUnit)!.position={...facility.position};facility.infected=7;
  beginTurnPresentation(state);facility.infected=9;facility.status='ruined';capturePresentation(state);
  const p=finishTurnPresentation(state)!;
  expect(p.base.facilities.find(f=>f.id===facility.id)!.infectedPopulation).toBeNull();
  expect(p.frames.flatMap(f=>f.facilities?.upsert??[]).find(f=>f.id===facility.id)!.infectedPopulation).toBeNull();
});
