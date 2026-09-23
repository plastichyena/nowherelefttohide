import type { GameAction, JsonValue } from '../core/types';

export const ACTION_SCHEMA_VERSION = '3.0.0';

export const ACTION_RESPONSE_SEMANTICS = {
  ok: 'The CLI/protocol command was processed successfully; this does not mean the GameAction was accepted.',
  accepted: 'true only when Core accepted and applied the GameAction. Always inspect accepted as well as ok.',
  rejected: 'ok:true, accepted:false means a well-formed action was rejected by game rules and recorded as a rejected Decision.',
  malformed: 'invalid_action_input; unknown fields are rejected before Core, with no Decision, State or RNG change.',
} as const;

export const ACTION_PLAY_GUIDANCE = {
  movement: 'Adjacent enemies can remove legal moves. Retreat before contact. Attack then Move is forbidden; Move then Attack requires remaining charge. Interception during movement can spend that charge.',
  recruitment: 'Each recruitment facility may hold one pending reservation. Different facilities have independent slots. The free Army Base Soldier reward consumes no reservation slot; ordinary recruitment uses one shared global action.',
  infection: 'Infected facilities cannot assign or withdraw workers. Population transfers require both cities, including Capital, to be safe and eligible in the turn-start snapshot.',
  intake: 'Strict takes 5 turns for 20 people, accepts 100% with zero latent infection, and remains slower than Normal. There is no fixed safe population: compare resource runway, guaranteed_resource_defeat, production capacity and queue demand.',
  defense: 'Keep defense available for Capital, Power Plants and principal Food/Civilian Goods producers when visible threats approach.',
  housing: 'Temporary Housing has a hard limit of 10 healthy plus infected residents; inspect population-transfers min/max.',
} as const;

const MAX_INPUT_DEPTH = 32;
const MAX_INPUT_STRING_LENGTH = 256;
const MAX_INPUT_ARRAY_LENGTH = 4096;
const MAX_INPUT_KEYS = 128;
const MAX_ACTION_JSON_LENGTH = 16_384;
const MAX_COORDINATE = 1_000;
const MAX_POPULATION_VALUE = 100_000;
const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

/** Keep transport inputs within the pre-existing Browser Bridge structural limits. */
export function isBoundedJson(value: unknown, depth = 0, seen = new WeakSet<object>()): value is JsonValue {
  if (depth > MAX_INPUT_DEPTH) return false;
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value) && Math.abs(value) <= MAX_POPULATION_VALUE;
  if (typeof value === 'string') return value.length <= MAX_INPUT_STRING_LENGTH;
  if (!isPlainObject(value) && !Array.isArray(value)) return false;
  if (seen.has(value)) return false;
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.length <= MAX_INPUT_ARRAY_LENGTH && value.every((item) => isBoundedJson(item, depth + 1, seen));
    const entries = Object.entries(value);
    return entries.length <= MAX_INPUT_KEYS && entries.every(([key, item]) => key.length <= MAX_INPUT_STRING_LENGTH && isBoundedJson(item, depth + 1, seen));
  } catch {
    return false;
  } finally {
    seen.delete(value);
  }
}

function jsonLength(value: unknown): number | null {
  try {
    if (!isBoundedJson(value)) return null;
    const serialized = JSON.stringify(value);
    return typeof serialized === 'string' ? serialized.length : null;
  } catch {
    return null;
  }
}

export function hasOnlyKeys(value: Record<string, unknown>, required: readonly string[], optional: readonly string[] = []): boolean {
  const allowed = new Set([...required, ...optional]);
  return required.every((key) => Object.prototype.hasOwnProperty.call(value, key))
    && Object.keys(value).every((key) => allowed.has(key));
}

export function isSafeId(value: unknown): value is string {
  return typeof value === 'string' && SAFE_ID_PATTERN.test(value);
}

function isCoordinate(value: unknown): value is { q: number; r: number } {
  return isPlainObject(value)
    && hasOnlyKeys(value, ['q', 'r'])
    && typeof value.q === 'number' && Number.isSafeInteger(value.q) && Math.abs(value.q) <= MAX_COORDINATE
    && typeof value.r === 'number' && Number.isSafeInteger(value.r) && Math.abs(value.r) <= MAX_COORDINATE;
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= MAX_POPULATION_VALUE;
}

/** Structural validation is intentionally separate from AgentGame legality validation. */
export function isGameActionInput(value: unknown): value is GameAction {
  if (!isPlainObject(value) || jsonLength(value) === null || jsonLength(value)! > MAX_ACTION_JSON_LENGTH) return false;
  try {
    switch (value.type) {
      case 'TakeOff':
      case 'Land': return hasOnlyKeys(value,['type','unitId']) && isSafeId(value.unitId);
      case 'BoardAircraft': return hasOnlyKeys(value,['type','unitId','aircraftId']) && isSafeId(value.unitId) && isSafeId(value.aircraftId);
      case 'DisembarkAircraft': return hasOnlyKeys(value,['type','aircraftId','destination']) && isSafeId(value.aircraftId) && isCoordinate(value.destination);
      case 'LaunchMilitaryDrone': return hasOnlyKeys(value,['type','facilityId','target']) && isSafeId(value.facilityId) && isCoordinate(value.target);
      case 'Move':
        return hasOnlyKeys(value, ['type', 'unitId', 'destination']) && isSafeId(value.unitId) && isCoordinate(value.destination);
      case 'AttackHex':
        return hasOnlyKeys(value, ['type','attackerId','position']) && isSafeId(value.attackerId) && isCoordinate(value.position);
      case 'ChangeUnitMode':
        return hasOnlyKeys(value, ['type','unitId','mode']) && isSafeId(value.unitId) && (value.mode === 'packed' || value.mode === 'deployed');
      case 'Attack':
        return hasOnlyKeys(value, ['type', 'attackerId', 'targetId']) && isSafeId(value.attackerId) && isSafeId(value.targetId);
      case 'Wait':
        return hasOnlyKeys(value, ['type', 'unitId']) && isSafeId(value.unitId);
      case 'AssignWorkers':
        return hasOnlyKeys(value, ['type', 'facilityId', 'workers']) && isSafeId(value.facilityId) && isNonNegativeSafeInteger(value.workers);
      case 'TransferPopulation':
        return hasOnlyKeys(value, ['type', 'fromFacilityId', 'toFacilityId', 'people'])
          && isSafeId(value.fromFacilityId) && isSafeId(value.toFacilityId) && isNonNegativeSafeInteger(value.people);
      case 'SetCheckpointPolicy':
        return hasOnlyKeys(value, ['type', 'branchId', 'policy']) && isSafeId(value.branchId)
          && (value.policy === 'passThrough' || value.policy === 'normal' || value.policy === 'strict' || value.policy === 'deny');
      case 'SetPowerSupply':
        return hasOnlyKeys(value, ['type', 'facilityId', 'enabled']) && isSafeId(value.facilityId) && typeof value.enabled === 'boolean';
      case 'BuildBarbedWire':
        return hasOnlyKeys(value, ['type', 'position']) && isCoordinate(value.position);
      case 'BuildCheckpoint':
        return hasOnlyKeys(value, ['type', 'position'], ['branchId']) && isCoordinate(value.position)
          && (value.branchId === undefined || isSafeId(value.branchId));
      case 'BuildConstructibleFacility':
        return hasOnlyKeys(value, ['type', 'facilityType', 'position'])
          && (value.facilityType === 'simpleFarm' || value.facilityType === 'civilianDroneBase' || value.facilityType === 'temporaryHousing' || value.facilityType === 'windPowerPlant')
          && isCoordinate(value.position);
      case 'DecommissionConstructibleFacility':
        return hasOnlyKeys(value, ['type', 'facilityId']) && isSafeId(value.facilityId);
      case 'RelocateCheckpoint':
        return hasOnlyKeys(value, ['type', 'checkpointId', 'position'], ['branchId'])
          && isSafeId(value.checkpointId) && isCoordinate(value.position)
          && (value.branchId === undefined || isSafeId(value.branchId));
      case 'ActivateCheckpoint':
        return hasOnlyKeys(value, ['type', 'branchId', 'checkpointId']) && isSafeId(value.branchId) && isSafeId(value.checkpointId);
      case 'TurnAwayCheckpointRefugees':
        return hasOnlyKeys(value, ['type', 'checkpointId', 'count']) && isSafeId(value.checkpointId)
          && isNonNegativeSafeInteger(value.count) && value.count >= 1;
      case 'ProduceUnit':
        return hasOnlyKeys(value, ['type', 'unitType'], ['destination'])
          && (value.unitType === 'police' || value.unitType === 'nationalGuard' || value.unitType === 'riotPolice' || value.unitType === 'reconTeam' || value.unitType === 'fieldArtillery' || value.unitType === 'specialForces' || value.unitType === 'multipurposeHelicopter')
          && (value.destination === undefined || isCoordinate(value.destination));
      case 'EndTurn':
        return hasOnlyKeys(value, ['type']);
      default:
        return false;
    }
  } catch {
    return false;
  }
}
