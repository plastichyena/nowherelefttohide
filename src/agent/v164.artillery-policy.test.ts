import { describe, expect, it } from 'vitest';
import { createAgentGame } from './game';
import { assessArtillery, healthyCasualtyDistribution } from './artillery-policy';
import { createBalancedAgent } from './balancedAgent';
import type { AgentObservation } from './types';
import type { ArtilleryPreview } from '../core/artillery';

function scenario(){
  const observation=createAgentGame().reset({seed:1});
  const gun={...observation.units[0]!,id:'gun',type:'fieldArtillery' as const,mode:'deployed' as const,position:{q:10,r:25},attack:50,currentMilitaryGoods:100,range:200};
  const capital={...observation.facilities.find(f=>f.type==='capital')!,position:{q:10,r:10},healthyPopulation:50,infectedPopulation:0};
  const threatened={...capital,id:'threatened',type:'simpleFarm' as const,constructible:true,position:{q:30,r:25},healthyPopulation:40};
  observation.siteFallRules={zombieSpawnPopulationPerUnit:5,maxZombieSpawnPerResolution:1};
  const zombie={...observation.zombies[0]!,id:'threat',type:'soldierZombie' as const,position:{q:29,r:25},hp:40,attack:40,movement:1,vision:5,terrainDamageMultiplier:1};
  observation.facilities=[capital,threatened];observation.checkpoints=[];observation.units=[gun];observation.zombies=[zombie];observation.barbedWire=[];observation.populationTransferCandidates=[];
  observation.map.tiles=observation.map.tiles.map(t=>({...t,unobstructedMovementCost:1,effectiveMovementCost:1,terrainDamageMultiplier:1}));
  const preview:ArtilleryPreview={aimedHex:zombie.position,hitProbability:1,militaryGoodsCost:50,possibleImpactHexes:[{position:zombie.position,probability:1}],possibleBlastHexes:[zombie.position,threatened.position],friendlyFirePossible:true,friendlyUnitIdsAtRisk:[],populationRisks:[{siteId:threatened.id,kind:'facility',position:threatened.position,healthyPopulation:40,infectedPopulation:0,populationKnown:true,healthyPeoplePossible:true,playerOwned:true,terrainDamageMultiplier:1,maxDirectDeaths:25,expectedDirectDeaths:25,capital:false}],immediateDefeatPossible:false,unitRisks:[{unitId:zombie.id,position:zombie.position,player:false,hp:40,population:0,terrainDamageMultiplier:1,maxDamage:40,expectedDamage:40,lethalProbability:1}],knownGasChainHexes:[],scope:'public_information',limitations:[]};
  gun.artillery={minRange:10,militaryGoodsCost:50,hitProbability:1,scatterRadius:0,legalTargetHexes:[zombie.position],targetPreviews:[preview]};
  return {observation,gun,zombie,threatened,preview};
}

describe('public-only artillery collateral policy',()=>{
  it('rejects emergency predictions with unmodelled base interception or later friendly damage',()=>{
    const {observation,gun,preview}=scenario();
    const base=createAgentGame().reset({seed:1}).facilities.find(f=>f.type==='armyBase')!;
    observation.facilities.push({...base,position:{q:22,r:25},owner:'player',status:'owned',armyBase:{...base.armyBase!,interceptionAvailable:true,interceptionRange:10}});
    expect(assessArtillery(observation,gun,preview).allowed).toBe(false);
    observation.facilities.pop();
    preview.unitRisks.push({...preview.unitRisks[0]!,unitId:gun.id,player:true,hp:25,population:5,maxDamage:10,expectedDamage:10,lethalProbability:0});
    expect(assessArtillery(observation,gun,preview).allowed).toBe(false);
  });
  it('does not count city residents converted into infection as deaths',()=>{
    const {observation,gun,preview,threatened}=scenario();
    threatened.constructible=false;
    observation.facilities=observation.facilities.map(f=>f.id===threatened.id?{...f,type:'city'}:f);
    expect(assessArtillery(observation,gun,preview)).toMatchObject({allowed:false,expectedDeathsBeforeLowerBound:0});
  });
  it('admits all-true emergency fire with quantified survival and expected deaths',()=>{
    const {observation,gun,preview}=scenario();
    expect(assessArtillery(observation,gun,preview)).toMatchObject({allowed:true,emergency:true,reason:'emergency_conditions_met',defenseSuccessBefore:0,defenseSuccessAfter:1,expectedDeathsBeforeLowerBound:35,expectedDeathsAfterUpperBound:25});
    const action={type:'AttackHex' as const,attackerId:gun.id,position:preview.aimedHex};
    expect(createBalancedAgent().decide(observation,[action,{type:'EndTurn'}]).action).toEqual(action);
  });
  it.each(['no_fall','defense_not_improved','deaths_not_reduced','immediate_defeat','unknown_population','gas_chain','alternative'] as const)('rejects when %s defeats an emergency condition',failure=>{
    const {observation,gun,zombie,threatened,preview}=scenario();
    if(failure==='no_fall')zombie.attack=10;
    if(failure==='defense_not_improved')zombie.hp=100;
    if(failure==='deaths_not_reduced')preview.possibleImpactHexes=[{position:threatened.position,probability:1}];
    if(failure==='immediate_defeat')preview.immediateDefeatPossible=true;
    if(failure==='unknown_population')preview.populationRisks[0]!.populationKnown=false;
    if(failure==='gas_chain')preview.knownGasChainHexes=[threatened.position];
    if(failure==='alternative'){
      const defender={...gun,id:'defender',mode:'packed' as const,position:{q:21,r:25},range:10,attack:50,attackChargesRemaining:1,canAttack:true,canMove:false,currentMilitaryGoods:100,attackMilitaryGoodsCostByRange:{8:4}};
      observation.units.push(defender);
    }
    expect(assessArtillery(observation,gun,preview).allowed).toBe(false);
    const action={type:'AttackHex' as const,attackerId:gun.id,position:preview.aimedHex};
    expect(createBalancedAgent().decide(observation,[action,{type:'EndTurn'}]).action.type).toBe('EndTurn');
  });
  it('quantifies internal casualty sampling and ignores unrelated private-shaped extensions',()=>{
    expect(healthyCasualtyDistribution(1,1,1)).toEqual([{deaths:1,probability:.5},{deaths:0,probability:.5}]);
    const {observation,gun,preview}=scenario(),before=assessArtillery(observation,gun,preview);
    const extended={...observation,rngState:{seed:7,state:123,calls:88},hiddenEnemies:[{hp:999}]} as AgentObservation;
    expect(assessArtillery(extended,gun,preview)).toEqual(before);
  });
});
