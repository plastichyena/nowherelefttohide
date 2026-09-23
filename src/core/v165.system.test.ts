import { describe, expect, it } from 'vitest';
import { GameEngine, validateAction } from './engine';
import { createDefaultConfig } from './config';
import { createUnit } from './state';
import { prepareTestSnapshot } from './testConfig';
import type { GameAction, GameState } from './types';
import { productionCandidates, attackCandidates } from './action-candidates';
import { previewCoreAction } from './action-preview';
import { getPlayerVisibleTileKeys } from './visibility';
import { getGroundVisionCoverageFrom } from './visibility';
import { hexDistance, hexKey, hexNeighbors } from './hex';
import { validateInvariants } from './invariants';
import { exportSaveJson, importSaveJson } from '../persistence/save';
import { createAgentObservation } from '../agent/observation';
import { BalancedAgent } from '../agent/balancedAgent';
import { createAiSession } from '../session/ai-session';
import { AIR_BASE_CANDIDATES } from './map';
import { findShortestPath, pathMovementCost } from './path';
import { effectiveMovementCost } from './terrain';

const config=()=>createDefaultConfig({economy:{initialZombieCount:0,initialHunterCount:{min:0,max:0},initialGasCount:{min:0,max:0},initialScreamerCount:0,initialResources:{food:100000,civilianGoods:100000,militaryGoods:100000,fuel:100000}},refugees:{arrivalIntervalMin:99,arrivalIntervalMax:99}});
function load(engine:GameEngine,state:GameState){prepareTestSnapshot(state);expect(engine.step({type:'LoadSnapshot',snapshot:state}).error).toBeNull();}
function apply(engine:GameEngine,action:GameAction){const result=engine.step(action);expect(result.error).toBeNull();return result.state;}
function ownedAir(){const settings=config();settings.checkpoint.initialSupplyRadius=50;settings.facilities.powerPlant.production.powerGeneration=100;const engine=new GameEngine(1,settings),state=engine.getState() as GameState,base=state.facilities.find(f=>f.type==='airBase')!;base.owner='player';base.status='owned';base.operationalStatus='operational';base.workers=5;base.infected=0;base.securedOrder=Math.max(...state.facilities.map(f=>f.securedOrder??0))+1;base.populationOperationalTurn=1;base.firstCaptureRewardClaimed=true;state.airBaseObjective={firstCapturedTurn:1,reward:'expired',failureSpawn:'none',fellBeforeCapture:false};load(engine,state);return {engine,base};}

describe('v1.6.5 integrated public contracts',()=>{
  it('reserves a helicopter with exact costs, commissions full stores and preserves lifetime count',()=>{
    const {engine,base}=ownedAir();const before=engine.getState();
    const action:GameAction={type:'ProduceUnit',unitType:'multipurposeHelicopter',destination:base.position};
    const candidate=productionCandidates(before,{facilityId:base.id,unitType:'multipurposeHelicopter'})[0]!;
    expect(candidate).toMatchObject({legal:true,populationCost:2,civilianGoodsCost:100,militaryGoodsCost:140,fuelCost:500,remainingLifetimeSlots:1});
    const reserved=apply(engine,action);expect(reserved.resources.fuel).toBe(before.resources.fuel-500);expect(reserved.pendingUnitProductions).toHaveLength(1);
    expect(validateAction(reserved,action)?.code).toBe('lifetime_production_limit_reached');
    const completed=apply(engine,{type:'EndTurn'});const aircraft=completed.units.find(u=>u.type==='multipurposeHelicopter')!;
    expect(aircraft).toMatchObject({flightState:'landed',proficiency:'recruit',currentFuel:500,currentMilitaryGoods:40,canMove:false});expect(completed.completedProductions.multipurposeHelicopter).toBe(1);
    expect(importSaveJson(exportSaveJson(completed as GameState))).toMatchObject({valid:true,errors:[]});
  });
  it('launches a zero-distance drone, retains it after base loss, and expires at fifth next start',()=>{
    const {engine,base}=ownedAir();const before=engine.getState();
    const state=apply(engine,{type:'LaunchMilitaryDrone',facilityId:base.id,target:base.position});expect(state.resources.fuel).toBe(before.resources.fuel);expect(state.militaryDrone?.expiresBeforeTurn).toBe(6);
    expect(validateAction(state,{type:'LaunchMilitaryDrone',facilityId:base.id,target:base.position})?.code).toBe('military_drone_active');
    const lost=engine.getState() as GameState;const f=lost.facilities.find(f=>f.id===base.id)!;f.owner='none';f.status='unowned';f.securedOrder=null;load(engine,lost);
    for(let i=0;i<4;i++)apply(engine,{type:'EndTurn'});expect(engine.getState().militaryDrone).not.toBeNull();
    apply(engine,{type:'EndTurn'});expect(engine.getState().militaryDrone).toBeNull();
  });
  it('round-trips airborne cargo and rejects forged cargo links without changing the source',()=>{
    const engine=new GameEngine(1,config()),state=engine.getState() as GameState;
    state.units=[createUnit(state,'heli','multipurposeHelicopter',{q:25,r:25}),createUnit(state,'troop','nationalGuard',{q:24,r:25})];load(engine,state);
    apply(engine,{type:'BoardAircraft',unitId:'troop',aircraftId:'heli'});apply(engine,{type:'TakeOff',unitId:'heli'});
    const snapshot=engine.getState() as GameState,restored=importSaveJson(exportSaveJson(snapshot));expect(restored.errors).toEqual([]);expect(restored.state).toEqual(snapshot);
    const replay=new GameEngine(1,config());apply(replay,{type:'LoadSnapshot',snapshot:restored.state!});
    const action:GameAction={type:'Move',unitId:'heli',destination:{q:26,r:25}};expect(apply(replay,action)).toEqual(apply(engine,action));
    const forged=structuredClone(snapshot);delete forged.units[0]!.cargoUnitId;expect(validateInvariants(forged).valid).toBe(false);
  });
  it('keeps batch entries independent and returns validation reasons at one unchanged revision',()=>{
    const session=createAiSession({initial:{seed:1,configOverrides:config()}});
    const first=session.query({generation:1,baseRevision:0,target:'full-snapshot'});
    expect(first.ok).toBe(true);
    const actions:GameAction[]=[{type:'ProduceUnit',unitType:'police',destination:{q:25,r:25}},{type:'ProduceUnit',unitType:'multipurposeHelicopter',destination:{q:25,r:25}},{type:'ProduceUnit',unitType:'police',destination:{q:25,r:25}}];
    const result=session.previewActions({generation:1,baseRevision:0,actions});expect(result.ok).toBe(true);
    if(result.ok){expect(result.results).toHaveLength(3);expect(result.results[0]).toEqual(result.results[2]);expect(result.results[1]!.reasonCode).toBe('unit_not_producible_here');}
    expect(session.query({generation:1,baseRevision:0,target:'full-snapshot'})).toEqual(first);
    expect(session.previewActions({generation:1,baseRevision:4,actions})).toMatchObject({ok:false,error:{code:'stale_revision'}});
  });
  it('returns landed/cargo attack reasons and only visible enemies without consuming RNG',()=>{
    const engine=new GameEngine(1,config()),state=engine.getState() as GameState;
    state.units=[createUnit(state,'heli','multipurposeHelicopter',{q:25,r:25}),createUnit(state,'troop','police',{q:24,r:25}),createUnit(state,'visible','hunterZombie',{q:26,r:25}),createUnit(state,'hidden','zombie',{q:3,r:3})];load(engine,state);
    apply(engine,{type:'BoardAircraft',unitId:'troop',aircraftId:'heli'});const before=engine.getState();const rows=attackCandidates(before);
    expect(rows.map(r=>'targetId' in r?r.targetId:null)).not.toContain('hidden');expect(rows.find(r=>r.unitId==='heli')?.reasonCode).toBe('aircraft_not_airborne');expect(rows.find(r=>r.unitId==='troop')?.reasonCode).toBe('unit_transported');
    for(const row of rows)if('targetId' in row)expect(row.reasonCode).toBe(validateAction(before,{type:'Attack',attackerId:row.unitId,targetId:row.targetId!})?.code??null);
    expect(engine.getState()).toEqual(before);
  });
  it('reports all actual worker withdrawal destinations and resulting resident deltas',()=>{
    const engine=new GameEngine(1,config()),state=engine.getState();const factory=state.facilities.find(f=>f.type==='civilianFactory')!;
    const action:GameAction={type:'AssignWorkers',facilityId:factory.id,workers:0};const preview=previewCoreAction(state,action,0);expect(preview.legal).toBe(true);
    const after=apply(engine,action);expect(preview.populationMovements.reduce((n,m)=>n+m.people,0)).toBe(factory.workers);
    for(const delta of preview.facilityResidentDeltas)expect(after.facilities.find(f=>f.id===delta.facilityId)?.workers).toBe(delta.after);
    expect(preview.facilityResidentDeltas.length).toBeGreaterThan(1);
  });
  it('makes Balanced AI rescue a stranded helicopter and conserve transferred fuel',()=>{
    const engine=new GameEngine(1,config()),state=engine.getState() as GameState;
    state.units=[createUnit(state,'heli','multipurposeHelicopter',{q:25,r:25}),createUnit(state,'troop','police',{q:24,r:25})];state.units[0]!.currentFuel=0;load(engine,state);
    const before=engine.getState();const decision=new BalancedAgent().decide(createAgentObservation(before),engine.getLegalActions());
    expect(decision.action).toEqual({type:'BoardAircraft',unitId:'troop',aircraftId:'heli'});const after=apply(engine,decision.action);expect(after.units[0]!.currentFuel+after.units[1]!.currentFuel).toBe(24);
  });
});
