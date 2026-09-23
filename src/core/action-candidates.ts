import { validateAction } from './engine';
import { HUMAN_UNIT_TYPES } from './unit-catalog';
import { hexDistance, hexKey } from './hex';
import { occupiesGroundLayer, deployedArtillery, canReact, canTargetUnit } from './unit-capabilities';
import { effectiveMovementCost } from './terrain';
import { canPlayerOccupyHex } from './map-reference';
import { getPlayerVisibleTileKeys, getVisibleEnemyUnits } from './visibility';
import { previewArtillery } from './artillery';
import { forecastUnitCombatAtDistance } from './combat-query';
import type { GameState, HumanUnitType } from './types';

export function productionCandidates(state: Readonly<GameState>, filters: {facilityId?: string; unitType?: HumanUnitType} = {}) {
  const visible=getPlayerVisibleTileKeys(state);
  const occupied=new Set(state.units.filter(u=>occupiesGroundLayer(u) && (u.isPlayerUnit || visible.has(hexKey(u.position)))).map(u=>hexKey(u.position)));
  return state.facilities.filter(f=>!filters.facilityId || f.id===filters.facilityId).sort((a,b)=>a.id.localeCompare(b.id)).flatMap(f=>
    HUMAN_UNIT_TYPES.filter(type=>filters.unitType ? type===filters.unitType : state.config.units[type].recruitmentFacilityTypes.includes(f.type as 'capital'|'city'|'armyBase'|'airBase')).map(unitType=>{
      const config=state.config.units[unitType]; const reason=validateAction(state,{type:'ProduceUnit',unitType,destination:f.position});
      const tile=f.owner==='player' ? state.map.tiles.filter(t=>visible.has(t.key) && !occupied.has(t.key) && canPlayerOccupyHex(state.map,t) && effectiveMovementCost(state,t,true)!==null).sort((a,b)=>hexDistance(f.position,a)-hexDistance(f.position,b)||a.q-b.q||a.r-b.r)[0] : undefined;
      const orders=state.pendingUnitProductions.filter(o=>o.unitType===unitType);
      const reservation=state.pendingUnitProductions.find(o=>o.cityFacilityId===f.id);
      return {facilityId:f.id,unitType,legal:!reason,reasonCode:reason?.code??null,reason:reason?.message??null,populationCost:config.population,civilianGoodsCost:config.productionCivilianGoods,militaryGoodsCost:config.productionMilitaryGoods,fuelCost:config.productionFuel,productionTurns:1,productionSlotOccupied:!!reservation,readyTurn:reservation?.readyTurn??state.turn+1,projectedPlacementHex:tile?{q:tile.q,r:tile.r}:null,placementReasonCode:f.owner!=='player'?'facility_not_owned':tile?null:'production_destination_blocked',placementIsGuaranteed:false,lifetimeProducedCount:state.completedProductions[unitType],lifetimeProductionLimit:config.productionLimitPerGame,reservedCount:orders.length,pendingPlacementCount:orders.filter(o=>o.readyTurn<=state.turn).length,remainingLifetimeSlots:config.productionLimitPerGame===null?null:Math.max(0,config.productionLimitPerGame-state.completedProductions[unitType]-orders.length)};
    }));
}
export function attackCandidates(state: Readonly<GameState>, filters: {unitId?: string; targetKind?: 'enemy'|'hex'} = {}) {
  const enemies=getVisibleEnemyUnits(state); const visible=getPlayerVisibleTileKeys(state);
  return state.units.filter(u=>u.isPlayerUnit && (!filters.unitId || filters.unitId===u.id)).sort((a,b)=>a.id.localeCompare(b.id)).flatMap(unit=>{
    const targets=[...(filters.targetKind==='hex'?[]:enemies.map(target=>({targetId:target.id,targetHex:{...target.position}}))),
      ...(deployedArtillery(unit) && filters.targetKind!=='enemy' ? state.map.tiles.filter(t=>visible.has(t.key)).map(t=>({targetId:undefined,targetHex:{q:t.q,r:t.r}})):[])];
    return targets.map(({targetId,targetHex})=>{
      const action=targetId?{type:'Attack' as const,attackerId:unit.id,targetId}:{type:'AttackHex' as const,attackerId:unit.id,position:targetHex};
      const error=validateAction(state,action); const distance=hexDistance(unit.position,targetHex); const projection=forecastUnitCombatAtDistance(state,unit,distance);
      const target=enemies.find(e=>e.id===targetId);
      const artillery=deployedArtillery(unit) && !error ? previewArtillery(state,unit,targetHex):null;
      return {unitId:unit.id,attackerId:unit.id,...(targetId?{targetId}:{targetHex}),targetKind:targetId?'enemy':'hex',distance,legal:!error,reasonCode:error?.code??null,reason:error?.message??null,projectedAttack:projection.effectiveAttack,militaryGoodsCost:projection.militaryGoodsCost,projectedMilitaryGoodsRemaining:projection.projectedMilitaryGoodsAfterAttack,attackChargesRemaining:unit.attackChargesRemaining,counterattackPossible:!error && !!target && !artillery && canReact(target) && canTargetUnit(state,target,unit) && forecastUnitCombatAtDistance(state,target,distance).canAttack,interceptionRelevant:false,friendlyFirePossible:artillery?.friendlyFirePossible??false,artillery,predictionScope:'current_visible_information',hiddenEffectsMayDiffer:true};
    });
  });
}
