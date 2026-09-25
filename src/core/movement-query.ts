import { movementPlan, summarizeMovement, movementUnavailableReason, infantryMoveFuel, previewMovementPath } from './move-plan';
import { canOccupyAirHex, emergencyLandingPreview } from './aircraft';
import { deployedArtillery, canReact, isAirborne, occupiesGroundLayer, canTargetUnit } from './unit-capabilities';
import type { GameState, UnitState, HexCoord, MoveAction, ActionError, GameAction } from './types';
import { hexKey, hexDistance, hexWithinBounds } from './hex';
import { getUnit, getUnitAt } from './state';
import { isHordeSpawnReserve } from './map';
import { getPlayerVisibleTileKeys } from './visibility';
import { forecastUnitCombatAtDistance } from './combat-query';
import { findShortestPath, findReachablePaths, pathMovementCost } from './path';
import { effectiveMovementCost, createMovementCostResolver } from './terrain';
import { queryValue } from './query-cache';
function error(action: GameAction, code: string, message: string): ActionError { return { action, code, message }; }
function isPlayerPhase(state: Readonly<GameState>): boolean { return state.phase === 'player' && !state.gameOver; }
import type { HumanUnitType } from './types';

export function unitMoveFuelCost(unitType: HumanUnitType, distance: number): number {
  if (unitType === 'multipurposeHelicopter') return Math.max(0, Math.floor(distance)) * 5;
  if (unitType === 'fieldArtillery') return Math.max(0, Math.floor(distance)) * 10;
  return infantryMoveFuel(unitType, distance);
}


export function movementFuelCost(state: Readonly<GameState>, unit: UnitState, hexes: number, movementPoints: number): number {
  if (isAirborne(unit)) return Math.min(unit.currentFuel, movementPoints * state.config.units.multipurposeHelicopter.fuelPerMovementPoint);
  return unit.type === 'fieldArtillery' ? movementPoints * state.config.units.fieldArtillery.fuelPerMovementPoint : unitMoveFuelCost(unit.type as HumanUnitType,hexes);
}

function movementActor(state: Readonly<GameState>, unit: UnitState) {
  return { ...unit, emergencyMovementPoints: state.config.units[unit.type].emergencyMovementPoints,
    artillery: { fuelPerMovementPoint: state.config.units.fieldArtillery.fuelPerMovementPoint },
    movementSummary: { fuelCostPerUnit: unit.type === 'multipurposeHelicopter' ? state.config.units.multipurposeHelicopter.fuelPerMovementPoint : null } };
}

export function getUnitMovementSummary(state: Readonly<GameState>, unit: UnitState) {
  const actor = movementActor(state, unit);
  const phase = state.gameOver ? 'ended' : state.phase;
  const count = unit.isPlayerUnit && !movementUnavailableReason(actor, phase) ? reachableMovePaths(state as GameState, unit).length : 0;
  return summarizeMovement(actor, phase, count);
}

export interface MovePreview {
  legal: boolean;
  reason: string | null;
  emergencyLanding?: ReturnType<typeof emergencyLandingPreview>;
  fuelExhaustionHex?: HexCoord | null;
  path: HexCoord[];
  reached: HexCoord | null;
  interception: { interceptorId: string; position: HexCoord } | null;
  fuelCost: number;
  projectedFuelAfterMove: number;
  movementMode: 'normal' | 'emergency';
  effectiveMovementCost: number;
}

export function interceptorsAt(state: GameState, mover: UnitState, position: HexCoord): UnitState[] {
  return state.units
    .filter(
      (candidate) =>
        candidate.id !== mover.id &&
        candidate.isPlayerUnit !== mover.isPlayerUnit &&
        canReact(candidate) && canTargetUnit(state, candidate, mover) &&
        forecastUnitCombatAtDistance(state, candidate, hexDistance(candidate.position, position)).canAttack,
    )
    .sort((left, right) => left.id.localeCompare(right.id));
}

export function getMovePath(state: GameState, action: MoveAction): {
  unit: UnitState;
  path: HexCoord[];
  movementMode: 'normal' | 'emergency';
  effectiveMovementCost: number;
  fuelCost: number;
} | ActionError {
  const unit = getUnit(state, action.unitId);
  if (!unit || !unit.isPlayerUnit) {
    return error(action, 'unknown_unit', 'A player unit is required');
  }
  if (unit.transportedByUnitId) return error(action, 'unit_transported', 'Transported units cannot move');
  if (unit.type === 'multipurposeHelicopter' && !isAirborne(unit)) return error(action, 'aircraft_not_airborne', 'Take off before moving');
  if (isAirborne(unit) && unit.currentFuel <= 0) return error(action, 'insufficient_unit_fuel', 'Flight requires fuel');
  const unavailable = movementUnavailableReason(movementActor(state, unit), state.gameOver ? 'ended' : state.phase);
  if (unavailable) return error(action, unavailable, 'This unit cannot move now; query route with moverUnitId and destination for details.');
  if (!hexWithinBounds(action.destination, state.map.width, state.map.height)) {
    return error(action, 'outside_map', 'Destination is outside the map');
  }
  if (!isAirborne(unit) && isHordeSpawnReserve(state.map, action.destination)) {
    return error(action, 'horde_spawn_reserve', 'Player units cannot enter or cross the Horde Spawn Reserve');
  }
  const visible = getPlayerVisibleTileKeys(state);
  const destinationUnit = isAirborne(unit) ? state.units.find(u=>u.id!==unit.id && isAirborne(u) && hexKey(u.position)===hexKey(action.destination)) : getUnitAt(state, action.destination);
  if (destinationUnit && (destinationUnit.isPlayerUnit || visible.has(hexKey(destinationUnit.position)))) {
    return error(action, 'occupied_destination', 'Destination is occupied');
  }
  const publicBlocked = new Set(
    state.units
      .filter((candidate) => candidate.id !== unit.id && (isAirborne(unit) ? isAirborne(candidate) : occupiesGroundLayer(candidate)) && (candidate.isPlayerUnit || visible.has(hexKey(candidate.position))))
      .map((candidate) => hexKey(candidate.position)),
  );
  const path = findShortestPath(
    state.map,
    unit.position,
    action.destination,
    publicBlocked,
    unitMovementCostResolver(state, unit, visible),
  );
  if (!path) {
    return error(action, 'no_path', 'No path is available');
  }
  const effectiveCost = pathMovementCost(path, unitMovementCostResolver(state, unit, visible));
  const plan = movementPlan(movementActor(state, unit), state.gameOver ? 'ended' : state.phase, path.length - 1, effectiveCost);
  if (!plan.legal) return error(action, plan.reason!, 'Inspect route with moverUnitId and destination for movement details and a possible alternative.');
  return { unit, path, movementMode: plan.movementMode, effectiveMovementCost: effectiveCost, fuelCost: plan.fuelCost };

}

function reachableMovePaths(state: GameState, unit: UnitState) {
  return queryValue(state, 'reachable:'+unit.id, () => computeReachableMovePaths(state, unit));
}

function computeReachableMovePaths(state: GameState, unit: UnitState) {
  const visible = getPlayerVisibleTileKeys(state);
  const blocked = new Set(
    state.units
      .filter((candidate) => candidate.id !== unit.id && (isAirborne(unit) ? isAirborne(candidate) : occupiesGroundLayer(candidate)) && (candidate.isPlayerUnit || visible.has(hexKey(candidate.position))))
      .map((candidate) => hexKey(candidate.position)),
  );
  const movementMode = unit.currentFuel === 0 ? 'emergency' as const : 'normal' as const;
  const movementBudget = movementMode === 'emergency'
    ? state.config.units[unit.type as HumanUnitType].emergencyMovementPoints
    : unit.movement;
  return findReachablePaths(
    state.map,
    unit.position,
    movementBudget,
    blocked,
    unitMovementCostResolver(state, unit, visible),
  ).filter((entry) => movementMode === 'emergency' || unit.currentFuel >= movementFuelCost(state, unit, entry.path.length - 1, entry.cost));
}

export function reachableDestinations(state: GameState, unit: UnitState): HexCoord[] {
  return reachableMovePaths(state, unit).map((entry) => ({ ...entry.position }));
}

export function getUnitLegalMoveFuelProjections(
  state: Readonly<GameState>,
  unitId: string,
): Array<{
  destination: HexCoord;
  fuelCost: number;
  projectedFuelAfterMove: number;
  movementMode: 'normal' | 'emergency';
  effectiveMovementCost: number;
}> {
  const snapshot = state as GameState;
  const unit = getUnit(snapshot, unitId);
  if (!unit || !unit.isPlayerUnit || state.gameOver || (isAirborne(unit) && unit.currentFuel <= 0) || unit.transportedByUnitId || (unit.type === 'multipurposeHelicopter' && !isAirborne(unit)) || unit.actionState === 'acted' || !unit.canMove || deployedArtillery(unit) || snapshot.phase !== 'player') return [];
  return reachableMovePaths(snapshot, unit).map((entry) => {
    const movementMode = unit.currentFuel === 0 ? 'emergency' as const : 'normal' as const;
    const fuelCost = movementMode === 'normal' ? movementFuelCost(state, unit, entry.path.length - 1, entry.cost) : 0;
    return {
      destination: { ...entry.position },
      fuelCost,
      projectedFuelAfterMove: unit.currentFuel - fuelCost,
      movementMode,
      effectiveMovementCost: entry.cost,
    };
  });
}

/** Pure movement preview shared by the UI and action validation. */
export function previewMove(state: Readonly<GameState>, unitId: string, destination: HexCoord): MovePreview {
  const snapshot = state as GameState;
  const initiallyVisible = getPlayerVisibleTileKeys(snapshot);
  const candidate = getMovePath(snapshot, { type: 'Move', unitId, destination });
  if ('code' in candidate) {
    return {
      legal: false,
      reason: candidate.code,
      path: [],
      reached: null,
      interception: null,
      fuelCost: 0,
      projectedFuelAfterMove: 0,
      movementMode: 'normal',
      effectiveMovementCost: 0,
    };
  }
  const mover = candidate.unit;
  const resolver = unitMovementCostResolver(state, mover, initiallyVisible);
  const projected = previewMovementPath(movementActor(state, mover), state.phase, candidate.path, p => resolver(p) ?? 0,
    p => interceptorsAt(snapshot, mover, p).find(i => initiallyVisible.has(hexKey(i.position)))?.id ?? null);
  return { ...projected, legal: true, reason: null, path: candidate.path,
    ...(projected.fuelExhaustionHex ? { emergencyLanding: emergencyLandingPreview(state, mover, projected.fuelExhaustionHex) } : {}) };

}

function unitMovementCostResolver(state: Readonly<GameState>, unit: UnitState, visible: ReadonlySet<string>) {
  return isAirborne(unit) ? (p: HexCoord) => canOccupyAirHex(state,p,unit.id) ? 1 : null : createMovementCostResolver(state,true,visible);
}
