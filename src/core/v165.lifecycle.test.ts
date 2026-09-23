import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from './config';
import { GameEngine } from './engine';
import { createUnit, synchronizePopulation } from './state';
import { createUnitLifecycle } from './unit-lifecycle';
import { emergencyLanding } from './aircraft';
import { SeededRng } from './rng';
import type { GameState, HumanUnitType } from './types';
import { hexKey, hexNeighbors } from './hex';
import { hasMovementRoad } from './terrain';

// These tests isolate real damage/death/cargo/reanimation logic. Site infection
// integration is exercised by the existing Gas and artillery Engine tests.
const lifecycle=createUnitLifecycle({applyGeneratedZombieOccupancy(){},processSpawnOccupancyQueue(){},applyGasExplosionSiteInfection(){return 0;},resolveGasExplosionSiteFalls(){}});
function fixture(type:HumanUnitType='police') {
  const state=new GameEngine(7,createDefaultConfig()).getState() as GameState;
  const heli=createUnit(state,'heli','multipurposeHelicopter',{q:25,r:25});heli.flightState='airborne';heli.movementDomain='air';heli.movement=50;
  const troop=createUnit(state,'troop',type,heli.position);troop.transportedByUnitId=heli.id;troop.boardedTurn=1;troop.actionState='acted';troop.canMove=troop.canAttack=false;heli.cargoUnitId=troop.id;
  state.units=[heli,troop];state.barbedWire=[];state.facilities=[];state.checkpoints=[];synchronizePopulation(state);
  return {state,heli,troop,rng:new SeededRng(8)};
}
describe('v1.6.5 cargo death and emergency lifecycle',()=>{
  it.each(['police','nationalGuard','riotPolice','reconTeam','specialForces'] as HumanUnitType[])('destroys cargo %s once and reanimates its configured type, never the aircraft',type=>{
    const {state,heli,troop,rng}=fixture(type);state.phase='zombie';
    lifecycle.dealDamage(state,heli,500,'hunter','attack',rng);lifecycle.destroyForCrash(state,heli,rng);
    expect(state.units.filter(u=>u.isPlayerUnit)).toHaveLength(0);expect(state.units).toHaveLength(1);
    expect(state.units[0]!.type).toBe(state.config.units[type].reanimationUnitType);expect(state.units[0]!.firstZombieActionTurn).toBe(state.turn+1);
    expect(state.population.cumulativeDeaths).toBe(heli.population+troop.population);expect(state.statistics.unitLosses).toBe(2);
    expect(state.events.filter(e=>e.type==='human_unit_reanimated')).toHaveLength(1);
  });
  it('ignores artillery and Gas damage while airborne without separately damaging cargo; landed takes normal damage',()=>{
    const {state,heli,troop,rng}=fixture();const hp=troop.hp;
    for(const cause of ['artillery','gas_explosion']){lifecycle.dealDamage(state,heli,30,'enemy',cause,rng);lifecycle.dealDamage(state,troop,30,'enemy',cause,rng);}
    expect(heli.hp).toBe(100);expect(troop.hp).toBe(hp);
    heli.flightState='landed';heli.movementDomain='ground';heli.movement=0;lifecycle.dealDamage(state,heli,30,'enemy','artillery',rng);expect(heli.hp).toBeLessThan(100);expect(troop.hp).toBe(hp);
  });
  it('does not reanimate cargo over unbridged water',()=>{
    const {state,heli,troop,rng}=fixture();const water=state.map.tiles.find(t=>t.terrain==='water'&&!hasMovementRoad(state.map,t))!;
    heli.position=troop.position={q:water.q,r:water.r};lifecycle.destroyForCrash(state,heli,rng);
    expect(state.units).toHaveLength(0);expect(state.pendingReanimations).toHaveLength(0);expect(state.statistics.unitLosses).toBe(2);
  });
  it('keeps a blocked reanimation pending and counts death only once after space opens',()=>{
    const {state,heli,troop,rng}=fixture('specialForces');const center=state.map.tiles.find(t=>hexKey(t)===hexKey(heli.position))!;
    // One ground cell is enough to exercise total placement exhaustion.
    state.map={...state.map,tiles:[{...center}]};state.units.push(createUnit(state,'blocker','zombie',heli.position));
    lifecycle.destroyForCrash(state,heli,rng);expect(state.pendingReanimations).toHaveLength(1);const deaths=state.population.cumulativeDeaths;
    lifecycle.retryPendingReanimations(state,rng);expect(state.pendingReanimations).toHaveLength(1);expect(state.population.cumulativeDeaths).toBe(deaths);
    state.units=[];lifecycle.retryPendingReanimations(state,rng);expect(state.pendingReanimations).toHaveLength(0);expect(state.units.map(u=>u.type)).toEqual(['packZombie']);
    lifecycle.retryPendingReanimations(state,rng);expect(state.units).toHaveLength(1);expect(state.population.cumulativeDeaths).toBe(heli.population+troop.population);expect(state.statistics.specialForcesReanimations).toBe(1);
  });
  it('crashes with no landing cell, preserving friendly ground occupants',()=>{
    const {state,heli,rng}=fixture();state.units=state.units.filter(u=>u.id!==heli.cargoUnitId);delete heli.cargoUnitId;
    const ground=[heli.position,...hexNeighbors(heli.position)].map((p,i)=>createUnit(state,`friend-${i}`,'riotPolice',p));state.units.push(...ground);heli.currentFuel=0;
    emergencyLanding(state,heli,rng,u=>lifecycle.destroyForCrash(state,u,rng));
    expect(state.units).toHaveLength(7);expect(state.units.every(u=>u.hp===75)).toBe(true);expect(state.statistics.unitLosses).toBe(1);
  });
  it('routes a collision Gas death through its real explosion queue and clears cargo links',()=>{
    const {state,heli,rng}=fixture('specialForces');const gas=createUnit(state,'gas','gasZombie',heli.position);const friends=hexNeighbors(heli.position).map((p,i)=>createUnit(state,`friend-${i}`,'riotPolice',p));state.units.push(gas,...friends);heli.currentFuel=0;
    emergencyLanding(state,heli,rng,u=>lifecycle.destroyForCrash(state,u,rng));
    expect(state.units.some(u=>u.id==='gas'||u.id==='heli'||u.id==='troop'||u.transportedByUnitId)).toBe(false);
    expect(state.statistics.gasExplosions).toBe(1);expect(friends.every(u=>u.hp<75&&u.hp>0)).toBe(true);expect(state.statistics.unitLosses).toBe(2);
  });
});
