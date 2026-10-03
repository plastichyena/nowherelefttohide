import type { GameAction } from '../core/types';
import { hexDistance, hexKey } from '../core/hex';
import type { AgentObservation, AgentUnitObservation } from './types';
import { publicMoveDetails } from './public-movement';

/** Public-state-only decisions, including cargo safety and an operating reserve. */
export function ifvPolicy(observation: AgentObservation) {
  const vehicles = observation.units.filter(u => u.type === 'ifv');
  const targets = observation.facilities.filter(f => f.status !== 'ruined' && (f.owner !== 'player' || (f.infectedPopulation ?? 0) > 0));
  const mission = (u: AgentUnitObservation) => [...targets].sort((a,b) => hexDistance(u.position,a.position)-hexDistance(u.position,b.position)||a.id.localeCompare(b.id))[0];
  const danger = (p: {q:number;r:number}) => observation.zombies.filter(z => hexDistance(z.position,p) <= z.effectiveRange + z.movement).reduce((n,z) => n+z.attack*z.attackChargesRemaining,0);
  const soleDefender = (u: AgentUnitObservation) => observation.facilities.some(f => f.type === 'capital' && f.owner === 'player' && hexDistance(u.position,f.position)<=1 && observation.units.filter(v => !v.transportedByUnitId && v.capabilities?.contain && hexDistance(v.position,f.position)<=1).length<=1);
  return (action: GameAction) => {
    const result = (score: number, reason: string) => ({score,reason,override:true});
    if (action.type==='ProduceUnit' && action.unitType==='ifv') return result(observation.resources.fuel>=250 && observation.resources.militaryGoods>=230 && observation.resources.food>=160 && observation.endTurnForecast.food.shortage===0 && observation.endTurnForecast.civilianGoods.maintenanceShortage===0 ? 1_200 : -10_000,'IFV_PRODUCTION_WITH_OPERATING_RESERVE');
    if (action.type==='BoardTransport') {
      const vehicle=vehicles.find(v=>v.id===action.transportId),cargo=observation.units.find(u=>u.id===action.unitId);
      if(!vehicle||!cargo)return null;
      if(soleDefender(cargo))return result(-10_000,'KEEP_CAPITAL_GARRISON');
      return result(vehicle.currentFuel===0 ? cargo.currentFuel>0?5_000:-10_000 : mission(vehicle)?2_900:-500,vehicle.currentFuel===0?'IFV_RESCUE_FUEL_TRANSFER':'IFV_BOARD_FOR_CAPTURE');
    }
    if (action.type==='DisembarkTransport') {
      const vehicle=vehicles.find(v=>v.id===action.transportId);if(!vehicle)return null;
      const target=mission(vehicle),distance=target?hexDistance(action.destination,target.position):0;
      return result(distance<=1?3_200-danger(action.destination)*30:-1_000,'IFV_DISEMBARK_AT_MISSION');
    }
    const id='unitId' in action?action.unitId:action.type==='Attack'?action.attackerId:null;
    const unit=observation.units.find(u=>u.id===id);if(!unit)return null;
    if(unit.type!=='ifv') {
      if(action.type==='Move' && unit.capabilities?.infantry && unit.currentFuel>0 && !soleDefender(unit)) {
        const stranded=vehicles.find(v=>v.currentFuel===0&&!v.cargoUnitId);
        if(stranded){const gain=hexDistance(unit.position,stranded.position)-hexDistance(action.destination,stranded.position);if(gain>0)return result(900+gain*60,'APPROACH_STRANDED_IFV');}
      }
      return null;
    }
    if(action.type==='Move') {
      const detail=publicMoveDetails(observation,unit.id,action.destination),p=detail?.preview;
      if(!p||!('overruns' in p))return result(-10_000,'IFV_PUBLIC_PREVIEW_REQUIRED');
      if(p.projectedHpAfterMove<=0 || p.cargoDeathRisk || p.arrivalReason==='overrun_insufficient_hp')return result(-10_000,'AVOID_LETHAL_OVERRUN_OR_CARGO_LOSS');
      const kills=p.overruns.filter(o=>o.wouldExecute).length,damage=unit.hp-p.projectedHpAfterMove;
      const target=mission(unit),gain=target?hexDistance(unit.position,target.position)-hexDistance(p.reached,target.position):0;
      const supplied=observation.supply.suppliedTileKeys.includes(hexKey(p.reached));
      if(p.projectedFuelAfterMove===0&&!supplied)return result(-7_000,'KEEP_IFV_MOBILE');
      const exposure=danger(p.reached);
      if(exposure>=p.projectedHpAfterMove)return result(-8_000,'AVOID_EXPOSED_IFV_DESTINATION');
      return result(kills*800+gain*90+(target&&hexDistance(p.reached,target.position)===0?1_300:0)+(supplied&&unit.currentFuel<30?600:0)-damage*18-detail!.fuelCost-exposure*8,'IFV_PUBLIC_OVERRUN_AND_CAPTURE');
    }
    if(action.type==='Attack')return result(2_300,'IFV_FIRE_AFTER_MANEUVER');
    if(action.type==='Wait')return result(unit.inSupply&&(unit.hp<unit.maxHp*.6||unit.currentFuel<20)?1_000:-100,'IFV_RECOVERY_OR_GARRISON');
    return null;
  };
}
