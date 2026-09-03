import type { GameAction, JsonValue } from '../core/types';

export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function actionKey(action: GameAction): string {
  if (action.type === 'Move') return `Move|${action.unitId}|${action.destination.q},${action.destination.r}`;
  if (action.type === 'Attack') return `Attack|${action.attackerId}|${action.targetId}`;
  if (action.type === 'Wait') return `Wait|${action.unitId}`;
  if (action.type === 'AssignWorkers') return `AssignWorkers|${action.facilityId}|${action.workers}`;
  if (action.type === 'TransferPopulation') return `TransferPopulation|${action.fromFacilityId}|${action.toFacilityId}|${action.people}`;
  if (action.type === 'SetCheckpointPolicy') return `SetCheckpointPolicy|${action.branchId}|${action.policy}`;
  if (action.type === 'SetPowerSupply') return `SetPowerSupply|${action.facilityId}|${action.enabled ? 'on' : 'off'}`;
  if (action.type === 'BuildCheckpoint') return `BuildCheckpoint|${action.branchId ?? ''}|${action.position.q},${action.position.r}`;
  if (action.type === 'BuildConstructibleFacility') return `BuildConstructibleFacility|${action.facilityType}|${action.position.q},${action.position.r}`;
  if (action.type === 'RelocateCheckpoint') return `RelocateCheckpoint|${action.checkpointId}|${action.branchId ?? ''}|${action.position.q},${action.position.r}`;
  if (action.type === 'ActivateCheckpoint') return `ActivateCheckpoint|${action.branchId}|${action.checkpointId}`;
  if (action.type === 'TurnAwayCheckpointRefugees') return `TurnAwayCheckpointRefugees|${action.checkpointId}|${action.count}`;
  if (action.type === 'DecommissionConstructibleFacility') return `DecommissionConstructibleFacility|${action.facilityId}`;
  if (action.type === 'ProduceUnit') {
    const destination = action.destination ? `${action.destination.q},${action.destination.r}` : '';
    return `ProduceUnit|${action.unitType}|${destination}`;
  }
  if (action.type === 'EndTurn') return 'EndTurn';
  if (action.type === 'StartNewGame') return `StartNewGame|${action.seed}`;
  return 'LoadSnapshot';
}

export function cloneAction(action: GameAction): GameAction {
  return cloneJson(action as unknown as JsonValue) as unknown as GameAction;
}

export function sortActions(actions: readonly GameAction[]): GameAction[] {
  return [...actions].sort((left, right) => actionKey(left).localeCompare(actionKey(right)));
}
