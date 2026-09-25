import { publicMoveDetails } from './public-movement';
import type { GameAction, HexCoord } from '../core/types';
import { hexDistance, hexKey, hexNeighbors } from '../core/hex';
import type { AgentObservation, AgentUnitObservation } from './types';

/** All mission and safety decisions are derived from the public Observation. */
export function aviationPolicy(observation: AgentObservation, actions: readonly GameAction[]) {
  const units=new Map(observation.units.map(u=>[u.id,u]));
  const supplied=new Set(observation.supply.suppliedTileKeys);
  const objectiveIds=new Set(observation.facilityObjectives?.filter(o=>o.firstCapturedTurn===null && observation.turn<=o.rewardDeadlineTurn).map(o=>o.facilityId));
  const targets=observation.facilities.filter(f=>f.owner!=='player' && f.status!=='ruined' || f.owner==='player' && f.infectedPopulation>0)
    .sort((a,b)=>Number(objectiveIds.has(b.id))-Number(objectiveIds.has(a.id)) || a.id.localeCompare(b.id));
  const mission=(unit:AgentUnitObservation)=>[...targets].sort((a,b)=>
    (hexDistance(unit.position,a.position)-(objectiveIds.has(a.id)?20:0))-(hexDistance(unit.position,b.position)-(objectiveIds.has(b.id)?20:0)) || a.id.localeCompare(b.id))[0];
  const danger=(position:HexCoord,air:boolean)=>observation.zombies.filter(z=>(!air||z.canTargetAir)&&hexDistance(z.position,position)<=z.movement+z.effectiveRange).reduce((n,z)=>n+z.attack*Math.max(1,z.attackChargesRemaining),0);
  const infantry=observation.units.filter(u=>u.capabilities?.infantry && !u.transportedByUnitId && u.actionState!=='acted');
  const soleDefender=(u:AgentUnitObservation)=>observation.facilities.some(f=>f.owner==='player' && f.type==='capital' && hexDistance(f.position,u.position)<=1 && (f.infectedPopulation>0||danger(f.position,false)>0) && observation.units.filter(v=>!v.transportedByUnitId&&v.capabilities?.contain&&hexDistance(v.position,f.position)<=1).length<=1);
  const droneTargets=[...targets.map(f=>f.position),...observation.map.tiles.filter(t=>t.hordeEntranceDirections.some(d=>observation.horde.warningDirections.includes(d)))];
  const droneValue=new Map<string,number>();
  for(const p of droneTargets)droneValue.set(hexKey(p),observation.map.tiles.filter(t=>!t.visibleToPlayer&&hexDistance(t,p)<=10).length);
  const supplyDistances=new Map<string,Map<string,number>>();
  const distancesToSafeSupply=(aircraft:AgentUnitObservation)=>{
    const cached=supplyDistances.get(aircraft.id);if(cached)return cached;
    const occupied=new Set([...observation.units.filter(u=>u.id!==aircraft.id&&!u.transportedByUnitId&&u.flightState!=='airborne'),...observation.zombies].map(u=>hexKey(u.position)));
    const distances=new Map<string,number>(),queue:HexCoord[]=[];
    const mapKeys=new Set(observation.map.tiles.map(hexKey));
    for(const tile of observation.map.tiles)if(tile.visibleToPlayer&&supplied.has(hexKey(tile))&&!occupied.has(hexKey(tile))&&tile.playerOccupancyAllowed&&tile.effectiveMovementCost!==null){queue.push(tile);distances.set(hexKey(tile),0);}
    for(let i=0;i<queue.length;i++){const p=queue[i]!,next=distances.get(hexKey(p))!+1;for(const neighbor of hexNeighbors(p)){const key=hexKey(neighbor);if(mapKeys.has(key)&&!distances.has(key)){distances.set(key,next);queue.push(neighbor);}}}
    supplyDistances.set(aircraft.id,distances);return distances;
  };
  return (action:GameAction): {score:number;reason:string;override:boolean}|null => {
    const result=(score:number,reason:string,override=true)=>({score,reason,override});
    if(action.type==='LaunchMilitaryDrone') {
      const base=observation.facilities.find(f=>f.id===action.facilityId)!;
      const cost=hexDistance(base.position,action.target)*5;
      const reveal=droneValue.get(hexKey(action.target))??0;
      return result(reveal>=20&&observation.resources.fuel-cost>=50?900+reveal-cost:-10_000,'DRONE_RECONNAISSANCE_WITH_FUEL_RESERVE');
    }
    if(action.type==='ProduceUnit'&&action.unitType==='multipurposeHelicopter') {
      const affordable=observation.resources.fuel>=700 && observation.endTurnForecast.food.shortage===0 && observation.endTurnForecast.civilianGoods.maintenanceShortage===0;
      return result(affordable?1_100:-10_000,'RECRUIT_HELICOPTER_WITH_OPERATING_RESERVE');
    }
    if(action.type==='BoardAircraft') {
      const aircraft=units.get(action.aircraftId),cargo=units.get(action.unitId);
      if(!aircraft||!cargo)return result(-10_000,'TRANSPORT_UNAVAILABLE');
      if(soleDefender(cargo))return result(-10_000,'RETAIN_CAPITAL_DEFENDER');
      if(aircraft.currentFuel===0)return result(cargo.currentFuel>5?5_000:-10_000,'RESCUE_STRANDED_AIRCRAFT_WITH_INFANTRY_FUEL');
      return result(mission(aircraft)?4_200:-500,'BOARD_INFANTRY_FOR_FACILITY_MISSION');
    }
    if(action.type==='DisembarkAircraft') {
      const aircraft=units.get(action.aircraftId)!;const target=mission(aircraft);
      const distance=target?hexDistance(action.destination,target.position):0;
      return result(2_600-distance*120-danger(action.destination,false)*25,'DISEMBARK_AT_PUBLIC_MISSION');
    }
    const id='unitId' in action?action.unitId:action.type==='Attack'?action.attackerId:null;
    const unit=id?units.get(id):undefined;
    if(!unit)return null;
    if(unit.type!=='multipurposeHelicopter') {
      if(action.type==='Move'&&unit.capabilities?.capture&&!soleDefender(unit)) {
        const objective=targets.filter(f=>objectiveIds.has(f.id)).sort((a,b)=>hexDistance(unit.position,a.position)-hexDistance(unit.position,b.position))[0];
        if(objective){const gain=hexDistance(unit.position,objective.position)-hexDistance(action.destination,objective.position);if(gain>0)return result(250+gain*45,'CAPTURE_DEADLINE_FACILITY',false);}
        const stranded=observation.units.find(u=>u.type==='multipurposeHelicopter'&&u.flightState==='landed'&&u.currentFuel===0&&!u.cargoUnitId);
        if(stranded&&unit.capabilities?.infantry&&unit.currentFuel>10){const gain=hexDistance(unit.position,stranded.position)-hexDistance(action.destination,stranded.position);if(gain>0)return result(700+gain*60,'INFANTRY_FUEL_RESCUE_APPROACH',false);}
      }
      return null;
    }
    const target=mission(unit);
    const cargo=unit.cargoUnitId?units.get(unit.cargoUnitId):undefined;
    const recoveryNeeded=unit.currentFuel<60||unit.currentMilitaryGoods<4||unit.hp<unit.maxHp*.5;
    // An aircraft cannot contain infection or capture a site. Ground-garrison
    // Wait bonuses must not override its available airborne attack/transport.
    if(action.type==='Wait')return result(unit.flightState==='landed'&&recoveryNeeded&&unit.inSupply?900:-200,'HOLD_AIRCRAFT_ONLY_FOR_SUPPLY');
    const safeGround=(p:HexCoord)=>!observation.units.some(u=>u.id!==unit.id&&!u.transportedByUnitId&&u.flightState!=='airborne'&&hexDistance(u.position,p)===0)&&!observation.zombies.some(z=>hexDistance(z.position,p)===0);
    if(action.type==='TakeOff')return result(recoveryNeeded&&unit.inSupply?-800:(cargo||observation.zombies.length||target?1_250:-500),'TAKE_OFF_FOR_TRANSPORT_OR_COMBAT');
    if(action.type==='Land')return result(danger(unit.position,false)>unit.hp*.6?-5_000:recoveryNeeded&&supplied.has(hexKey(unit.position))?4_000:cargo&&target&&hexDistance(unit.position,target.position)<=1?3_000:!cargo&&infantry.some(u=>hexDistance(u.position,unit.position)===1)?1_600:!target&&!observation.zombies.length?500:-400,'LAND_FOR_DELIVERY_OR_SUPPLY');
    if(action.type==='Attack') {
      const enemy=observation.zombies.find(z=>z.id===action.targetId)!;
      const risk=danger(unit.position,true);
      return result(2_200+(enemy.canTargetAir?500:200)+(enemy.hp<=unit.attack?200:0)-risk*10,'AIRBORNE_FIRE_WITH_ANTI_AIR_RISK');
    }
    if(action.type==='Move') {
      const move=publicMoveDetails(observation, unit.id, action.destination);
      if(!move||move.projectedFuelAfterMove<=1)return result(-10_000,'AVOID_FUEL_EXHAUSTION');
      const risk=danger(action.destination,true);if(risk>=unit.hp)return result(-8_000,'AVOID_LETHAL_ANTI_AIR');
      const supplyDistance=distancesToSafeSupply(unit).get(hexKey(action.destination))??Infinity;
      if(move.projectedFuelAfterMove<supplyDistance*5+6)return result(-7_000,'KEEP_RETURN_FUEL');
      if(recoveryNeeded){const currentDistance=distancesToSafeSupply(unit).get(hexKey(unit.position))??Infinity;return result((currentDistance-supplyDistance)*80+(supplyDistance===0?2_500:0)-move.fuelCost-risk*20,'RETURN_TO_SUPPLY');}
      if(cargo&&target){const gain=hexDistance(unit.position,target.position)-hexDistance(action.destination,target.position);const distance=hexDistance(action.destination,target.position);return result(gain>0?1_500+gain*30+(distance<=1&&safeGround(action.destination)?400:0)-move.fuelCost-risk*25:-600,'AIR_TRANSPORT_TO_PUBLIC_FACILITY');}
      const pickup=infantry.filter(u=>!soleDefender(u)).sort((a,b)=>hexDistance(unit.position,a.position)-hexDistance(unit.position,b.position))[0];
      if(target&&pickup){const before=hexDistance(unit.position,pickup.position),after=hexDistance(action.destination,pickup.position);return result(after===1?1_700:before>after?800+(before-after)*25-move.fuelCost-risk*20:-500,'FLY_TO_INFANTRY_PICKUP');}
      const enemy=[...observation.zombies].sort((a,b)=>hexDistance(unit.position,a.position)-hexDistance(unit.position,b.position))[0];
      if(enemy){const before=hexDistance(unit.position,enemy.position),after=hexDistance(action.destination,enemy.position);return result(before>2&&after<=2?1_400-move.fuelCost-risk*25:before>after?500+(before-after)*20-move.fuelCost-risk*25:-500,'FLY_TO_SAFE_FIRING_RANGE');}
      return result(-500,'PRESERVE_AIRCRAFT_FUEL');
    }
    return null;
  };
}
