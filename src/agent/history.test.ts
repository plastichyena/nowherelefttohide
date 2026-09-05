import { describe, expect, it } from 'vitest';
import { ObservationHistory, metricObservation } from './history';
import { createAgentGame } from './game';
import { createBrowserBridge } from '../browser/bridge';
import { collectGameMetrics } from './metrics';
import { createDefaultConfig } from '../core/config';
import { applyLosslessJsonDiff } from '../session/public-diff';
import { writeJsonStream } from './json-stream';
import { createGameMetricsAccumulator } from './metrics-stream';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('bounded public history and artifact access', () => {
  it('reconstructs exact snapshots across the 50-entry boundary in arbitrary order', () => {
    const game = createAgentGame();
    const observation = game.reset({ seed: 7 });
    const history = new ObservationHistory();
    for (let index = 0; index < 55; index += 1) {
      observation.turn = index + 1;
      observation.resources.food = 100 + index;
      if (index % 3 === 0) observation.units.reverse();
      history.push(observation);
    }
    for (const index of [54, 1, 50, 49, 0, 51]) {
      const value = history.at(index);
      expect(value.turn).toBe(index + 1);
      expect(value.resources.food).toBe(100 + index);
      expect(value.map).toEqual(observation.map);
      value.units[0]!.hp = 0;
      expect(history.at(index).units[0]!.hp).toBeGreaterThan(0);
    }
    const page = history.view().slice(48, 53);
    expect(page.map((value) => value.turn)).toEqual([49, 50, 51, 52, 53]);
    expect(JSON.parse(JSON.stringify(history.compactView()))).toHaveLength(55);
  }, 30000);

  it('preserves metrics when heavyweight projections are omitted', () => {
    const game = createAgentGame();
    const initial = game.reset({ seed: 1 });
    const step = game.step({ type: 'EndTurn' });
    const base = { initialObservation: initial, finalObservation: step.observation,
      actions: [{ type: 'EndTurn' } as const], events: step.events, result: step.result,
      agent: { id: 'test', version: '1' }, config: createDefaultConfig(), buildId: 'test', seed: 1 };
    expect(collectGameMetrics({ ...base, observations: [initial, step.observation].map(metricObservation) }))
      .toEqual(collectGameMetrics({ ...base, observations: [initial, step.observation] }));
  });

  it('paginates every public observation and rejects stale revisions without changing the run', () => {
    const game = createAgentGame();
    game.reset({ seed: 1 });
    const initial = game.getObservation();
    const first = game.getArtifactPage({ target: 'observations', pageSize: 1 });
    expect(first.items).toEqual([initial]);
    const after = game.step({ type: 'EndTurn' }).observation;
    expect(() => game.getArtifactPage({ target: 'observations', expectedRevision: first.revision })).toThrow('stale_revision');
    const page = game.getArtifactPage({ target: 'observations', offset: 1, pageSize: 1 });
    expect(page.items).toEqual([after]);
    expect(page.hasMore).toBe(false);
    expect(() => game.getArtifactPage({ pageSize: 501 })).toThrow('invalid_pagination');
    expect(game.getObservation()).toEqual(after);
  });

  it('keeps supply return, checkpoint gain and emergency mobility metrics in the compact metric projection', () => {
    const game = createAgentGame();
    const observation = game.reset({ seed: 1 });
    const unit = observation.units[0]!;
    unit.currentFuel = 0; unit.canMove = true;
    expect(unit.fuelCostByLegalMove.length).toBeGreaterThan(0);
    const candidate = observation.checkpointPositionCandidates.find((entry) => entry.actionType === 'BuildCheckpoint')!;
    candidate.projectedBranchRadius = candidate.currentBranchRadius;
    candidate.suppliedFacilityDelta = 0; candidate.newlyBuildableConstructibleHexCount = 0;
    const [q, r] = observation.supply.suppliedTileKeys[0]!.split(',').map(Number);
    const base = { initialObservation: observation, finalObservation: observation,
      actions: [{ type: 'BuildCheckpoint' as const, branchId: candidate.branchId, position: candidate.position }],
      events: [{ id: 'emergency-return', turn: observation.turn, phase: observation.phase, type: 'unit_moved' as const,
        payload: { unitId: unit.id, unitType: unit.type, movementMode: 'emergency', q: q!, r: r!, hexesMoved: 1, effectiveMovementCost: 1 } }],
      result: null, agent: { id: 'test', version: '1' }, config: createDefaultConfig(), buildId: 'test', seed: 1 };
    const full = collectGameMetrics({ ...base, observations: [observation] });
    expect(full.checkpointMovesWithNoSupplyGain).toBe(1);
    expect(full.emergencyReturnsToSupplyByType[unit.type as 'police']).toBe(1);
    expect(full.unitsUnableToMoveForFuel).toBe(0);
    expect(collectGameMetrics({ ...base, observations: [metricObservation(observation)] })).toEqual(full);
  });

  it('produces identical Metrics from streamed accepted and rejected Decisions', () => {
    const game = createAgentGame({ recordHistory: false });
    const initial = game.reset({ seed: 7 });
    const metadata = { config: createDefaultConfig(), agent: { id: 'stream-test', version: '1' }, buildId: 'test', seed: 7 };
    const accumulator = createGameMetricsAccumulator(metadata, initial);
    const observations = [initial];
    const actions: import('../core/types').GameAction[] = [];
    const events: import('./types').AgentPublicEvent[] = [];
    const rejected = game.step({ type: 'Wait', unitId: 'missing-unit' });
    expect(rejected.error).not.toBeNull();
    const invalid = { decision: 1, action: { type: 'Wait' as const, unitId: 'missing-unit' }, error: rejected.error! };
    accumulator.pushDecision({ record: { decision: 1, inputAction: invalid.action, accepted: false, error: invalid.error, events: rejected.events } });
    events.push(...rejected.events);
    for (let index = 0; index < 4; index += 1) {
      const action = { type: 'EndTurn' as const };
      const step = game.step(action);
      expect(step.error).toBeNull();
      accumulator.pushDecision({ record: { decision: index + 2, inputAction: action, accepted: true, error: null, events: step.events }, observationAfter: step.observation });
      observations.push(step.observation); actions.push(action); events.push(...step.events);
    }
    const final = game.getObservation();
    expect(accumulator.finish(final, game.getResult())).toEqual(collectGameMetrics({ ...metadata,
      initialObservation: initial, finalObservation: final, observations, actions, events,
      result: game.getResult(), invalidAttempts: [invalid], invalidAttemptCount: 1, totalAgentDecisions: 5 }));
  }, 60_000);

  it('includes malformed Bridge attempts in bounded history and invalidates their previous revision', () => {
    const bridge = createBrowserBridge();
    const first = bridge.getArtifactPage();
    const before = bridge.getObservation();
    bridge.step({ type: 'LoadSnapshot' } as never);
    expect(() => bridge.getArtifactPage({ expectedRevision: first.revision })).toThrow('stale_revision');
    expect(bridge.getArtifactPage({ target: 'invalid-attempts' }).total).toBe(1);
    expect(bridge.getObservation()).toEqual(before);
    expect(JSON.stringify(bridge.getArtifactPage())).not.toContain('noiseRadius');
    expect(() => bridge.getArtifactPage(null as never)).toThrow('invalid_artifact_query');
    expect(() => bridge.getArtifactPage([] as never)).toThrow('invalid_artifact_query');
  });

  it('streams JSON arrays and long Unicode strings with exact decoded contents', () => {
    const directory = resolve('output/v151-json-stream'); mkdirSync(directory, { recursive: true });
    const path = resolve(directory, 'unicode.json');
    const value = { text: 'a'.repeat(8191) + '🧟'.repeat(10000), entries: Array.from({ length: 1000 }, (_, index) => ({ index, quote: '\"\n' })) };
    writeJsonStream(path, value);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(value);
  });

  it('rejects prototype-mutating payload paths', () => {
    expect(() => applyLosslessJsonDiff({}, [{ op: 'set', path: ['__proto__', 'polluted'], value: true }])).toThrow();
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
});
