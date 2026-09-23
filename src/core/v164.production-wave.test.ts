import { describe, expect, it } from 'vitest';
import { GameEngine, validateAction } from './engine';
import { createDefaultConfig } from './config';
import { createUnit } from './state';
import { prepareTestSnapshot } from './testConfig';
import { decodeSaveCode, encodeSaveCode } from '../persistence/save';
import { createAgentObservation } from '../agent/observation';
import { previewMove } from './movement-query';
import type { GameState } from './types';

const config = () => createDefaultConfig({checkpoint:{initialSupplyRadius:8},economy:{initialZombieCount:0,initialScreamerCount:0,initialHunterCount:{min:0,max:0},initialGasCount:{min:0,max:0},initialResources:{food:100000,civilianGoods:100000,militaryGoods:100000,fuel:100000}},horde:{waves:[{turn:99,directionCount:1,compositionPerDirection:{hordeZombie:1,zombie:0},final:true}]}});
function load(engine:GameEngine,state:GameState){prepareTestSnapshot(state,true);const r=engine.step({type:'LoadSnapshot',snapshot:state});expect(r.error,r.error?.message).toBeNull();}
function baseScenario(){const engine=new GameEngine(1,config()),state=engine.getState() as GameState,base=state.facilities.find(f=>f.type==='armyBase')!;Object.assign(base,{owner:'player',status:'owned',operationalStatus:'operational',populationOperationalTurn:1,securedOrder:20,workers:0});load(engine,state);return {engine,state,base};}

describe('v1.6.4 production and wave acceptance',()=>{
  it('pays all costs once, pauses without power, completes fully loaded and persists lifetime counts',()=>{
    const {engine,state,base}=baseScenario();for(const f of state.facilities)if(f.type==='powerPlant'||f.type==='windPowerPlant')f.operationalStatus='disabled';load(engine,state);
    const before=engine.getState(),reserve=engine.step({type:'ProduceUnit',unitType:'fieldArtillery',destination:base.position});expect(reserve.error,reserve.error?.message).toBeNull();
    expect(reserve.state.resources).toMatchObject({civilianGoods:before.resources.civilianGoods-100,militaryGoods:before.resources.militaryGoods-200,fuel:before.resources.fuel-100});
    expect(reserve.state.population.healthyCivilians).toBe(before.population.healthyCivilians-5);
    expect(createAgentObservation(reserve.state).productionLedger?.fieldArtillery).toEqual({completed:0,reserved:1,limit:2,remaining:1});
    expect(engine.step({type:'EndTurn'}).error).toBeNull();expect(engine.getState().pendingUnitProductions).toHaveLength(1);
    const ready=engine.getState() as GameState;ready.facilities.find(f=>f.id==='power-plant-1')!.workers=15;for(const f of ready.facilities)if(f.owner==='player'&&(f.type==='powerPlant'||f.type==='windPowerPlant'))f.operationalStatus='operational';load(engine,ready);
    const completed=engine.step({type:'EndTurn'});expect(completed.error,completed.error?.message).toBeNull();
    expect(completed.state.units.find(u=>u.type==='fieldArtillery')).toMatchObject({mode:'packed',proficiency:'recruit',hp:25,population:5,currentFuel:100,currentMilitaryGoods:100,maxAttackCharges:1});
    expect(completed.state.pendingUnitProductions).toHaveLength(0);expect(completed.state.completedProductions.fieldArtillery).toBe(1);
    expect(decodeSaveCode(encodeSaveCode(completed.state as GameState)).state).toEqual(completed.state);
    const exhausted=engine.getState() as GameState;exhausted.completedProductions.fieldArtillery=2;load(engine,exhausted);
    expect(validateAction(engine.getState(),{type:'ProduceUnit',unitType:'fieldArtillery',destination:base.position})?.code).toBe('lifetime_production_limit_reached');
  });

  it('counts a pending reservation and never refunds resources after forfeiture',()=>{
    const {engine,state,base}=baseScenario();state.completedProductions.fieldArtillery=1;load(engine,state);
    expect(engine.step({type:'ProduceUnit',unitType:'fieldArtillery',destination:base.position}).error).toBeNull();
    const reserved=engine.getState() as GameState;expect(createAgentObservation(reserved).productionLedger?.fieldArtillery.remaining).toBe(0);
    const b=reserved.facilities.find(f=>f.id===base.id)!;b.workers=0;b.infected=1;b.operationalStatus='infected';load(engine,reserved);
    const result=engine.step({type:'EndTurn'});expect(result.error,result.error?.message).toBeNull();
    expect(result.events.some(e=>e.type==='production_forfeited'&&e.payload.people===5)).toBe(true);
    expect(result.state.pendingUnitProductions).toHaveLength(0);expect(result.state.completedProductions.fieldArtillery).toBe(1);
    expect(createAgentObservation(result.state).productionLedger?.fieldArtillery.remaining).toBe(1);
    expect(result.events.some(e=>e.type==='resource_produced'&&e.payload.reason==='production_refund')).toBe(false);
  });

  it.each(['gasZombie','zombie'] as const)('normalizes an early wave and rejected bonus with only %s weight',type=>{
    const cfg=config();cfg.horde.waves=[{turn:1,directionCount:1,compositionPerDirection:{hordeZombie:1,zombie:4},final:false},{turn:99,directionCount:1,compositionPerDirection:{hordeZombie:1,zombie:0},final:true}];
    for(const key of Object.keys(cfg.horde.specialZombieWeights))cfg.horde.specialZombieWeights[key as keyof typeof cfg.horde.specialZombieWeights]=key===type?1:0;
    const engine=new GameEngine(1,cfg),state=engine.getState() as GameState;for(const count of Object.values(state.rejectedRefugeesByDirection))count.normalRejected=10;load(engine,state);
    const result=engine.step({type:'EndTurn'});expect(result.error,result.error?.message).toBeNull();
    const spawned=result.state.units.filter(u=>u.spawnGroupId!==null);expect(spawned).toHaveLength(7);expect(spawned.filter(u=>u.type==='zombie')).toHaveLength(0);
    expect(spawned.filter(u=>u.type==='gasZombie')).toHaveLength(type==='gasZombie'?6:0);
    expect(spawned.filter(u=>u.type==='hordeZombie')).toHaveLength(type==='zombie'?7:1);
  });
});
