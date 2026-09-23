import type { GameAction, JsonValue } from '../core/types';

export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function actionKey(action: GameAction): string {
  if(action.type==='TakeOff' || action.type==='Land') return `${action.type}|${action.unitId}`;
  if(action.type==='BoardAircraft') return `BoardAircraft|${action.aircraftId}|${action.unitId}`;
  if(action.type==='DisembarkAircraft') return `DisembarkAircraft|${action.aircraftId}|${action.destination.q},${action.destination.r}`;
  if(action.type==='LaunchMilitaryDrone') return `LaunchMilitaryDrone|${action.facilityId}|${action.target.q},${action.target.r}`;
  if (action.type === 'AttackHex') return `AttackHex|${action.attackerId}|${action.position.q},${action.position.r}`;
  if (action.type === 'ChangeUnitMode') return `ChangeUnitMode|${action.unitId}|${action.mode}`;
  if (action.type === 'BuildBarbedWire') return `BuildBarbedWire|${action.position.q},${action.position.r}`;
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

/** Resolve optional branch shorthand against the canonical public legal list. */
export function matchLegalAction(action: GameAction, legal: readonly GameAction[]): GameAction | undefined {
  if ((action.type === 'RelocateCheckpoint' || action.type === 'BuildCheckpoint') && action.branchId === undefined) {
    return legal.find(candidate => candidate.type === action.type && 'position' in candidate && candidate.position.q === action.position.q && candidate.position.r === action.position.r && (action.type !== 'RelocateCheckpoint' || ('checkpointId' in candidate && candidate.checkpointId === action.checkpointId)));
  }
  const key=actionKey(action);return legal.find(candidate=>actionKey(candidate)===key);
}
