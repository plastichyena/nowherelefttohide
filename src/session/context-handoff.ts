import { APP_VERSION, AGENT_API_VERSION, ARTIFACT_SCHEMA_VERSION } from '../agent/types';
import type { AgentObservation } from '../agent/types';
import type { GameAction, JsonValue } from '../core/types';

export const CONTEXT_HANDOFF_LIMITS = { facilities: 24, units: 24, visibleEnemies: 24, importantChanges: 20, recentIntent: 5, checkpoints: 8, maxCommentCodePoints: 500 } as const;
export interface HandoffDecision { decision: number; turn?: number; accepted: boolean; inputAction: GameAction; decisionSummary: string | null; importantChanges?: unknown[]; stateDelta?: { beforeTurn?: number; afterTurn?: number } }
export interface HandoffIdentity { sessionId: string; revision: number; preferredCommentLocale: 'ja' | 'en'; branchLineage: unknown }

/** Bounded facts accumulated from canonical Decisions, never from a previous handoff. */
export class ContextHandoffHistory {
  checkpointDecision = 0;
  checkpointReasons: string[] = [];
  completedTurns = 0;
  changesTotal = 0;
  latestEndTurn: { decision: number; summary: string } | null = null;
  changes: unknown[] = [];
  intent: Array<{ decision: number; summary: string }> = [];

  push(record: HandoffDecision): void {
    const endTurn = record.accepted && record.inputAction.type === 'EndTurn';
    const completed = endTurn && record.stateDelta?.afterTurn !== undefined && record.stateDelta.beforeTurn !== undefined && record.stateDelta.afterTurn > record.stateDelta.beforeTurn;
    if (completed) this.completedTurns += 1;
    const reasons = [...(completed && this.completedTurns % 5 === 0 ? ['five_completed_turns'] : []), ...(record.decision - this.checkpointDecision >= 128 ? ['128_decisions'] : [])];
    if (reasons.length) { this.checkpointDecision = record.decision; this.checkpointReasons = reasons; this.changes.length = 0; this.changesTotal = 0; }
    else if (record.accepted) for (const change of record.importantChanges ?? []) {
      this.changes.push(structuredClone(change));
      this.changesTotal++;
      if (this.changes.length > CONTEXT_HANDOFF_LIMITS.importantChanges) this.changes.shift();
    }
    const summary = record.decisionSummary?.trim();
    if (endTurn) this.latestEndTurn = { decision: record.decision, summary: Array.from(summary ?? '').slice(0,500).join('') };
    if (record.accepted && summary) {
      const text = Array.from(summary).slice(0,500).join('');
      const existing = this.intent.findIndex(i => i.summary === text); if (existing >= 0) this.intent.splice(existing,1);
      this.intent.push({ decision: record.decision, summary: text }); if (this.intent.length > CONTEXT_HANDOFF_LIMITS.recentIntent) this.intent.shift();
    }
  }
}

/** Bounded projection from current public truth; never re-summarizes a previous handoff. */
export function buildContextHandoff(observation: Omit<AgentObservation, 'map'>, identity: HandoffIdentity, history: Iterable<HandoffDecision>) {
  const facts = new ContextHandoffHistory();
  for (const record of history) {
    if (record.decision > identity.revision) break;
    facts.push(record);
  }
  return projectContextHandoff(observation, identity, facts);
}

export function projectContextHandoff(observation: Omit<AgentObservation, 'map'>, identity: HandoffIdentity, history: ContextHandoffHistory) {
  // Responses must not expose mutable references to the continuation cache.
  const { checkpointDecision, checkpointReasons, completedTurns, changesTotal, latestEndTurn, changes, intent } = structuredClone(history);
  const detailQuery = (target: string) => ({ target, expectedRevision: identity.revision, pageSize: 100, continuation: 'Use nextCursor returned by query; discard cursors after a committed Decision.' });
  const bounded = <T>(items: T[], limit: number, target: string) => ({ items: items.slice(0,limit), total: items.length, returned: Math.min(items.length,limit), omitted: Math.max(0,items.length-limit), detailQuery: detailQuery(target) });
  const alerts = new Map<string, { reasonCode: string; severity: string; alertCount: number; targetCount: number }>();
  for (const alert of observation.crisisSummary.alerts) {
    const key = `${alert.reasonCode}:${alert.severity}`;
    const group = alerts.get(key) ?? { reasonCode: alert.reasonCode, severity: alert.severity, alertCount: 0, targetCount: 0 };
    group.alertCount++; group.targetCount += alert.entityIds.length; alerts.set(key,group);
  }
  const health = observation.endTurnForecast.publicHealth;
  return structuredClone({
    schemaVersion: '1.0.0', sourceRevision: identity.revision, limits: CONTEXT_HANDOFF_LIMITS,
    durableConstraints: { ...identity, appVersion: APP_VERSION, gameRulesVersion: observation.gameRulesVersion, agentApiVersion: AGENT_API_VERSION, artifactSchemaVersion: ARTIFACT_SCHEMA_VERSION, fairPlay: true, publicInformationOnly: true, commentRequirement: 'Keep human-facing comments and decisionSummary in preferredCommentLocale for the whole Session. Record public intent only, never private reasoning.' },
    authoritativeState: {
      turn: observation.turn, phase: observation.phase, gameOver: observation.gameOver, result: observation.result,
      resources: observation.resources, population: observation.population, capital: observation.facilities.find(f => f.type === 'capital'),
      publicHealth: observation.publicHealth, nextEndTurnHealth: health ? { foodDeficit: health.foodDeficit, civilianGoodsDeficit: health.civilianGoodsDeficit, stressAfter: health.stressAfter, accumulationAfter: health.accumulationAfter, starvationRate: health.starvationRate, starvationLoss: health.starvation.loss, carryAfter: health.starvation.carryAfter, conditional: health.conditions } : null,
      nuclearObjective: observation.nuclearObjective, refineryAllowance: observation.refineryAllowance,
      horde: observation.horde, supply: { initialRadius: observation.supply.initialRadius, branchRadii: observation.supply.branchRadii, suppliedTileCount: observation.supply.suppliedTileKeys.length },
      crises: { groups: [...alerts.values()], total: observation.crisisSummary.alerts.length, detailQuery: detailQuery('full-snapshot') },
      imminentDefeat: observation.strategicForecast?.guaranteedDefeat,
      facilities: bounded(observation.facilities.map(f => ({ id: f.id, type: f.type, position: f.position, owner: f.owner, workers: f.healthyPopulation, infected: f.infectedPopulation, operationalStatus: f.operationalStatus, inSupply: f.inSupply })), CONTEXT_HANDOFF_LIMITS.facilities, 'facilities'),
      units: bounded(observation.units.map(u => ({ id: u.id, type: u.type, position: u.position, hp: u.hp, attackChargesRemaining: u.attackChargesRemaining, currentFuel: u.currentFuel, currentMilitaryGoods: u.currentMilitaryGoods })), CONTEXT_HANDOFF_LIMITS.units, 'units'),
      visibleEnemies: bounded(observation.zombies.map(u => ({ id: u.id, type: u.type, movementDomain: u.movementDomain, position: u.position, hp: u.hp, maxHp: u.maxHp, attack: u.attack, movement: u.movement, range: u.range, vision: u.vision, attackChargesRemaining: u.attackChargesRemaining, maxAttackCharges: u.maxAttackCharges, isFinalWaveMember: u.isFinalWaveMember })), CONTEXT_HANDOFF_LIMITS.visibleEnemies, 'full-snapshot'),
      checkpoints: bounded(observation.checkpoints.map(c => ({ id: c.id, currentPolicy: c.currentPolicy, waiting: c.waiting, screening: c.screening, approved: c.approved, infected: c.infected })), CONTEXT_HANDOFF_LIMITS.checkpoints, 'checkpoints'),
    },
    contextCheckpoint: { decision: checkpointDecision, reasons: checkpointReasons, completedTurns },
    recentImportantChanges: { items: changes, total: changesTotal, omitted: Math.max(0,changesTotal-changes.length), detailQuery: { ...detailQuery('history'), filters: { fromDecision: checkpointDecision + 1 } } },
    agentIntent: { latestAcceptedEndTurn: latestEndTurn, recent: intent },
    historyHint: { canonicalHistoryPreserved: true, query: detailQuery('history'), instruction: 'After handoff use this latest public state. Do not reread old tool output; query only the needed detail at this revision.' },
  });
}
export type ContextHandoff = ReturnType<typeof buildContextHandoff>;
export const handoffJson = (value: ContextHandoff): JsonValue => value as unknown as JsonValue;
