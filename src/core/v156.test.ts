import { describe, expect, it } from 'vitest';
import { GameEngine } from './engine';
import { createDefaultConfig } from './config';
import { createInitialState, createUnit } from './state';
import { damageWire, radialConflict, wireBuildReason, wireCandidates } from './barbed-wire';
import { effectiveMovementCost } from './terrain';
import { createMovement } from './movement';
import { hexKey } from './hex';
import { createAgentObservation } from '../agent/observation';
import { facilityRecaptureConditions } from './facility-recovery';
import { validateInvariants } from './invariants';
import { createUnitLifecycle } from './unit-lifecycle';
import { SeededRng } from './rng';
import { compactArtifactObservation, restoreArtifactObservation } from '../agent/observation';
import { encodeSaveCode, decodeSaveCode } from '../persistence/save';

const state = () => createInitialState(1, createDefaultConfig());
describe('v1.5.6 Barbed Wire', () => {
  it.each([5,10,15])('absorbs damage %i before human terrain defense', damage => {
    const s=state();const human=s.units.find(u=>u.isPlayerUnit)!;
    human.position={q:25,r:25};human.hp=human.maxHp;
    s.barbedWire=[{id:'shield',position:{...human.position},hp:10,maxHp:20,builtTurn:1}];
    const {dealDamage}=createUnitLifecycle({applyGeneratedZombieOccupancy:()=>{},processSpawnOccupancyQueue:()=>{},applyGasExplosionSiteInfection:()=>0,resolveGasExplosionSiteFalls:()=>{}});
    dealDamage(s,human,damage,'enemy','attack',SeededRng.fromState(s.rngState));
    expect(human.hp).toBe(human.maxHp-Math.ceil(Math.max(0,damage-10)*s.config.terrain.damageMultiplier.urban));
    expect(s.barbedWire[0]?.hp??0).toBe(Math.max(0,10-damage));
  });
  it('Gas damage bypasses intact wire', () => {
    const s=state();const human=s.units.find(u=>u.isPlayerUnit)!;
    s.barbedWire=[{id:'shield',position:{...human.position},hp:10,maxHp:20,builtTurn:1}];
    const {dealDamage}=createUnitLifecycle({applyGeneratedZombieOccupancy:()=>{},processSpawnOccupancyQueue:()=>{},applyGasExplosionSiteInfection:()=>0,resolveGasExplosionSiteFalls:()=>{}});
    const hp=human.hp;dealDamage(s,human,5,'gas','gas_explosion',SeededRng.fromState(s.rngState));
    expect(human.hp).toBeLessThan(hp);expect(s.barbedWire[0].hp).toBe(10);
  });
  it('round-trips saves and restores dynamic obstacle movement in public artifacts', () => {
    const engine=new GameEngine(1,createDefaultConfig());
    const initial=createAgentObservation(engine.getState());
    const candidate=wireCandidates(engine.getState()).find(c=>c.legal)!;
    expect(engine.step({type:'BuildBarbedWire',position:candidate.position}).error).toBeNull();
    const s=engine.getState();
    expect(decodeSaveCode(encodeSaveCode(s)).state?.barbedWire).toEqual(s.barbedWire);
    const observation=createAgentObservation(s);
    expect(restoreArtifactObservation(compactArtifactObservation(observation),initial.map)).toEqual(observation);
  });
  it('allows lateral lines and rejects radial layers independent of order', () => {
    const c = { q: 0, r: 0 };
    for (const [a, b, conflict] of [
      [{q:3,r:0},{q:3,r:-1},false], [{q:3,r:0},{q:4,r:0},true],
      [{q:3,r:0},{q:5,r:0},true], [{q:3,r:0},{q:6,r:0},false],
      [{q:2,r:1},{q:3,r:2},true], [{q:2,r:1},{q:1,r:2},false],
    ] as const) {
      expect(radialConflict(c,a,b)).toBe(conflict);
      expect(radialConflict(c,b,a)).toBe(conflict);
    }
  });
  it('builds atomically for 5/5 and one action; rejects stacking without mutation', () => {
    const engine = new GameEngine(1, createDefaultConfig());
    const before = engine.getState();
    const candidate = wireCandidates(before).find(c => c.legal)!;
    expect(candidate).toBeDefined();
    const action = {type:'BuildBarbedWire' as const,position:candidate.position};
    const result = engine.step(action);
    expect(result.error).toBeNull();
    expect(result.state.resources.civilianGoods).toBe(before.resources.civilianGoods-5);
    expect(result.state.resources.militaryGoods).toBe(before.resources.militaryGoods-5);
    expect(result.state.actionsTakenThisTurn).toBe(before.actionsTakenThisTurn+1);
    expect(result.state.rngState).toEqual(before.rngState);
    expect(result.state.barbedWire[0]).toMatchObject({hp:20,maxHp:20});
    expect(engine.step(action).error).not.toBeNull();
    expect(engine.getState()).toEqual(result.state);
  });
  it('uses total human entry MP5 and restores terrain immediately on destruction', () => {
    const s=state(); const p=wireCandidates(s).find(c=>c.legal)!.position;
    const original=effectiveMovementCost(s,p);
    s.barbedWire.push({id:'wall',position:p,hp:10,maxHp:20,builtTurn:1});
    expect(effectiveMovementCost(s,p)).toBe(5);
    expect(damageWire(s,p,5)).toBe(5); expect(s.barbedWire[0].hp).toBe(5);
    expect(damageWire(s,p,15)).toBe(5); expect(s.barbedWire).toEqual([]);
    expect(effectiveMovementCost(s,p)).toBe(original);
  });
  it('empty-wall attacks use charges, preserve MP and allow movement only after destruction', () => {
    const s=state(); const start={q:25,r:24}, end={q:26,r:24};
    s.units=[]; const z=createUnit(s,'z','hordeZombie',start);s.units=[z];
    z.attack=5;z.attackChargesRemaining=2;z.canAttack=true;
    s.barbedWire=[{id:'wall',position:end,hp:10,maxHp:20,builtTurn:1}];
    const movement=createMovement({interceptorsAt:()=>[],interceptArmyBase:()=>false,resolveCombat:()=>{},tryCapture:()=>{}});
    movement.applyMovement(s,z,[start,end],5);
    expect(s.barbedWire).toEqual([]);expect(z.attackChargesRemaining).toBe(0);expect(z.position).toEqual(end);
    expect(s.events.filter(e=>e.type==='noise_emitted')).toEqual([]);
  });
  it('never exposes a hidden wall or its damage through public state', () => {
    const s=state();const p={q:3,r:3};
    s.barbedWire=[{id:'hidden',position:p,hp:10,maxHp:20,builtTurn:1}];
    const before=createAgentObservation(s);damageWire(s,p,10);
    expect(createAgentObservation(s)).toEqual(before);
    expect(wireBuildReason(s,p)).toBe('visibility_required');
  });
  it('rejects HP0 persistence', () => {
    const s=state();s.barbedWire=[{id:'wall',position:{q:25,r:24},hp:0,maxHp:20,builtTurn:1}];
    expect(validateInvariants(s).valid).toBe(false);
  });
});

describe('v1.5.6 permanent facility recovery', () => {
  it('rechecks an already stationed human with no charge or ammunition', () => {
    const s=state();const f=s.facilities.find(f=>f.id==='farm-2')!;
    f.owner='none';f.status='ruined';f.operationalStatus='ruined';f.workers=0;f.infected=0;
    const human=s.units.find(u=>u.isPlayerUnit)!;human.position={...f.position};human.attackChargesRemaining=0;human.canAttack=false;human.currentMilitaryGoods=0;
    expect(facilityRecaptureConditions(s,f).ready).toBe(true);
    const engine=new GameEngine(1,s.config);expect(engine.step({type:'LoadSnapshot',snapshot:s}).error).toBeNull();
    const result=engine.step({type:'EndTurn'});
    expect(result.error).toBeNull();
    expect(result.state.facilities.find(c=>c.id===f.id)).toMatchObject({owner:'player',status:'owned',workers:0,populationOperationalTurn:2});
  });
  it('requires infection removal, enemy absence and a surviving game', () => {
    const s=state();const f=s.facilities.find(f=>f.type==='farm')!;f.status='ruined';f.owner='none';
    s.units[0].position={...f.position};f.infected=1;expect(facilityRecaptureConditions(s,f).ready).toBe(false);
    f.infected=0; s.units.push(createUnit(s,'enemy','zombie',f.position));expect(facilityRecaptureConditions(s,f).ready).toBe(false);
    s.units=s.units.filter(u=>u.isPlayerUnit);s.gameOver=true;expect(facilityRecaptureConditions(s,f).ready).toBe(false);
  });
});
