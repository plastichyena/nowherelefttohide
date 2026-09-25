import type { HexCoord, UnitType } from './types';

/** Minimal public movement contract, shared by Core, route queries and agents. */
export interface MovementActor {
  id: string; type: UnitType; currentFuel: number; movement: number;
  canMove: boolean; actionState: string; emergencyMovementPoints: number;
  transportedByUnitId?: string; flightState?: 'landed' | 'airborne'; mode?: string;
  artillery?: { fuelPerMovementPoint?: number };
  movementSummary?: { fuelCostPerUnit: number | null };
}

export interface MovementSummary {
  legalMoveCount: number;
  movementMode: 'normal' | 'emergency';
  availableMovementPoints: number;
  fuelCostBasis: 'entered_hex_tiers' | 'effective_movement_points';
  fuelCostPerUnit: number | null;
  rangeUpperBound: number | null;
  rangeEstimateReason: string;
  movementUnavailableReason: string | null;
  detailQuery: { target: 'route'; moverUnitId: string; destination: { kind: 'coordinate'; position: 'supply q and r' } };
}

export function movementUnavailableReason(unit: MovementActor, phase: string): string | null {
  if (phase !== 'player') return 'not_player_phase';
  if (unit.transportedByUnitId) return 'unit_transported';
  if (unit.type === 'multipurposeHelicopter' && unit.flightState !== 'airborne') return 'aircraft_not_airborne';
  if (unit.type === 'multipurposeHelicopter' && unit.currentFuel <= 0) return 'insufficient_unit_fuel';
  if (unit.mode === 'deployed') return 'artillery_deployed';
  if (unit.actionState === 'acted') return 'unit_cannot_move';
  if (!unit.canMove) return 'unit_cannot_move';
  return null;
}

export function infantryMoveFuel(type: UnitType, hexes: number): number {
  const n = Math.max(0, Math.floor(hexes));
  return n === 0 ? 0 : 2 * (1 + Math.max(0, n - 5) * (['nationalGuard', 'reconTeam'].includes(type) ? 2 : 1));
}

export function movementPlan(unit: MovementActor, phase: string, hexes: number, effectiveCost: number) {
  const movementMode = unit.currentFuel === 0 ? 'emergency' as const : 'normal' as const;
  const movementBudget = movementMode === 'emergency' ? unit.emergencyMovementPoints : unit.movement;
  const perPoint = unit.movementSummary?.fuelCostPerUnit ?? unit.artillery?.fuelPerMovementPoint ?? (unit.type === 'multipurposeHelicopter' ? 5 : 10);
  const plannedFuelCost = movementMode === 'emergency' ? 0 : ['fieldArtillery', 'multipurposeHelicopter'].includes(unit.type)
    ? effectiveCost * perPoint : infantryMoveFuel(unit.type, hexes);
  const fuelCost = unit.type === 'multipurposeHelicopter' ? Math.min(unit.currentFuel, plannedFuelCost) : plannedFuelCost;
  const reason = movementUnavailableReason(unit, phase) ?? (hexes <= 0 || effectiveCost > movementBudget ? 'out_of_range'
    : fuelCost > unit.currentFuel ? 'insufficient_unit_fuel' : null);
  return { legal: reason === null, reason, movementMode, movementBudget, effectiveMovementCost: effectiveCost,
    plannedFuelCost, fuelCost, projectedFuelAfterMove: Math.max(0, unit.currentFuel - fuelCost) };
}

export function summarizeMovement(unit: MovementActor, phase: string, legalMoveCount: number): MovementSummary {
  const reason = movementUnavailableReason(unit, phase);
  const mode = unit.currentFuel === 0 ? 'emergency' : 'normal';
  const points = reason ? 0 : mode === 'emergency' ? unit.emergencyMovementPoints : unit.movement;
  const perPoint = unit.type === 'fieldArtillery' ? unit.artillery?.fuelPerMovementPoint ?? 10 : unit.type === 'multipurposeHelicopter' ? unit.movementSummary?.fuelCostPerUnit ?? 5 : null;
  const fuelRange = mode === 'emergency' ? points : perPoint !== null
    ? unit.type === 'multipurposeHelicopter' ? Math.max(0, Math.ceil(unit.currentFuel / perPoint) - 1) : Math.floor(unit.currentFuel / perPoint)
    : unit.currentFuel < 2 ? 0 : 5 + Math.floor((unit.currentFuel - 2) / (['nationalGuard', 'reconTeam'].includes(unit.type) ? 4 : 2));
  return { legalMoveCount, movementMode: mode, availableMovementPoints: points,
    fuelCostBasis: perPoint === null ? 'entered_hex_tiers' : 'effective_movement_points', fuelCostPerUnit: perPoint,
    rangeUpperBound: Math.min(points, fuelRange), rangeEstimateReason: reason ?? (mode === 'emergency' ? 'emergency_mp_upper_bound_not_guaranteed' : 'mp_and_fuel_upper_bound_not_guaranteed'),
    movementUnavailableReason: reason,
    detailQuery: { target: 'route', moverUnitId: unit.id, destination: { kind: 'coordinate', position: 'supply q and r' } } };
}

/** Fuel exhaustion takes precedence over interception on the same entered hex. */
export function previewMovementPath(unit: MovementActor, phase: string, path: readonly HexCoord[], costAt: (p: HexCoord) => number,
  interceptorAt: (p: HexCoord) => string | null) {
  let cost = 0;
  let reached = path[0]!;
  let interception: { interceptorId: string; position: HexCoord } | null = null;
  let fuelExhaustionHex: HexCoord | null = null;
  let entered = 0;
  for (const p of path.slice(1)) {
    cost += costAt(p); reached = p; entered++;
    const plan = movementPlan(unit, phase, entered, cost);
    if (unit.flightState === 'airborne' && plan.projectedFuelAfterMove === 0) { fuelExhaustionHex = p; break; }
    const interceptorId = interceptorAt(p);
    if (interceptorId) { interception = { interceptorId, position: p }; break; }
  }
  const plan = movementPlan(unit, phase, entered, cost);
  return { ...plan, reached: { ...reached }, interception, fuelExhaustionHex,
    destinationReached: reached.q === path.at(-1)?.q && reached.r === path.at(-1)?.r && fuelExhaustionHex === null,
    arrivalReason: fuelExhaustionHex ? 'fuel_exhaustion_emergency_landing' : interception ? 'visible_interception' : 'planned_destination' };
}
