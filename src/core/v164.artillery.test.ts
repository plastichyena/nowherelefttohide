import { describe, expect, it } from 'vitest';
import { GameEngine } from './engine';
import { createDefaultConfig } from './config';
import { createUnit, populationLedgerTotal } from './state';
import { prepareTestSnapshot } from './testConfig';
import { artilleryImpacts, artilleryAttackReason, previewArtillery, damageArtilleryPopulation } from './artillery';
import { synchronizeArtilleryStats } from './unit-capabilities';
import { previewCoreAction } from './action-preview';
import { forecastUnitSuppression, forecastUnitCombatAtDistance } from './combat-query';
import { previewMove, interceptorsAt } from './movement-query';
import { hexDistance, hexKey } from './hex';
import { SeededRng } from './rng';
import { validateInvariants } from './invariants';
import { deriveUnitRecovery } from './recovery';
import type { GameState, UnitProficiency } from './types';
import { createAgentGame } from '../agent/game';
import { getPlayerVisibleTileKeys } from './visibility';

function scenario(proficiency: UnitProficiency = 'veteran') {
  const engine = new GameEngine(1, createDefaultConfig({ economy: { initialZombieCount: 0, initialHunterCount: { min:0,max:0 }, initialGasCount:{min:0,max:0},initialScreamerCount:0,initialResources:{food:100000,civilianGoods:100000,militaryGoods:100000,fuel:100000} }, refugees:{arrivalIntervalMin:99,arrivalIntervalMax:99} }));
  const state=engine.getState() as GameState;
  state.units=[createUnit(state,'gun','fieldArtillery',{q:15,r:25},'ready',proficiency),createUnit(state,'spotter','reconTeam',{q:26,r:27})];
  const gun=state.units[0]!;gun.mode='deployed';gun.canMove=false;synchronizeArtilleryStats(state,gun);
  const load=()=>{prepareTestSnapshot(state);const result=engine.step({type:'LoadSnapshot',snapshot:state});expect(result.error,result.error?.message).toBeNull();};
  return {engine,state,gun,load};
}

describe('v1.6.4 artillery',()=>{
  it('keeps hidden splash victims private without changing vision',()=>{
    const {state,gun}=scenario();
    state.units=state.units.filter(u=>u.id==='gun');
    const visible=getPlayerVisibleTileKeys(state);
    const aim=state.map.tiles.find(t=>visible.has(hexKey(t))&&hexDistance(t,gun.position)>=10&&state.map.tiles.some(n=>hexDistance(n,t)===1&&!visible.has(hexKey(n))&&n.terrain==='plain'&&n.playerOccupancyAllowed))!;
    const hidden=state.map.tiles.find(n=>hexDistance(n,aim)===1&&!visible.has(hexKey(n))&&n.terrain==='plain'&&n.playerOccupancyAllowed)!;
    state.units.push(createUnit(state,'hidden-victim','zombie',hidden));
    prepareTestSnapshot(state);
    const game=createAgentGame();game.restorePrivateSessionState(state);
    expect(game.getObservation().zombies.some(u=>u.id==='hidden-victim')).toBe(false);
    const result=game.step({type:'AttackHex',attackerId:'gun',position:{q:aim.q,r:aim.r}});
    expect(result.error,result.error?.message).toBeNull();
    expect(game.getDebugState().events.some(e=>e.type==='damage'&&e.payload.targetId==='hidden-victim')).toBe(true);
    expect(JSON.stringify(result)).not.toContain('hidden-victim');
    expect(result.observation.map.tiles.find(t=>hexKey(t)===hexKey(hidden))?.visibleToPlayer).toBe(false);
  });

  it('emits one dual-center noise pulse, chooses the source on overlap, and rolls each fallen site once',()=>{
    const {engine,state,gun,load}=scenario();
    const listener=createUnit(state,'listener','zombie',{q:35,r:25});listener.vision=0;listener.movement=0;
    state.units.push(listener);
    const fallen=state.facilities.find(f=>f.type==='farm'&&f.owner==='none')??state.facilities.find(f=>f.owner==='none')!;
    Object.assign(fallen,{status:'ruined',operationalStatus:'ruined',workers:0,infected:30,earlyCaptureSurvivorStatus:'lost'});
    load();
    const fired=engine.step({type:'AttackHex',attackerId:'gun',position:{q:25,r:25}});
    expect(fired.error,fired.error?.message).toBeNull();
    expect(fired.state.pendingNoisePulses.filter(p=>p.sourceUnitType==='fieldArtillery')).toHaveLength(1);
    expect(fired.state.pendingNoisePulses.find(p=>p.sourceUnitType==='fieldArtillery')).toMatchObject({center:gun.position,secondaryCenter:{q:25,r:25},radius:40});
    expect(fired.events.filter(e=>e.type==='site_noise_respawn'&&e.payload.siteId===fallen.id)).toHaveLength(1);
    const ended=engine.step({type:'EndTurn'});expect(ended.error,ended.error?.message).toBeNull();
    expect(ended.state.units.find(u=>u.id==='listener')?.noiseTarget).toEqual(gun.position);
    expect(ended.events.filter(e=>e.type==='noise_targeted'&&e.payload.zombieId==='listener')).toHaveLength(1);
  });

  it('enforces inclusive 10..200 range and never reacts in deployed mode',()=>{
    const {state,gun}=scenario();
    for(const [distance,legal] of [[9,false],[10,true],[200,true],[201,false]] as const)expect(forecastUnitCombatAtDistance(state,gun,distance).canAttack).toBe(legal);
    const enemy=createUnit(state,'walker','zombie',{q:26,r:25});state.units.push(enemy);
    expect(interceptorsAt(state,enemy,enemy.position).some(u=>u.id===gun.id)).toBe(false);
  });

  it('charges packed movement by MP including terrain, and preserves move-then-melee',()=>{
    const {engine,state,gun,load}=scenario();gun.mode='packed';gun.canMove=true;synchronizeArtilleryStats(state,gun);
    const forest=state.map.tiles.find(t=>t.terrain==='forest'&&!t.road&&t.playerOccupancyAllowed&&t.q>10&&t.q<20&&t.r>10&&t.r<20)!;
    const start=state.map.tiles.find(t=>hexDistance(t,forest)===1&&t.terrain==='plain'&&t.playerOccupancyAllowed)!;
    gun.position={q:start.q,r:start.r};state.units=state.units.filter(u=>u.id===gun.id);load();
    const preview=previewMove(engine.getState(),gun.id,forest);
    expect(preview).toMatchObject({legal:true,effectiveMovementCost:2,fuelCost:20,projectedFuelAfterMove:80});
    expect(engine.step({type:'Move',unitId:gun.id,destination:{q:forest.q,r:forest.r}}).error).toBeNull();
    expect(engine.getState().units[0]).toMatchObject({currentFuel:80,canAttack:true});
  });

  it('locks both modes until the next turn without charging resources; movement prevents deployment',()=>{
    const {engine,state,gun,load}=scenario();gun.mode='packed';gun.canMove=true;synchronizeArtilleryStats(state,gun);gun.currentFuel=gun.currentMilitaryGoods=0;load();
    expect(engine.step({type:'ChangeUnitMode',unitId:'gun',mode:'deployed'}).error).toBeNull();
    let u=engine.getState().units.find(u=>u.id==='gun')!;
    expect(u).toMatchObject({mode:'deployed',movement:0,range:200,attack:50,canAttack:false,canMove:false,currentFuel:0,currentMilitaryGoods:0});
    expect(deriveUnitRecovery(engine.getState(),u).recoveryClass).not.toBe('rest');
    expect(engine.step({type:'ChangeUnitMode',unitId:'gun',mode:'packed'}).error?.code).toBe('mode_change_unavailable');
    expect(engine.step({type:'AttackHex',attackerId:'gun',position:{q:25,r:25}}).error?.code).toBe('unit_cannot_attack');
    expect(engine.step({type:'EndTurn'}).error).toBeNull();u=engine.getState().units.find(u=>u.id==='gun')!;
    expect(u.canAttack).toBe(true);expect(u.canMove).toBe(false);
    expect(engine.step({type:'ChangeUnitMode',unitId:'gun',mode:'packed'}).error).toBeNull();
    expect(engine.getState().units.find(u=>u.id==='gun')).toMatchObject({movement:10,range:1,attack:9,canMove:false,canAttack:false,maxAttackCharges:1});
    gun.mode='packed';gun.canMove=false;gun.actionState='moved';gun.activity.moved=true;synchronizeArtilleryStats(state,gun);load();
    expect(engine.step({type:'ChangeUnitMode',unitId:'gun',mode:'deployed'}).error?.code).toBe('mode_change_unavailable');
  });

  it('requires range and 50 carried goods, accepts visible empty ground, and keeps preview RNG pure',()=>{
    const {engine,state,gun,load}=scenario('recruit');load();
    const action={type:'AttackHex' as const,attackerId:'gun',position:{q:25,r:25}};
    gun.currentMilitaryGoods=49;load();expect(engine.step(action).error?.code).toBe('insufficient_military_goods');
    gun.currentMilitaryGoods=50;load();const before=engine.getState();const preview=previewCoreAction(before,action,8);
    expect(preview).toMatchObject({legal:true,baseRevision:8,artillery:{hitProbability:0.5,militaryGoodsCost:50}});
    expect(JSON.stringify(preview)).not.toContain('hitRoll');expect(engine.getState()).toEqual(before);
    expect(preview.artillery!.possibleImpactHexes).toHaveLength(19);
    expect(preview.artillery!.possibleImpactHexes.reduce((n,p)=>n+p.probability,0)).toBeCloseTo(1);
    expect(engine.step(action).error).toBeNull();expect(engine.getState().artilleryRngState.calls).toBeGreaterThan(before.artilleryRngState.calls);
    expect(engine.getState().units.find(u=>u.id==='gun')).toMatchObject({currentMilitaryGoods:0,attackChargesRemaining:0});
    expect(engine.step(action).error).not.toBeNull();
  });

  it.each([['recruit',19,2],['regular',7,1],['veteran',1,0]] as const)('builds %s scatter distribution including map-edge clipping', (proficiency,count,radius)=>{
    const {state,gun}=scenario(proficiency),aim={q:25,r:25};
    const candidates=artilleryImpacts(state,gun,aim);expect(candidates).toHaveLength(count);
    for(const c of candidates.slice(1)){expect(hexDistance(c.position,aim)).toBeGreaterThan(0);expect(hexDistance(c.position,aim)).toBeLessThanOrEqual(radius);expect(c.probability).toBeCloseTo(0.5/(count-1));}
    expect(artilleryImpacts(state,gun,{q:0,r:0}).every(c=>c.position.q>=0&&c.position.r>=0)).toBe(true);
    expect(artilleryImpacts(state,gun,{q:0,r:0}).reduce((n,c)=>n+c.probability,0)).toBeCloseTo(1);
  });

  it('applies direct and adjacent terrain damage once and credits direct kills only',()=>{
    const {engine,state,gun,load}=scenario('regular');
    // Force accuracy through supported Config so the lifecycle test is independent of scatter.
    state.config.units.fieldArtillery.scatter.regular.hitProbability=1;
    state.units.push(createUnit(state,'direct','soldierZombie',{q:25,r:25}),createUnit(state,'splash','zombie',{q:25,r:26}));load();
    const before=engine.getState();const result=engine.step({type:'AttackHex',attackerId:'gun',position:{q:25,r:25}});
    expect(result.error,result.error?.message).toBeNull();
    expect(result.state.units.some(u=>u.id==='direct'||u.id==='splash')).toBe(false);
    expect(result.state.units.find(u=>u.id==='gun')!.regularZombieKills).toBe(2);
    expect(result.events.filter(e=>e.type==='damage'&&e.payload.cause==='artillery')).toHaveLength(2);
    expect(populationLedgerTotal(result.state as GameState)).toBe(populationLedgerTotal(before as GameState));
    expect(validateInvariants(result.state as GameState).valid).toBe(true);
  });

  it('defers Gas until all direct deaths and never adds reanimation to the original blast',()=>{
    const {engine,state,load}=scenario();
    state.units.push(createUnit(state,'gas','gasZombie',{q:25,r:25}),createUnit(state,'friend','fieldArtillery',{q:25,r:26}),createUnit(state,'chain-target','soldierZombie',{q:24,r:25}));
    state.units.find(u=>u.id==='gas')!.hp=20;state.units.find(u=>u.id==='friend')!.hp=1;load();
    const result=engine.step({type:'AttackHex',attackerId:'gun',position:{q:25,r:25}});expect(result.error,result.error?.message).toBeNull();
    const directIndices=result.events.flatMap((e,i)=>e.type==='damage'&&e.payload.cause==='artillery'?[i]:[]);
    const explosionIndex=result.events.findIndex(e=>e.type==='gas_explosion');expect(explosionIndex).toBeGreaterThan(Math.max(...directIndices));
    const reanimation=result.events.find(e=>e.type==='human_unit_reanimated'&&e.payload.humanUnitId==='friend')!;
    expect(reanimation.payload.zombieUnitType).toBe('soldierZombie');
    expect(result.events.filter(e=>e.type==='damage'&&e.payload.targetId===reanimation.payload.zombieUnitId&&e.payload.cause==='artillery')).toEqual([]);
    expect(result.events.find(e=>e.type==='damage'&&e.payload.targetId===reanimation.payload.zombieUnitId&&e.payload.cause==='gas_explosion')?.payload.baseDamage).toBe(15);
  });

  it('draws all internal population pools without replacement and preserves grace and queue totals',()=>{
    const {state}=scenario();const cp=state.checkpoints[0]!;
    Object.assign(cp,{waiting:9,grandfatheredWaiting:4,grandfatheredPolicy:'normal',screening:7,approved:5,infected:6,infectionGrace:[{count:3,spreadsFromTurn:2}],remainingTurns:2});
    const deaths=state.population.cumulativeDeaths;
    damageArtilleryPopulation(state,cp,200,new SeededRng(7),'gun');
    expect(cp).toMatchObject({waiting:0,screening:0,approved:0,infected:0,grandfatheredWaiting:0,grandfatheredPolicy:null,remainingTurns:0,infectionGrace:[]});
    expect(state.population.cumulativeDeaths-deaths).toBe(27);
  });

  it('shows unknown unowned populations as risks and warns about capital defeat',()=>{
    const {state,gun}=scenario();const capital=state.facilities.find(f=>f.type==='capital')!;capital.workers=1;
    const unknown=state.facilities.find(f=>f.owner==='none')!;unknown.position={q:26,r:25};unknown.workers=9;
    const preview=previewArtillery(state,gun,capital.position);
    expect(preview.immediateDefeatPossible).toBe(true);
    expect(preview.populationRisks.find(p=>p.siteId===unknown.id)).toMatchObject({populationKnown:false,healthyPopulation:null,infectedPopulation:null,healthyPeoplePossible:true});
  });

  it('cannot suppress or contain, and a deliberate shot can defeat the player after full resolution',()=>{
    const {engine,state,gun,load}=scenario();const capital=state.facilities.find(f=>f.type==='capital')!;
    capital.workers=1;capital.infected=0;load();
    expect(forecastUnitSuppression(state,gun)).toBeNull();
    const result=engine.step({type:'AttackHex',attackerId:'gun',position:capital.position});
    expect(result.error,result.error?.message).toBeNull();expect(result.gameOver).toBe(true);expect(result.result?.reason).toBe('capitalLost');
  });

  it('keeps artillery RNG and outcomes identical across snapshot restoration',()=>{
    const {engine,load}=scenario('recruit');load();const before=engine.getState();
    const action={type:'AttackHex' as const,attackerId:'gun',position:{q:25,r:25}};
    const first=engine.step(action);expect(first.error).toBeNull();
    const replay=new GameEngine(1,before.config);expect(replay.step({type:'LoadSnapshot',snapshot:before as GameState}).error).toBeNull();
    const second=replay.step(action);expect(second.events).toEqual(first.events);expect(second.state).toEqual(first.state);
  });
});
