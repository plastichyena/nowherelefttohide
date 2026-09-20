import { describe, expect, it } from 'vitest';
import { GameEngine } from './engine';
import { createDefaultConfig } from './config';
import { prepareTestSnapshot } from './testConfig';
import { createUnit } from './state';
import { validateInvariants } from './invariants';
import { forecastEndTurn, forecastFacilityProduction } from './economy-query';
import { previewCoreAction } from './action-preview';
import { effectiveMovementCost } from './terrain';
import { BAY_CORNERS, BAY_WATER_COUNT, bayCornerForSeed, bayLayout } from './bay';
import { hexDistance, hexKey } from './hex';
import { healthTransition, internalInfectionRisk, waitingProbability, screeningProbability, starvationAllocation, addInfectionGrace, consumeInfected, graceCount, binomial, domainRng } from './public-health';
import type { GameState } from './types';

const quiet = () => createDefaultConfig({ economy: { initialZombieCount: 0, initialHunterCount: { min: 0, max: 0 }, initialGasCount: { min: 0, max: 0 }, initialScreamerCount: 0, initialResources: { food: 100000, civilianGoods: 100000, militaryGoods: 100000, fuel: 100000 } }, refugees: { arrivalIntervalMin: 99, arrivalIntervalMax: 99 } });
function load(engine: GameEngine, state: GameState) { prepareTestSnapshot(state); const result=engine.step({ type: 'LoadSnapshot', snapshot: state }); expect(result.error,result.error?.message).toBeNull(); }

describe('v1.6.3 health equations', () => {
  it.each([[1,3],[0.5,5],[0.25,9]])('starts starvation for deficit %s on turn %s', (deficit, turn) => {
    let a = 0;
    for(let t=1;t<=turn;t++) { const next=healthTransition({food:0,civilianGoods:0},a,deficit,0); a=next.accumulation; expect(next.starvationRate > 0).toBe(t===turn); }
  });
  it('caps accumulation at seven, retains partial deficits, and fully recovers in fourteen supplied turns', () => {
    expect(healthTransition({food:0,civilianGoods:0},7,0.99,0)).toMatchObject({accumulation:7,starvationRate:0.099});
    let a=7; for(let i=0;i<14;i++){ const next=healthTransition({food:1,civilianGoods:1},a,0,0); a=next.accumulation; expect(next.starvationRate).toBe(0); } expect(a).toBe(0);
    expect(healthTransition({food:0,civilianGoods:0},0,1,1)).toMatchObject({stress:{food:0.4,civilianGoods:0.4},starvationRate:0});
  });
  it('keeps Normal fixed and Strict safe, applies only Pass and waiting corrections', () => {
    const stress={food:1,civilianGoods:1};
    expect(screeningProbability('normal',100,20,stress)).toBe(0.05); expect(screeningProbability('strict',100,20,stress)).toBe(0);
    expect(screeningProbability('passThrough',100,20,stress)).toBe(0.60);
    for(const [waiting,p] of [[20,0],[40,0.01],[60,0.02],[100,0.04]]) expect(waitingProbability(waiting!,20,{food:0,civilianGoods:0})).toBe(p);
    expect(waitingProbability(10000,20,stress)).toBe(0.12);
  });
  it('preserves national carry and apportions exact integer deaths across pools', () => {
    const pools=[{id:'a',kind:'facility' as const,pool:'workers' as const,population:3},{id:'b',kind:'checkpoint' as const,pool:'waiting' as const,population:7}];
    const plan=starvationAllocation(pools,0.1,0.9); expect(plan.loss).toBe(1); expect(plan.carryAfter).toBeCloseTo(0.9); expect(plan.allocations.map(p=>p.loss)).toEqual([0,1]);
    expect(starvationAllocation(pools,0,0.9).carryAfter).toBe(0.9); expect(starvationAllocation([],0,0.9).carryAfter).toBe(0);
    expect(starvationAllocation([{...pools[0]!,population:10}],0.1,0.9).loss).toBe(plan.loss);
  });
  it('consumes old infections before grace cohorts, with next EndTurn spread', () => {
    const site={infected:6}; addInfectionGrace(site,4,2); expect(graceCount(site,2)).toBe(4); consumeInfected(site,3); expect(site.infected).toBe(3); expect(graceCount(site,2)).toBe(3); expect(graceCount(site,3)).toBe(0);
  });
  it('draws deterministic independent binomials with the specified probability', () => {
    const samples=Array.from({length:128},(_,i)=>binomial(100,0.05,domainRng(i,'test'))); expect(samples).toEqual(Array.from({length:128},(_,i)=>binomial(100,0.05,domainRng(i,'test')))); expect(samples.reduce((a,b)=>a+b,0)/12800).toBeGreaterThan(0.04); expect(samples.reduce((a,b)=>a+b,0)/12800).toBeLessThan(0.06);
  });
});

it('protects the last Capital resident atomically and uses other eligible cities', () => {
  const engine=new GameEngine(1,quiet()), state=engine.getState() as GameState;
  const capital=state.facilities.find(f=>f.type==='capital')!; capital.workers=1;
  const city=state.facilities.find(f=>f.id==='city-1')!; city.workers=0; load(engine,state);
  expect(engine.getLegalActions().filter(a=>a.type==='TransferPopulation'&&a.fromFacilityId==='capital')).toEqual([]);
  for(const action of [{type:'TransferPopulation' as const,fromFacilityId:'capital',toFacilityId:city.id,people:1},{type:'AssignWorkers' as const,facilityId:'farm-1',workers:24}]) {
    const before=engine.getState(); expect(engine.step(action).error?.code).toBe('capital_minimum_resident_required'); expect(engine.getState()).toEqual(before); expect(previewCoreAction(before,action,0)).toMatchObject({legal:false,capitalMinimum:1,capitalResidents:{before:1,after:1}});
  }
  const state2=engine.getState() as GameState; state2.facilities.find(f=>f.id===city.id)!.workers=5; load(engine,state2);
  expect(engine.step({type:'AssignWorkers',facilityId:'farm-1',workers:24}).error).toBeNull(); expect(engine.getState().facilities.find(f=>f.type==='capital')!.workers).toBe(1);
  const state3=engine.getState() as GameState; state3.facilities.find(f=>f.id==='capital')!.workers=5; state3.facilities.find(f=>f.id===city.id)!.workers=0; load(engine,state3);
  const production={type:'ProduceUnit' as const,unitType:'police' as const,destination:{q:25,r:25}}, before=engine.getState();
  expect(engine.step(production).error?.code).toBe('capital_minimum_resident_required'); expect(engine.getState()).toEqual(before);
  expect(previewCoreAction(before,production,0)).toMatchObject({legal:false,capitalMinimum:1,capitalResidents:{before:5,after:5}});
});

it('uses local occupancy cost and deterministic starvation forecasts without first-turn deaths', () => {
  const engine=new GameEngine(1,quiet()), state=engine.getState() as GameState;
  state.facilities.find(f=>f.type==='capital')!.workers=200;
  state.resources.food=0; state.resources.civilianGoods=0;
  for(const f of state.facilities) if(f.type==='farm') f.workers=0;
  load(engine,state); const forecast=forecastEndTurn(engine.getState());
  expect(forecast.overcrowding.additionalFood).toBe(50); expect(forecast.overcrowding.additionalCivilianGoods).toBe(200); expect(forecast.publicHealth.starvation.loss).toBe(0);
  const before=engine.getState(); forecastEndTurn(before); expect(engine.getState()).toEqual(before);
  const result=engine.step({type:'EndTurn'}); expect(result.error).toBeNull(); expect(result.state.statistics.resourceShortageLosses).toBe(0); expect(result.state.publicHealthStress.food).toBeCloseTo(0.4);
});

it('includes deterministic suppression casualties in projected healthy civilians', () => {
  const engine=new GameEngine(1,quiet()), state=engine.getState() as GameState;
  const farm=state.facilities.find(f=>f.id==='farm-1')!; farm.workers-=10; farm.infected=10; farm.operationalStatus='infected';
  state.units=state.units.filter(u=>!u.isPlayerUnit);
  state.units.push(createUnit(state,'guard-preview','nationalGuard',farm.position)); load(engine,state);
  const before=engine.getState(), preview=previewCoreAction(before,{type:'Wait',unitId:'guard-preview'},0); expect(preview.legal).toBe(true);
  const result=engine.step({type:'EndTurn'}); expect(result.error).toBeNull();
  expect(result.state.population.healthyCivilians).toBeLessThan(before.population.healthyCivilians);
  expect(preview.nextEndTurn.before.projectedHealthyCivilians).toBe(result.state.population.healthyCivilians);
});

it('all four bay templates preserve distance, water blocking and bridge access', () => {
  for(const corner of BAY_CORNERS) {
    const seed=Array.from({length:64},(_,i)=>i).find(s=>bayCornerForSeed(s)===corner)!;
    const state=new GameEngine(seed,quiet()).getState(); const bay=bayLayout(corner), plant=state.facilities.find(f=>f.type==='nuclearPowerPlant')!;
    expect(hexDistance({q:25,r:25},plant.position)).toBe(16); expect(plant).toMatchObject({owner:'none',workers:0,infected:0,workerCapacity:5});
    expect(state.map.tiles.filter(t=>t.terrain==='water')).toHaveLength(BAY_WATER_COUNT);
    expect(state.map.tiles.filter(t=>t.terrain==='water'&&!t.road).every(t=>effectiveMovementCost(state,t)===null)).toBe(true);
    expect(bay.bridge.filter(p=>bay.waterKeys.has(hexKey(p))).every(p=>effectiveMovementCost(state,p)===1)).toBe(true);
    expect(validateInvariants(state as GameState).errors).toEqual([]);
  }
},60000);

it('integrates nuclear free generation, Regular special forces charges and Pack configuration', () => {
  const engine=new GameEngine(1,quiet()), state=engine.getState() as GameState;
  const plant=state.facilities.find(f=>f.type==='nuclearPowerPlant')!; plant.owner='player'; plant.status='owned'; plant.operationalStatus='operational'; plant.workers=5;
  expect(forecastFacilityProduction(state).find(f=>f.facilityId===plant.id)?.powerGeneration).toBe(0);
  for(const c of state.checkpoints) { const p=state.map.roadBranches.find(b=>b.id===c.branchId)!.roadTiles[16]!; c.position={...p}; }
  for(let workers=1;workers<=5;workers++) { plant.workers=workers; expect(forecastFacilityProduction(state).find(f=>f.facilityId===plant.id)?.powerGeneration).toBe(workers*500); }
  plant.infected=1; plant.operationalStatus='infected'; expect(forecastFacilityProduction(state).find(f=>f.facilityId===plant.id)?.powerGeneration).toBe(0);
  plant.infected=0; plant.operationalStatus='operational';
  expect(createUnit(state,'sf','specialForces',{q:25,r:25})).toMatchObject({population:5,attack:15,maxAttackCharges:3,currentFuel:44,currentMilitaryGoods:40});
  expect(createUnit(state,'sf','specialForces',{q:25,r:25},'ready','veteran').maxAttackCharges).toBe(4);
  expect(createUnit(state,'pack','packZombie',{q:25,r:25})).toMatchObject({hp:50,attack:15,maxAttackCharges:5,movement:10});
  expect(internalInfectionRisk({...plant,type:'city',workerCapacity:50,workers:100},{food:0,civilianGoods:0},false).probability).toBeCloseTo(0.003675);
});
