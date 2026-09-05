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
  const entered = Math.max(0, Math.floor(distance));
  if (entered === 0) return 0;
  if (entered <= 5) return 1;
  return unitType === 'nationalGuard' ? 1 + 2 * (entered - 5) : 1 + (entered - 5);
}


export interface MovePreview {
  legal: boolean;
  reason: string | null;
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
        candidate.canAttack &&
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
  if (!isPlayerPhase(state) || unit.actionState === 'acted' || !unit.canMove) {
    return error(action, 'unit_cannot_move', 'This unit cannot move now');
  }
  if (!hexWithinBounds(action.destination, state.map.width, state.map.height)) {
    return error(action, 'outside_map', 'Destination is outside the map');
  }
  if (isHordeSpawnReserve(state.map, action.destination)) {
    return error(action, 'horde_spawn_reserve', 'Player units cannot enter or cross the Horde Spawn Reserve');
  }
  const visible = getPlayerVisibleTileKeys(state);
  const destinationUnit = getUnitAt(state, action.destination);
  if (destinationUnit && (destinationUnit.isPlayerUnit || visible.has(hexKey(destinationUnit.position)))) {
    return error(action, 'occupied_destination', 'Destination is occupied');
  }
  const publicBlocked = new Set(
    state.units
      .filter((candidate) => candidate.id !== unit.id && (candidate.isPlayerUnit || visible.has(hexKey(candidate.position))))
      .map((candidate) => hexKey(candidate.position)),
  );
  const path = findShortestPath(
    state.map,
    unit.position,
    action.destination,
    publicBlocked,
    createMovementCostResolver(state, true),
  );
  if (!path) {
    return error(action, 'no_path', 'No path is available');
  }
  const movementMode = unit.currentFuel === 0 ? 'emergency' as const : 'normal' as const;
  const movementBudget = movementMode === 'emergency'
    ? state.config.units[unit.type as HumanUnitType].emergencyMovementPoints
    : unit.movement;
  const effectiveCost = pathMovementCost(path, (position) => effectiveMovementCost(state, position));
  if (path.length <= 1 || effectiveCost > movementBudget) {
    return error(action, 'out_of_range', 'Destination exceeds movement range');
  }
  const fuelCost = movementMode === 'normal' ? unitMoveFuelCost(unit.type as HumanUnitType, path.length - 1) : 0;
  if (movementMode === 'normal' && unit.currentFuel < fuelCost) {
    return error(action, 'insufficient_unit_fuel', 'The unit does not have enough Fuel for this move');
  }
  return { unit, path, movementMode, effectiveMovementCost: effectiveCost, fuelCost };
}

function reachableMovePaths(state: GameState, unit: UnitState) {
  return queryValue(state, 'reachable:'+unit.id, () => computeReachableMovePaths(state, unit));
}

function computeReachableMovePaths(state: GameState, unit: UnitState) {
  const visible = getPlayerVisibleTileKeys(state);
  const blocked = new Set(
    state.units
      .filter((candidate) => candidate.id !== unit.id && (candidate.isPlayerUnit || visible.has(hexKey(candidate.position))))
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
    createMovementCostResolver(state, true),
  ).filter((entry) => movementMode === 'emergency' || unit.currentFuel >= unitMoveFuelCost(unit.type as HumanUnitType, entry.path.length - 1));
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
  if (!unit || !unit.isPlayerUnit || unit.actionState === 'acted' || !unit.canMove || snapshot.phase !== 'player') return [];
  return reachableMovePaths(snapshot, unit).map((entry) => {
    const movementMode = unit.currentFuel === 0 ? 'emergency' as const : 'normal' as const;
    const fuelCost = movementMode === 'normal' ? unitMoveFuelCost(unit.type as HumanUnitType, entry.path.length - 1) : 0;
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
      reason: candidate.message,
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
  for (const position of candidate.path.slice(1)) {
    const interceptors = interceptorsAt(snapshot, mover, position)
      .filter((interceptor) => initiallyVisible.has(hexKey(interceptor.position)));
    if (interceptors[0]) {
      const entered = candidate.path.findIndex((step) => hexKey(step) === hexKey(position));
      const partialPath = candidate.path.slice(0, entered + 1);
      const effectiveCost = pathMovementCost(partialPath, (step) => effectiveMovementCost(snapshot, step));
      const fuelCost = candidate.movementMode === 'normal'
        ? unitMoveFuelCost(mover.type as HumanUnitType, entered)
        : 0;
      return {
        legal: true,
        reason: null,
        path: candidate.path,
        reached: { ...position },
        interception: { interceptorId: interceptors[0].id, position: { ...position } },
        fuelCost,
        projectedFuelAfterMove: mover.currentFuel - fuelCost,
        movementMode: candidate.movementMode,
        effectiveMovementCost: effectiveCost,
      };
    }
  }
  return {
    legal: true,
    reason: null,
    path: candidate.path,
    reached: { ...destination },
    interception: null,
    fuelCost: candidate.fuelCost,
    projectedFuelAfterMove: mover.currentFuel - candidate.fuelCost,
    movementMode: candidate.movementMode,
    effectiveMovementCost: candidate.effectiveMovementCost,
  };
}
