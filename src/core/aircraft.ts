import type { GameAction, GameState, HexCoord, UnitState } from './types';
import { hexDistance, hexKey, hexNeighbors, hexWithinBounds } from './hex';
import { canPlayerOccupyHex } from './map-reference';
import { effectiveMovementCost } from './terrain';
import { isAirborne, isInfantry, occupiesGroundLayer } from './unit-capabilities';
import { isHexSupplied } from './supply';
import { calculateEconomyPlan } from './economy-query';
import { getPlayerVisibleTileKeys } from './visibility';
import { emit } from './events-internal';
import type { SeededRng } from './rng';

export type AviationAction = Extract<GameAction, { type: 'TakeOff' | 'Land' | 'BoardAircraft' | 'DisembarkAircraft' | 'LaunchMilitaryDrone' }>;
export function isAviationAction(action: GameAction): action is AviationAction {
  return ['TakeOff', 'Land', 'BoardAircraft', 'DisembarkAircraft', 'LaunchMilitaryDrone'].includes(action.type);
}
export function canOccupyAirHex(state: Readonly<GameState>, position: HexCoord, exceptId?: string): boolean {
  return hexWithinBounds(position, state.map.width, state.map.height) && !state.units.some(u => u.id !== exceptId && isAirborne(u) && hexKey(u.position) === hexKey(position));
}
export function groundPlacementReason(state: Readonly<GameState>, position: HexCoord, exceptId?: string, publicOnly = false): string | null {
  if (!hexWithinBounds(position, state.map.width, state.map.height)) return 'out_of_bounds';
  if (!canPlayerOccupyHex(state.map, position)) return 'player_occupancy_forbidden';
  if (effectiveMovementCost(state, position, true) === null) return 'impassable';
  const visible = publicOnly ? getPlayerVisibleTileKeys(state) : null;
  const occupant = state.units.find(u => u.id !== exceptId && occupiesGroundLayer(u) && hexKey(u.position) === hexKey(position) && (!visible || u.isPlayerUnit || visible.has(hexKey(u.position))));
  return occupant ? occupant.isPlayerUnit ? 'occupied' : 'enemy_occupied' : null;
}
export function canOccupyGroundHex(state: Readonly<GameState>, position: HexCoord, exceptId?: string): boolean { return groundPlacementReason(state, position, exceptId) === null; }
export function unitCanReceiveSupply(unit: Pick<UnitState, 'flightState' | 'transportedByUnitId'>): boolean { return !isAirborne(unit) && !unit.transportedByUnitId; }
export function aviationReason(state: Readonly<GameState>, action: AviationAction): string | null {
  if (state.gameOver) return 'game_over';
  if (state.phase !== 'player') return 'wrong_phase';
  if (state.actionsTakenThisTurn >= state.config.maxActionsPerTurn) return 'action_limit';
  if (action.type === 'LaunchMilitaryDrone') {
    const base = state.facilities.find(f => f.id === action.facilityId);
    if (!base || base.type !== 'airBase') return 'invalid_air_base';
    if (base.owner !== 'player') return 'facility_not_owned';
    if (base.status !== 'owned' || base.operationalStatus !== 'operational' || base.infected > 0) return 'facility_not_operational';
    if (!isHexSupplied(state, base.position)) return 'facility_out_of_supply';
    if (!calculateEconomyPlan(state).facilities.find(f => f.facilityId === base.id)?.projectedPowerSupplied) return 'facility_not_powered';
    if (state.militaryDrone && state.turn < state.militaryDrone.expiresBeforeTurn) return 'military_drone_active';
    if (!hexWithinBounds(action.target, state.map.width, state.map.height)) return 'target_out_of_bounds';
    if (state.resources.fuel < hexDistance(base.position, action.target) * state.config.militaryDrone.fuelPerHex) return 'insufficient_fuel';
    return null;
  }
  const aircraftId = 'aircraftId' in action ? action.aircraftId : action.unitId;
  const aircraft = state.units.find(u => u.id === aircraftId && u.isPlayerUnit && u.type === 'multipurposeHelicopter');
  if (!aircraft) return 'unknown_aircraft';
  if (action.type === 'TakeOff') {
    if (isAirborne(aircraft)) return 'aircraft_already_airborne';
    if (aircraft.landedTurn === state.turn) return 'aircraft_landed_this_turn';
    if (aircraft.actionState === 'acted') return 'unit_already_acted';
    if (aircraft.currentFuel <= 0) return 'insufficient_unit_fuel';
    return canOccupyAirHex(state, aircraft.position, aircraft.id) ? null : 'air_layer_occupied';
  }
  if (action.type === 'Land') {
    if (!isAirborne(aircraft)) return 'aircraft_not_airborne';
    if (aircraft.tookOffTurn === state.turn) return 'aircraft_took_off_this_turn';
    if (aircraft.actionState === 'acted' && !aircraft.activity.attacked) return 'unit_already_acted';
    const reason = groundPlacementReason(state, aircraft.position, aircraft.id, true);
    return reason ? `landing_destination_${reason}` : null;
  }
  if (isAirborne(aircraft)) return 'aircraft_not_landed';
  if (action.type === 'BoardAircraft') {
    if (aircraft.cargoUnitId) return 'aircraft_cargo_occupied';
    const infantry = state.units.find(u => u.id === action.unitId && u.isPlayerUnit);
    if (!infantry || !isInfantry(state, infantry)) return 'unit_not_infantry';
    if (infantry.transportedByUnitId) return 'unit_already_transported';
    if (infantry.actionState === 'acted' || infantry.activity.attacked || infantry.activity.suppressed || infantry.disembarkedTurn === state.turn) return 'unit_already_acted';
    if (hexDistance(infantry.position, aircraft.position) !== 1) return 'boarding_requires_adjacency';
    return null;
  }
  const cargo = state.units.find(u => u.id === aircraft.cargoUnitId);
  if (!cargo) return 'aircraft_has_no_cargo';
  if (cargo.boardedTurn === state.turn) return 'cargo_boarded_this_turn';
  const reason = groundPlacementReason(state, action.destination, undefined, true);
  if (reason) return `disembark_destination_${reason}`;
  return hexDistance(aircraft.position, action.destination) === 1 ? null : 'disembark_requires_adjacency';
}
export function setFlightState(state: GameState, unit: UnitState, airborne: boolean): void {
  unit.flightState = airborne ? 'airborne' : 'landed'; unit.movementDomain = airborne ? 'air' : 'ground';
  unit.movement = airborne ? state.config.units.multipurposeHelicopter.airborneMovement : 0;
  if (airborne) { unit.tookOffTurn = state.turn; unit.canMove = !unit.activity.moved && unit.actionState !== 'acted'; }
  else { unit.landedTurn = state.turn; unit.canMove = false; }
  unit.activity.moved = true;
  emit(state, 'aircraft_state_changed', { unitId: unit.id, flightState: unit.flightState });
}
export function applyAviationAction(state: GameState, action: AviationAction): void {
  state.actionsTakenThisTurn++;
  if (action.type === 'LaunchMilitaryDrone') {
    const base = state.facilities.find(f => f.id === action.facilityId)!;
    const fuelCost = hexDistance(base.position, action.target) * state.config.militaryDrone.fuelPerHex;
    state.resources.fuel -= fuelCost;
    state.militaryDrone = { sourceFacilityId: base.id, center: { ...action.target }, radius: state.config.militaryDrone.visionRadius, startedTurn: state.turn, expiresBeforeTurn: state.turn + state.config.militaryDrone.durationTurns };
    emit(state, 'military_drone_launched', { facilityId: base.id, fuelCost, q: action.target.q, r: action.target.r, expiresBeforeTurn: state.militaryDrone.expiresBeforeTurn });
    return;
  }
  const aircraft = state.units.find(u => u.id === ('aircraftId' in action ? action.aircraftId : action.unitId))!;
  if (action.type === 'TakeOff' || action.type === 'Land') { setFlightState(state, aircraft, action.type === 'TakeOff'); return; }
  if (action.type === 'BoardAircraft') {
    const cargo = state.units.find(u => u.id === action.unitId)!;
    const transferredFuel = aircraft.currentFuel === 0 ? Math.min(cargo.currentFuel, aircraft.maxFuel) : 0;
    aircraft.currentFuel += transferredFuel; cargo.currentFuel -= transferredFuel;
    aircraft.cargoUnitId = cargo.id; cargo.transportedByUnitId = aircraft.id; cargo.boardedTurn = state.turn;
    cargo.position = { ...aircraft.position }; cargo.canMove = false; cargo.canAttack = false; cargo.actionState = 'acted'; cargo.activity.moved = true;
    emit(state, 'aircraft_boarded', { aircraftId: aircraft.id, unitId: cargo.id, transferredFuel });
  } else {
    const cargo = state.units.find(u => u.id === aircraft.cargoUnitId)!;
    delete aircraft.cargoUnitId; delete cargo.transportedByUnitId;
    cargo.position = { ...action.destination }; cargo.disembarkedTurn = state.turn;
    cargo.actionState = 'acted'; cargo.canMove = false; cargo.canAttack = cargo.attackChargesRemaining > 0; cargo.activity.moved = true;
    emit(state, 'aircraft_disembarked', { aircraftId: aircraft.id, unitId: cargo.id, q: cargo.position.q, r: cargo.position.r });
  }
}
export function synchronizeCargoPosition(state: GameState, aircraft: UnitState): void {
  const cargo = state.units.find(u => u.id === aircraft.cargoUnitId); if (cargo) cargo.position = { ...aircraft.position };
}
export function emergencyLanding(state: GameState, aircraft: UnitState, rng: SeededRng, destroy: (unit: UnitState) => void): void {
  if (!isAirborne(aircraft) || !state.units.includes(aircraft)) return;
  const candidates = canOccupyGroundHex(state, aircraft.position, aircraft.id) ? [{ ...aircraft.position }]
    : hexNeighbors(aircraft.position).filter(p => canOccupyGroundHex(state, p, aircraft.id)).sort((a,b) => a.q-b.q || a.r-b.r);
  if (candidates.length) {
    const target = candidates.length === 1 ? candidates[0]! : candidates[rng.nextInt(0, candidates.length-1)]!;
    aircraft.position = { ...target }; synchronizeCargoPosition(state, aircraft); setFlightState(state, aircraft, false);
    emit(state, 'aircraft_emergency_landing', { unitId: aircraft.id, q: target.q, r: target.r });
  } else {
    const enemy = state.units.find(u => !u.isPlayerUnit && occupiesGroundLayer(u) && hexKey(u.position) === hexKey(aircraft.position));
    destroy(aircraft); if (enemy && state.units.includes(enemy)) destroy(enemy);
  }
}
export function emergencyLandingPreview(state: Readonly<GameState>, aircraft: UnitState, position: HexCoord) {
  const visible = getPlayerVisibleTileKeys(state);
  const originLegal = groundPlacementReason(state, position, aircraft.id, true) === null;
  const candidates = originLegal && visible.has(hexKey(position)) ? [position] : [...(originLegal?[position]:[]),...hexNeighbors(position)].filter(p => groundPlacementReason(state,p,aircraft.id,true) === null).sort((a,b)=>a.q-b.q || a.r-b.r);
  return { possibleEmergencyLandingHexes: candidates.map(p=>({...p})), noSafeLandingPossible: candidates.length === 0, hiddenOccupancyMayAffectOutcome: candidates.some(p=>!visible.has(hexKey(p))), selectionIsRandom: candidates.length > 1 };
}
