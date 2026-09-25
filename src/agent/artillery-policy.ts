import { publicMoveCandidates } from './public-movement';
import { hexDistance, hexKey, hexNeighbors } from '../core/hex';
import type { ArtilleryPreview } from '../core/artillery';
import type { GameAction } from '../core/types';
import type { AgentObservation, AgentUnitObservation } from './types';

export interface ArtilleryAssessment {
  allowed: boolean; emergency: boolean; reason: string;
  defenseSuccessBefore: number | null; defenseSuccessAfter: number | null;
  expectedDeathsBeforeLowerBound: number | null; expectedDeathsAfterUpperBound: number | null;
  scope: 'public_next_enemy_phase_estimate';
}
type Site={id:string;position:{q:number;r:number};healthy:number;infected:number;capital:boolean;constructible:boolean};

/** Exact marginal sampling distribution for healthy casualties, without replacement. */
export function healthyCasualtyDistribution(healthy:number,infected:number,damage:number): Array<{deaths:number;probability:number}> {
  let distribution=new Map<number,number>([[0,1]]);
  for(let removed=0;removed<Math.min(damage,healthy+infected);removed++){
    const next=new Map<number,number>();
    for(const [dead,p] of distribution){
      const denominator=healthy+infected-removed,h=(healthy-dead)/denominator,i=(infected-(removed-dead))/denominator;
      if(h>0)next.set(dead+1,(next.get(dead+1)??0)+p*h);
      if(i>0)next.set(dead,(next.get(dead)??0)+p*i);
    }
    distribution=next;
  }
  return [...distribution].map(([deaths,probability])=>({deaths,probability}));
}

function travelCost(observation:AgentObservation,unit:AgentUnitObservation,site:Site):number {
  const tiles=new Map(observation.map.tiles.map(t=>[hexKey(t),t]));
  const blocked=new Set(observation.units.map(u=>hexKey(u.position)));
  const pending=[{position:unit.position,cost:0}],best=new Map<string,number>();
  while(pending.length){pending.sort((a,b)=>a.cost-b.cost);const current=pending.shift()!,key=hexKey(current.position);if(best.has(key))continue;best.set(key,current.cost);if(key===hexKey(site.position))return current.cost;if(current.cost>=unit.movement)continue;
    for(const position of hexNeighbors(current.position)){const tile=tiles.get(hexKey(position));if(!tile||tile.unobstructedMovementCost===null||blocked.has(hexKey(position))||observation.barbedWire.some(w=>hexKey(w.position)===hexKey(position)))continue;pending.push({position,cost:current.cost+(tile.unobstructedMovementCost??tile.effectiveMovementCost??Infinity)});}
  }return Infinity;
}

/** An explicit bounded alternative plan; a merely available attack is insufficient. */
function alternativeDefense(observation:AgentObservation,gunId:string,threats:AgentUnitObservation[]):boolean|null {
  if(threats.length>6)return null;
  if(observation.units.some(u=>u.id!==gunId&&u.mode==='deployed'&&u.canAttack&&u.currentMilitaryGoods>=50))return null;
  const humans=observation.units.filter(u=>u.id!==gunId&&u.mode!=='deployed'&&u.canAttack&&u.attackChargesRemaining>0);
  let visits=0,exhausted=false;
  const recurse=(index:number,hp:number[]):boolean=>{
    if(hp.every(h=>h<=0))return true;
    if(++visits>20000){exhausted=true;return false;}if(index>=humans.length)return false;
    const human=humans[index]!;
    const positions=[human.position,...(human.canMove?publicMoveCandidates(observation, human.id).map(m=>m.destination):[])];
    // Each unit chooses one position for all of its attacks, retaining charge and ammunition constraints.
    const patterns=new Set<string>();
    for(const position of positions){
      const costs=threats.map(z=>{const d=hexDistance(position,z.position);return d>=1&&d<=human.range?human.attackMilitaryGoodsCostByRange[d]??Infinity:Infinity;});
      if(patterns.has(costs.join(',')))continue;patterns.add(costs.join(','));
      const attack=(remaining:number,ammo:number,health:number[]):boolean=>{
        if(recurse(index+1,health))return true;
        if(remaining===0)return false;
        for(let t=0;t<threats.length;t++){
          const cost=costs[t]!;if(health[t]!<=0||!Number.isFinite(cost))continue;
          const distance=hexDistance(position,threats[t]!.position),shortage=ammo<cost;
          if(shortage&&(distance!==1||human.type==='reconTeam'))continue;
          const damage=Math.ceil((shortage?Math.max(1,Math.ceil(human.attack*.2)):human.attack)*threats[t]!.terrainDamageMultiplier);
          const next=[...health];next[t]=Math.max(0,next[t]!-damage);
          if(attack(remaining-1,Math.max(0,ammo-cost),next))return true;
        }return false;
      };
      if(attack(human.attackChargesRemaining,human.currentMilitaryGoods,hp))return true;
    }
    return recurse(index+1,hp);
  };
  const found=recurse(0,threats.map(z=>z.hp));return found?true:exhausted?null:false;
}

/** No GameState, hidden enemies, seed or execution RNG is available to this policy. */
export function assessArtillery(observation:AgentObservation,gun:AgentUnitObservation,preview:ArtilleryPreview):ArtilleryAssessment {
  const result:ArtilleryAssessment={allowed:false,emergency:false,reason:'unsafe',defenseSuccessBefore:null,defenseSuccessAfter:null,expectedDeathsBeforeLowerBound:null,expectedDeathsAfterUpperBound:null,scope:'public_next_enemy_phase_estimate'};
  if(preview.immediateDefeatPossible)return {...result,reason:'immediate_defeat_possible'};
  const useful=preview.unitRisks.some(u=>!u.player&&u.expectedDamage>0)||preview.populationRisks.some(p=>(p.infectedPopulation??0)>0&&p.maxDirectDeaths>0);
  if(!useful)return {...result,reason:'no_public_target'};
  if(!preview.friendlyFirePossible)return {...result,allowed:true,reason:'no_public_friendly_fire'};
  if(preview.populationRisks.some(p=>!p.populationKnown))return {...result,reason:'unknown_population'};
  if(observation.facilities.some(f=>f.armyBase?.interceptionAvailable&&observation.zombies.some(z=>hexDistance(z.position,f.position)<=f.armyBase!.interceptionRange+z.movement)))return {...result,reason:'base_interception_prediction_unavailable'};
  // Surviving the shell does not prove survival of the following enemy phase.
  if(preview.unitRisks.some(u=>u.player&&u.maxDamage>0))return {...result,reason:'friendly_unit_future_damage_unresolved'};
  // These effects can change targeting and cause new occupations. Do not claim a quantified safety proof.
  if(preview.knownGasChainHexes.length||preview.unitRisks.some(u=>u.player&&u.maxDamage>=u.hp))return {...result,reason:'chain_or_reanimation_prediction_unavailable'};
  const sites:Site[]=[...observation.facilities.filter(f=>f.owner==='player'&&f.status==='owned').map(f=>({id:f.id,position:f.position,healthy:f.healthyPopulation,infected:f.infectedPopulation,capital:f.type==='capital',constructible:f.constructible&&f.type!=='windPowerPlant'})),...observation.checkpoints.filter(c=>c.status==='operational'||c.status==='remnant').map(c=>({id:c.id,position:c.position,healthy:c.waiting+c.screening+c.approved,infected:c.infected,capital:false,constructible:false}))];
  const threats=observation.zombies.filter(z=>sites.some(s=>hexDistance(z.position,s.position)<=z.vision && travelCost(observation,z,s)<=z.movement));
  if(threats.some(z=>!['zombie','policeZombie','soldierZombie','riotZombie'].includes(z.type)))return {...result,reason:'special_enemy_prediction_unavailable'};
  if(threats.some(z=>observation.facilities.some(f=>f.owner!=='player'&&hexDistance(z.position,f.position)<=z.vision)))return {...result,reason:'unknown_population_target'};
  if(threats.some(z=>observation.units.some(u=>hexDistance(z.position,u.position)<=z.vision)))return {...result,reason:'competing_unit_target'};
  // A pinned enemy follows combat rather than the simple occupation model below.
  if(threats.some(z=>observation.units.some(u=>hexDistance(u.position,z.position)===1)))return {...result,reason:'contact_combat_prediction_unavailable'};
  const targetByEnemy=new Map(threats.map(z=>[z.id,sites.filter(s=>hexDistance(z.position,s.position)<=z.vision&&travelCost(observation,z,s)<=z.movement).sort((a,b)=>travelCost(observation,z,a)-travelCost(observation,z,b)||b.healthy-a.healthy||a.id.localeCompare(b.id))[0]!.id]));
  // Ties can retarget after collateral damage; congestion can stop multiple occupiers.
  // Neither is a quantified emergency proof in this bounded public model.
  if(threats.some(z=>sites.filter(s=>hexDistance(z.position,s.position)<=z.vision&&travelCost(observation,z,s)<=z.movement).length>1)
    || new Set(targetByEnemy.values()).size<targetByEnemy.size)return {...result,reason:'targeting_or_congestion_unresolved'};
  const pressure=(siteId:string,hp:Map<string,number>)=>threats.filter(z=>targetByEnemy.get(z.id)===siteId&&(hp.get(z.id)??z.hp)>0).reduce((n,z)=>n+z.attack,0);
  const threatened=sites.filter(s=>s.healthy>0&&pressure(s.id,new Map())>=s.healthy);
  if(!threatened.length)return {...result,reason:'no_next_phase_fall'};
  // Internal infection before the enemy phase introduces additional uncertain population draws.
  if(threatened.some(s=>s.infected>0))return {...result,reason:'infection_phase_prediction_unavailable'};
  if(observation.populationTransferCandidates.some(c=>threatened.some(s=>s.id===c.toFacilityId||s.id===c.fromFacilityId)))return {...result,reason:'population_transfer_alternative_unresolved'};
  const relevant=threats.filter(z=>threatened.some(s=>s.id===targetByEnemy.get(z.id)));
  const alternative=alternativeDefense(observation,gun.id,relevant);
  if(alternative!==false)return {...result,reason:alternative?'adequate_alternative':'alternative_search_unresolved'};
  // Occupation converts healthy people into infection; this is not itself death.
  // Only destroyed constructibles kill the infected people left after spawning.
  // Use public Config bounds rather than predicting private spawn positions/types.
  const fallRules=observation.siteFallRules;
  if(sites.some(s=>s.constructible)&&!fallRules)return {...result,reason:'site_fall_rules_unavailable'};
  const maximumSpawnPopulation=fallRules?fallRules.zombieSpawnPopulationPerUnit*fallRules.maxZombieSpawnPerResolution:0;
  const beforeDeaths=sites.reduce((n,s)=>n+(s.constructible&&pressure(s.id,new Map())>=s.healthy?Math.max(0,s.healthy-maximumSpawnPopulation):0),0);
  let success=0,afterDeaths=0;
  const byKey=new Map(observation.map.tiles.map(t=>[hexKey(t),t]));
  for(const impact of preview.possibleImpactHexes){
    const base=(at:Site['position'])=>{const d=hexDistance(impact.position,at);return d===0?gun.attack:d===1?gun.attack/2:0;};
    const enemyHp=new Map(observation.zombies.map(z=>[z.id,Math.max(0,z.hp-Math.ceil(base(z.position)*z.terrainDamageMultiplier))]));
    let outcomeSuccess=1,outcomeDeaths=0;
    for(const site of sites){
      const damage=Math.ceil(base(site.position)*(byKey.get(hexKey(site.position))?.terrainDamageMultiplier??1));
      const distribution=healthyCasualtyDistribution(site.healthy,site.infected,damage),attack=pressure(site.id,enemyHp);
      const survives=distribution.filter(d=>site.healthy-d.deaths>attack).reduce((n,d)=>n+d.probability,0);
      if(threatened.some(t=>t.id===site.id))outcomeSuccess*=survives;
      outcomeDeaths+=distribution.reduce((n,d)=>n+d.probability*(d.deaths+(site.constructible&&attack>=site.healthy-d.deaths?site.healthy-d.deaths:0)),0);
    }
    // Friendly-unit damage was excluded because later combat losses are not modelled.
    success+=impact.probability*outcomeSuccess;afterDeaths+=impact.probability*outcomeDeaths;
  }
  return {...result,emergency:true,allowed:success>0&&afterDeaths<beforeDeaths,reason:success<=0?'defense_not_improved':afterDeaths>=beforeDeaths?'deaths_not_reduced':'emergency_conditions_met',defenseSuccessBefore:0,defenseSuccessAfter:success,expectedDeathsBeforeLowerBound:beforeDeaths,expectedDeathsAfterUpperBound:afterDeaths};
}

export function artilleryActionAssessment(observation:AgentObservation,action:GameAction):ArtilleryAssessment|null {
  if(action.type!=='AttackHex'&&action.type!=='Attack')return null;
  const gun=observation.units.find(u=>u.id===action.attackerId);if(gun?.type!=='fieldArtillery'||gun.mode!=='deployed')return null;
  const aim=action.type==='AttackHex'?action.position:observation.zombies.find(z=>z.id===action.targetId)?.position;
  const preview=gun.artillery?.targetPreviews.find(p=>aim&&hexKey(p.aimedHex)===hexKey(aim));
  return preview?assessArtillery(observation,gun,preview):{allowed:false,emergency:false,reason:'preview_unavailable',defenseSuccessBefore:null,defenseSuccessAfter:null,expectedDeathsBeforeLowerBound:null,expectedDeathsAfterUpperBound:null,scope:'public_next_enemy_phase_estimate'};
}
