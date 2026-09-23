import type { GameState } from './types';
import { isAirborne, isInfantry } from './unit-capabilities';
import { hexKey, hexWithinBounds } from './hex';
import { getTile } from './map-reference';
import { hasMovementRoad } from './terrain';
import { isHumanUnitType, isZombieUnitType } from './unit-catalog';

export function validateAviationState(state: GameState): string[] {
  const errors:string[]=[];
  const turn=(v:unknown)=>Number.isInteger(v) && (v as number)>=1 && (v as number)<=state.turn;
  const objective=state.airBaseObjective; const rule=state.config.objectives.airBase;
  if(!objective || typeof objective.fellBeforeCapture!=='boolean' || !['unclaimed','pending','claimed','expired'].includes(objective.reward) || !['none','pending','spawned'].includes(objective.failureSpawn) || (objective.firstCapturedTurn!==null && !turn(objective.firstCapturedTurn))) errors.push('Invalid Air Base objective');
  else {
    if(['pending','claimed'].includes(objective.reward) && (objective.firstCapturedTurn===null || objective.firstCapturedTurn>rule.rewardDeadlineTurn || objective.fellBeforeCapture)) errors.push('Invalid Air Base reward entitlement');
    if(objective.failureSpawn!=='none' && !objective.fellBeforeCapture && (objective.firstCapturedTurn!==null && objective.firstCapturedTurn<=rule.rewardDeadlineTurn || state.turn<=rule.rewardDeadlineTurn)) errors.push('Invalid Air Base failure entitlement');
    if(objective.firstCapturedTurn!==null && objective.reward==='unclaimed') errors.push('Captured Air Base must settle reward entitlement');
  }
  for(const unit of state.units) {
    if(unit.type==='multipurposeHelicopter') {
      const config=state.config.units.multipurposeHelicopter;
      if(!['landed','airborne'].includes(unit.flightState??'') || unit.movement!==(isAirborne(unit)?config.airborneMovement:0) || unit.range!==config.range || unit.vision!==config.vision || unit.population!==config.population || unit.maxFuel!==config.maxFuel || unit.maxHp!==config.hp) errors.push(`Invalid helicopter state/stats: ${unit.id}`);
      if(isAirborne(unit) && unit.currentFuel<=0) errors.push('Airborne aircraft must have fuel after action resolution');
      if(!isAirborne(unit) && unit.canMove) errors.push('Landed aircraft cannot move');
      if(unit.transportedByUnitId) errors.push('Aircraft cannot be cargo');
      if(unit.cargoUnitId && !state.units.some(c=>c.id===unit.cargoUnitId && c.transportedByUnitId===unit.id && c.isPlayerUnit && isInfantry(state,c) && hexKey(c.position)===hexKey(unit.position))) errors.push('Invalid aircraft cargo reference');
      if(!isAirborne(unit)) { const tile=getTile(state.map,unit.position); if(tile?.terrain==='water' && !hasMovementRoad(state.map,unit.position)) errors.push('Aircraft cannot land on water'); }
    } else if(unit.flightState!==undefined || unit.tookOffTurn!==undefined || unit.landedTurn!==undefined || unit.cargoUnitId!==undefined) errors.push('Flight state only applies to aircraft');
    for(const key of ['tookOffTurn','landedTurn','boardedTurn','disembarkedTurn'] as const) if(unit[key]!==undefined && !turn(unit[key])) errors.push(`Invalid flight/transport turn: ${unit.id}:${key}`);
    if(unit.transportedByUnitId) {
      const carrier=state.units.find(u=>u.id===unit.transportedByUnitId);
      if(!isInfantry(state,unit) || !unit.isPlayerUnit || !carrier || carrier.cargoUnitId!==unit.id || carrier.type!=='multipurposeHelicopter' || !turn(unit.boardedTurn) || unit.canMove || unit.canAttack || unit.actionState!=='acted' || hexKey(carrier.position)!==hexKey(unit.position)) errors.push(`Invalid transported unit: ${unit.id}`);
    }
    if(unit.disembarkedTurn===state.turn && (unit.canMove || unit.actionState!=='acted')) errors.push('Disembarked infantry must remain committed');
    if(unit.landedTurn===state.turn && isAirborne(unit)) errors.push('Same-turn relaunch is forbidden');
  }
  const drone=state.militaryDrone;
  if(drone!==null && (!drone || !state.facilities.some(f=>f.id===drone.sourceFacilityId && f.type==='airBase') || !drone.center || !Number.isInteger(drone.center.q) || !Number.isInteger(drone.center.r) || !hexWithinBounds(drone.center,state.map.width,state.map.height) || drone.radius!==state.config.militaryDrone.visionRadius || !turn(drone.startedTurn) || drone.expiresBeforeTurn!==drone.startedTurn+state.config.militaryDrone.durationTurns || drone.expiresBeforeTurn<=state.turn)) errors.push('Invalid Military Drone vision');
  const pendingIds=new Set<string>();
  for(const entry of state.pendingReanimations) {
    if(!entry || typeof entry.humanUnitId!=='string' || !isHumanUnitType(entry.humanUnitType) || !isZombieUnitType(entry.zombieUnitType) || state.config.units[entry.humanUnitType]?.reanimationUnitType!==entry.zombieUnitType || !entry.position || !Number.isInteger(entry.position.q) || !Number.isInteger(entry.position.r) || !hexWithinBounds(entry.position,state.map.width,state.map.height) || typeof entry.cause!=='string' || pendingIds.has(entry.humanUnitId) || state.units.some(u=>u.id===entry.humanUnitId)) errors.push('Invalid pending reanimation');
    if(entry) pendingIds.add(entry.humanUnitId);
  }
  const expected=state.units.filter(u=>u.type==='multipurposeHelicopter').reduce((n,u)=>n+u.population,0)+state.pendingUnitProductions.filter(o=>o.unitType==='multipurposeHelicopter').reduce((n,o)=>n+o.population,0);
  if(state.population.multipurposeHelicopter!==expected) errors.push('Helicopter population mismatch');
  return errors;
}
