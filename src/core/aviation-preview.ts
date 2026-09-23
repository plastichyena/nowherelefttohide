import { aviationReason, emergencyLandingPreview, isAviationAction, unitCanReceiveSupply } from './aircraft';
import { hexDistance, hexNeighbors } from './hex';
import { isAirborne } from './unit-capabilities';
import { isHexSupplied } from './supply';
import type { GameAction, GameState, UnitState } from './types';

export function aviationUnitProjection(state: Readonly<GameState>, unit: UnitState) {
  const takeoff=aviationReason(state,{type:'TakeOff',unitId:unit.id});
  const land=aviationReason(state,{type:'Land',unitId:unit.id});
  const boardingCandidates=state.units.filter(u=>u.isPlayerUnit && u.id!==unit.id && hexDistance(unit.position,u.position)===1).map(u=>({unitId:u.id,reasonCode:aviationReason(state,{type:'BoardAircraft',unitId:u.id,aircraftId:unit.id})}));
  const disembarkCandidates=hexNeighbors(unit.position).map(destination=>({destination,reasonCode:aviationReason(state,{type:'DisembarkAircraft',aircraftId:unit.id,destination})}));
  const supply=unitCanReceiveSupply(unit) && isHexSupplied(state,unit.position);
  return {flightState:unit.flightState!,cargoUnitId:unit.cargoUnitId??null,cargoUnitType:state.units.find(u=>u.id===unit.cargoUnitId)?.type as import('./types').HumanUnitType ?? null,
    tookOffTurn:unit.tookOffTurn??null,landedTurn:unit.landedTurn??null,canTakeOff:!takeoff,takeOffReasonCode:takeoff,canLand:!land,landReasonCode:land,
    canBoard:boardingCandidates.some(c=>!c.reasonCode),boardingCandidates,canDisembark:disembarkCandidates.some(c=>!c.reasonCode),disembarkCandidates,
    canRefuel:supply,canResupplyMilitaryGoods:supply,supplyReasonCode:supply?null:isAirborne(unit)?'aircraft_airborne':'out_of_supply'};
}
export function militaryDroneProjection(state: Readonly<GameState>) {
  const drone=state.militaryDrone; const base=state.facilities.find(f=>f.type==='airBase');
  const reason=base?aviationReason(state,{type:'LaunchMilitaryDrone',facilityId:base.id,target:base.position}):'invalid_air_base';
  return {active:!!drone && state.turn<drone.expiresBeforeTurn,sourceFacilityId:drone?.sourceFacilityId??null,center:drone?{...drone.center}:null,radius:drone?.radius??state.config.militaryDrone.visionRadius,startedTurn:drone?.startedTurn??null,expiresBeforeTurn:drone?.expiresBeforeTurn??null,relaunchAvailable:!reason,relaunchReasonCode:reason};
}
export function aviationPreview(state: Readonly<GameState>,action: GameAction) {
  if(action.type==='EndTurn') return {aircraft:state.units.filter(isAirborne).map(unit=>({unitId:unit.id,fuelCost:Math.min(unit.currentFuel,state.config.units.multipurposeHelicopter.endTurnFuel),noiseRadius:state.config.units.multipurposeHelicopter.endTurnNoiseRadius,emergencyLandingRisk:unit.currentFuel<=state.config.units.multipurposeHelicopter.endTurnFuel,landing:emergencyLandingPreview(state,unit,unit.position)})),cargoUpkeepContinues:true,droneExpiresNextTurn:!!state.militaryDrone && state.militaryDrone.expiresBeforeTurn===state.turn+1};
  if(!isAviationAction(action)) return undefined;
  const reasonCode=aviationReason(state,action); const common={legal:!reasonCode,reasonCode};
  if(action.type==='LaunchMilitaryDrone') {
    const base=state.facilities.find(f=>f.id===action.facilityId && f.type==='airBase');
    const distance=base?hexDistance(base.position,action.target):0; const fuelCost=distance*state.config.militaryDrone.fuelPerHex;
    return {...common,target:{...action.target},distance,fuelCost,currentFuel:state.resources.fuel,resultingFuel:reasonCode?state.resources.fuel:state.resources.fuel-fuelCost,visionRadius:state.config.militaryDrone.visionRadius,activeThroughTurn:state.turn+state.config.militaryDrone.durationTurns-1};
  }
  const aircraft=state.units.find(u=>u.id===('aircraftId' in action?action.aircraftId:action.unitId));
  if(!aircraft?.isPlayerUnit) return common;
  if(action.type==='BoardAircraft') {
    const cargo=state.units.find(u=>u.id===action.unitId && u.isPlayerUnit);
    const transfer=!reasonCode && cargo && aircraft.currentFuel===0?Math.min(cargo.currentFuel,aircraft.maxFuel):0;
    return {...common,aircraftId:aircraft.id,cargoUnitId:cargo?.id??null,transferredFuel:transfer,aircraftFuelBefore:aircraft.currentFuel,aircraftFuelAfter:aircraft.currentFuel+transfer,infantryFuelBefore:cargo?.currentFuel??null,infantryFuelAfter:cargo?cargo.currentFuel-transfer:null,consumesInfantryAction:true,sameTurnDisembarkAllowed:false};
  }
  if(action.type==='DisembarkAircraft') return {...common,aircraftId:aircraft.id,cargoUnitId:aircraft.cargoUnitId??null,destination:{...action.destination},voluntaryActionsAllowed:false,enemyPhaseReactionsAllowed:true,attackChargesGranted:0};
  return {...common,resultingFlightState:reasonCode?aircraft.flightState:action.type==='TakeOff'?'airborne':'landed',resultingMovement:reasonCode?aircraft.movement:action.type==='TakeOff'?state.config.units.multipurposeHelicopter.airborneMovement:0,currentFuel:aircraft.currentFuel,additionalFuelCost:0,sameTurnReverseTransitionAllowed:false,canReceiveSupply:!reasonCode && action.type==='Land' && isHexSupplied(state,aircraft.position),immediateRefill:false};
}
