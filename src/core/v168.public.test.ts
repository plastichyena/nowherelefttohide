import { describe,it,expect } from 'vitest';
import { createDefaultConfig } from './config';
import { GameEngine, forecastEndTurn, getCheckpointPositionCandidates, getConstructibleFacilityPositionCandidates, validateAction } from './engine';
import { createInitialState,createUnit } from './state';
import { prepareTestSnapshot,singleFinalWave } from './testConfig';
import type { GameState } from './types';
import { previewCoreAction } from './action-preview';
import { destinationContactRisk } from './contact-risk';
import { beginTurnPresentation,capturePresentation,presentationActor,finishTurnPresentation,applyPresentationFrame,presentationEffects,type TurnPresentation } from './presentation';
import { hexKey,hexDistance } from './hex';
import { getPlayerVisibleTileKeys } from './visibility';

const config=()=>createDefaultConfig({mapMode:'fixed',economy:{initialZombieCount:0,initialScreamerCount:0,initialHunterCount:{min:0,max:0},initialGasCount:{min:0,max:0}},horde:singleFinalWave(200)});
function load(state:GameState){prepareTestSnapshot(state);const e=new GameEngine(state.seed,state.config);expect(e.step({type:'LoadSnapshot',snapshot:state}).error).toBeNull();return e;}

describe('v1.6.8 public contracts',()=>{
  it('previews all four retained pools and rejects the old active ID after relocation',()=>{
    const state=createInitialState(11,config());for(const u of state.units)u.vision=100;
    const c=state.checkpoints[0]!;c.branchId??=c.direction;c.waiting=61;c.screening=7;c.approved=3;c.infected=0;
    const e=load(state),before=e.getState();
    const candidate=getCheckpointPositionCandidates(before).find(p=>p.actionType==='RelocateCheckpoint'&&p.legal&&p.branchId===c.branchId)!;
    expect(candidate).toBeDefined();
    const action={type:'RelocateCheckpoint' as const,checkpointId:c.id,position:candidate.position};
    const preview=previewCoreAction(before,action,0);expect(preview.legal).toBe(true);
    expect(preview.checkpointRelocation).toMatchObject({oldCheckpointId:c.id,remaining:{waiting:61,screening:7,approved:3,infected:0},newActive:{id:null,position:candidate.position}});
    const result=e.step(action);expect(result.error).toBeNull();
    expect(result.state.checkpoints.find(p=>p.id===c.id)).toMatchObject(preview.checkpointRelocation!.remaining);
    expect(result.state.roadBranches.map(b=>b.nextArrivalTurn)).toEqual(before.roadBranches.map(b=>b.nextArrivalTurn));
    const active=result.state.roadBranches.find(b=>b.branchId===c.branchId)!.activeCheckpointId;
    expect(active).not.toBe(c.id);
    expect(e.step(action).error).toMatchObject({code:'unknown_operational_checkpoint',details:{reason:'checkpoint_not_active',activeCheckpointId:active}});
    expect(validateAction(result.state,{...action,checkpointId:'missing',branchId:c.branchId})).toMatchObject({code:'unknown_operational_checkpoint',details:{reason:'checkpoint_id_unknown',activeCheckpointId:active}});
    expect(result.events.find(v=>v.type==='checkpoint_relocated')?.payload).toMatchObject({sourceCheckpointId:c.id,checkpointId:active,branchId:c.branchId});
  });
  it('uses threshold60 in remnant waiting forecast regardless of screening capacity and other pools',()=>{
    const state=createInitialState(12,config()),c=state.checkpoints[0]!;
    c.waiting=120;c.screening=300;c.approved=300;c.infected=10;state.config.refugees.screeningCapacity=7;
    state.roadBranches.find(b=>b.branchId===c.branchId)!.activeCheckpointId=null;
    state.resources.food=100000;state.resources.civilianGoods=100000;prepareTestSnapshot(state);
    const f=forecastEndTurn(state).publicHealth.checkpoints.find(p=>p.checkpointId===c.id)!;
    expect(f.waiting).toBe(120);expect(f.probability).toBeCloseTo(.01);expect(f.expectedInfections).toBeCloseTo(1.2);
  });
  it('contact advice includes pursuit+3 and ignores private targets/memory/hidden enemies without mutating state',()=>{
    const state=createInitialState(2,config());state.units=state.units.filter(u=>u.isPlayerUnit);
    const human=state.units[0]!;human.position={q:25,r:25};human.vision=20;
    const z=createUnit(state,'visible','zombie',{q:29,r:25});state.units.push(z);
    const before=JSON.stringify(state),risk=destinationContactRisk(state,human.id,{q:25,r:25});
    expect(JSON.stringify(state)).toBe(before);
    expect(risk.enemies[0]).toMatchObject({enemyId:z.id,baseMovement:3,maximumNextMovement:6,attackRange:1,contactPossible:true});
    expect(risk.guaranteedSafe).toBe(false);
    z.inheritedTarget={q:1,r:1};z.noiseTarget={q:49,r:49};
    state.units.push(createUnit(state,'hidden','hunterZombie',{q:0,r:0}));
    expect(destinationContactRisk(state,human.id,{q:25,r:25})).toEqual(risk);
    expect(JSON.stringify(risk)).not.toMatch(/inheritedTarget|noiseTarget|pursuitActive|hidden"/);
  });
  it('builds at least seven simple farms, still rejecting occupied and unaffordable placements',()=>{
    const state=createInitialState(3,config());state.resources.civilianGoods=1000;state.config.maxActionsPerTurn=50;
    const e=load(state);
    for(let i=0;i<7;i++) {
      const p=getConstructibleFacilityPositionCandidates(e.getState(),'simpleFarm').find(p=>p.legal)!;
      expect(p).toBeDefined();expect(e.step({type:'BuildConstructibleFacility',facilityType:'simpleFarm',position:p.position}).error).toBeNull();
      expect(e.step({type:'BuildConstructibleFacility',facilityType:'simpleFarm',position:p.position}).error).not.toBeNull();
    }
    expect(e.getState().facilities.filter(f=>f.type==='simpleFarm')).toHaveLength(7);
    const poor=structuredClone(e.getState()) as GameState;poor.resources.civilianGoods=0;
    expect(getConstructibleFacilityPositionCandidates(poor,'simpleFarm').some(p=>p.legal)).toBe(false);
  });
});

describe('public presentation recording',()=>{
  it('shows visible gas chain explosions after their source units have died',()=>{
    const state=createInitialState(19,config());state.units=[];
    const guard=createUnit(state,'guard','riotPolice',{q:25,r:25});guard.vision=12;
    const first=createUnit(state,'a-gas','gasZombie',{q:26,r:25}),second=createUnit(state,'b-gas','gasZombie',{q:27,r:25});
    first.hp=1;second.hp=1;state.units.push(guard,first,second);
    const result=load(state).step({type:'EndTurn'});expect(result.error).toBeNull();
    expect(result.events.filter(e=>e.type==='gas_explosion')).toHaveLength(2);
    const p=result.events.find(e=>e.type==='zombie_presentation')!.payload as unknown as TurnPresentation;
    let current=p.base;const positions=[];
    for(const frame of p.frames){const next=applyPresentationFrame(current,frame);positions.push(...presentationEffects(current,next,frame).filter(e=>e.kind==='gas_explosion').map(e=>e.position));current=next;}
    expect(positions).toEqual([{q:26,r:25},{q:27,r:25}]);
  });
  it('records actual visible path steps, HP changes and appearances in order, with no hidden timing frames',()=>{
    const state=createInitialState(8,config());state.units=state.units.filter(u=>u.isPlayerUnit);const human=state.units[0]!;human.position={q:25,r:25};human.vision=12;
    const z=createUnit(state,'visible','zombie',{q:28,r:25}),hidden=createUnit(state,'secret','gasZombie',{q:0,r:0});state.units.push(z,hidden);
    beginTurnPresentation(state);presentationActor(state,hidden.id);hidden.position={q:1,r:0};hidden.hp--;capturePresentation(state);
    capturePresentation(state,{id:'hidden-explosion',turn:state.turn,phase:state.phase,type:'gas_explosion',payload:{sourceUnitId:hidden.id,q:1,r:0}});
    presentationActor(state,z.id);z.position={q:27,r:25};capturePresentation(state);z.position={q:26,r:25};capturePresentation(state);human.hp-=3;capturePresentation(state);
    const p=finishTurnPresentation(state)!;expect(p.frames).toHaveLength(3);expect(p.frames.every(f=>f.actorId===z.id)).toBe(true);
    expect(p.frames.flatMap(f=>f.units?.upsert.filter(u=>u.id===z.id).map(u=>u.position)??[])).toEqual([{q:27,r:25},{q:26,r:25}]);
    expect(JSON.stringify(p)).not.toContain('secret');expect(JSON.stringify(p)).not.toMatch(/inheritedTarget|noiseTarget|rngState|pursuitActive/);
    const after=p.frames.reduce(applyPresentationFrame,p.base);expect(after.units.find(u=>u.id===human.id)?.hp).toBe(human.hp);
    expect(JSON.stringify(p.frames)).not.toContain('map');
  });
  it('records entry into and exit from vision without a hidden destination',()=>{
    const state=createInitialState(10,config());state.units=state.units.filter(u=>u.isPlayerUnit);
    const visible=getPlayerVisibleTileKeys(state),inside=state.map.tiles.find(t=>visible.has(hexKey(t)))!,outside=state.map.tiles.find(t=>!visible.has(hexKey(t)))!;
    const z=createUnit(state,'entrant','zombie',outside);state.units.push(z);beginTurnPresentation(state);presentationActor(state,z.id);
    z.position={q:inside.q,r:inside.r};capturePresentation(state);z.position={q:outside.q,r:outside.r};capturePresentation(state);
    const p=finishTurnPresentation(state)!;expect(p.base.units.some(u=>u.id===z.id)).toBe(false);
    expect(p.frames[0]!.units!.upsert[0]!.position).toEqual({q:inside.q,r:inside.r});expect(p.frames[1]!.units!.remove).toContain(z.id);
    expect(p.frames[1]!.units!.upsert).toHaveLength(0);
  });
  it('Core EndTurn emits serializable public deltas and remains deterministic',()=>{
    const state=createInitialState(15,config());const a=load(state),b=load(state);
    const one=a.step({type:'EndTurn'}),two=b.step({type:'EndTurn'});expect(one.error).toBeNull();expect(two.state).toEqual(one.state);
    const p=one.events.find(e=>e.type==='zombie_presentation')?.payload as unknown as TurnPresentation;
    expect(p?.version).toBe(1);expect(()=>JSON.stringify(p)).not.toThrow();expect(p.frames.length).toBeGreaterThan(0);
  });
});
