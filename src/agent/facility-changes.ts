import type { AgentObservation, AgentPublicEvent } from './types';

export interface FacilityPopulationChange {
  facilityId: string;
  healthyPopulation: { before: number; after: number; delta: number; unintendedDelta: number };
  infectedPopulation: { before: number; after: number };
  outputs: Record<string, { before: number; after: number; delta: number }> | null;
  outputReason: 'not_producing' | 'public_projection_unavailable' | null;
  eventTypes: string[];
}

function intentionalPopulationDelta(id: string, events: readonly AgentPublicEvent[]): number {
  let delta = 0;
  for (const event of events) {
    const p = event.payload;
    if (event.type === 'population_transferred' && p.reason === 'city_transfer') {
      if (p.from === id) delta -= Number(p.people);
      if (p.to === id) delta += Number(p.people);
    }
    if (event.type === 'workers_assigned') {
      if (p.facilityId === id) delta += Number(p.difference);
      if (Array.isArray(p.movements)) for (const move of p.movements) {
        if (move && typeof move === 'object' && !Array.isArray(move) && move.facilityId === id) delta -= Math.sign(Number(p.difference)) * Number(move.people);
      }
    }
    if (event.type === 'population_conscripted' && Array.isArray(p.sources)) {
      for (const source of p.sources) {
        if (source && typeof source === 'object' && !Array.isArray(source) && source.facilityId === id) delta -= Number(source.people);
      }
    }
  }
  return delta;
}

/** Queue deltas are changes between committed revisions, separate from arrivals. */
export function branchFlowChanges(before: AgentObservation, after: AgentObservation) {
  return after.roadBranches.flatMap(branch => {
    const old = before.roadBranches.find(b => b.branchId === branch.branchId);
    if (!old || JSON.stringify(old.currentQueue) === JSON.stringify(branch.currentQueue)) return [];
    return [{ branchId: branch.branchId, turn: after.turn, before: old.currentQueue ?? { waiting: 0, screening: 0, approved: 0, infected: 0 }, after: branch.currentQueue ?? { waiting: 0, screening: 0, approved: 0, infected: 0 } }];
  });
}

/** Only compares two committed public snapshots. No history is invented by status/new. */
export function facilityChanges(before: AgentObservation, after: AgentObservation, events: readonly AgentPublicEvent[]): Array<{
  facilityId: string; reasons: string[]; evidence: 'public_state'; events: string[]; populationLoss?: FacilityPopulationChange;
}> {
  const prior = new Map(before.facilities.map(f => [f.id, f]));
  const changes: ReturnType<typeof facilityChanges> = after.facilities.flatMap(f => {
    const old = prior.get(f.id);
    if (!old) return [{ facilityId: f.id, reasons: ['newly_public'], evidence: 'public_state' as const, events: [] as string[] }];
    const reasons: string[] = [];
    const healthyDelta = f.healthyPopulation - old.healthyPopulation;
    const intentionalDelta = intentionalPopulationDelta(f.id, events);
    const unintendedDelta = healthyDelta - intentionalDelta;
    if (healthyDelta < 0 && unintendedDelta >= 0 && intentionalDelta < 0
      && old.owner === f.owner && old.status === f.status && old.infectedPopulation === f.infectedPopulation) return [];
    if (old.owner !== f.owner) reasons.push('ownership_changed');
    if (old.status !== f.status) reasons.push(f.status === 'ruined' ? 'ruined' : 'secured');
    if (old.operationalStatus !== f.operationalStatus) reasons.push(`operation_${f.operationalStatus}`);
    if (old.healthyPopulation !== f.healthyPopulation || old.infectedPopulation !== f.infectedPopulation) reasons.push('population_changed');
    if (old.production.stoppedReason !== f.production.stoppedReason) reasons.push(f.production.stoppedReason ?? 'production_resumed');
    if (old.production.projectedPowerReason !== f.production.projectedPowerReason) reasons.push(`power_${f.production.projectedPowerReason}`);
    const matching = events.filter(e => e.payload.facilityId === f.id || e.payload.siteId === f.id).map(e => e.type);
    let populationLoss: FacilityPopulationChange | undefined;
    if (old.owner === 'player' && f.owner === 'player' && unintendedDelta < 0) {
      reasons.push('healthy_population_lost');
      const previous = old.production.projectedProduction;
      const current = f.production.projectedProduction;
      const outputs: NonNullable<FacilityPopulationChange['outputs']> = {};
      for (const resource of new Set([...Object.keys(previous), ...Object.keys(current)])) {
        const a = Number(previous[resource as keyof typeof previous] ?? 0);
        const b = Number(current[resource as keyof typeof current] ?? 0);
        outputs[resource] = { before: a, after: b, delta: b - a };
      }
      if (old.production.estimatedPowerGeneration || f.production.estimatedPowerGeneration) {
        outputs.electricity = { before: old.production.estimatedPowerGeneration, after: f.production.estimatedPowerGeneration,
          delta: f.production.estimatedPowerGeneration - old.production.estimatedPowerGeneration };
      }
      populationLoss = { facilityId: f.id,
        healthyPopulation: { before: old.healthyPopulation, after: f.healthyPopulation, delta: healthyDelta, unintendedDelta },
        infectedPopulation: { before: old.infectedPopulation, after: f.infectedPopulation },
        outputs: Object.keys(outputs).length ? outputs : null, outputReason: Object.keys(outputs).length ? null : 'not_producing', eventTypes: matching };
    }
    return reasons.length ? [{ facilityId: f.id, reasons, evidence: 'public_state' as const, events: matching, ...(populationLoss ? { populationLoss } : {}) }] : [];
  });
  for (const old of before.facilities) {
    if (after.facilities.some(f => f.id === old.id)) continue;
    const matching = events.filter(e => e.payload.facilityId === old.id || e.payload.siteId === old.id).map(e => e.type);
    changes.push({ facilityId: old.id, reasons: ['no_longer_public'], evidence: 'public_state', events: matching });
  }
  return changes;
}
