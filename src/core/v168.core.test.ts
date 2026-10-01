import type { GameState } from './types';
import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from './config';
import { createInitialState, createUnit } from './state';
import { refugeeArrivalRange } from './refugees';
import { screeningProbability, waitingProbability, forecastPublicHealth } from './public-health';
import { wireBuildReason, wireCandidates } from './barbed-wire';
import { hexDistance, hexKey, hexNeighbors } from './hex';
import { createMapReference } from './map-reference';
import { GameEngine,findZombieTargetPath } from './engine';
import { prepareTestSnapshot, singleFinalWave } from './testConfig';
import { createMovement } from './movement';
import { ZOMBIE_UNIT_TYPES } from './unit-catalog';

const quietConfig = () => createDefaultConfig({ economy: { initialZombieCount: 0, initialScreamerCount: 0, initialHunterCount: { min: 0, max: 0 }, initialGasCount: { min: 0, max: 0 } }, horde: singleFinalWave(200) });
const wall = (q: number, r: number, hp = 20) => ({ id: `wire-${q}-${r}`, position: { q, r }, hp, maxHp: 20, builtTurn: 1 });

describe('v1.6.8 refugees and crowding', () => {
  it.each([[1,20],[2,20],[3,21],[20,29],[21,30],[41,40],[61,50],[69,54],[201,120]])('uses resolving turn %i upper %i', (turn, max) => {
    expect(refugeeArrivalRange(createDefaultConfig().refugees, turn)).toEqual({ min: 10, max });
  });
  it.each([false,true])('draws integer endpoints on all four branches (unmanaged=%s)', unmanaged => {
    const seen = new Set<number>();
    for (let seed = 1; seed <= 12; seed++) {
      const config = quietConfig(); config.refugees.arrivalPeopleMin = 20; config.refugees.arrivalPeopleMax = 20;
      const engine = new GameEngine(seed, config), state = engine.getState() as GameState; state.turn = 3;
      if (unmanaged) { state.checkpoints = []; for (const b of state.roadBranches) { b.activeCheckpointId = null; b.standbyCheckpointIds = []; } }
      for (const b of state.roadBranches) b.nextArrivalTurn = 3;
      for (const c of state.checkpoints) c.nextArrivalTurn = 3;
      prepareTestSnapshot(state);
      expect(engine.step({ type: 'LoadSnapshot', snapshot: state }).error).toBeNull();
      const result = engine.step({ type: 'EndTurn' }); expect(result.error).toBeNull();
      const arrivals = result.events.filter(e => e.type === 'refugees_arrived'); expect(arrivals).toHaveLength(4);
      for (const e of arrivals) { const people = Number(e.payload.people); expect([20,21]).toContain(people); seen.add(people); }
    }
    expect([...seen].sort()).toEqual([20,21]);
    expect(refugeeArrivalRange({ ...createDefaultConfig().refugees, arrivalGrowthPeople: 0 }, 100)).toEqual({ min: 10, max: 20 });
  });
  it.each([[60,0,.25],[61,.01/60,.25*(1+.5/60)],[120,.01,.375],[180,.02,.375]])('waiting %i has independent threshold', (waiting,pWait,pPass) => {
    expect(waitingProbability(waiting,60,{food:0,civilianGoods:0})).toBeCloseTo(pWait);
    expect(screeningProbability('passThrough',waiting,60,{food:0,civilianGoods:0})).toBeCloseTo(pPass);
    expect(screeningProbability('normal',waiting,60,{food:1,civilianGoods:1})).toBe(.05);
    expect(screeningProbability('strict',waiting,60,{food:1,civilianGoods:1})).toBe(0);
  });
});

describe('v1.6.8 wall topology', () => {
  function stage() {
    const state = createInitialState(1, quietConfig());
    const center = { q: 25, r: 25 };
    state.units = []; state.checkpoints = []; state.facilities = [];
    const keys = new Set(state.map.tiles.map(hexKey));
    return { state, center, context: { map: createMapReference(state.map), visible: keys, supplied: keys } };
  }
  it('accepts a closed six-wall ring in either construction order', () => {
    for (const reverse of [false,true]) {
      const { state, center, context } = stage(); const ring = hexNeighbors(center); if (reverse) ring.reverse();
      for (const p of ring) { expect(wireBuildReason(state,p,context)).toBeNull(); state.barbedWire.push(wall(p.q,p.r)); }
      expect(state.barbedWire).toHaveLength(6);
    }
  });
  it('checks existing wall degree as well as the newly placed wall; ignores HP0', () => {
    const { state, context } = stage();
    state.barbedWire = [wall(24,25),wall(25,25),wall(26,25)];
    expect(wireBuildReason(state,{q:25,r:24},context)).toBe('too_many_adjacent_walls');
    state.barbedWire[2]!.hp = 0;
    expect(wireBuildReason(state,{q:25,r:24},context)).toBeNull();
  });
  it('returns visibility first regardless of hidden walls or enemies', () => {
    const { state, context } = stage(); const p={q:25,r:25}; state.barbedWire=[wall(26,25)];
    context.visible.delete('27,25');
    expect(wireBuildReason(state,p,context)).toBe('visibility_required');
    state.barbedWire.push(wall(27,25)); state.units.push(createUnit(state,'hidden','zombie',{q:27,r:25}));
    expect(wireBuildReason(state,p,context)).toBe('visibility_required');
  });
});

describe('v1.6.8 wall combat and performance', () => {
  it('chooses the shorter high-MP path over a longer road, but pays terrain MP while moving',()=>{
    const state=createInitialState(16,quietConfig());state.map=structuredClone(state.map);delete state.map.roads;
    for(const t of state.map.tiles){t.road=false;t.terrain='mountain';}
    for(const p of [{q:21,r:24},{q:22,r:23},{q:23,r:23},{q:24,r:23},{q:25,r:23},{q:25,r:24}])state.map.tiles.find(t=>hexKey(t)===hexKey(p))!.road=true;
    state.units=[];for(const f of state.facilities)if(f.type!=='capital')f.workers=0;
    for(const c of state.checkpoints){c.waiting=c.screening=c.approved=c.infected=0;c.nextArrivalTurn=99;}
    for(const b of state.roadBranches)b.nextArrivalTurn=99;
    const z=createUnit(state,'short-route','hordeZombie',{q:21,r:25});z.movement=3;state.units.push(z);prepareTestSnapshot(state);
    const route=findZombieTargetPath(state,z,{position:{q:25,r:25},population:100})!;
    expect(route.path.slice(0,3)).toEqual([{q:21,r:25},{q:22,r:25},{q:23,r:25}]);
    const move=createMovement({ resolveOverrun: () => { throw new Error("Unexpected IFV"); }, emitMoveNoise: () => { throw new Error("Unexpected IFV"); },emergencyLand:()=>{},interceptorsAt:()=>[],interceptArmyBase:()=>false,resolveCombat:()=>{},tryCapture:()=>{}});
    move.applyMovement(state,z,route.path,3);expect(z.position).toEqual({q:22,r:25});
  });
  it('stops arrivals when the final roster freezes, including all unmanaged branches',()=>{
    const config=quietConfig();config.horde=singleFinalWave(1);const e=new GameEngine(17,config),state=e.getState() as GameState;
    state.checkpoints=[];for(const b of state.roadBranches){b.activeCheckpointId=null;b.standbyCheckpointIds=[];b.nextArrivalTurn=1;}
    prepareTestSnapshot(state);expect(e.step({type:'LoadSnapshot',snapshot:state}).error).toBeNull();
    const result=e.step({type:'EndTurn'});expect(result.error).toBeNull();
    expect(result.events.some(event=>event.type==='refugee_arrivals_ended')).toBe(true);
    const next=e.step({type:'EndTurn'});expect(next.error).toBeNull();
    expect(next.events.filter(event=>event.type==='refugees_arrived')).toHaveLength(0);
    expect(result.state.roadBranches.every(b=>b.nextArrivalTurn===null)).toBe(true);
  });
  it('waiting infection draws use the same threshold and stress as the forecast for a remnant queue',()=>{
    const state=createInitialState(18,quietConfig());const c=state.checkpoints[0]!;
    state.units=state.units.filter(u=>u.isPlayerUnit);c.status='remnant';c.waiting=180;c.screening=0;c.approved=0;c.infected=0;
    const b=state.roadBranches.find(b=>b.branchId===(c.branchId??c.direction))!;b.activeCheckpointId=null;b.currentPolicy='deny';
    for(const branch of state.roadBranches)branch.nextArrivalTurn=99;for(const post of state.checkpoints)post.nextArrivalTurn=99;
    state.resources.food=100000;state.resources.civilianGoods=100000;prepareTestSnapshot(state);
    const e=new GameEngine(state.seed,state.config);expect(e.step({type:'LoadSnapshot',snapshot:state}).error).toBeNull();
    const result=e.step({type:'EndTurn'});expect(result.error).toBeNull();
    const event=result.events.find(event=>event.type==='checkpoint_waiting_risk_infection'&&event.payload.checkpointId===c.id);
    expect(event?.payload).toMatchObject({probability:.02,populationAtRisk:180});
    expect(Number(event?.payload.infected)).toBeGreaterThan(0);
  });
  it.each(ZOMBIE_UNIT_TYPES)('%s attacks the next adjacent wall with zero remaining MP and stops', type => {
    const state=createInitialState(1,quietConfig()); state.units=[];
    const p={q:25,r:24}, z=createUnit(state,'enemy',type,{q:24,r:24});state.units=[z];state.barbedWire=[wall(p.q,p.r)];
    const move=createMovement({ resolveOverrun: () => { throw new Error("Unexpected IFV"); }, emitMoveNoise: () => { throw new Error("Unexpected IFV"); }, emergencyLand:()=>{throw Error('ground');},interceptorsAt:()=>[],interceptArmyBase:()=>false,resolveCombat:()=>{throw Error('empty wall');},tryCapture:()=>{} });
    const before=z.attackChargesRemaining; move.applyMovement(state,z,[z.position,p],0);
    expect(z.position).toEqual({q:24,r:24});expect(z.attackChargesRemaining).toBeLessThan(before);
    expect(state.barbedWire[0]?.hp??0).toBeLessThan(20);
    z.canAttack=false;z.attackChargesRemaining=0;state.barbedWire=[wall(p.q,p.r)];move.applyMovement(state,z,[z.position,p],100);
    expect(z.position).toEqual({q:24,r:24});expect(state.barbedWire[0]!.hp).toBe(20);
  });
  it('sets Riot Zombie HP75 without changing human Riot Police', () => {
    const state=createInitialState(1,quietConfig());expect(createUnit(state,'r','riotZombie',{q:25,r:24})).toMatchObject({hp:75,maxHp:75,attack:5,movement:3});
    expect(state.config.units.riotPolice.hp).toBe(75);
  });
});
