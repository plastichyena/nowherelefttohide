import { expect, it } from 'vitest';
import { GameEngine } from './engine';
import { createDefaultConfig } from './config';
import { prepareTestSnapshot } from './testConfig';
import { validateInvariants } from './invariants';
import type { GameState } from './types';

function fixture(seed:number) {
  const engine=new GameEngine(seed,createDefaultConfig({economy:{initialZombieCount:0,initialScreamerCount:0,initialHunterCount:{min:0,max:0},initialGasCount:{min:0,max:0},initialResources:{food:100000,civilianGoods:100000,militaryGoods:100000,fuel:100000}},refugees:{arrivalIntervalMin:999,arrivalIntervalMax:999}}));
  const state=engine.getState() as GameState;
  state.facilities.find(f=>f.id==='capital')!.workers=90;
  state.facilities.find(f=>f.id==='city-1')!.workers=40;
  for(const b of state.roadBranches)b.nextArrivalTurn=999;
  return {engine,state,checkpoint:state.checkpoints[0]!};
}
function load(engine:GameEngine,state:GameState){prepareTestSnapshot(state);const r=engine.step({type:'LoadSnapshot',snapshot:state});expect(r.error,r.error?.message).toBeNull();}

it.each(['normal','strict'] as const)('%s accepts every screened person and infects only actual recipients with deferred spread',policy=>{
  let infected=0;
  for(const seed of [1,7,13,21,29,35,42,51]) {
    const {engine,state,checkpoint}=fixture(seed);checkpoint.screening=20;checkpoint.remainingTurns=1;checkpoint.screeningPolicy=policy;
    load(engine,state);const result=engine.step({type:'EndTurn'});expect(result.error).toBeNull();
    expect(result.state.statistics.refugeesAccepted).toBe(20);expect(result.state.statistics.refugeesDeparted).toBe(0);
    const recipients=result.events.filter(e=>e.type==='population_transferred'&&e.payload.reason==='screening_approved');
    expect(recipients.map(e=>e.payload.to).sort()).toEqual(['capital','city-1']);expect(recipients.map(e=>e.payload.people)).toEqual([10,10]);
    for(const event of result.events.filter(e=>e.type==='latent_infection')) {
      expect(['capital','city-1']).toContain(event.payload.facilityId);expect(event.payload.populationAtRisk).toBe(10);expect(event.payload.probability).toBe(0.05);
      const site=result.state.facilities.find(f=>f.id===event.payload.facilityId)!;
      expect(site.infected).toBe(event.payload.infected);expect(site.infectionGrace).toEqual([{count:event.payload.infected,spreadsFromTurn:2}]);
    }
    expect(result.events.some(e=>e.type==='infection_spread')).toBe(false);expect(validateInvariants(result.state as GameState).errors).toEqual([]);
    infected+=result.state.statistics.screeningInfections;
  }
  if(policy==='strict')expect(infected).toBe(0);else expect(infected).toBeGreaterThan(0);
},60000);

it('does not roll screening infection again when placing already approved people',()=>{
  const {engine,state,checkpoint}=fixture(7);checkpoint.approved=20;checkpoint.screeningPolicy='passThrough';load(engine,state);
  const result=engine.step({type:'EndTurn'});expect(result.error).toBeNull();
  expect(result.events.filter(e=>e.type==='population_transferred'&&e.payload.reason==='approved_refugees').reduce((n,e)=>n+Number(e.payload.people),0)).toBe(20);
  expect(result.state.statistics.screeningInfections).toBe(0);expect(result.events.some(e=>e.type==='latent_infection')).toBe(false);
});
