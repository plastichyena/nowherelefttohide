import { hexDistance, hexKey, hexNeighbors, hexWithinBounds } from './hex';
import { terrainAdjustedDamage } from './terrain';
import { getPlayerVisibleTileKeys } from './visibility';
import { deployedArtillery } from './unit-capabilities';
import { emit } from './events-internal';
import type { SeededRng } from './rng';
import type { CheckpointState, FacilityState, GameState, HexCoord, UnitState } from './types';

export interface ArtilleryImpact { position: HexCoord; probability: number }
export interface ArtilleryPopulationRisk {
  siteId: string; kind: 'facility' | 'checkpoint'; position: HexCoord;
  healthyPopulation: number | null; infectedPopulation: number | null;
  populationKnown: boolean; healthyPeoplePossible: boolean; playerOwned: boolean;
  terrainDamageMultiplier: number; maxDirectDeaths: number; expectedDirectDeaths: number | null; capital: boolean;
}
export interface ArtilleryPreview {
  aimedHex: HexCoord; hitProbability: number; militaryGoodsCost: number;
  possibleImpactHexes: ArtilleryImpact[]; possibleBlastHexes: HexCoord[];
  friendlyFirePossible: boolean; friendlyUnitIdsAtRisk: string[];
  populationRisks: ArtilleryPopulationRisk[];
  immediateDefeatPossible: boolean;
  unitRisks: Array<{ unitId: string; position: HexCoord; player: boolean; hp: number; population: number; terrainDamageMultiplier: number; maxDamage: number; expectedDamage: number; lethalProbability: number }>;
  knownGasChainHexes: HexCoord[];
  scope: 'public_information'; limitations: string[];
}

/** Stable, bounded-map distribution. Scatter is uniform over Hexes, never rings. */
export function artilleryImpacts(state: Pick<GameState, 'map' | 'config'>, unit: Pick<UnitState, 'proficiency'>, aim: HexCoord): ArtilleryImpact[] {
  const rule = state.config.units.fieldArtillery.scatter[unit.proficiency ?? 'recruit'];
  if (rule.hitProbability === 1) return [{ position: { ...aim }, probability: 1 }];
  const scatter = state.map.tiles.filter(p => { const d = hexDistance(p, aim); return d > 0 && d <= rule.radius; })
    .sort((a,b) => a.q - b.q || a.r - b.r);
  if (!scatter.length) return [{ position: { ...aim }, probability: 1 }];
  return [{ position: { ...aim }, probability: rule.hitProbability }, ...scatter.map(p => ({ position: { q: p.q, r: p.r }, probability: (1 - rule.hitProbability) / scatter.length }))];
}

export function artilleryBaseDamage(unit: Pick<UnitState, 'attack'>, impact: HexCoord, at: HexCoord): number {
  const distance = hexDistance(impact, at);
  return distance === 0 ? unit.attack : distance === 1 ? unit.attack / 2 : 0;
}

export function artilleryAttackReason(state: Readonly<GameState>, unit: UnitState | undefined, aim: HexCoord): string | null {
  if (state.gameOver || state.phase !== 'player') return 'wrong_phase';
  if (!unit || !unit.isPlayerUnit || !deployedArtillery(unit)) return 'deployed_artillery_required';
  if (!unit.canAttack || unit.attackChargesRemaining < 1 || (unit.actionState === 'acted' && !unit.activity.attacked) || unit.modeChangedTurn === state.turn) return 'unit_cannot_attack';
  if (!hexWithinBounds(aim, state.map.width, state.map.height)) return 'outside_map';
  if (!getPlayerVisibleTileKeys(state).has(hexKey(aim))) return 'target_not_visible';
  const config = state.config.units.fieldArtillery.deployed, distance = hexDistance(unit.position, aim);
  if (distance < config.minRange || distance > config.range) return 'out_of_range';
  if (unit.currentMilitaryGoods < config.militaryGoodsCost) return 'insufficient_military_goods';
  return null;
}

export function previewArtillery(state: Readonly<GameState>, unit: UnitState, aim: HexCoord): ArtilleryPreview {
  const impacts = artilleryImpacts(state, unit, aim), visible = getPlayerVisibleTileKeys(state);
  const publicUnits = state.units.filter(u => u.isPlayerUnit || visible.has(hexKey(u.position)));
  const blast = new Map<string, HexCoord>();
  for (const impact of impacts) for (const p of [impact.position, ...hexNeighbors(impact.position)]) if (hexWithinBounds(p,state.map.width,state.map.height)) blast.set(hexKey(p),p);
  // Conservatively close over all public Gas that could die to direct damage or a preceding Gas.
  const gas = publicUnits.filter(u => u.type === 'gasZombie');
  const chain = new Map<string, HexCoord>(), queued = new Set<string>();
  for (const u of gas) if (impacts.some(i => terrainAdjustedDamage(state,u,artilleryBaseDamage(unit,i.position,u.position)).finalDamage >= u.hp)) queued.add(u.id);
  for (;;) {
    const next = gas.find(u => queued.has(u.id) && !chain.has(u.id));
    if (!next) break;
    chain.set(next.id,next.position);
    for (const u of gas) if (hexDistance(next.position,u.position) === 1) {
      const possible = impacts.some(i => {
        const direct = terrainAdjustedDamage(state,u,artilleryBaseDamage(unit,i.position,u.position)).finalDamage;
        const chainDamage = [...chain.values()].filter(p => hexDistance(p,u.position) === 1).length * terrainAdjustedDamage(state,u,state.config.units.gasZombie.explosionZombieDamage).finalDamage;
        return direct + chainDamage >= u.hp;
      });
      if (possible) queued.add(u.id);
    }
  }
  const chainHexes = new Map<string,HexCoord>();
  for (const p of chain.values()) for (const n of hexNeighbors(p)) if(hexWithinBounds(n,state.map.width,state.map.height)) chainHexes.set(hexKey(n),n);
  const unitRisks = publicUnits.flatMap(u => {
    const damages = impacts.map(i => ({ probability:i.probability, damage: Math.min(u.hp,terrainAdjustedDamage(state,u,(u.isPlayerUnit&&!state.config.units.fieldArtillery.friendlyFire?0:artilleryBaseDamage(unit,i.position,u.position))).finalDamage) }));
    const directMax = Math.max(...damages.map(d => d.damage));
    const gasDamage = [...chain.values()].filter(p => hexDistance(p,u.position) === 1).length * terrainAdjustedDamage(state,u,u.isPlayerUnit ? state.config.units.gasZombie.explosionDamage : state.config.units.gasZombie.explosionZombieDamage).finalDamage;
    if (!directMax && !gasDamage) return [];
    return [{unitId:u.id, position:{...u.position}, player:u.isPlayerUnit,hp:u.hp,population:u.population,terrainDamageMultiplier:terrainAdjustedDamage(state,u,1).defense.multiplier,maxDamage:Math.min(u.hp,directMax+gasDamage),expectedDamage:damages.reduce((n,d)=>n+d.damage*d.probability,0),lethalProbability:damages.filter(d=>d.damage>=u.hp).reduce((n,d)=>n+d.probability,0)}];
  });
  const populationRisks: ArtilleryPopulationRisk[] = [];
  for (const site of [...state.facilities,...state.checkpoints]) {
    if (!blast.has(hexKey(site.position)) && !chainHexes.has(hexKey(site.position))) continue;
    const facility = 'workers' in site, playerOwned = facility ? site.owner === 'player' : true;
    // Unowned internal populations are not public, even on a visible Hex.
    const known = playerOwned;
    const healthy = known ? facility ? site.workers : site.waiting+site.screening+site.approved : null;
    const infected = known ? site.infected : null;
    const damages = impacts.map(i => ({ probability:i.probability, damage:state.config.units.fieldArtillery.facilityPopulationDamage?terrainAdjustedDamage(state,{type:'police',isPlayerUnit:true,position:site.position},artilleryBaseDamage(unit,i.position,site.position)).finalDamage:0 }));
    const max = Math.max(...damages.map(d=>d.damage));
    if(!max&&!chainHexes.has(hexKey(site.position)))continue;
    populationRisks.push({siteId:site.id,kind:facility?'facility':'checkpoint',position:{...site.position},healthyPopulation:healthy,infectedPopulation:infected,terrainDamageMultiplier:terrainAdjustedDamage(state,{type:'police',isPlayerUnit:true,position:site.position},1).defense.multiplier,populationKnown:known,healthyPeoplePossible:healthy === null || healthy > 0,playerOwned,maxDirectDeaths:healthy === null ? max : Math.min(max,healthy+infected!),expectedDirectDeaths:healthy === null ? null : damages.reduce((n,d)=>n+Math.min(d.damage,healthy+infected!)*d.probability,0),capital:facility&&site.type==='capital'});
  }
  const friends = unitRisks.filter(u=>u.player).map(u=>u.unitId);
  const immediateDefeatPossible = populationRisks.some(p => p.capital && (p.healthyPopulation === null || p.healthyPopulation <= p.maxDirectDeaths + (chainHexes.has(hexKey(p.position)) ? state.config.units.gasZombie.explosionInfection * chain.size : 0)))
    || populationRisks.filter(p=>p.playerOwned&&p.kind==='facility').reduce((n,p)=>n+Math.min(p.healthyPopulation??0,p.maxDirectDeaths+(chainHexes.has(hexKey(p.position))?state.config.units.gasZombie.explosionInfection*chain.size:0)),0) >= state.population.healthyCivilians;
  return { aimedHex:{...aim},hitProbability:state.config.units.fieldArtillery.scatter[unit.proficiency??'recruit'].hitProbability,militaryGoodsCost:state.config.units.fieldArtillery.deployed.militaryGoodsCost,possibleImpactHexes:impacts,possibleBlastHexes:[...blast.values()],friendlyFirePossible:friends.length>0||populationRisks.some(p=>p.healthyPeoplePossible),friendlyUnitIdsAtRisk:friends,populationRisks,immediateDefeatPossible,unitRisks,knownGasChainHexes:[...chainHexes.values()],scope:'public_information',limitations:['hidden_entities_not_predicted','expected_damage_is_direct_only','gas_chain_risk_is_conservative','reanimation_and_site_spawn_consequences_not_predicted'] };
}

/** Sample people without replacement, retaining the waiting/grace cohort ledgers. */
export function damageArtilleryPopulation(state: GameState, site: FacilityState | CheckpointState, damage: number, rng: SeededRng, sourceId: string): void {
  const facility = 'workers' in site;
  const removed: Record<string,number> = {};
  for (let i=0;i<damage;i++) {
    const pools = facility ? [{key:'workers',count:site.workers}] : [
      {key:'waiting',count:site.waiting-(site.grandfatheredWaiting??0)},
      {key:'grandfatheredWaiting',count:site.grandfatheredWaiting??0},
      {key:'screening',count:site.screening},{key:'approved',count:site.approved}];
    const grace = site.infectionGrace??[];
    pools.push({key:'infected',count:site.infected-grace.reduce((n,g)=>n+g.count,0)},...grace.map((g,index)=>({key:`grace:${index}`,count:g.count})));
    const total = pools.reduce((n,p)=>n+p.count,0); if(total<=0)break;
    let draw=rng.nextInt(1,total); const selected=pools.find(p=>(draw-=p.count)<=0)!;
    const infected=selected.key==='infected'||selected.key.startsWith('grace:');
    if (infected) { site.infected--; if(selected.key.startsWith('grace:')) grace[Number(selected.key.slice(6))]!.count--; }
    else if(facility)site.workers--;
    else if(selected.key==='grandfatheredWaiting'){site.waiting--;site.grandfatheredWaiting!--;}
    else site[selected.key as 'waiting'|'screening'|'approved']--;
    removed[selected.key]=(removed[selected.key]??0)+1;
    state.population.cumulativeDeaths++;
    if(!infected)state.statistics.civilianLosses++;
  }
  if(site.infectionGrace)site.infectionGrace=site.infectionGrace.filter(g=>g.count>0);
  if(!facility){ if(!site.grandfatheredWaiting)site.grandfatheredPolicy=null; if(!site.screening)site.remainingTurns=0; }
  else if(site.armyBase)site.armyBase.interceptionsRemaining=Math.min(site.armyBase.interceptionsRemaining,site.workers);
  emit(state,'artillery_population_damage',{sourceId,siteId:site.id,siteKind:facility?'facility':'checkpoint',q:site.position.q,r:site.position.r,removed});
}
