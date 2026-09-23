import { describe, expect, it } from 'vitest';
import { GameEngine } from './engine';
import { createDefaultConfig } from './config';
import { createUnit } from './state';
import { prepareTestSnapshot } from './testConfig';
import { AIR_BASE_CANDIDATES } from './map';
import { hexDistance, hexKey, hexNeighbors } from './hex';
import { findShortestPath, pathMovementCost } from './path';
import { effectiveMovementCost } from './terrain';
import { getGroundVisionCoverageFrom } from './visibility';
import { emergencyLanding, emergencyLandingPreview } from './aircraft';
import { SeededRng } from './rng';
import type { GameAction, GameState, HumanUnitType, UnitType } from './types';

const quiet=()=>createDefaultConfig({economy:{initialZombieCount:0,initialHunterCount:{min:0,max:0},initialGasCount:{min:0,max:0},initialScreamerCount:0,initialResources:{food:100000,civilianGoods:100000,militaryGoods:100000,fuel:100000}},refugees:{arrivalIntervalMin:99,arrivalIntervalMax:99}});
function load(engine:GameEngine,state:GameState,preserve=false){prepareTestSnapshot(state,preserve);expect(engine.step({type:'LoadSnapshot',snapshot:state}).error).toBeNull();}
function apply(engine:GameEngine,action:GameAction){const result=engine.step(action);expect(result.error).toBeNull();return result.state;}
function flying(state:GameState,id='heli',position={q:25,r:25}){const unit=createUnit(state,id,'multipurposeHelicopter',position);unit.flightState='airborne';unit.movementDomain='air';unit.movement=50;return unit;}

describe('v1.6.5 rule boundaries',()=>{
  it('checks all seeded air-base candidates, deterministic terrain access and initial enemy sight exclusions',()=>{
    const seen=new Set<string>();
    for(let seed=1;seed<=24;seed++){
      const engine=new GameEngine(seed,createDefaultConfig()),state=engine.getState() as GameState;
      const air=state.facilities.find(f=>f.type==='airBase')!;seen.add(hexKey(air.position));
      expect(state.map.hordeSpawnReserve.some(p=>hexKey(p)===hexKey(air.position))).toBe(false);
      const reach=state.units.filter(u=>u.isPlayerUnit).some(u=>{const path=findShortestPath(state.map,u.position,air.position,new Set(),p=>effectiveMovementCost(state,p,true));if(!path)return false;const cost=pathMovementCost(path,p=>effectiveMovementCost(state,p,true));return cost<=u.movement*10&&(path.length-1)*2<=u.currentFuel;});
      expect(reach).toBe(true);
      for(const enemy of state.units.filter(u=>!u.isPlayerUnit))for(const base of state.facilities.filter(f=>f.type==='armyBase'||f.type==='airBase'))expect(getGroundVisionCoverageFrom(state,enemy.position,enemy.vision).visible.has(hexKey(base.position))).toBe(false);
      expect(new GameEngine(seed,createDefaultConfig()).getState().map).toEqual(state.map);
    }
    expect([...seen].sort()).toEqual(AIR_BASE_CANDIDATES.map(hexKey).sort());
  },30000);
  it.each(['airBase','nuclearPowerPlant'] as const)('captures %s during Turn10 actions, awarding a single reinforcement',type=>{
    const engine=new GameEngine(1,quiet());for(let i=1;i<10;i++)apply(engine,{type:'EndTurn'});
    const state=engine.getState() as GameState,base=state.facilities.find(f=>f.type===type)!;
    if(type==='airBase'){base.workers=1;base.earlyCaptureSurvivorStatus='available';base.armyBase!.interceptionsRemaining=1;}
    const from=hexNeighbors(base.position).find(p=>effectiveMovementCost(state,p,true)!==null&&!state.units.some(u=>hexKey(u.position)===hexKey(p)))!;
    state.units=[createUnit(state,'capture','police',from)];load(engine,state,true);
    const before=engine.getState();const after=apply(engine,{type:'Move',unitId:'capture',destination:base.position});const objective=type==='airBase'?after.airBaseObjective:after.nuclearObjective;
    expect(objective).toMatchObject({firstCapturedTurn:10,reward:'claimed',failureSpawn:'none'});expect(after.units.filter(u=>u.type==='specialForces')).toHaveLength(1);
    if(type==='airBase'){expect(after.resources.food-before.resources.food).toBe(100);expect(after.resources.militaryGoods-before.resources.militaryGoods).toBe(100);expect(after.units.some(u=>u.type==='nationalGuard')).toBe(false);}
    const next=apply(engine,{type:'EndTurn'});expect((type==='airBase'?next.airBaseObjective:next.nuclearObjective).failureSpawn).toBe('none');
  });
  it('expires both unclaimed objectives at Turn11 and does not duplicate their Pack spawns',()=>{
    const engine=new GameEngine(1,quiet());for(let i=1;i<11;i++)apply(engine,{type:'EndTurn'});
    const state=engine.getState();expect(state.nuclearObjective.failureSpawn).toBe('spawned');expect(state.airBaseObjective.failureSpawn).toBe('spawned');expect(state.statistics.packZombiesSpawned).toBe(2);
    apply(engine,{type:'EndTurn'});expect(engine.getState().statistics.packZombiesSpawned).toBe(2);
  });
  it.each(['police','nationalGuard','riotPolice','reconTeam','specialForces'] as HumanUnitType[])('boards %s after movement and refuses additional transfer from existing cargo',type=>{
    const engine=new GameEngine(1,quiet()),state=engine.getState() as GameState;
    const heli=createUnit(state,'heli','multipurposeHelicopter',{q:25,r:25});heli.currentFuel=0;
    const troop=createUnit(state,'troop',type,{q:23,r:25});state.units=[heli,troop];load(engine,state);
    apply(engine,{type:'Move',unitId:'troop',destination:{q:24,r:25}});const fuel=engine.getState().units[1]!.currentFuel;
    const result=apply(engine,{type:'BoardAircraft',unitId:'troop',aircraftId:'heli'});expect(result.units[0]!.currentFuel+result.units[1]!.currentFuel).toBe(fuel);
    expect(engine.step({type:'BoardAircraft',unitId:'troop',aircraftId:'heli'}).error?.code).toBe('aircraft_cargo_occupied');
    expect(engine.getState()).toEqual(result);
  });
  it.each(['zombie','policeZombie','soldierZombie','riotZombie','gasZombie','screamerZombie','hunterZombie','packZombie'] as UnitType[])('applies airborne targeting capability for %s in a real enemy phase',type=>{
    const settings=quiet();settings.units[type].hp=500;settings.units[type].movement=0;
    const engine=new GameEngine(1,settings),state=engine.getState() as GameState,heli=flying(state,'heli',{q:38,r:30});
    state.units=[heli,createUnit(state,'enemy',type,{q:39,r:30})];load(engine,state);
    const after=apply(engine,{type:'EndTurn'});const survivor=after.units.find(u=>u.id==='heli');expect(survivor).toBeDefined();
    expect(survivor!.hp<100).toBe(type==='hunterZombie'||type==='packZombie');expect(survivor!.currentFuel).toBe(499);
  });
  it('lands at the current free ground without consuming RNG, even on the takeoff turn',()=>{
    const state=new GameEngine(1,quiet()).getState() as GameState,heli=flying(state);heli.currentFuel=0;heli.tookOffTurn=1;state.units=[heli];
    const rng=new SeededRng(42),before=rng.snapshot();emergencyLanding(state,heli,rng,()=>{throw new Error('unexpected crash');});
    expect(heli.flightState).toBe('landed');expect(heli.position).toEqual({q:25,r:25});expect(rng.snapshot()).toEqual(before);
  });
  it('keeps public emergency previews independent of hidden occupants and seeded selection deterministic',()=>{
    const state=new GameEngine(1,quiet()).getState() as GameState,heli=flying(state);heli.currentFuel=0;state.units=[heli,createUnit(state,'friend','police',heli.position)];
    const preview=emergencyLandingPreview(state,heli,heli.position);expect(preview.possibleEmergencyLandingHexes.length).toBeGreaterThan(1);
    const a=structuredClone(state),b=structuredClone(state);emergencyLanding(a,a.units[0]!,new SeededRng(22),()=>{throw new Error('crash');});emergencyLanding(b,b.units[0]!,new SeededRng(22),()=>{throw new Error('crash');});
    expect(a.units[0]!.position).toEqual(b.units[0]!.position);expect(a.units[1]!.hp).toBe(state.units[1]!.hp);expect(hexDistance(a.units[0]!.position,heli.position)).toBe(1);
    const distant={q:5,r:5};const publicBefore=emergencyLandingPreview(state,heli,distant);
    state.units.push(createUnit(state,'unseen','zombie',distant));
    expect(getGroundVisionCoverageFrom(state,heli.position,heli.vision).visible.has(hexKey(distant))).toBe(false);
    expect(emergencyLandingPreview(state,heli,distant)).toEqual(publicBefore);
  });
});
