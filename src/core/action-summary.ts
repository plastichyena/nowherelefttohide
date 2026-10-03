import { SUMMARY_SCHEMA_VERSION } from './versions';
import type { CoreActionPreview } from './action-preview';
import type { GameAction, HexCoord, JsonValue, ResourceType } from './types';
import type { AgentObservation, AgentPublicEvent } from '../agent/types';

export const ACTION_SUMMARY_SCHEMA = { version: SUMMARY_SCHEMA_VERSION, eventLimit: 12, changeLimit: 12,
  phases: ['prediction', 'result'], unknown: null,
  detailQueries: ['units', 'facilities', 'history', 'full-snapshot'],
} as const;

export interface ActionSummary {
  schemaVersion: typeof ACTION_SUMMARY_SCHEMA.version;
  phase: 'prediction' | 'result'; actionType: GameAction['type'];
  baseRevision: number; resultRevision: number | null;
  legal: boolean | null; accepted: boolean | null; reasonCode: string | null;
  remainingAttackCharges: number | null;
  combat?: JsonValue;
  targetIds: string[]; target: HexCoord | null;
  movement: { predictedPosition: HexCoord | null; actualPosition: HexCoord | null;
    destinationReached: boolean | null; interruptionReason: string | null;
    remainingHp: number | null; remainingFuel: number | null; remainingAttackCharges: number | null; overruns: JsonValue[]; overrunCount: number; overrunsOmitted: number; destroyed: boolean | null } | null;
  resources: Partial<Record<ResourceType, number>>;
  populationMovementCount: number; populationMovementsOmitted: number;
  populationMovements: JsonValue[]; production: JsonValue | null; construction: JsonValue | null;
  turn: { before: number | null; after: number | null }; outcome: JsonValue | null;
  changes: { items: JsonValue[]; total: number; omitted: number };
  detailQueries: JsonValue[];
}

const copy = <T>(value: T): T => structuredClone(value);
function identity(action: GameAction) {
  const fields = action as unknown as Record<string, unknown>;
  return { targetIds: [...new Set(Object.entries(fields).filter(([k,v]) => k.endsWith('Id') && typeof v === 'string').map(([,v]) => v as string))].sort(),
    target: copy(('destination' in action ? action.destination : 'position' in action ? action.position : 'target' in action ? action.target : null) ?? null) };
}
function actorId(action: GameAction) { return 'unitId' in action ? action.unitId : 'attackerId' in action ? action.attackerId : null; }
function bounded(items: JsonValue[], limit = ACTION_SUMMARY_SCHEMA.changeLimit) { return { items: items.slice(0,limit), total: items.length, omitted: Math.max(0,items.length-limit) }; }
function detailQueries(revision: number, ids: string[]): JsonValue[] {
  return [{ target: 'history', filters: { fromDecision: revision, toDecision: revision } }, ...ids.flatMap(id => [{ target: 'units', filters: { id } }, { target: 'facilities', filters: { id } }])];
}

/** Input consists exclusively of already-public projections. Missing values stay unknown. */
export function summarizePreview(preview: Omit<CoreActionPreview, 'summary'>, turn: number, charges: number | null = null): ActionSummary {
  const { action, legal } = preview, id = identity(action), move = preview.movement;
  return { schemaVersion: ACTION_SUMMARY_SCHEMA.version, phase: 'prediction', actionType: action.type,
    baseRevision: preview.baseRevision, resultRevision: null, legal, accepted: null, reasonCode: preview.reasonCode,
    ...(preview.combat ? {combat: copy(preview.combat) as unknown as JsonValue} : {}),
    ...id, remainingAttackCharges: move?.interception ? null : charges, movement: action.type === 'Move' ? { predictedPosition: legal ? copy(move?.reached ?? null) : null, actualPosition: null,
      destinationReached: legal ? move?.destinationReached ?? null : false,
      interruptionReason: !legal ? preview.reasonCode : move?.destinationReached === false ? move.arrivalReason ?? 'unknown' : null,
      remainingHp: move?.projectedHpAfterMove ?? null, remainingFuel: move?.projectedFuelAfterMove ?? null,
      remainingAttackCharges: move?.interception ? null : charges, overruns: copy((move?.overruns ?? []).slice(0,ACTION_SUMMARY_SCHEMA.eventLimit)) as unknown as JsonValue[], overrunCount: move?.overruns?.length ?? 0, overrunsOmitted: Math.max(0,(move?.overruns?.length ?? 0)-ACTION_SUMMARY_SCHEMA.eventLimit), destroyed: legal && move?.projectedHpAfterMove !== undefined ? move.projectedHpAfterMove === 0 : null } : null,
    resources: legal ? copy(preview.immediate.resourceDelta) : {},
    populationMovementCount: preview.populationMovements.length, populationMovementsOmitted: Math.max(0,preview.populationMovements.length-12),
    populationMovements: copy(preview.populationMovements.slice(0,12)) as unknown as JsonValue[],
    production: preview.production ? { ...copy(preview.production), result: legal ? 'reservation_predicted' : 'not_reserved' } : null,
    construction: ['BuildCheckpoint','RelocateCheckpoint','ActivateCheckpoint','BuildBarbedWire','BuildConstructibleFacility','DecommissionConstructibleFacility'].includes(action.type)
      ? { status: legal ? 'predicted' : 'rejected', completionTurn: preview.completionTurn, target: id.target, costs: copy(preview.immediate.resourceDelta) } : null,
    turn: { before: turn, after: legal && action.type === 'EndTurn' ? turn + 1 : turn }, outcome: null,
    changes: bounded(action.type === 'EndTurn' ? [{ forecast: Object.fromEntries(Object.entries(preview.nextEndTurn.after).filter(([k]) => ['food','civilianGoods','militaryGoods','fuel','populationLoss','guaranteedDefeat'].includes(k))) as JsonValue, uncertain: [...preview.uncertain] }] : copy(preview.facilityResidentDeltas) as unknown as JsonValue[]),
    detailQueries: detailQueries(preview.baseRevision, id.targetIds),
  };
}

export function summarizeActionResult(action: GameAction, before: AgentObservation, after: AgentObservation,
  events: readonly AgentPublicEvent[], error: {code:string} | null, baseRevision: number, resultRevision: number): ActionSummary {
  const id = identity(action), accepted = error === null, actor = actorId(action);
  const unit = after.units.find(u => u.id === actor);
  const destroyed = !!actor && events.some(e => e.type === 'unit_destroyed' && e.payload.unitId === actor);
  const targetReached = action.type === 'Move' && unit ? unit.position.q === action.destination.q && unit.position.r === action.destination.r : false;
  const stop = events.find(e => e.type === 'unit_movement_stopped' && e.payload.unitId === actor);
  const interruption = !accepted ? error.code : destroyed ? 'unit_destroyed' : !targetReached ? String(stop?.payload.reason ?? (unit?.currentFuel === 0 ? 'fuel_exhausted' : 'movement_interrupted')) : null;
  const resources = Object.fromEntries((['food','civilianGoods','militaryGoods','fuel'] as const).map(k => [k, after.resources[k] - before.resources[k]]));
  const populationMovements = events.filter(e => ['workers_assigned','population_transferred','population_conscripted'].includes(e.type)).map(e => ({eventId:e.id,...copy(e.payload)}));
  const important = new Set(['game_over','unit_overrun','unit_destroyed','unit_movement_stopped','unit_commissioned','facility_recovered','site_fallen','site_chain_fallen','checkpoint_recovered','infection_suppressed','population_transferred','workers_assigned','population_conscripted']);
  const changes = [...events].sort((a,b)=>Number(important.has(b.type))-Number(important.has(a.type))).map(e => ({ eventId: e.id, turn: e.turn, type: e.type, ...Object.fromEntries(Object.entries(e.payload).filter(([key, value]) => (key.endsWith('Id') || ['q','r','people','amount','reason','unitType','impactDamage'].includes(key)) && (value === null || typeof value !== 'object'))) })) as JsonValue[];
  const overrunEvents = events.filter(e => e.type === 'unit_overrun' && e.payload.unitId === actor);
  const productionEvents = events.filter(e => ['population_conscripted','unit_produced','unit_production_started','unit_commissioned','production_completed','production_forfeited'].includes(e.type));
  return { schemaVersion: ACTION_SUMMARY_SCHEMA.version, phase: 'result', actionType: action.type,
    baseRevision, resultRevision, legal: accepted, accepted, reasonCode: error?.code ?? null, ...id, remainingAttackCharges: unit?.attackChargesRemaining ?? null,
    movement: action.type === 'Move' ? { predictedPosition: null, actualPosition: unit ? copy(unit.position) : null,
      destinationReached: accepted && targetReached, interruptionReason: interruption,
      remainingHp: unit?.hp ?? null, remainingFuel: unit?.currentFuel ?? null,
      remainingAttackCharges: unit?.attackChargesRemaining ?? null,
      overruns: overrunEvents.slice(0,ACTION_SUMMARY_SCHEMA.eventLimit).map(e => ({eventId:e.id,...copy(e.payload)})), overrunCount: overrunEvents.length, overrunsOmitted: Math.max(0,overrunEvents.length-ACTION_SUMMARY_SCHEMA.eventLimit), destroyed } : null,
    resources, populationMovementCount: populationMovements.length, populationMovementsOmitted: Math.max(0,populationMovements.length-12), populationMovements: populationMovements.slice(0,ACTION_SUMMARY_SCHEMA.changeLimit),
    production: action.type === 'ProduceUnit' ? { unitType: action.unitType, status: accepted ? 'reserved' : 'rejected', costs: resources, events: productionEvents.slice(0,12) as unknown as JsonValue[], total: productionEvents.length, omitted: Math.max(0,productionEvents.length-12) } : productionEvents.length ? { events: productionEvents.slice(0,12) as unknown as JsonValue[], total: productionEvents.length, omitted: Math.max(0,productionEvents.length-12) } : null,
    construction: ['BuildCheckpoint','RelocateCheckpoint','ActivateCheckpoint','BuildBarbedWire','BuildConstructibleFacility','DecommissionConstructibleFacility'].includes(action.type)
      ? { status: accepted ? 'applied' : 'rejected', target: id.target, resourceDelta: resources } : null,
    turn: { before: before.turn, after: after.turn }, outcome: after.gameOver && after.result ? { outcome: after.result.outcome, reason: after.result.reason, turn: after.result.turn } : null,
    changes: bounded(changes), detailQueries: detailQueries(resultRevision,id.targetIds),
  };
}
