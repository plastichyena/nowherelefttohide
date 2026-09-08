import { deriveSupplySnapshot } from './supply';
import { getPlayerVisibleTileKeys } from './visibility';
import { getCheckpointPositionCandidates, getConstructibleFacilityPositionCandidates } from './engine';
import { gasAttackPreview } from './gas-preview';
import { createUnit, populationLedgerTotal } from './state';
import { GameEngine } from './engine';
import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from './config';
import { createInitialState, synchronizePopulation, createCityPopulationSnapshot } from './state';
import { calculateEconomyPlan } from './economy-query';
import { createFixedMap, ARMY_BASE_CANDIDATES, validateFixedMap } from './map';
import { connectRoadAccess, fixedRoadInput, generateRoadNetwork, roadConnections, roadEdges, roadHash } from './roads';
import { hexDistance, hexKey } from './hex';
import { effectiveMovementCost, terrainDefenseAt } from './terrain';
import { populationTransferCandidates, validateAction } from './engine';
import { createAgentGame } from '../agent/game';
import type { GameState } from './types';
const setup = () => createInitialState(1, createDefaultConfig({ economy: { initialZombieCount: 0, initialHunterCount: {min:0,max:0}, initialGasCount:{min:0,max:0} } }));
describe('v1.5.5 housing', () => {
  it.each([0,1,2,9,10,11,25])('floors capped healthy resident output: %s', people => {
    const s=setup(), f={...s.facilities[0]!,id:'housing-test',type:'temporaryHousing' as const,position:{q:24,r:25},constructible:true,workerCapacity:10,workers:people,infected:0,builtTurn:0,operationalStatus:'operational' as const};s.facilities.push(f);s.resources.fuel=1000;
    const plan=calculateEconomyPlan(s),p=plan.facilities.find(p=>p.facilityId===f.id)!;
    expect(p.projectedPowerSupplied).toBe(true);expect(p.outputs.civilianGoods??0).toBe(Math.floor(Math.min(people,10)/2));
    expect(plan.forecast.maintenancePopulation.residents).toBe(s.facilities.filter(f=>['capital','city','temporaryHousing'].includes(f.type)&&f.owner==='player').reduce((n,f)=>n+f.workers,0));
  });
  it.each(['infection','building','supply','power'])('stops housing production for %s', reason => {
    const s=setup(),f={...s.facilities[0]!,id:'housing-test',type:'temporaryHousing' as const,position:{q:24,r:25},constructible:true,workerCapacity:10,workers:10,infected:0,builtTurn:0,operationalStatus:'operational' as GameState['facilities'][number]['operationalStatus']};s.facilities.push(f);
    if(reason==='infection')f.infected=1;if(reason==='building')f.operationalStatus='building';if(reason==='supply')f.position={q:3,r:3};if(reason==='power'){s.resources.fuel=0;s.facilities.filter(f=>f.type==='windPowerPlant').forEach(f=>f.operationalStatus='disabled');}
    expect(calculateEconomyPlan(s).facilities.find(p=>p.facilityId===f.id)!.outputs.civilianGoods??0).toBe(0);
  });
});
describe('v1.5.5 roads',()=>{
  it('connects all facilities and all Army Base candidates without altering the base network',()=>{
    const base=createFixedMap();const hash=roadHash(base.roads);
    for(const position of ARMY_BASE_CANDIDATES){const map=structuredClone(base);connectRoadAccess(fixedRoadInput(map),map.roads!,position,'access-army-base-1');const graph=roadConnections(map.roads!);const seen=new Set<string>(),pending=[hexKey(map.roadBranches[0]!.capitalConnection)];while(pending.length){const k=pending.pop()!;if(seen.has(k))continue;seen.add(k);for(const e of graph.get(k)??[])pending.push(hexKey(e.position));}for(const f of map.facilities)expect(seen.has(hexKey(f.position)),f.id).toBe(true);expect(seen.has(hexKey(position))).toBe(true);expect(roadHash({...map.roads!,segments:map.roads!.segments.filter(s=>s.id!=='access-army-base-1')})).toBe(hash);
      for(const s of map.roads!.segments.filter(s=>s.role!=='trunk'))for(const p of s.path){expect(map.tiles.find(t=>hexKey(t)===hexKey(p))!.playerOccupancyAllowed).toBe(true);}expect([...graph.values()].every(v=>v.length<=4)).toBe(true);
    }
  });
  it('is stable under input permutation and consumes no gameplay RNG',()=>{
    const map=createFixedMap(),input=fixedRoadInput(map),first=generateRoadNetwork(input),second=generateRoadNetwork({...input,tiles:[...input.tiles].reverse(),facilities:[...input.facilities].reverse(),trunks:[...input.trunks].reverse()});expect(second).toEqual(first);expect(validateFixedMap(map).valid).toBe(true);
    const corrupt=structuredClone(map);corrupt.roads!.segments[0]!.path[1]={q:0,r:0};expect(validateFixedMap(corrupt).valid).toBe(false);
  });
  it('uses destination MP1 over Forest/Mountain without changing defense or base terrain',()=>{
    const s=setup();const tile=s.map.tiles.find(t=>t.terrain==='forest'&&t.playerOccupancyAllowed)!;const adjacent=s.map.tiles.find(t=>hexDistance(t,tile)===1)!;
    s.map.roads={...s.map.roads!,segments:[...s.map.roads!.segments,{id:'test',role:'access',path:[{q:adjacent.q,r:adjacent.r},{q:tile.q,r:tile.r}]}]};
    expect(effectiveMovementCost(s,tile)).toBe(1);expect(tile.terrain).toBe('forest');expect(terrainDefenseAt(s,{type:'zombie',position:tile,isPlayerUnit:false}).source).toBe('forest');
    tile.terrain='water';expect(effectiveMovementCost(s,tile)).toBeNull();
  });
});
describe('v1.5.5 population parameter domain',()=>{
  it('accepts a legal unenumerated integer and rejects invalid counts without state mutation',()=>{
    const s=setup(),city=s.facilities.find(f=>f.type==='city')!;city.owner='player';city.status='owned';city.workers=5;s.facilities.find(f=>f.type==='capital')!.workers-=5;city.securedOrder=100;city.operationalStatus='operational';city.populationOperationalTurn=1;synchronizePopulation(s);createCityPopulationSnapshot(s);
    const range=populationTransferCandidates(s).find(c=>c.fromFacilityId==='capital'&&c.toFacilityId===city.id)!;expect(range.min).toBe(1);expect(range.max).toBeGreaterThan(7);
    const game=createAgentGame() as ReturnType<typeof createAgentGame>&{restorePrivateSessionState(s:GameState):void};game.restorePrivateSessionState(s);
    expect(game.step({type:'TransferPopulation',fromFacilityId:'capital',toFacilityId:city.id,people:7}).error).toBeNull();const before=game.getObservation();expect(game.step({type:'TransferPopulation',fromFacilityId:'capital',toFacilityId:city.id,people:0}).error).not.toBeNull();expect(game.getObservation()).toEqual(before);
    expect(validateAction(s,{type:'TransferPopulation',fromFacilityId:'capital',toFacilityId:city.id,people:1.2})).not.toBeNull();
  });
});

describe('v1.5.5 public and terrain boundaries',()=>{
  it('does not change Supply, LOS or construction/checkpoint eligibility when roads are removed',()=>{
    const state=setup(),other=structuredClone(state);other.map.roads=undefined;
    expect(deriveSupplySnapshot(state)).toEqual(deriveSupplySnapshot(other));
    expect(getPlayerVisibleTileKeys(state)).toEqual(getPlayerVisibleTileKeys(other));
    expect(getCheckpointPositionCandidates(state)).toEqual(getCheckpointPositionCandidates(other));
    for(const type of ['simpleFarm','civilianDroneBase','temporaryHousing','windPowerPlant'] as const)expect(getConstructibleFacilityPositionCandidates(state,type)).toEqual(getConstructibleFacilityPositionCandidates(other,type));
  });
  it('rejects a disconnected synthetic road input without changing forbidden terrain',()=>{
    const map=createFixedMap(),input=fixedRoadInput(map);input.forbidden=input.tiles.filter(t=>!t.road).map(t=>({position:{q:t.q,r:t.r},reason:'synthetic closure'}));
    const before=JSON.stringify(input);expect(()=>generateRoadNetwork(input)).toThrow(/Road/);expect(JSON.stringify(input)).toBe(before);
    const zero=generateRoadNetwork({...fixedRoadInput(map),style:{...input.style,optionalRatio:0}});expect(zero.segments.some(s=>s.id.startsWith('loop-'))).toBe(false);
  });
  it('previews visible Gas chains, terrain damage and population infection without hidden-enemy influence',()=>{
    const state=setup();state.units=[];state.checkpoints=[];
    const add=(id:string,type:Parameters<typeof createUnit>[2],q:number,r:number,hp?:number)=>{const u=createUnit(state,id,type,{q,r});if(hp!==undefined)u.hp=hp;state.units.push(u);return u;};
    const human=add('observer','police',25,25,50),gas=add('gas','gasZombie',24,25,1),chain=add('gas-chain','gasZombie',24,24,1),enemy=add('victim','hordeZombie',23,25,40);
    const preview=gasAttackPreview(state,gas,1)!;expect(preview.explosions.map(e=>e.sourceId)).toEqual(['gas','gas-chain']);expect(preview.units.find(u=>u.unitId===human.id)?.damage).toBe(15);expect(preview.units.find(u=>u.unitId===enemy.id)?.damage).toBe(30);expect(preview.sites.find(s=>s.siteId==='capital')?.infected).toBe(30);
    const hidden=add('hidden-gas','gasZombie',1,1,1);expect(gasAttackPreview(state,gas,1)).toEqual(preview);hidden.hp=100;expect(gasAttackPreview(state,gas,1)).toEqual(preview);
    expect(gasAttackPreview(state,gas,0)?.trigger).toBe('nonlethal_no_explosion');expect(gasAttackPreview(state,gas,0)?.explosions).toEqual([]);
  });
});

it('matches visible Gas-chain damage and infection against an actual Core Attack',()=>{
 const state=setup();state.units=[];state.checkpoints=[];
 for(const [id,type,q,r,hp] of [['guard','nationalGuard',25,25,50],['root','gasZombie',24,25,1],['chain','gasZombie',24,24,1],['victim','policeZombie',23,25,25]] as const){const unit=createUnit(state,id,type,{q,r});unit.hp=Math.min(hp,unit.maxHp);state.units.push(unit);}
 state.nextUnitNumber=100;synchronizePopulation(state);state.population.initialPopulation=populationLedgerTotal(state);
 const engine=new GameEngine(1,state.config);const loaded=engine.step({type:'LoadSnapshot',snapshot:state});expect(loaded.error?.message).toBeUndefined();
 const preview=gasAttackPreview(state,state.units.find(u=>u.id==='root')!,20)!;
 const result=engine.step({type:'Attack',attackerId:'guard',targetId:'root'});expect(result.error).toBeNull();
 for(const unit of preview.units)expect(result.state.units.find(u=>u.id===unit.unitId)?.hp??0).toBe(unit.hpAfter);
 expect(result.state.facilities.find(f=>f.id==='capital')!.workers).toBe(preview.sites.find(s=>s.siteId==='capital')!.healthyAfter);
});
