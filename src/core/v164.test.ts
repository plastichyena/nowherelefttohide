import { publicMoveCandidates } from '../agent/public-movement';
import { describe, expect, it } from 'vitest';
import { GameEngine } from './engine';
import { createDefaultConfig } from './config';
import { prepareTestSnapshot } from './testConfig';
import { createUnit } from './state';
import { createAgentObservation } from '../agent/observation';
import { queryRoute } from '../agent/route-query';
import type { GameState } from './types';
import { deriveCheckpointRole } from './supply';

export const quiet164 = () => createDefaultConfig({ economy: { initialZombieCount: 0, initialHunterCount: { min: 0, max: 0 }, initialGasCount: { min: 0, max: 0 }, initialScreamerCount: 0, initialResources: { food: 100000, civilianGoods: 100000, militaryGoods: 100000, fuel: 100000 } }, refugees: { arrivalIntervalMin: 99, arrivalIntervalMax: 99 } });
export function load164(engine: GameEngine, state: GameState) {
  prepareTestSnapshot(state);
  const result = engine.step({ type: 'LoadSnapshot', snapshot: state });
  expect(result.error?.message).toBeUndefined();
}

describe('v1.6.4 reported regressions', () => {
  it.each(['active','standby','dormant'] as const)('recovers as %s despite an adjacent enemy, without duplicating its event',role=>{
    const engine=new GameEngine(1,quiet164()),state=engine.getState() as GameState,cp=state.checkpoints[0]!;
    const branch=state.roadBranches.find(b=>b.branchId===cp.branchId)!;
    cp.status='ruined';cp.overrunProcessed=true;branch.activeCheckpointId=null;
    if(role!=='active'){
      const active={...cp,id:'other-active',position:{q:25,r:19},status:'operational' as const,overrunProcessed:false};
      state.checkpoints.push(active);branch.activeCheckpointId=active.id;
      if(role==='dormant')for(let i=0;i<state.config.checkpoint.maxPreparedPostsPerDirection-1;i++){
        const reserve={...active,id:`reserve-${i}`,position:{q:25,r:18-i}};
        state.checkpoints.push(reserve);branch.standbyCheckpointIds.push(reserve.id);
      }
    }
    state.units=[createUnit(state,'recovery-unit','police',cp.position),createUnit(state,'adjacent','zombie',{q:24,r:20}),createUnit(state,'other','police',{q:24,r:25})];
    load164(engine,state);
    const result=engine.step({type:'Wait',unitId:'recovery-unit'});expect(result.error?.message).toBeUndefined();
    const recovered=result.state.checkpoints.find(c=>c.id===cp.id)!;
    expect(deriveCheckpointRole(result.state,recovered)).toBe(role);expect(recovered.overrunProcessed).toBe(false);
    expect(result.events.filter(e=>e.type==='checkpoint_recovered')).toHaveLength(1);
    expect(engine.step({type:'Wait',unitId:'other'}).events.some(e=>e.type==='checkpoint_recovered')).toBe(false);
  });

  it.each(['infection','artillery','enemy'] as const)('does not recover when blocked by %s and exposes the public reason',reason=>{
    const engine=new GameEngine(1,quiet164()),state=engine.getState() as GameState,cp=state.checkpoints[0]!;
    cp.status='ruined';cp.overrunProcessed=true;cp.infected=reason==='infection'?1:0;
    state.roadBranches.find(b=>b.branchId===cp.branchId)!.activeCheckpointId=null;
    state.units=[createUnit(state,'occupant',reason==='enemy'?'zombie':reason==='artillery'?'fieldArtillery':'police',cp.position),createUnit(state,'other','police',{q:24,r:25})];
    load164(engine,state);
    const result=engine.step({type:'Wait',unitId:'other'});expect(result.error?.message).toBeUndefined();
    expect(result.state.checkpoints.find(c=>c.id===cp.id)?.status).toBe('ruined');
    const recovery=createAgentObservation(result.state).checkpoints.find(c=>c.id===cp.id)!.recovery!;
    expect(recovery.ready).toBe(false);
    expect(recovery.missing).toContain(reason==='infection'?'suppress_infection':reason==='enemy'?'clear_visible_enemy':'station_recovery_capable_unit');
  });
  it('allows the public route query to use a player Recon Team', () => {
    const engine = new GameEngine(1, quiet164());
    const observation = createAgentObservation(engine.getState());
    const unit = observation.units.find(u => u.type === 'reconTeam')!;
    const move = publicMoveCandidates(observation, unit.id)[0]!;
    expect(queryRoute(observation, { moverUnitId: unit.id, destination: { kind: 'coordinate', position: move.destination } }).currentSingleAction.reachable).toBe(true);
  });

  it('recovers an infection-free ruined checkpoint while a qualified unit is stationed there', () => {
    const engine = new GameEngine(1, quiet164()), state = engine.getState() as GameState;
    const checkpoint = state.checkpoints[0]!;
    checkpoint.status = 'ruined'; checkpoint.overrunProcessed = true;
    checkpoint.waiting = checkpoint.screening = checkpoint.approved = checkpoint.infected = 0;
    state.roadBranches.find(b => b.branchId === checkpoint.branchId)!.activeCheckpointId = null;
    state.units = [createUnit(state, 'recovery-unit', 'police', checkpoint.position)];
    load164(engine, state);
    const result = engine.step({ type: 'Wait', unitId: 'recovery-unit' });
    expect(result.error?.message).toBeUndefined();
    expect(result.state.checkpoints.find(c => c.id === checkpoint.id)?.status).toBe('operational');
    expect(result.events.filter(e => e.type === 'checkpoint_recovered')).toHaveLength(1);
  });
});
