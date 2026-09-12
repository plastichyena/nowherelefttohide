import { expect, it } from 'vitest';
import { createInitialState, createUnit } from '../core/state';
import { createDefaultConfig } from '../core/config';
import { createAgentObservation } from './observation';
import { deriveCombatHazards, deriveImportantChanges, summarizeImportantChanges } from './decision-summary';
import { QUERY_FILTER_SCHEMAS, publicQueryContract, validateQuerySchema } from './query-contract';
import { GameEngine } from '../core/engine';

it('reports actual forward expansion and rear standby coverage from accepted Core actions', () => {
  const engine = new GameEngine(1, createDefaultConfig({ vision: { capital: 50 } }));
  const initial = engine.getState();
  const state = { ...initial, units: initial.units.filter(u => u.isPlayerUnit) };
  expect(engine.step({ type: 'LoadSnapshot', snapshot: state }).error).toBeNull();
  const before = createAgentObservation(engine.getState());
  const built = engine.step({ type: 'BuildCheckpoint', branchId: 'east', position: { q: 31, r: 25 } });
  expect(built.error).toBeNull();
  const after = createAgentObservation(engine.getState());
  expect(after.facilities.find(f => f.id === 'army-base-1')?.inSupply).toBe(true);
  expect(deriveImportantChanges(before, after, []).find(c => c.category === 'checkpoint')?.consequences).toEqual(expect.arrayContaining(['branch_supply_radius:5->6', 'newly_supplied_facilities:1']));
  expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
  const beforeRear = createAgentObservation(engine.getState());
  expect(engine.step({ type: 'BuildCheckpoint', branchId: 'east', position: { q: 30, r: 25 } }).error).toBeNull();
  const rear = createAgentObservation(engine.getState());
  expect(rear.checkpoints.find(c => c.role === 'standby')?.providesSupply).toBe(false);
  expect(deriveImportantChanges(beforeRear, rear, []).find(c => c.category === 'checkpoint')?.consequences).toEqual(expect.arrayContaining(['branch_supply_radius:6->6', 'newly_supplied_facilities:0', 'supply_coverage_unchanged']));
  expect(engine.step({ type: 'EndTurn' }).error).toBeNull();
  const beforeMove = createAgentObservation(engine.getState());
  const candidate = beforeMove.checkpointPositionCandidates.find(c => c.actionType === 'RelocateCheckpoint' && c.branchId === 'east' && c.legal && c.projectedBranchRadius === 7)!;
  expect(candidate).toBeDefined();
  expect(engine.step({ type: 'RelocateCheckpoint', branchId: 'east', checkpointId: candidate.checkpointId!, position: candidate.position }).error).toBeNull();
  const afterMove = createAgentObservation(engine.getState());
  expect(deriveImportantChanges(beforeMove, afterMove, [])).toEqual(expect.arrayContaining([
    expect.objectContaining({ category: 'checkpoint', consequences: expect.arrayContaining(['branch_supply_radius:6->7']) }),
  ]));
  expect(afterMove.supply.branchRadii.find(b => b.branchId === 'east')?.radius).toBe(7);
});

it('links public factory and power losses to production and keeps losses separate from recovery decisions', () => {
  const state = createInitialState(1, createDefaultConfig());
  const before = createAgentObservation(state);
  const factory = before.facilities.find(f => before.strategicForecast.resources.civilianGoods.contributors.some(c => c.facilityId === f.id))!;
  expect(factory).toBeDefined();
  const after = structuredClone(before);
  const lost = after.facilities.find(f => f.id === factory.id)!;
  lost.owner = 'none'; lost.status = 'ruined';
  const changes = deriveImportantChanges(before, after, []);
  expect(changes.find(c => c.entityIds.includes(factory.id))).toMatchObject({ severity: 'critical', reasonCodes: expect.arrayContaining(['production_lost', 'player_facility_lost']) });
  const restored = deriveImportantChanges(after, before, []);
  const packet = summarizeImportantChanges([{ decision: 1, changes }, { decision: 2, changes: restored }], 1, 2, 2);
  expect(packet.totalCount).toBe(changes.length + restored.length);
  expect(packet.items.some(c => c.decision === 1)).toBe(true);
  expect(packet.items.some(c => c.decision === 2)).toBe(true);
});

it('bounds summary entries and each array with stable ordering and complete detail counts', () => {
  const changes = Array.from({ length: 14 }, (_, i) => ({ id: String(i).padStart(2, '0'), category: 'test', severity: 'warning' as const, entityIds: Array.from({ length: 12 }, (_, j) => `entity-${j}`), reasonCodes: ['test'], relatedEventIds: [], relatedEventTypes: [], consequences: [] }));
  const packet = summarizeImportantChanges([{ decision: 5, changes }, { decision: 6, changes: changes.slice(0, 1) }], 5, 6, 6);
  expect(packet.items).toHaveLength(10);
  expect(packet.totalCount).toBe(15); expect(packet.omittedCount).toBe(5);
  expect(packet.items[0].decision).toBe(6);
  expect(packet.items[0].totals.entityIds).toEqual({ totalCount: 12, omittedCount: 2 });
  expect(packet.detailQuery).toEqual({ target: 'history', expectedRevision: 6, filters: { fromDecision: 5, toDecision: 6 } });
});

it('reports real legal lethal gas previews and is unchanged by hidden enemies', () => {
  const state = createInitialState(1, createDefaultConfig());
  const human = state.units.find(u => u.type === 'police')!;
  human.position = { q: 25, r: 25 }; human.hp = 1;
  const gas = createUnit(state, 'gas-visible', 'gasZombie', { q: 26, r: 25 }); gas.hp = 1;
  state.units.push(gas);
  const before = createAgentObservation(state);
  const hazard = deriveCombatHazards(before, 0);
  expect(hazard.items).toEqual(expect.arrayContaining([expect.objectContaining({ attackerId: human.id, targetId: gas.id, victims: expect.arrayContaining([{ entityId: human.id, outcome: 'unit_death' }]) })]));
  state.units.push(createUnit(state, 'gas-hidden', 'gasZombie', { q: 0, r: 0 }));
  expect(deriveCombatHazards(createAgentObservation(state), 0)).toEqual(hazard);
  const many = structuredClone(before);
  many.units = Array.from({ length: 7 }, (_, i) => ({ ...before.units.find(u => u.id === human.id)!, id: `attacker-${i}` }));
  const bounded = deriveCombatHazards(many, 2);
  expect(bounded.items).toHaveLength(5); expect(bounded.omittedCount).toBe(2);
});

it('validates from the same machine-readable schemas and rejects malformed envelopes', () => {
  expect(publicQueryContract().schemaVersion).toBe('2020-12');
  expect(validateQuerySchema({ id: 'police-1' }, QUERY_FILTER_SCHEMAS.units)).toEqual([]);
  expect(validateQuerySchema({ filters: { id: 'police-1' } }, QUERY_FILTER_SCHEMAS.units)).not.toEqual([]);
  expect(validateQuerySchema({ includeHexPath: true }, QUERY_FILTER_SCHEMAS.route)).not.toEqual([]);
  expect(validateQuerySchema({ destination: { kind: 'coordinate', position: { q: 2, r: 3 } }, ranges: { hexPath: { limit: 501 } } }, QUERY_FILTER_SCHEMAS.route)).not.toEqual([]);
  expect(validateQuerySchema({ source: { kind: 'facility', id: 'farm-1' }, destination: { kind: 'facility', id: 'capital' } }, QUERY_FILTER_SCHEMAS.route)).toEqual([]);
});
