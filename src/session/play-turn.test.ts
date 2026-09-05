import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '../core/config';
import type { GameAction, JsonValue } from '../core/types';
import type { AgentObservation, AgentStepResult } from '../agent/types';
import { runInteractivePlayTurn } from './session-cli';
import { SessionService } from './service';
import { SessionStore } from './store';
import { MAX_PLAY_TURN_LINE_BYTES, SessionError, type SessionGameFactory, type SessionGameRuntime, type SessionStepInput, type SessionVersionIdentity } from './types';

function root(name: string): string { return mkdtempSync(join(tmpdir(), `nlth-play-turn-${name}-`)); }

const identity: SessionVersionIdentity = {
  appVersion: '1.5.2', gameRulesVersion: '4.0.0', saveFormatVersion: 11, artifactSchemaVersion: '8.0.0',
  agentApiVersion: '9.0.0', observationApiVersion: '9.0.0', bridgeApiVersion: '9.0.0', buildId: 'play-turn-test',
  gitCommit: 'a'.repeat(40), mapId: 'test-map',
};

interface RuntimeState { turn: number; hp: number; enemy: boolean; crisis: number; unitPresent: boolean }

function observation(state: RuntimeState): AgentObservation {
  const unit = {
    id: 'unit-1', type: 'police', unitType: 'police', position: { q: 0, r: 0 }, hp: state.hp, maxHp: 10,
    proficiency: 'regular', attackChargesRemaining: 1, maxAttackCharges: 1, canMove: true, canAttack: false,
    inSupply: true, currentFuel: 1, maxFuel: 1, currentMilitaryGoods: 1, maxMilitaryGoods: 1,
    fixedMilitaryGoodsUpkeepPerTurn: 0, attack: 1, baseRecruitAttack: 1, effectiveAttack: 1, movement: 1,
    effectiveMovementCostAtPosition: 1, baseRange: 1, effectiveRange: 1, rangeModifierReason: null,
    emergencyMovementPoints: 0, emergencyMovementAvailable: false,
  };
  return {
    apiVersion: '9.0.0', gameRulesVersion: '4.0.0', turn: state.turn, finalHordeTurn: 50, phase: 'player',
    map: { id: 'test-map', width: 2, height: 1, coordinateSystem: 'axial-q-r', hordeSpawnReserve: [], tiles: [] } as never,
    resources: { food: 10, civilianGoods: 10, militaryGoods: 10, fuel: 10, electricityCapacity: 0, electricityRequired: 0 },
    population: { healthyCivilians: 1, cityResidents: 1, productionWorkers: 0, unitPopulation: 0, waitingRefugees: 0, screeningRefugees: 0, approvedRefugees: 0, infected: 0 },
    facilities: [], units: state.unitPresent ? [unit] as never : [],
    zombies: state.enemy ? [{ id: 'enemy-1', type: 'zombie', unitType: 'zombie', position: { q: 1, r: 0 }, hp: 10, maxHp: 10 }] as never : [],
    checkpoints: [], importantSiteEvents: [], checkpointPositionCandidates: [], constructibleFacilityPositionCandidates: [], roadBranches: [],
    supply: { initialRadius: 0, suppliedTileKeys: ['0,0'], branchRadii: [] },
    horde: { warningType: 'none', warningDirections: [], nextWaveIndex: null, nextWave: null, spawnTurn: null, finalHordeStatus: 'notStarted', turnsRemaining: 0, nextSpawnTurn: null },
    victory: { finalHordeDefeated: false, suppliedAreaZombieClear: !state.enemy, suppliedAreaInfectionClear: true },
    finalHordeDefeated: false, suppliedAreaZombieClear: !state.enemy, suppliedAreaInfectionClear: true,
    crisisSummary: { alerts: state.crisis > 0 ? [{ id: 'unit_out_of_supply_risk:unit-1', severity: 'warning', category: 'unit', reasonCode: 'unit_out_of_supply_risk', entityIds: ['unit-1'], publicFacts: { hp: state.crisis, fuel: 1, militaryGoods: 1 } }] : [], criticalCount: 0, warningCount: state.crisis > 0 ? 1 : 0, advisoryCount: 0 },
    endTurnRisk: { readyUnits: [], unitsWithMoveRemaining: [], unitsWithAttackChargesRemaining: [], uncontainedInfectedSites: [], criticalAlerts: [], forecastGuaranteedDefeat: false },
    endTurnForecast: { overcrowding: { cities: [], additionalCivilianGoods: 0, additionalFood: 0 }, food: { shortage: 0 }, civilianGoods: { shortage: 0 }, militaryGoods: { totalUnfilledRefillDemand: 0, units: [] }, fuel: { totalFuelShortage: 0, windPowerAvailable: 0 }, electricity: { shortage: 0 } } as never,
    strategicForecast: { resources: {}, guaranteedDefeat: { guaranteed: false }, productionCapacity: { targetTurn: state.turn, cityPopulationBasis: 'current_healthy_residents', facilityScope: 'player_owned_completed_not_ruined_including_temporarily_unavailable', boundsSimultaneouslyAchievable: false, blockingReasonsOverlap: true, exactReallocationCapacityComputed: false, availableCityPopulation: 1, remainingActions: 1, resources: Object.fromEntries(['food', 'civilianGoods', 'militaryGoods', 'fuel'].map((key) => [key, { projectedEndTurnOutput: 0, ratedUpperBoundAtCurrentCityPopulation: 0, ratedGapUpperBound: 0, utilizationRatio: null, blockingReasonCounts: {} }])), electricity: { availableGenerationCapacity: 0, demand: 0, allocated: 0, unallocatedAvailableCapacity: 0, storable: false, fuelBasis: 'turn_start_stock' }, facilities: [] } } as never,
    gameOver: false, result: null,
  };
}

class Runtime implements SessionGameRuntime {
  public constructor(private state: RuntimeState = { turn: 1, hp: 10, enemy: false, crisis: 0, unitPresent: true }) {}
  public getObservation(): AgentObservation { return structuredClone(observation(this.state)); }
  public getLegalActions(): GameAction[] { return [{ type: 'Wait', unitId: 'safe' }, { type: 'EndTurn' }]; }
  public step(input: SessionStepInput): AgentStepResult {
    const action = input.action;
    if (action.type === 'EndTurn') { this.state.turn += 1; this.state.enemy = true; this.state.crisis = 8; }
    else if (action.type === 'Wait') {
      if (action.unitId === 'damage') this.state.hp -= 2;
      if (action.unitId === 'spawn') this.state.enemy = true;
      if (action.unitId === 'lost') this.state.unitPresent = false;
      if (action.unitId === 'crisis') this.state.crisis = 8;
    } else if (action.type === 'Move') {
      // Intentionally leave the Unit at its original position.
    } else return { observation: this.getObservation(), events: [], error: { code: 'illegal_action', message: 'Unsupported test action' }, gameOver: false, result: null };
    return { observation: this.getObservation(), events: [], error: null, gameOver: false, result: null };
  }
  public isGameOver(): boolean { return false; }
  public getResult(): null { return null; }
  public getRunArtifact(): never { return { config: structuredClone(DEFAULT_CONFIG) } as never; }
  public exportPrivateState(): JsonValue { return structuredClone(this.state) as unknown as JsonValue; }
}

function factory(counter?: { restores: number }): SessionGameFactory {
  return {
    createNew: () => new Runtime(),
    restore: ({ privateState }) => {
      if (counter) counter.restores += 1;
      return new Runtime(structuredClone(privateState) as unknown as RuntimeState);
    },
  };
}

function service(path: string, counter?: { restores: number }): SessionService { return new SessionService(new SessionStore(path), factory(counter), identity); }

describe('play-turn protocol', () => {
  it('reuses one verified runtime, commits every action, and stops after the first EndTurn', () => {
    const path = root('plan');
    service(path).newSession({ sessionId: 'game' });
    const counter = { restores: 0 };
    const api = service(path, counter);
    const result = api.playTurnPlan('game', { expectedRevision: 0, actions: [
      { requestId: 'plan-1', action: { type: 'Wait', unitId: 'safe' }, decisionSummary: 'Safe administration.' },
      { requestId: 'plan-2', action: { type: 'EndTurn' }, decisionSummary: 'Finish the turn.' },
      { requestId: 'plan-3', action: { type: 'Wait', unitId: 'safe' }, decisionSummary: 'Must remain unexecuted.' },
    ] });
    expect(result).toMatchObject({ startRevision: 0, currentRevision: 2, executedIndexes: [0, 1], rejectedIndex: null, unexecutedIndexes: [2], stopReason: 'end_turn_completed' });
    expect(counter.restores).toBe(1);
    expect(api.status('game').active.decision).toBe(2);
  });

  it('reuses the verified runtime across interactive queries and actions', () => {
    const path = root('interactive-runtime');
    service(path).newSession({ sessionId: 'game' });
    const counter = { restores: 0 };
    const api = service(path, counter);
    const turn = api.beginPlayTurn('game');
    try {
      expect(api.query('game', { target: 'api', expectedRevision: 0 }).value).toMatchObject({
        unavailable: true,
        sessionPlayTurn: { protocolVersion: '1.0.0', portableLauncher: './run-session.sh', portableLauncherWindows: '.\\run-session.cmd', limits: { maxPlanBytes: 8 * 1024 * 1024 } },
      });
      expect(api.query('game', { target: 'legal-actions', expectedRevision: 0 }).revision).toBe(0);
      expect(api.playTurnAction('game', { type: 'action', requestId: 'interactive-runtime-1', action: { type: 'Wait', unitId: 'safe' }, decisionSummary: 'Use the retained runtime.', expectedRevision: 0 })).toMatchObject({ accepted: true, currentRevision: 1 });
      expect(counter.restores).toBe(1);
    } finally { turn.close(); }
  });

  it('persists request idempotency across processes and rejects changed content', () => {
    const path = root('request');
    const first = service(path);
    first.newSession({ sessionId: 'game' });
    const input = { type: 'action', requestId: 'stable-request', action: { type: 'Wait', unitId: 'safe' }, decisionSummary: 'Commit once.', expectedRevision: 0 };
    expect(first.playTurnAction('game', input)).toMatchObject({ replayed: false, originalDecision: 1, currentRevision: 1 });
    const second = service(path);
    expect(second.playTurnAction('game', input)).toMatchObject({ replayed: true, originalDecision: 1, currentRevision: 1 });
    expect(second.status('game').active.decision).toBe(1);
    try { second.playTurnAction('game', { ...input, decisionSummary: 'Different content.' }); throw new Error('expected conflict'); }
    catch (error) {
      expect(error).toMatchObject({ code: 'request_id_conflict', details: { currentRevision: 1, original: { committed: true, decision: 1, accepted: true } } });
    }
    expect(readdirSync(join(path, 'game', 'public', 'requests'))).toHaveLength(1);
  });

  it('recovers a request reserved immediately before an interrupted Active commit', () => {
    const path = root('commit-interruption');
    service(path).newSession({ sessionId: 'game' });
    let fail = true;
    const interrupted = new SessionService(new SessionStore(path, (stage) => {
      if (stage === 'before-active-commit' && fail) { fail = false; throw new Error('simulated interruption'); }
    }), factory(), identity);
    const input = { type: 'action', requestId: 'interrupted-request', action: { type: 'Wait', unitId: 'safe' }, decisionSummary: 'Retry the same durable request.', expectedRevision: 0 };
    expect(() => interrupted.playTurnAction('game', input)).toThrow('simulated interruption');
    expect(service(path).status('game').revision).toBe(0);
    const recovered = interrupted.playTurnAction('game', input);
    expect(recovered).toMatchObject({ replayed: false, originalDecision: 1, currentRevision: 1 });
  });

  it('records a rejected Decision and leaves later plan actions unnumbered', () => {
    const path = root('rejected');
    const api = service(path);
    api.newSession({ sessionId: 'game' });
    const result = api.playTurnPlan('game', { expectedRevision: 0, actions: [
      { requestId: 'reject-1', action: { type: 'AssignWorkers', facilityId: 'missing', workers: 1 }, decisionSummary: 'Exercise rejection.' },
      { requestId: 'reject-2', action: { type: 'EndTurn' }, decisionSummary: 'Must remain unexecuted.' },
    ] });
    expect(result).toMatchObject({ currentRevision: 1, executedIndexes: [], rejectedIndex: 0, unexecutedIndexes: [1], stopReason: 'rejected' });
    expect(api.status('game').active).toMatchObject({ decision: 1, invalidActionCount: 1, acceptedActionCount: 0 });
  });

  it('returns Compact state and all unexecuted indexes for a stale finite plan', () => {
    const path = root('stale-plan');
    const api = service(path);
    api.newSession({ sessionId: 'game' });
    const result = api.playTurnPlan('game', { expectedRevision: 9, actions: [
      { requestId: 'stale-1', action: { type: 'Wait', unitId: 'safe' }, decisionSummary: 'Stale action.' },
      { requestId: 'stale-2', action: { type: 'EndTurn' }, decisionSummary: 'Must remain unexecuted.' },
    ] });
    expect(result).toMatchObject({ currentRevision: 0, executedIndexes: [], rejectedIndex: null, unexecutedIndexes: [0, 1], stopReason: 'stale_revision', observation: { turn: 1 } });
  });

  it('bounds the Store payload cache and finite plan length', () => {
    const path = root('cache-bounds');
    const store = new SessionStore(path, undefined, { payloadCacheEntries: 3 });
    for (let index = 0; index < 10; index += 1) store.writePayload('public', { index });
    expect((store as unknown as { writtenPayloads: Map<string, unknown> }).writtenPayloads.size).toBe(3);
    const api = new SessionService(store, factory(), identity);
    api.newSession({ sessionId: 'game' });
    expect(() => api.playTurnPlan('game', { expectedRevision: 0, actions: Array.from({ length: 65 }, (_entry, index) => ({ requestId: `request-${index}`, action: { type: 'Wait', unitId: 'safe' }, decisionSummary: 'Bounded plan.' })) })).toThrow(/1-64/u);
  });

  it.each([
    ['new_enemy_spotted', { type: 'Wait', unitId: 'spawn' }, undefined],
    ['unexpected_unit_damage', { type: 'Wait', unitId: 'damage' }, undefined],
    ['player_unit_lost', { type: 'Wait', unitId: 'lost' }, undefined],
    ['new_crisis', { type: 'Wait', unitId: 'crisis' }, undefined],
    ['move_interrupted', { type: 'Move', unitId: 'unit-1', destination: { q: 1, r: 0 } }, undefined],
  ] as const)('stops a finite plan on %s and preserves the committed action', (reason, action, expectations) => {
    const path = root(reason);
    const api = service(path);
    api.newSession({ sessionId: 'game' });
    const result = api.playTurnPlan('game', { expectedRevision: 0, actions: [
      { requestId: `${reason}-1`, action, decisionSummary: `Trigger ${reason}.`, ...(expectations ? { expectations } : {}) },
      { requestId: `${reason}-2`, action: { type: 'EndTurn' }, decisionSummary: 'Must remain unexecuted.' },
    ] });
    expect(result).toMatchObject({ currentRevision: 1, executedIndexes: [0], unexecutedIndexes: [1], stopReason: reason });
  });

  it('continues planned expected damage inside the declared per-unit HP range', () => {
    const path = root('expected-damage');
    const api = service(path);
    api.newSession({ sessionId: 'game' });
    const result = api.playTurnPlan('game', { expectedRevision: 0, actions: [
      { requestId: 'damage-1', action: { type: 'Wait', unitId: 'damage' }, decisionSummary: 'Accept bounded damage.', expectations: { playerUnitHp: [{ unitId: 'unit-1', minHp: 7, maxHp: 9 }] } },
      { requestId: 'damage-2', action: { type: 'EndTurn' }, decisionSummary: 'Finish after checking damage.' },
    ] });
    expect(result).toMatchObject({ currentRevision: 2, executedIndexes: [0, 1], stopReason: 'end_turn_completed' });
  });

  it('uses bounded JSONL framing, reports malformed input, and ignores input after EndTurn', async () => {
    const path = root('interactive');
    const api = service(path);
    api.newSession({ sessionId: 'game' });
    async function* input() {
      yield '{broken}\n';
      yield `${JSON.stringify({ type: 'action', requestId: 'interactive-1', action: { type: 'EndTurn' }, decisionSummary: 'Finish.', expectedRevision: 0 })}\n${JSON.stringify({ type: 'action', requestId: 'interactive-2', action: { type: 'EndTurn' }, decisionSummary: 'Ignored.', expectedRevision: 1 })}\n`;
    }
    const chunks: Buffer[] = [];
    const sink = new Writable({ highWaterMark: 64, write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); setTimeout(callback, 1); } });
    await expect(runInteractivePlayTurn(api, 'game', input(), sink, 10_000)).resolves.toBe('successful_end_turn');
    const output = Buffer.concat(chunks).toString('utf8').trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(output.map((entry) => entry.kind ?? entry.code)).toEqual(['start', 'invalid_play_turn_json', 'action-result', 'closed']);
    expect(api.status('game').active.decision).toBe(1);
  });

  it('rejects an oversized JSONL line and releases its play-turn lock', async () => {
    const path = root('line-limit');
    const api = service(path);
    api.newSession({ sessionId: 'game' });
    async function* input() { yield 'x'.repeat(MAX_PLAY_TURN_LINE_BYTES + 1); }
    const sink = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
    await expect(runInteractivePlayTurn(api, 'game', input(), sink, 10_000)).rejects.toMatchObject({ code: 'play_turn_line_too_large' });
    const reopened = api.beginPlayTurn('game');
    reopened.close();
  });

  it('closes an idle interactive process without applying an action', async () => {
    const path = root('idle-timeout');
    const api = service(path);
    api.newSession({ sessionId: 'game' });
    const input: AsyncIterable<string> = {
      [Symbol.asyncIterator]() {
        return {
          next: () => new Promise<IteratorResult<string>>(() => undefined),
          return: async () => ({ done: true, value: undefined }),
        };
      },
    };
    const chunks: Buffer[] = [];
    const sink = new Writable({ write(chunk, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); } });
    await expect(runInteractivePlayTurn(api, 'game', input, sink, 10)).resolves.toBe('idle_timeout');
    const output = Buffer.concat(chunks).toString('utf8').trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(output).toHaveLength(2);
    expect(output[1]).toMatchObject({ kind: 'closed', reason: 'idle_timeout', revision: 0 });
    expect(api.status('game').active.decision).toBe(0);
  });

  it('detects a second live play-turn writer', () => {
    const path = root('double');
    const api = service(path);
    api.newSession({ sessionId: 'game' });
    const first = api.beginPlayTurn('game');
    expect(() => api.beginPlayTurn('game')).toThrowError(SessionError);
    first.close();
  });
});
