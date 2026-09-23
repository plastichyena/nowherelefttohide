import { expect, it } from 'vitest';
import { GameEngine, nuclearReinforcementPosition } from './engine';
import { createDefaultConfig } from './config';
import { prepareTestSnapshot, clearScenarioCheckpoints } from './testConfig';
import { createUnit } from './state';
import { hexDistance, hexKey, hexNeighbors } from './hex';
import { effectiveMovementCost } from './terrain';
import { forecastEndTurn } from './economy-query';
import { forecastUnitCombatAtDistance } from './combat-query';
import { validateInvariants } from './invariants';
import { exportSaveJson, importSaveJson } from '../persistence/save';
import { createAgentGame } from '../agent/game';
import { createAgentObservation } from '../agent/observation';
import type { GameState } from './types';

const quiet = () => createDefaultConfig({ economy: { initialZombieCount:0, initialScreamerCount:0, initialHunterCount:{min:0,max:0}, initialGasCount:{min:0,max:0}, initialResources:{food:100000,civilianGoods:100000,militaryGoods:100000,fuel:100000} }, refugees:{arrivalIntervalMin:999,arrivalIntervalMax:999}, horde:{waves:[{turn:100,directionCount:4,compositionPerDirection:{hordeZombie:1,zombie:0},final:true}]} });
function load(e:GameEngine,s:GameState){prepareTestSnapshot(s); const result=e.step({type:'LoadSnapshot',snapshot:s}); expect(result.error,result.error?.message).toBeNull();}
function captureReady(turn=10){const e=new GameEngine(1,quiet()),s=e.getState() as GameState; s.turn=turn; const p=s.facilities.find(f=>f.type==='nuclearPowerPlant')!; const neighbor=hexNeighbors(p.position).find(h=>effectiveMovementCost(s,h)!==null&&!s.units.some(u=>hexKey(u.position)===hexKey(h)))!; const u=s.units.find(u=>u.isPlayerUnit)!; u.position=neighbor; load(e,s); return {e,p,u};}

it('captures on Turn10 outside Supply, grants exactly five people once, and round-trips reward state',()=>{
 const {e,p,u}=captureReady(); const before=e.getState().population.cumulativeReinforcements;
 const moved=e.step({type:'Move',unitId:u.id,destination:p.position}); expect(moved.error).toBeNull();
 expect(moved.state.nuclearObjective).toMatchObject({firstCapturedTurn:10,reward:'claimed',failureSpawn:'none'});
 const sf=moved.state.units.find(u=>u.type==='specialForces')!; expect(sf).toMatchObject({hp:50,currentFuel:44,currentMilitaryGoods:40,proficiency:'regular',maxAttackCharges:3,canMove:true,canAttack:true});
 expect(moved.state.population.cumulativeReinforcements-before).toBe(5); expect(sf.position).not.toEqual(p.position);
 const restored=importSaveJson(exportSaveJson(moved.state as GameState)); expect(restored.valid).toBe(true);
 const end=e.step({type:'EndTurn'}); expect(end.error).toBeNull(); expect(end.state.nuclearObjective.failureSpawn).toBe('none'); expect(end.state.units.filter(u=>u.type==='specialForces')).toHaveLength(1); expect(validateInvariants(end.state as GameState).errors).toEqual([]);
});

it('expires at the start of Turn11 without exposing a hidden Pack spawn',()=>{
 const e=new GameEngine(7,quiet()),s=e.getState() as GameState;s.turn=10;load(e,s);
 const end=e.step({type:'EndTurn'}); expect(end.error).toBeNull(); expect(end.state.turn).toBe(11); expect(end.state.nuclearObjective).toMatchObject({reward:'expired',failureSpawn:'spawned'});
 const plant=end.state.facilities.find(f=>f.type==='nuclearPowerPlant')!;const pack=end.state.units.filter(u=>u.type==='packZombie').sort((a,b)=>hexDistance(a.position,plant.position)-hexDistance(b.position,plant.position))[0]!;expect(pack).toMatchObject({attackChargesRemaining:5,firstZombieActionTurn:11});
 const game=createAgentGame({recordHistory:false});const obs=game.restorePrivateSessionState(end.state as GameState);expect(obs.nuclearObjective).not.toHaveProperty('failureSpawn');expect(obs.zombies.some(z=>z.id===pack.id)).toBe(false);
 expect(end.events.some(e=>e.type==='nuclear_objective_updated'&&JSON.stringify(e.payload).includes('pack'))).toBe(false);
});

it('defers a blocked reward beyond the deadline and accounts for reinforcements only on placement',()=>{
 const e=new GameEngine(1,quiet()),s=e.getState() as GameState;s.turn=10;s.nuclearObjective={firstCapturedTurn:10,reward:'pending',failureSpawn:'none'};
 const occupied=new Set(s.units.map(u=>hexKey(u.position)));
 for(const t of s.map.tiles.filter(t=>t.playerOccupancyAllowed&&effectiveMovementCost(s,t)!==null&&!occupied.has(t.key)))s.units.push(createUnit(s,`block-${t.key}`,'zombie',t));
 load(e,s);const full=e.getState() as GameState; const before=full.population.cumulativeReinforcements;
 expect(nuclearReinforcementPosition(full,true)).toBeNull();
 // Pending state survives save independently of an opportunity to place it.
 expect(importSaveJson(exportSaveJson(full)).valid).toBe(true);
 const opened=structuredClone(s);opened.turn=11;opened.units=opened.units.filter(u=>!u.id.startsWith('block-'));load(e,opened);
 const result=e.step({type:'EndTurn'});expect(result.error).toBeNull();expect(result.state.nuclearObjective.reward).toBe('claimed');expect(result.state.population.cumulativeReinforcements-before).toBe(5);
},60000);

it.each([[0,1,3],[1,1,3],[2,1,15],[3,2,0],[4,2,15]])('Special Forces combat with MG%s at range%s has attack%s', (mg,distance,attack)=>{
 const s=new GameEngine(1,quiet()).getState() as GameState;const sf=createUnit(s,'sf','specialForces',{q:25,r:25});sf.currentMilitaryGoods=mg;
 const p=forecastUnitCombatAtDistance(s,sf,distance);expect(p.canAttack).toBe(attack>0);if(attack>0)expect(p.effectiveAttack).toBe(attack);
});

it('Pack can kill Riot on open ground using its shared five-charge budget',()=>{
 const e=new GameEngine(1,quiet()),s=e.getState() as GameState;
 const position=s.map.tiles.find(t=>t.terrain==='plain'&&!t.facilityId&&!s.checkpoints.some(c=>hexKey(c.position)===t.key)&&t.q===30&&t.r>30)!;
 const riot=createUnit(s,'riot-test','riotPolice',position);riot.hp=75;riot.currentMilitaryGoods=0;riot.attackChargesRemaining=0;riot.canAttack=false;
 const pack=createUnit(s,'pack-test','packZombie',{q:position.q+1,r:position.r});s.units.push(riot,pack);load(e,s);
 const result=e.step({type:'EndTurn'});expect(result.error).toBeNull();expect(result.state.units.some(u=>u.id===riot.id)).toBe(false);expect(result.events.filter(e=>e.type==='attack'&&e.payload.attackerId===pack.id).length).toBe(5);
});

it.each(['player','zombie'] as const)('Special Forces death during %s phase reanimates one Pack with the correct first action turn',phase=>{
 const e=new GameEngine(1,quiet()),s=e.getState() as GameState;
 const p=s.map.tiles.find(t=>t.terrain==='plain'&&!t.facilityId&&t.q===30&&t.r>30)!;
 const sf=createUnit(s,'sf-doomed','specialForces',p);sf.hp=1;sf.currentMilitaryGoods=2;
 const enemy=createUnit(s,'killer','packZombie',{q:p.q+1,r:p.r});s.units.push(sf,enemy);load(e,s);
 const result=phase==='player'?e.step({type:'Attack',attackerId:sf.id,targetId:enemy.id}):e.step({type:'EndTurn'});
 expect(result.error).toBeNull();const event=result.events.find(e=>e.type==='human_unit_reanimated'&&e.payload.humanUnitId===sf.id)!;expect(event).toBeDefined();
 const pack=result.state.units.find(u=>u.id===event.payload.zombieUnitId)!;expect(pack.type).toBe('packZombie');expect(pack.firstZombieActionTurn).toBe(phase==='player'?1:2);
 expect(result.state.population.cumulativeDeaths).toBeGreaterThanOrEqual(5);expect(result.state.statistics.specialForcesReanimations).toBe(1);
 if(phase==='zombie')expect(result.events.some(e=>e.type==='attack'&&e.payload.attackerId===pack.id)).toBe(false);
 expect(result.state.units.filter(u=>u.id===event.payload.zombieUnitId)).toHaveLength(1);expect(validateInvariants(result.state as GameState).errors).toEqual([]);
});

it('starves all healthy pools with an exact forecast, retains grace and carry through save, and does not reanimate deaths',()=>{
 const e=new GameEngine(7,quiet()),s=e.getState() as GameState;
 s.foodShortageAccumulation=7;s.starvationCarry=0.7;s.resources.food=0;
 for(const f of s.facilities)if(f.type==='farm')f.workers=0;
 const cp=s.checkpoints[0]!;cp.waiting=11;cp.screening=10;cp.approved=13;cp.remainingTurns=4;cp.screeningPolicy='strict';cp.nextArrivalTurn=999;
 for(const b of s.roadBranches)b.nextArrivalTurn=999;
 load(e,s);const before=e.getState();const plan=forecastEndTurn(before).publicHealth.starvation;
 const result=e.step({type:'EndTurn'});expect(result.error).toBeNull();expect(result.state.statistics.starvationDeaths).toBe(plan.loss);expect(result.state.starvationCarry).toBeCloseTo(plan.carryAfter);expect(result.state.statistics.starvationDeaths).toBeGreaterThan(0);
 expect(result.events.filter(e=>e.type==='resource_shortage'&&e.payload.cause==='starvation').reduce((n,e)=>n+Number(e.payload.populationLost),0)).toBe(plan.loss);
 expect(result.events.some(e=>e.type==='human_unit_reanimated')).toBe(false);expect(importSaveJson(exportSaveJson(result.state as GameState)).valid).toBe(true);
});

it('environmental infection uses updated stress, does not spread immediately, and records only public causes',()=>{
 const e=new GameEngine(3,quiet()),s=e.getState() as GameState;clearScenarioCheckpoints(s);
 const capital=s.facilities.find(f=>f.type==='capital')!;capital.workers=200;s.publicHealthStress={food:1,civilianGoods:1};s.resources.civilianGoods=0;
 s.units=s.units.filter(u=>hexKey(u.position)!==hexKey(capital.position));load(e,s);
 const result=e.step({type:'EndTurn'});expect(result.error).toBeNull();const events=result.events.filter(e=>e.type==='public_health_infection'&&e.payload.facilityId===capital.id);expect(events.length).toBe(1);
 const infected=Number(events[0]!.payload.infected),after=result.state.facilities.find(f=>f.id===capital.id)!;expect(after.infected).toBe(infected);expect(after.infectionGrace).toEqual([{count:infected,spreadsFromTurn:2}]);expect(result.events.some(e=>e.type==='infection_spread'&&e.payload.facilityId===capital.id)).toBe(false);expect(validateInvariants(result.state as GameState).errors).toEqual([]);
});

it('adds one deterministic Pack to the Final roster including pending and total accounting',()=>{
 const config=quiet();config.horde.waves=[{turn:2,directionCount:4,compositionPerDirection:{hordeZombie:1,zombie:0},final:true}];
 const e=new GameEngine(8,config);expect(e.step({type:'EndTurn'}).error).toBeNull();const result=e.step({type:'EndTurn'});expect(result.error).toBeNull();
 const packs=result.state.units.filter(u=>u.type==='packZombie'&&u.hordeKind==='final');expect(packs.length+result.state.horde.pendingWaves.flatMap(w=>w.roster).filter(t=>t==='packZombie').length).toBe(1);
 expect(result.state.horde.waves.reduce((n,w)=>n+w.committedWaveUnitCount,0)).toBe(5);expect(result.state.statistics.finalSpecialZombiesSpawnedByType.packZombie).toBe(1);
 expect(result.events.filter(e=>e.type==='horde_warning').every(e=>!JSON.stringify(e.payload).includes('packZombie'))).toBe(true);
});


it('exposes Special Forces as human, shares real combat charges, and promotes on the next turn only',()=>{
 const e=new GameEngine(1,quiet()),s=e.getState() as GameState;
 s.units=s.units.filter(u=>hexKey(u.position)!=='25,25'&&hexKey(u.position)!=='26,25');
 const sf=createUnit(s,'sf-promote','specialForces',{q:25,r:25}); sf.regularZombieKills=4;
 const target=createUnit(s,'fifth-kill','zombie',{q:26,r:25});target.hp=1;target.attackChargesRemaining=0;target.canAttack=false;
 s.units.push(sf,target);load(e,s);
 expect(createAgentObservation(e.getState()).units.find(u=>u.id===sf.id)).toMatchObject({proficiency:'regular',baseRecruitAttack:12,attack:15,attackChargesRemaining:3,maxAttackCharges:3,movementDomain:'ground'});
 expect(e.step({type:'ProduceUnit',unitType:'specialForces',destination:{q:25,r:25}}).error).not.toBeNull();
 const attack=e.step({type:'Attack',attackerId:sf.id,targetId:target.id});expect(attack.error).toBeNull();
 expect(attack.state.units.find(u=>u.id===sf.id)).toMatchObject({regularZombieKills:5,veteranPromotionPending:true,proficiency:'regular',attackChargesRemaining:2,currentMilitaryGoods:38});
 const saved=importSaveJson(exportSaveJson(attack.state as GameState));expect(saved.valid,JSON.stringify(saved.errors)).toBe(true);
 const end=e.step({type:'EndTurn'});expect(end.error).toBeNull();
 expect(end.state.units.find(u=>u.id===sf.id)).toMatchObject({proficiency:'veteran',veteranPromotionPending:false,maxAttackCharges:4,attackChargesRemaining:4});
});

it('kills a Pack through a real attack and saves consistent enemy totals',()=>{
 const e=new GameEngine(7,quiet()),s=e.getState() as GameState;
 s.units=s.units.filter(u=>hexKey(u.position)!=='25,25'&&hexKey(u.position)!=='26,25');
 const sf=createUnit(s,'sf-pack-kill','specialForces',{q:25,r:25});const pack=createUnit(s,'pack-kill','packZombie',{q:26,r:25});pack.hp=1;pack.attackChargesRemaining=0;pack.canAttack=false;
 s.units.push(sf,pack);load(e,s);const r=e.step({type:'Attack',attackerId:sf.id,targetId:pack.id});expect(r.error,r.error?.message).toBeNull();
 expect(r.state.units.some(u=>u.id===pack.id)).toBe(false);expect(r.state.statistics).toMatchObject({enemyKillsTotal:1,packZombiesKilled:1});
 expect(importSaveJson(exportSaveJson(r.state as GameState)).valid).toBe(true);
});
