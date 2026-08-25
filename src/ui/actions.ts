import { hexKey } from '../core/hex';
import type { GameAction, GameState, HexCoord, UnitState } from '../core/types';

export function sameHex(a: HexCoord, b: HexCoord): boolean {
  return a.q === b.q && a.r === b.r;
}

export function findUnitAt(state: Readonly<GameState>, position: HexCoord): UnitState | undefined {
  return state.units.find((unit) => unit.actionState !== 'destroyed' && sameHex(unit.position, position));
}

export function findUnit(state: Readonly<GameState>, unitId: string): UnitState | undefined {
  return state.units.find((unit) => unit.id === unitId && unit.actionState !== 'destroyed');
}

export function findFacilityAt(state: Readonly<GameState>, position: HexCoord) {
  return state.facilities.find((facility) => sameHex(facility.position, position));
}

export function legalActionsForUnit(state: Readonly<GameState>, actions: readonly GameAction[], unitId: string): GameAction[] {
  return actions.filter((action) =>
    (action.type === 'Move' && action.unitId === unitId) ||
    (action.type === 'Attack' && action.attackerId === unitId) ||
    (action.type === 'Wait' && action.unitId === unitId) ||
    (action.type === 'SuppressInfection' && action.unitId === unitId),
  );
}

export function legalMoveDestinations(actions: readonly GameAction[], unitId: string): HexCoord[] {
  return actions
    .filter((action): action is Extract<GameAction, { type: 'Move' }> => action.type === 'Move' && action.unitId === unitId)
    .map((action) => action.destination);
}

export function legalAttackTargets(actions: readonly GameAction[], unitId: string): string[] {
  return actions
    .filter((action): action is Extract<GameAction, { type: 'Attack' }> => action.type === 'Attack' && action.attackerId === unitId)
    .map((action) => action.targetId);
}

export function isLegalAction(actions: readonly GameAction[], action: GameAction): boolean {
  const wanted = JSON.stringify(action);
  return actions.some((candidate) => JSON.stringify(candidate) === wanted);
}

export function actionForWorkerAssignment(
  actions: readonly GameAction[],
  facilityId: string,
  workers: number,
): Extract<GameAction, { type: 'AssignWorkers' }> | undefined {
  return actions.find(
    (action): action is Extract<GameAction, { type: 'AssignWorkers' }> =>
      action.type === 'AssignWorkers' && action.facilityId === facilityId && action.workers === workers,
  );
}

export function actionForCheckpointPolicy(
  actions: readonly GameAction[],
  checkpointId: string,
  policy: Extract<GameAction, { type: 'SetCheckpointPolicy' }>['policy'],
): Extract<GameAction, { type: 'SetCheckpointPolicy' }> | undefined {
  return actions.find(
    (action): action is Extract<GameAction, { type: 'SetCheckpointPolicy' }> =>
      action.type === 'SetCheckpointPolicy' && action.checkpointId === checkpointId && action.policy === policy,
  );
}

export function unitTileKey(unit: UnitState): string {
  return hexKey(unit.position);
}
