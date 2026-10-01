import { overrunDamage } from './ifv';
import { isAirborne, occupiesGroundLayer, canTargetUnit } from './unit-capabilities';
import { synchronizeCargoPosition } from './aircraft';
import type { GameState, UnitState, HexCoord, HumanUnitType } from './types';
import { getPlayerVisibleTileKeys } from './visibility';
import { hexDistance, hexKey } from './hex';
import { SeededRng } from './rng';
import { isHumanUnit, getUnitAt } from './state';
import { canPlayerOccupyHex, getTile } from './map';
import { effectiveMovementCost } from './terrain';
import { unitMoveFuelCost, movementFuelCost } from './movement-query';
import { emit } from './events-internal';
import { wireAt, damageWire } from './barbed-wire';
import { capturePresentation } from './presentation';
interface MovementHooks {
  resolveOverrun(state: GameState, mover: UnitState, target: UnitState, damage: number, rng: SeededRng): void;
  emitMoveNoise(state: GameState, mover: UnitState, rng: SeededRng): void;
  emergencyLand(state: GameState, unit: UnitState, rng: SeededRng): void;
  interceptArmyBase(state: GameState, mover: UnitState, rng: SeededRng): boolean;
  interceptorsAt(state: GameState, mover: UnitState, position: HexCoord): UnitState[];
  resolveCombat(state: GameState, attacker: UnitState, defender: UnitState, kind: 'attack' | 'interception', rng: SeededRng): void;
  tryCapture(state: GameState, unit: UnitState, rng: SeededRng): void;
}
/** Enter one hex, resolve interception, stop, then settle fuel and capture in existing order. */
export function createMovement({ resolveOverrun, emitMoveNoise, interceptorsAt, resolveCombat, tryCapture, interceptArmyBase, emergencyLand }: MovementHooks) {
function applyMovement(
  state: GameState,
  mover: UnitState,
  path: HexCoord[],
  movementBudget: number,
  movementMode: 'normal' | 'emergency' = 'normal',
  rng: SeededRng = SeededRng.fromState(state.rngState),
): { reached: HexCoord; interception: UnitState | null } {
  const flying = isAirborne(mover);
  const startingFuel = mover.currentFuel;
  let reached = { ...mover.position };
  let interception: UnitState | null = null;
  const traversed: HexCoord[] = [];
  let spent = 0;
  const pinned = () => !mover.isPlayerUnit && state.units.some(u => u.isPlayerUnit && u.hp > 0 && canTargetUnit(state,mover,u) && hexDistance(u.position, mover.position) <= 1);
  for (const position of (pinned() ? [] : path.slice(1))) {
    if (!flying && mover.isPlayerUnit && !canPlayerOccupyHex(state.map, position)) break;
    const cost = flying ? 1 : effectiveMovementCost(state, position, mover.isPlayerUnit);
    if (cost === null) break;
    const occupant = flying ? state.units.find(u=>isAirborne(u) && hexKey(u.position)===hexKey(position)) : getUnitAt(state, position);
    if (occupant && occupant.id !== mover.id && (mover.type !== 'ifv' || occupant.isPlayerUnit)) break;
    if (mover.type === 'ifv' && mover.currentFuel <= 0) break;
    const overrun = mover.type === 'ifv' && occupant && !occupant.isPlayerUnit ? overrunDamage(state, mover, occupant, position) : null;
    if (overrun && !overrun.survivesEntry) { emit(state, 'unit_movement_stopped', { unitId: mover.id, reason: 'overrun_insufficient_hp', q: reached.q, r: reached.r }); break; }
    if (!mover.isPlayerUnit) {
      const encounteredWire = Boolean(wireAt(state, position));
      while (wireAt(state, position) && mover.canAttack && mover.attackChargesRemaining > 0) {
        if (getPlayerVisibleTileKeys(state).has(hexKey(position))) {
          state.statistics.barbedWireEmptyAttackCharges += 1;
          emit(state, 'barbed_wire_attack_charge', { wireId: wireAt(state, position)!.id, targetKind: 'empty', charges: 1 });
        }
        mover.attackChargesRemaining--;
        mover.canAttack = mover.attackChargesRemaining > 0;
        damageWire(state, position, mover.attack);
      }
      // Breaching ends this individual's movement, even after the last HP is removed.
      if (encounteredWire) break;
    }
    if (spent + cost > movementBudget) break;
    spent += cost;
    mover.position = { ...position };
    delete mover.reanimatedOnBarbedWireId;
    reached = { ...position };
    traversed.push(position);
    synchronizeCargoPosition(state, mover);
    if (mover.type === 'ifv') {
      mover.currentFuel -= Math.min(mover.currentFuel, state.config.units.ifv.fuelPerHex);
      if (overrun && occupant) resolveOverrun(state, mover, occupant, overrun.impactDamage, rng);
      emitMoveNoise(state, mover, rng);
    }
    capturePresentation(state);
    if (!state.units.includes(mover) || state.gameOver) break;
    if (flying) {
      mover.currentFuel = Math.max(0,mover.currentFuel-state.config.units.multipurposeHelicopter.fuelPerMovementPoint);
      if (mover.currentFuel===0) { emergencyLand(state,mover,rng); reached={...mover.position}; break; }
    }
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
        ? movementFuelCost(state, mover, traversed.length, spent)
        : 0;
      if (!flying && mover.type !== 'ifv') mover.currentFuel = Math.max(0, mover.currentFuel - fuelUsed);
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
      fuelUsed: flying || mover.type === 'ifv' ? startingFuel - mover.currentFuel : isHumanUnit(mover) && movementMode === 'normal'
        ? movementFuelCost(state, mover, traversed.length, spent)
        : 0,
    });
    tryCapture(state, mover, rng);
  }
  return { reached, interception };
}

  return { applyMovement };
}
