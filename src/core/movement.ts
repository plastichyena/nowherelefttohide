import type { GameState, UnitState, HexCoord, HumanUnitType } from './types';
import { SeededRng } from './rng';
import { isHumanUnit, getUnitAt } from './state';
import { canPlayerOccupyHex, getTile } from './map';
import { effectiveMovementCost } from './terrain';
import { unitMoveFuelCost } from './movement-query';
import { emit } from './events-internal';
interface MovementHooks {
  interceptorsAt(state: GameState, mover: UnitState, position: HexCoord): UnitState[];
  resolveCombat(state: GameState, attacker: UnitState, defender: UnitState, kind: 'attack' | 'interception', rng: SeededRng): void;
  tryCapture(state: GameState, unit: UnitState): void;
}
/** Enter one hex, resolve interception, stop, then settle fuel and capture in existing order. */
export function createMovement({ interceptorsAt, resolveCombat, tryCapture }: MovementHooks) {
function applyMovement(
  state: GameState,
  mover: UnitState,
  path: HexCoord[],
  movementBudget: number,
  movementMode: 'normal' | 'emergency' = 'normal',
  rng: SeededRng = SeededRng.fromState(state.rngState),
): { reached: HexCoord; interception: UnitState | null } {
  let reached = { ...mover.position };
  let interception: UnitState | null = null;
  const traversed: HexCoord[] = [];
  let spent = 0;
  for (const position of path.slice(1)) {
    if (mover.isPlayerUnit && !canPlayerOccupyHex(state.map, position)) break;
    const cost = effectiveMovementCost(state, position);
    if (cost === null || spent + cost > movementBudget) break;
    const occupant = getUnitAt(state, position);
    if (occupant && occupant.id !== mover.id) break;
    spent += cost;
    mover.position = { ...position };
    reached = { ...position };
    traversed.push(position);
    const enteredTile = getTile(state.map, position);
    if (enteredTile) state.statistics.terrainEntriesByType[enteredTile.terrain] += 1;
    const candidates = interceptorsAt(state, mover, position);
    const interceptor = candidates[0];
    if (interceptor) {
      interception = interceptor;
      resolveCombat(state, interceptor, mover, 'interception', rng);
      break;
    }
  }
  if (state.units.some((unit) => unit.id === mover.id)) {
    if (isHumanUnit(mover)) {
      const fuelUsed = movementMode === 'normal'
        ? unitMoveFuelCost(mover.type as HumanUnitType, traversed.length)
        : 0;
      mover.currentFuel = Math.max(0, mover.currentFuel - fuelUsed);
      mover.activity.moved = traversed.length > 0;
      mover.canMove = false;
      mover.actionState = 'moved';
      if (mover.type === 'police' && traversed.length >= 11 && traversed.length <= 15) {
        state.statistics.policeLongRangeMoves += 1;
      }
    }
    emit(state, 'unit_moved', {
      unitId: mover.id,
      unitType: mover.type,
      q: reached.q,
      r: reached.r,
      hexesMoved: traversed.length,
      effectiveMovementCost: spent,
      movementMode: isHumanUnit(mover) ? movementMode : 'normal',
      fuelUsed: isHumanUnit(mover) && movementMode === 'normal'
        ? unitMoveFuelCost(mover.type as HumanUnitType, traversed.length)
        : 0,
    });
    tryCapture(state, mover);
  }
  return { reached, interception };
}

  return { applyMovement };
}
