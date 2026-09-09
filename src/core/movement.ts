import type { GameState, UnitState, HexCoord, HumanUnitType } from './types';
import { hexDistance } from './hex';
import { SeededRng } from './rng';
import { isHumanUnit, getUnitAt } from './state';
import { canPlayerOccupyHex, getTile } from './map';
import { effectiveMovementCost } from './terrain';
import { unitMoveFuelCost } from './movement-query';
import { emit } from './events-internal';
import { wireAt, damageWire } from './barbed-wire';
interface MovementHooks {
  interceptArmyBase(state: GameState, mover: UnitState, rng: SeededRng): boolean;
  interceptorsAt(state: GameState, mover: UnitState, position: HexCoord): UnitState[];
  resolveCombat(state: GameState, attacker: UnitState, defender: UnitState, kind: 'attack' | 'interception', rng: SeededRng): void;
  tryCapture(state: GameState, unit: UnitState, rng: SeededRng): void;
}
/** Enter one hex, resolve interception, stop, then settle fuel and capture in existing order. */
export function createMovement({ interceptorsAt, resolveCombat, tryCapture, interceptArmyBase }: MovementHooks) {
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
  const pinned = () => !mover.isPlayerUnit && state.units.some(u => u.isPlayerUnit && u.hp > 0 && hexDistance(u.position, mover.position) === 1);
  for (const position of (pinned() ? [] : path.slice(1))) {
    if (mover.isPlayerUnit && !canPlayerOccupyHex(state.map, position)) break;
    const cost = effectiveMovementCost(state, position, mover.isPlayerUnit);
    if (cost === null) break;
    const occupant = getUnitAt(state, position);
    if (occupant && occupant.id !== mover.id) break;
    if (!mover.isPlayerUnit) {
      while (wireAt(state, position) && mover.canAttack && mover.attackChargesRemaining > 0) {
        mover.attackChargesRemaining--;
        mover.canAttack = mover.attackChargesRemaining > 0;
        damageWire(state, position, mover.attack);
      }
      if (wireAt(state, position)) break;
    }
    if (spent + cost > movementBudget) break;
    spent += cost;
    mover.position = { ...position };
    delete mover.reanimatedOnBarbedWireId;
    reached = { ...position };
    traversed.push(position);
    const enteredTile = getTile(state.map, position);
    if (enteredTile) state.statistics.terrainEntriesByType[enteredTile.terrain] += 1;
    const candidates = interceptorsAt(state, mover, position);
    const interceptor = candidates[0];
    if (interceptor) {
      interception = interceptor;
      resolveCombat(state, interceptor, mover, 'interception', rng);
    }
    const baseIntercepted = !mover.isPlayerUnit && state.units.some(u => u.id === mover.id) && interceptArmyBase(state, mover, rng);
    if (interceptor || baseIntercepted || pinned() || !state.units.some(u => u.id === mover.id)) break;
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
    tryCapture(state, mover, rng);
  }
  return { reached, interception };
}

  return { applyMovement };
}
