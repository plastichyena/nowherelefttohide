import type { AgentObservation, AgentPublicEvent } from './types';
import { facilityChanges } from './facility-changes';

export interface ImportantChange {
  id: string;
  severity: 'critical' | 'warning' | 'advisory';
  category: string;
  entityIds: string[];
  reasonCodes: string[];
  relatedEventIds: string[];
  relatedEventTypes: string[];
  consequences: string[];
}
export interface ChangeDecision { decision: number; changes: readonly ImportantChange[] }
const severity = { critical: 0, warning: 1, advisory: 2 };

/** Interpretation of committed public facts only; no Store or transport dependency. */
export function deriveImportantChanges(before: AgentObservation, after: AgentObservation, events: readonly AgentPublicEvent[]): ImportantChange[] {
  const changes: ImportantChange[] = [];
  const add = (id: string, category: string, level: ImportantChange['severity'], entityIds: string[], reasonCodes: string[], consequences: string[] = []) => {
    const related = events.filter(e => Object.values(e.payload).some(v => typeof v === 'string' && entityIds.includes(v)));
    changes.push({ id, category, severity: level, entityIds, reasonCodes: [...new Set(reasonCodes)].sort(), consequences,
      relatedEventIds: related.map(e => e.id), relatedEventTypes: [...new Set(related.map(e => e.type))].sort() });
  };
  for (const change of facilityChanges(before, after, events)) {
    const old = before.facilities.find(f => f.id === change.facilityId);
    const current = after.facilities.find(f => f.id === change.facilityId);
    const lost = old?.owner === 'player' && (!current || current.owner !== 'player' || (old.status !== 'ruined' && current.status === 'ruined'));
    const reasons = [...change.reasons];
    const consequences: string[] = [];
    if (lost) {
      reasons.push('player_facility_lost');
      for (const [resource, forecast] of Object.entries(before.strategicForecast.resources)) {
        if (forecast.contributors.some(c => c.facilityId === change.facilityId)) {
          reasons.push(resource === 'electricity' ? 'power_source_lost' : 'production_lost');
          consequences.push(`${resource}:source_lost`);
        }
      }
    }
    add(`facility:${change.facilityId}`, 'facility', lost ? 'critical' : current && current.infectedPopulation > (old?.infectedPopulation ?? 0) ? 'warning' : 'advisory', [change.facilityId], reasons, consequences);
  }
  for (const old of before.units) {
    const current = after.units.find(u => u.id === old.id);
    if (!current) add(`unit:${old.id}`, 'unit', 'critical', [old.id], ['player_unit_lost']);
    else if (current.hp < old.hp || current.inSupply !== old.inSupply) add(`unit:${old.id}`, 'unit', 'warning', [old.id], [ ...(current.hp < old.hp ? ['unit_damaged'] : []), ...(current.inSupply !== old.inSupply ? [current.inSupply ? 'supply_restored' : 'supply_lost'] : []) ]);
  }
  for (const current of after.checkpoints) {
    const old = before.checkpoints.find(c => c.id === current.id);
    const reasons = [...(old?.role !== current.role ? ['checkpoint_role_changed'] : []), ...(current.infected > (old?.infected ?? 0) ? ['checkpoint_infected'] : [])];
    if (reasons.length) add(`checkpoint:${current.id}`, 'checkpoint', current.status === 'ruined' ? 'critical' : 'warning', [current.id], reasons);
  }
  for (const enemy of after.zombies) if (!before.zombies.some(z => z.id === enemy.id)) add(`enemy:${enemy.id}`, 'enemy', 'warning', [enemy.id], ['enemy_spotted']);
  return changes.sort((a, b) => a.id.localeCompare(b.id));
}

export function summarizeImportantChanges(records: Iterable<ChangeDecision>, fromDecision: number, toDecision: number, revision: number) {
  let totalCount = 0;
  let items: Array<ImportantChange & { decision: number }> = [];
  for (const record of records) {
    totalCount += record.changes.length;
    items.push(...record.changes.map(change => ({ ...change, decision: record.decision })));
    items.sort((a, b) => severity[a.severity] - severity[b.severity] || b.decision - a.decision || a.id.localeCompare(b.id));
    items = items.slice(0, 10);
  }
  const detailQuery = { target: 'history', expectedRevision: revision, filters: { fromDecision, toDecision } };
  return { items: items.map(item => {
    const { entityIds, reasonCodes, relatedEventIds, relatedEventTypes, consequences, ...rest } = item;
    const arrays = { entityIds, reasonCodes, relatedEventIds, relatedEventTypes, consequences };
    return { ...rest, ...Object.fromEntries(Object.entries(arrays).map(([key, value]) => [key, value.slice(0, 10)])),
      totals: Object.fromEntries(Object.entries(arrays).map(([key, value]) => [key, { totalCount: value.length, omittedCount: Math.max(0, value.length - 10) }])), detailQuery };
  }), totalCount, omittedCount: Math.max(0, totalCount - 10), range: { fromDecision, toDecision, fromRevision: fromDecision, toRevision: toDecision }, detailQuery };
}

/** Summarizes the same legal public gas previews returned by query units. */
export function deriveCombatHazards(observation: Pick<AgentObservation, 'units' | 'facilities' | 'checkpoints'>, revision: number) {
  const entries = observation.units.flatMap(unit => unit.attackPreviews.flatMap(preview => {
    const gas = preview.gasExplosion;
    if (!gas) return [];
    const victims = [
      ...gas.units.filter(u => u.side === 'player' && u.lethal).map(u => ({ entityId: u.unitId, outcome: 'unit_death' })),
      ...gas.sites.filter(s => s.falls && (s.kind === 'facility' ? observation.facilities.some(f => f.id === s.siteId && f.owner === 'player') : observation.checkpoints.some(c => c.id === s.siteId))).map(s => ({ entityId: s.siteId, outcome: 'site_fall' })),
    ].sort((a, b) => a.entityId.localeCompare(b.entityId));
    return victims.length ? [{ attackerId: unit.id, targetId: preview.targetUnitId, victims: victims.slice(0, 10), totalVictimCount: victims.length, omittedVictimCount: Math.max(0, victims.length - 10), reason: 'lethal_gas_chain', detailQuery: { target: 'units', expectedRevision: revision, filters: { id: unit.id } } }] : [];
  })).sort((a, b) => a.attackerId.localeCompare(b.attackerId) || a.targetId.localeCompare(b.targetId));
  return { items: entries.slice(0, 5), totalCount: entries.length, omittedCount: Math.max(0, entries.length - 5), detailQuery: { target: 'units', expectedRevision: revision } };
}
