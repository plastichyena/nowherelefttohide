import type { AgentObservation, AgentPublicEvent } from './types';

/** Queue deltas are changes between committed revisions, separate from arrivals. */
export function branchFlowChanges(before: AgentObservation, after: AgentObservation) {
  return after.roadBranches.flatMap(branch => {
    const old = before.roadBranches.find(b => b.branchId === branch.branchId);
    if (!old || JSON.stringify(old.currentQueue) === JSON.stringify(branch.currentQueue)) return [];
    return [{ branchId: branch.branchId, turn: after.turn, before: old.currentQueue ?? { waiting: 0, screening: 0, approved: 0, infected: 0 }, after: branch.currentQueue ?? { waiting: 0, screening: 0, approved: 0, infected: 0 } }];
  });
}

/** Only compares two committed public snapshots. No history is invented by status/new. */
export function facilityChanges(before: AgentObservation, after: AgentObservation, events: readonly AgentPublicEvent[]) {
  const prior = new Map(before.facilities.map(f => [f.id, f]));
  const changes = after.facilities.flatMap(f => {
    const old = prior.get(f.id);
    if (!old) return [{ facilityId: f.id, reasons: ['newly_public'], evidence: 'public_state' as const, events: [] as string[] }];
    const reasons: string[] = [];
    if (old.owner !== f.owner) reasons.push('ownership_changed');
    if (old.status !== f.status) reasons.push(f.status === 'ruined' ? 'ruined' : 'secured');
    if (old.operationalStatus !== f.operationalStatus) reasons.push(`operation_${f.operationalStatus}`);
    if (old.healthyPopulation !== f.healthyPopulation || old.infectedPopulation !== f.infectedPopulation) reasons.push('population_changed');
    if (old.production.stoppedReason !== f.production.stoppedReason) reasons.push(f.production.stoppedReason ?? 'production_resumed');
    if (old.production.projectedPowerReason !== f.production.projectedPowerReason) reasons.push(`power_${f.production.projectedPowerReason}`);
    const matching = events.filter(e => e.payload.facilityId === f.id || e.payload.siteId === f.id).map(e => e.type);
    return reasons.length ? [{ facilityId: f.id, reasons, evidence: 'public_state' as const, events: matching }] : [];
  });
  for (const old of before.facilities) {
    if (after.facilities.some(f => f.id === old.id)) continue;
    const matching = events.filter(e => e.payload.facilityId === old.id || e.payload.siteId === old.id).map(e => e.type);
    changes.push({ facilityId: old.id, reasons: ['no_longer_public'], evidence: 'public_state', events: matching });
  }
  return changes;
}
