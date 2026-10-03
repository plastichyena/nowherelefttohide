import { describe, expect, it } from 'vitest';
import { GameEngine, validateAction } from './engine';
import { createDefaultConfig } from './config';
import { createUnit } from './state';
import { prepareTestSnapshot } from './testConfig';
import { previewMove } from './movement-query';
import { forecastUnitCombatAtDistance, forecastUnitSuppression } from './combat-query';
import { deriveUnitRecovery } from './recovery';
import { validateInvariants } from './invariants';
import { decodeSaveCode, encodeSaveCode } from '../persistence/save';
import type { GameState, HumanUnitType, UnitProficiency, UnitType } from './types';

const config = () => createDefaultConfig({mapMode:'fixed', checkpoint: { initialSupplyRadius: 8 }, economy: { initialZombieCount: 0, initialScreamerCount: 0, initialHunterCount: {min:0,max:0}, initialGasCount: {min:0,max:0}, initialResources: {food:100000,civilianGoods:100000,militaryGoods:100000,fuel:100000} } });
function load(engine: GameEngine, state: GameState) { prepareTestSnapshot(state); state.nextUnitNumber = Math.max(state.nextUnitNumber, ...state.units.map(u => Number(/-(\d+)$/.exec(u.id)?.[1] ?? 0) + 1)); const r=engine.step({type:'LoadSnapshot',snapshot:state}); expect(r.error?.message).toBeUndefined(); }
function fixture(fuel=100, hp=200, proficiency: UnitProficiency='recruit') {
  const e=new GameEngine(1,config()),s=e.getState() as GameState;
  s.units=[createUnit(s,'ifv','ifv',{q:25,r:25},'ready',proficiency)];
  s.units[0]!.currentFuel=fuel; s.units[0]!.hp=hp;
  return {e,s,vehicle:s.units[0]!};
}
function enemy(s:GameState,type:UnitType='zombie',q=26,charges=1) { const z=createUnit(s,`enemy-${q}`,type,{q,r:25});if(type==='hordeZombie'){z.hordeKind='periodic';z.spawnGroupId='test-wave';}z.attackChargesRemaining=charges;z.canAttack=charges>0;s.units.push(z);return z; }

describe('IFV movement and combat',()=>{
  it.each(['zombie','hordeZombie','policeZombie','soldierZombie','riotZombie','hunterZombie','screamerZombie','gasZombie','packZombie'] as UnitType[])('overruns the full remaining HP of %s',type=>{
    const {e,s}=fixture();const target=enemy(s,type,26,0);load(e,s);
    const r=e.step({type:'Move',unitId:'ifv',destination:{q:26,r:25}});expect(r.error).toBeNull();
    expect(r.state.units.some(u=>u.id===target.id)).toBe(false);
    expect(r.events.filter(v=>v.type==='unit_overrun')).toHaveLength(1);
    expect(r.state.units.find(u=>u.id==='ifv')!.hp).toBe(type==='gasZombie'?170:200);
  });
  it.each([null,'police','riotPolice','nationalGuard','reconTeam','specialForces'] as const)('counts carrier/cargo death once and reanimates only the selected lineage (%s)',cargoType=>{
    const {e,s}=fixture(100,40);s.completedProductions.ifv=1;enemy(s,'gasZombie',26);const chain=createUnit(s,'chain','gasZombie',{q:26,r:26});chain.hp=1;s.units.push(chain);
    if(cargoType)s.units.push(createUnit(s,'cargo',cargoType,{q:24,r:25}));load(e,s);
    if(cargoType)expect(e.step({type:'BoardTransport',unitId:'cargo',transportId:'ifv'}).error).toBeNull();
    const before=e.getState(),r=e.step({type:'Move',unitId:'ifv',destination:{q:26,r:25}});
    expect(r.error).toBeNull();expect(r.state.population.cumulativeDeaths-before.population.cumulativeDeaths).toBe(4+(cargoType?before.config.units[cargoType].population:0));
    expect(r.state.completedProductions.ifv).toBe(1);
    const reanimations=r.events.filter(v=>v.type==='human_unit_reanimated');expect(reanimations).toHaveLength(1);
    expect(reanimations[0]!.payload).toMatchObject({humanUnitId:cargoType?'cargo':'ifv',zombieUnitType:cargoType==='specialForces'?'packZombie':cargoType==='riotPolice'?'riotZombie':cargoType==='police'?'policeZombie':'soldierZombie'});
    expect(validateInvariants(r.state as GameState).errors).toEqual([]);
  });
  it.each([19,20,21])('uses Urban target Gas damage 15 and the strict entry threshold at HP %s',hp=>{
    const {e,s,vehicle}=fixture(100,hp);vehicle.position={q:24,r:25};
    enemy(s,'gasZombie',25,1);load(e,s);
    const p=previewMove(e.getState(),'ifv',{q:25,r:25});
    expect(p.overruns?.[0]).toMatchObject({impactDamage:5,gasDamage:15,wouldExecute:hp>20});
    const r=e.step({type:'Move',unitId:'ifv',destination:{q:25,r:25}});expect(r.error).toBeNull();
    expect(r.state.units.find(u=>u.id==='ifv')).toMatchObject({hp:hp>20?hp-20:hp,currentFuel:hp>20?90:100});
  });
  it('can fire after an overrun without earning an overrun veteran kill',()=>{
    const {e,s}=fixture();enemy(s,'zombie',26);const target=enemy(s,'hordeZombie',29,4);load(e,s);
    expect(e.step({type:'Move',unitId:'ifv',destination:{q:27,r:25}}).error).toBeNull();
    const r=e.step({type:'Attack',attackerId:'ifv',targetId:target.id});expect(r.error).toBeNull();
    expect(r.state.units.find(u=>u.id==='ifv')).toMatchObject({currentMilitaryGoods:100,attackChargesRemaining:2,regularZombieKills:0});
  });
  it.each([100,11,10,9,1,0])('pays per entered hex, supports the last partial fuel step, fuel=%s',fuel=>{
    const {e,s}=fixture(fuel);load(e,s);const before=e.getState();
    const p=previewMove(before,'ifv',{q:28,r:25});
    const r=e.step({type:'Move',unitId:'ifv',destination:{q:28,r:25}});
    if(fuel===0) { expect(p.legal).toBe(false);expect(r.error?.code).toBe('insufficient_unit_fuel');expect(e.getState()).toEqual(before);return; }
    expect(r.error).toBeNull();const u=r.state.units.find(u=>u.id==='ifv')!;
    expect(u.position).toEqual({q:25+Math.min(3,Math.ceil(fuel/10)),r:25});
    expect(u.position).toEqual(p.reached);expect(u.currentFuel).toBe(p.projectedFuelAfterMove);
    expect(r.events.filter(v=>v.type==='noise_emitted'&&v.payload.sourceUnitType==='ifv')).toHaveLength(u.position.q-25);
  });
  it.each([0,1,4])('overruns regardless of target HP, uses remaining charge=%s, retains ammunition and charge',charges=>{
    const {e,s}=fixture();enemy(s,'hordeZombie',26,charges);load(e,s);
    const p=previewMove(e.getState(),'ifv',{q:27,r:25}),r=e.step({type:'Move',unitId:'ifv',destination:{q:27,r:25}});
    expect(r.error,r.error?.message).toBeNull();const u=r.state.units.find(u=>u.id==='ifv')!;
    expect(r.state.units.some(u=>u.id==='enemy-26')).toBe(false);expect(u.hp).toBe(200-5*charges);
    expect(u.hp).toBe(p.projectedHpAfterMove);expect(u.currentMilitaryGoods).toBe(120);expect(u.attackChargesRemaining).toBe(3);
    expect(u.regularZombieKills).toBe(0);expect(deriveUnitRecovery(r.state,u).rate).toBe(.05);
  });
  it.each([20,19])('stops before damage >= hp (%s), without entry fuel or killing the target',hp=>{
    const {e,s}=fixture(100,hp);enemy(s,'hordeZombie',26,4);load(e,s);
    const p=previewMove(e.getState(),'ifv',{q:27,r:25}),r=e.step({type:'Move',unitId:'ifv',destination:{q:27,r:25}});
    expect(r.error).toBeNull();expect(p.arrivalReason).toBe('overrun_insufficient_hp');
    expect(r.state.units[0]).toMatchObject({hp,currentFuel:100,position:{q:25,r:25}});expect(r.state.units.find(u=>u.id==='enemy-26')?.hp).toBe(40);
  });
  it('checks sequential damage with the current HP, and ignores adjacent interception',()=>{
    const {e,s}=fixture(100,35);enemy(s,'hordeZombie',26,4);enemy(s,'hordeZombie',27,4);
    const flank=createUnit(s,'flank','soldierZombie',{q:25,r:26});s.units.push(flank);load(e,s);
    const p=previewMove(e.getState(),'ifv',{q:28,r:25}),r=e.step({type:'Move',unitId:'ifv',destination:{q:28,r:25}});
    expect(r.error).toBeNull();expect(r.state.units[0]).toMatchObject({hp:15,currentFuel:90,position:{q:26,r:25}});
    expect(decodeSaveCode(encodeSaveCode(r.state as GameState)).state).toEqual(r.state);
    expect(p.projectedHpAfterMove).toBe(15);expect(p.reached).toEqual({q:26,r:25});expect(r.events.some(v=>v.type==='attack')).toBe(false);
  });
  it.each(['recruit','regular','veteran'] as const)('uses specified firepower, charges and strict ammo for %s',proficiency=>{
    const {s,vehicle}=fixture(100,200,proficiency);
    expect(vehicle.attack).toBe(proficiency==='recruit'?16:20);expect(vehicle.attackChargesRemaining).toBe(proficiency==='veteran'?4:3);
    for(const distance of [0,1,5]) {vehicle.currentMilitaryGoods=20;expect(forecastUnitCombatAtDistance(s,vehicle,distance).canAttack).toBe(true);vehicle.currentMilitaryGoods=19;expect(forecastUnitCombatAtDistance(s,vehicle,distance).canAttack).toBe(false);}
    expect(forecastUnitCombatAtDistance(s,vehicle,6).canAttack).toBe(false);
  });
  it('includes only the target Gas in the entry gate; resolves visible chain death and cargo once',()=>{
    const {e,s}=fixture(100,40);const gas=enemy(s,'gasZombie',26,1);const chain=createUnit(s,'chain','gasZombie',{q:26,r:26});chain.hp=1;s.units.push(chain);
    const cargo=createUnit(s,'cargo','specialForces',{q:24,r:25});s.units.push(cargo);load(e,s);
    expect(e.step({type:'BoardTransport',transportId:'ifv',unitId:'cargo'}).error).toBeNull();
    const before=e.getState(),p=previewMove(before,'ifv',gas.position),r=e.step({type:'Move',unitId:'ifv',destination:gas.position});
    expect(r.error,r.error?.message).toBeNull();expect(p.overruns?.[0]?.wouldExecute).toBe(true);
    expect(r.state.units.some(u=>u.id==='ifv'||u.id==='cargo')).toBe(false);
    expect(r.state.population.cumulativeDeaths-before.population.cumulativeDeaths).toBe(9);
    expect(r.events.filter(v=>v.type==='human_unit_reanimated').map(v=>v.payload.humanUnitId)).toEqual(['cargo']);
    expect(r.events.filter(v=>v.type==='gas_explosion')).toHaveLength(2);
    expect(validateInvariants(r.state as GameState).errors).toEqual([]);
  });
  it('does not expose hidden enemies in paths or preview',()=>{
    const {s,vehicle}=fixture();vehicle.vision=1;vehicle.position={q:10,r:10};const before=previewMove(s,'ifv',{q:13,r:10});
    const hidden=enemy(s,'packZombie',13,5);hidden.position.r=10;expect(previewMove(s,'ifv',{q:13,r:10})).toEqual(before);
  });
});

describe('IFV production and transport',()=>{
  it('unloads on a later turn with reactions but no voluntary actions or fuel refund',()=>{
    const {e,s}=fixture(0);s.units.push(createUnit(s,'troop','police',{q:24,r:25}));load(e,s);
    expect(e.step({type:'BoardTransport',unitId:'troop',transportId:'ifv'}).error).toBeNull();
    expect(e.step({type:'EndTurn'}).error).toBeNull();const before=e.getState();
    const r=e.step({type:'DisembarkTransport',transportId:'ifv',destination:{q:24,r:25}});expect(r.error).toBeNull();
    const u=r.state.units.find(u=>u.id==='troop')!;
    expect(u).toMatchObject({canMove:false,canAttack:true,attackChargesRemaining:1,actionState:'acted'});
    expect(u.transportedByUnitId).toBeUndefined();expect(u.currentFuel).toBe(before.units.find(v=>v.id==='troop')!.currentFuel);
    expect(validateAction(r.state,{type:'Move',unitId:'troop',destination:{q:23,r:25}})?.code).toBe('unit_cannot_move');
  });
  it.each(['police','riotPolice','nationalGuard','reconTeam','specialForces'] as HumanUnitType[])('boards %s, preserves carrier actions, and transfers fuel only at zero',type=>{
    for(const fuel of [0,1]) {const {e,s,vehicle}=fixture(fuel);const troop=createUnit(s,'troop',type,{q:24,r:25});s.units.push(troop);load(e,s);
      const r=e.step({type:'BoardTransport',unitId:'troop',transportId:'ifv'});expect(r.error,r.error?.message).toBeNull();
      const u=r.state.units.find(u=>u.id==='ifv')!;expect(u.currentFuel).toBe(fuel===0?troop.currentFuel:1);expect(u.canMove).toBe(vehicle.canMove);expect(u.attackChargesRemaining).toBe(3);expect(u.flightState).toBeUndefined();
      expect(e.step({type:'DisembarkTransport',transportId:'ifv',destination:{q:24,r:25}}).error?.code).toBe('cargo_boarded_this_turn');
      expect(decodeSaveCode(encodeSaveCode(r.state as GameState)).state).toEqual(r.state);
    }
  });
  it('reserves all costs once at Army Base and fills one lifetime slot',()=>{
    const {e,s}=fixture();s.units=[];const base=s.facilities.find(f=>f.type==='armyBase')!;
    s.facilities.find(f=>f.id==='power-plant-1')!.workers=15;Object.assign(base,{owner:'player',status:'owned',operationalStatus:'operational',populationOperationalTurn:1,securedOrder:20,workers:0});load(e,s);
    const action={type:'ProduceUnit' as const,unitType:'ifv' as const,destination:base.position};
    for(const resource of ['food','civilianGoods','militaryGoods','fuel'] as const) {const poor=structuredClone(e.getState());poor.resources[resource]=0;expect(validateAction(poor,action)?.code).toMatch(/insufficient/);}
    const before=e.getState(),r=e.step(action);expect(r.error,r.error?.message).toBeNull();
    expect(r.state.resources).toMatchObject({food:before.resources.food-80,civilianGoods:before.resources.civilianGoods-50,militaryGoods:before.resources.militaryGoods-170,fuel:before.resources.fuel-150});
    expect(e.step(action).error?.code).toBe('lifetime_production_limit_reached');
    const turn=e.step({type:'EndTurn'});expect(turn.error,turn.error?.message).toBeNull();
    expect(turn.state.units.find(u=>u.type==='ifv')).toMatchObject({proficiency:'recruit',population:4,currentFuel:100,currentMilitaryGoods:120,maxAttackCharges:3});
    expect(decodeSaveCode(encodeSaveCode(turn.state as GameState)).state).toEqual(turn.state);
    expect(turn.state.completedProductions.ifv).toBe(1);expect(e.step(action).error?.code).toBe('lifetime_production_limit_reached');
  });
});


describe('IFV facility roles',()=>{
  it.each([19,20])('contains infection, and suppresses only with 20 ammunition (ammo=%s)',ammo=>{
    const {e,s,vehicle}=fixture(); const farm=s.facilities.find(f=>f.id==='farm-1')!;
    farm.workers=20; farm.infected=8; farm.operationalStatus='infected';
    vehicle.position={...farm.position};vehicle.currentMilitaryGoods=ammo;
    s.resources.militaryGoods=0; load(e,s);
    const r=e.step({type:'EndTurn'});expect(r.error).toBeNull();
    const site=r.state.facilities.find(f=>f.id===farm.id)!;
    const suppression=r.events.find(ev=>ev.type==='infection_suppressed'&&ev.payload.unitId==='ifv');
    if(ammo===20){expect(suppression?.payload).toMatchObject({remaining:0,militaryGoodsCost:20,attackChargesRemaining:2});expect(site.workers).toBe(12);expect(site.infected).toBe(0);}
    else {expect(suppression).toBeUndefined();expect(site.infected).toBe(8);expect(site.workers).toBe(20);}
  });
  it('captures an unowned site and restores a ruined checkpoint',()=>{
    const {e,s,vehicle}=fixture(); const site=s.facilities.find(f=>f.id==='oilfield-north')!;
    vehicle.position={q:site.position.q-1,r:site.position.r};load(e,s);
    const capture=e.step({type:'Move',unitId:'ifv',destination:site.position});expect(capture.error).toBeNull();
    expect(capture.state.facilities.find(f=>f.id===site.id)?.owner).toBe('player');
    const next=e.getState() as GameState,cp=next.checkpoints[0]!;
    cp.status='ruined';cp.infected=0;cp.overrunProcessed=true;
    next.roadBranches.find(b=>b.branchId===cp.branchId)!.activeCheckpointId=null;
    next.units[0]!.position={...cp.position};next.units[0]!.actionState='ready';next.units[0]!.canMove=true;load(e,next);
    const recovered=e.step({type:'Wait',unitId:'ifv'});expect(recovered.error).toBeNull();
    expect(recovered.events.filter(ev=>ev.type==='checkpoint_recovered')).toHaveLength(1);
    expect(recovered.state.checkpoints[0]!.status).toBe('operational');
  });
});


it.each(['ifv','multipurposeHelicopter'] as const)('disembarked infantry retains reactions but cannot automatically suppress that turn (%s)',carrier=>{
  const {e,s}=fixture();const farm=s.facilities.find(f=>f.id==='farm-1')!;
  const position={q:farm.position.q-1,r:farm.position.r};
  s.units=[createUnit(s,'carrier',carrier,position),createUnit(s,'troop','police',{q:position.q-1,r:position.r})];load(e,s);
  expect(e.step({type:'BoardTransport',unitId:'troop',transportId:'carrier'}).error).toBeNull();
  expect(e.step({type:'EndTurn'}).error).toBeNull();
  const next=e.getState() as GameState;const infected=next.facilities.find(f=>f.id===farm.id)!;
  infected.infected=8;infected.workers=20;infected.operationalStatus='infected';load(e,next);
  const landed=e.step({type:'DisembarkTransport',transportId:'carrier',destination:farm.position});expect(landed.error).toBeNull();
  const troop=landed.state.units.find(u=>u.id==='troop')!;expect(troop.canAttack).toBe(true);
  expect(forecastUnitSuppression(landed.state,troop)).toBeNull();
  const end=e.step({type:'EndTurn'});expect(end.error).toBeNull();
  expect(end.events.filter(ev=>ev.type==='infection_suppressed'&&ev.payload.unitId==='troop')).toHaveLength(0);
  expect(end.state.facilities.find(f=>f.id===farm.id)!.infected).toBe(8);
});
