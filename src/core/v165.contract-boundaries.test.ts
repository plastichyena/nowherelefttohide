import { describe, expect, it } from 'vitest';
import { GameEngine, validateAction } from './engine';
import { createDefaultConfig } from './config';
import { createUnit } from './state';
import { prepareTestSnapshot } from './testConfig';
import { hexKey, hexNeighbors } from './hex';
import { effectiveMovementCost } from './terrain';
import { aviationReason } from './aircraft';
import { productionCandidates } from './action-candidates';
import { createAgentObservation } from '../agent/observation';
import { queryRoute } from '../agent/route-query';
import type { GameAction, GameState } from './types';

function fixture() {
  const config=createDefaultConfig({checkpoint:{initialSupplyRadius:50},facilities:{powerPlant:{production:{powerGeneration:100}}},economy:{initialZombieCount:0,initialHunterCount:{min:0,max:0},initialGasCount:{min:0,max:0},initialScreamerCount:0,initialResources:{food:100000,civilianGoods:100000,militaryGoods:100000,fuel:100000}},refugees:{arrivalIntervalMin:99,arrivalIntervalMax:99},horde:{waves:[{turn:99,directionCount:1,compositionPerDirection:{hordeZombie:1,zombie:0},final:true}]}});
  const engine=new GameEngine(1,config),state=engine.getState() as GameState;
  const base=state.facilities.find(f=>f.type==='airBase')!;
  base.owner='player';base.status='owned';base.operationalStatus='operational';base.workers=5;base.infected=0;base.securedOrder=99;base.populationOperationalTurn=1;base.firstCaptureRewardClaimed=true;
  state.airBaseObjective={firstCapturedTurn:1,reward:'expired',failureSpawn:'none',fellBeforeCapture:false};
  return {engine,state,base};
}
function load(engine:GameEngine,state:GameState){prepareTestSnapshot(state);const result=engine.step({type:'LoadSnapshot',snapshot:state});expect(result.error,result.error?.message).toBeNull();}
function act(engine:GameEngine,action:GameAction){const result=engine.step(action);expect(result.error).toBeNull();return result.state;}

describe('v1.6.5 public and resource boundaries',()=>{
  it('expires a Turn20 drone before Turn25 while maintaining its full five turns',()=>{
    const {engine,state,base}=fixture();state.turn=20;load(engine,state);
    const before=engine.getState().resources.fuel;
    act(engine,{type:'LaunchMilitaryDrone',facilityId:base.id,target:{q:base.position.q+3,r:base.position.r}});
    expect(engine.getState().resources.fuel).toBe(before-15);
    for(let turn=20;turn<=24;turn++){
      expect(engine.getState().militaryDrone).toMatchObject({startedTurn:20,expiresBeforeTurn:25,radius:10});
      act(engine,{type:'EndTurn'});
    }
    expect(engine.getState().turn).toBe(25);expect(engine.getState().militaryDrone).toBeNull();
  });
  it.each(['power','supply','fuel','bounds','ownership'] as const)('rejects drone launch for %s with the same preview/action reason and no mutation',condition=>{
    const {engine,state,base}=fixture();let target={q:base.position.q+3,r:base.position.r};
    if(condition==='power')for(const rule of Object.values(state.config.facilities)){rule.production.powerGeneration=0;rule.production.fixedPowerGeneration=0;}
    if(condition==='supply')state.config.checkpoint.initialSupplyRadius=0;
    if(condition==='fuel'){state.resources.fuel=14;state.config.facilities.windPowerPlant.production.fixedPowerGeneration=500;}
    if(condition==='bounds')target={q:-1,r:0};
    if(condition==='ownership'){base.owner='none';base.status='unowned';base.securedOrder=null;}
    load(engine,state);const before=engine.getState();
    const action:GameAction={type:'LaunchMilitaryDrone',facilityId:base.id,target};
    const code={power:'facility_not_powered',supply:'facility_out_of_supply',fuel:'insufficient_fuel',bounds:'target_out_of_bounds',ownership:'facility_not_owned'}[condition];
    expect(aviationReason(before,action)).toBe(code);expect(engine.step(action).error?.code).toBe(code);expect(engine.getState()).toEqual(before);
  });
  it.each([0,1,500])('conserves both fuel pools when boarding at aircraft fuel %s',fuel=>{
    const {engine,state}=fixture();const heli=createUnit(state,'heli','multipurposeHelicopter',{q:25,r:25}),troop=createUnit(state,'troop','police',{q:24,r:25});
    heli.currentFuel=fuel;state.units=[heli,troop];load(engine,state);
    const after=act(engine,{type:'BoardAircraft',unitId:'troop',aircraftId:'heli'});
    expect(after.units[0]!.currentFuel).toBe(fuel===0?24:fuel);expect(after.units[1]!.currentFuel).toBe(fuel===0?0:24);
    expect(after.units.reduce((sum,u)=>sum+u.currentFuel,0)).toBe(fuel+24);
  });
  it('keeps a completed helicopter lifetime slot after destruction and gives produced aircraft a distinct ID',()=>{
    const {engine,state,base}=fixture();load(engine,state);
    act(engine,{type:'ProduceUnit',unitType:'multipurposeHelicopter',destination:base.position});
    const completed=act(engine,{type:'EndTurn'}) as GameState;
    const heli=completed.units.find(u=>u.type==='multipurposeHelicopter')!;expect(heli.id.startsWith('multipurpose-helicopter-')).toBe(true);
    // A completed slot is persistent metadata, independent of remaining live Units.
    completed.units=completed.units.filter(u=>u.id!==heli.id);load(engine,completed);
    expect(productionCandidates(engine.getState(),{facilityId:base.id,unitType:'multipurposeHelicopter'})[0]).toMatchObject({legal:false,reasonCode:'lifetime_production_limit_reached',lifetimeProducedCount:1});
  });
  it('captures an empty Air Base by its deadline without a reward or a deadline Pack',()=>{
    const {engine,state,base}=fixture();base.owner='none';base.status='unowned';base.workers=0;base.securedOrder=null;base.firstCaptureRewardClaimed=false;
    state.airBaseObjective={firstCapturedTurn:null,reward:'unclaimed',failureSpawn:'none',fellBeforeCapture:false};
    const position=hexNeighbors(base.position).find(p=>effectiveMovementCost(state,p,true)!==null)!;
    state.units=[createUnit(state,'capture','police',position)];load(engine,state);
    const captured=act(engine,{type:'Move',unitId:'capture',destination:base.position});
    expect(captured.airBaseObjective).toMatchObject({firstCapturedTurn:1,reward:'expired',failureSpawn:'none'});
    const later=engine.getState() as GameState;later.turn=10;load(engine,later);act(engine,{type:'EndTurn'});
    expect(engine.getState().airBaseObjective.failureSpawn).toBe('none');
  });
  it('routes flying units over impassable ground and ground occupants using the public air layer',()=>{
    const {engine,state}=fixture();const water=state.map.tiles.find(t=>t.terrain==='water'&&t.q>5&&t.q<45&&t.r>5&&t.r<45)!;
    const position=hexNeighbors(water).find(p=>effectiveMovementCost(state,p,true)!==null)!;
    const heli=createUnit(state,'heli','multipurposeHelicopter',position);heli.flightState='airborne';heli.movementDomain='air';heli.movement=50;heli.canMove=true;
    state.units=[heli,createUnit(state,'ground','police',position)];load(engine,state);
    const move:GameAction={type:'Move',unitId:'heli',destination:{q:water.q,r:water.r}};
    expect(validateAction(engine.getState(),move)).toBeNull();
    const result=queryRoute(createAgentObservation(engine.getState()),{moverUnitId:'heli',destination:{kind:'coordinate',position:{q:water.q,r:water.r}},includeHexPath:true});
    expect(result.routeAvailable).toBe(true);expect(result.currentSingleAction).toMatchObject({reachable:true,fuelCost:5,effectiveMovementCost:1});expect(hexKey(result.hexPath.items.at(-1)!.position)).toBe(hexKey(water));
  });
  it('omits airborne aircraft and cargo from public Gas blast victims and reports aerial LOS',()=>{
    const {engine,state}=fixture();const heli=createUnit(state,'heli','multipurposeHelicopter',{q:25,r:25}),cargo=createUnit(state,'cargo','police',heli.position);
    heli.flightState='airborne';heli.movementDomain='air';heli.movement=50;heli.cargoUnitId=cargo.id;
    cargo.transportedByUnitId=heli.id;cargo.boardedTurn=1;cargo.canMove=false;cargo.canAttack=false;cargo.actionState='acted';
    state.units=[heli,cargo,createUnit(state,'ground','police',{q:26,r:24}),createUnit(state,'gas','gasZombie',{q:26,r:25})];load(engine,state);
    const observation=createAgentObservation(engine.getState());
    expect(observation.zombies.find(u=>u.id==='gas')!.deathExplosion!.units.map(u=>u.unitId)).toEqual(['ground']);
    expect(observation.units.find(u=>u.id==='heli')).toMatchObject({visionMode:'aerial',terrainLosBlocking:false,effectiveMovementCostAtPosition:1});
  });
});
