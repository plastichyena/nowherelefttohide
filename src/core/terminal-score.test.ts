import { beforeAll, describe, expect, it } from 'vitest';
import { createDefaultConfig, validateGameConfig } from './config';
import { GameEngine } from './engine';
import { createInitialState, createUnit } from './state';
import { prepareTestSnapshot } from './testConfig';
import { calculateScorePoints, calculateTerminalScore, createScoreContext, DEFAULT_SCORE_COEFFICIENTS, type ScoredTerminal } from './terminal-score';
import type { GameState } from './types';
import { createTerminalSessionFixture, terminalFixtureAction } from '../testing/v171-session-fixture';

let initial: GameState;
beforeAll(() => { initial = createInitialState(42, createDefaultConfig({ mapMode: 'fixed' })); });
const fixture = () => structuredClone(initial);
const score = (state: GameState, outcome: 'won' | 'lost' = 'won') => calculateTerminalScore(state, outcome) as ScoredTerminal;
const input = { healthyPopulation: '300', healthyInitialFacilities: 20, initialPersonnel: '45', initialPersonnelTotal: '45', populationLimit: '10425', initialFacilityCount: 28 };
const points = (overrides: Partial<typeof input> = {}, outcome: 'won' | 'lost' = 'won') => calculateScorePoints({ ...input, ...overrides }, DEFAULT_SCORE_COEFFICIENTS, outcome);

describe('terminal-assets-v1 arithmetic and start basis', () => {
  it('uses the documented standard bounds without consulting hidden survivors', () => {
    expect(initial.scoreContext).toMatchObject({ status: 'supported', populationLimit: '10425', initialPersonnelTotal: '45' });
    expect(initial.scoreContext.initialFacilityIds).toHaveLength(28);
    expect(initial.scoreContext.initialUnits).toHaveLength(7);
    expect(score(initial)).toMatchObject({ healthyPopulation: '155', healthyInitialFacilities: 8, initialPersonnel: '45', survivingUnits: 7,
      populationByLocation: { facilities: '110', units: '45', formations: '0', waiting: '0', screening: '0', approved: '0' },
      points: { defeatPenalty: '1050951', total: '17951' } });
    const altered = fixture();
    for (const f of altered.facilities.filter(f => f.owner === 'none')) f.workers += 1000;
    expect(createScoreContext(altered)).toEqual(initial.scoreContext);
    expect(score(altered)).toEqual(score(initial));
  });

  it.each([
    ['300', 20, '45', '50', '36051', '-1014901'],
    ['301', 20, '45', '50', '36151', '-1014801'],
    ['300', 21, '45', '50', '36351', '-1014601'],
    ['300', 20, '0', '0', '36001', '-1014951'],
    ['0', 0, '0', '0', '1', '-1050951'],
  ] as const)('matches H=%s F=%s I=%s for both outcomes', (h, f, i, b, won, lost) => {
    const values = { healthyPopulation: h, healthyInitialFacilities: f, initialPersonnel: i };
    expect(points(values)).toMatchObject({ initialPersonnel: b, total: won });
    expect(points(values, 'lost').total).toBe(lost);
  });

  it('keeps the upper-bound loss negative and cannot trade one healthy person for all unit points', () => {
    expect(points({ healthyPopulation: '10425', healthyInitialFacilities: 28 }, 'lost').total).toBe('-1');
    expect(points({ healthyPopulation: '10425', healthyInitialFacilities: 28 }).total).toBe('1050951');
    for (const outcome of ['won', 'lost'] as const) {
      expect(BigInt(points({ initialPersonnel: '0' }, outcome).total)).toBeGreaterThan(BigInt(points({ healthyPopulation: '299' }, outcome).total));
    }
    expect(points({ initialPersonnel: '0', initialPersonnelTotal: '0' }).initialPersonnel).toBe('0');
  });

  it('preserves exact scores above Number.MAX_SAFE_INTEGER', () => {
    const c = { wH: Number.MAX_SAFE_INTEGER, wF: Number.MAX_SAFE_INTEGER, bMax: 50 };
    const result = calculateScorePoints(input, c, 'won');
    expect(result.total).toBe((BigInt(Number.MAX_SAFE_INTEGER) * 320n + 51n).toString());
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });

  it('rejects negative, fractional, nonfinite, unsafe and out-of-bound inputs rather than clamping', () => {
    for (const h of ['-1', '1.1', 'NaN', 'Infinity', '01', '10426']) expect(() => points({ healthyPopulation: h })).toThrow(/score:/);
    for (const f of [-1, 0.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, 29]) expect(() => points({ healthyInitialFacilities: f })).toThrow(/score:/);
    expect(() => points({ initialPersonnel: '46' })).toThrow(/bounds/);
    for (const c of [{ wH: 0 }, { wF: -1 }, { bMax: 100 }, { bMax: -1 }, { wH: 1.1 }, { wH: Infinity }, { wH: Number.MAX_SAFE_INTEGER + 1 }]) {
      expect(validateGameConfig(createDefaultConfig({ terminalScore: c })).valid).toBe(false);
    }
    const state = fixture(); state.units[0]!.population = Number.MAX_SAFE_INTEGER + 1;
    expect(() => score(state)).toThrow(/safe integer/);
  });

  it('records unsafe custom bounds as unsupported and distinguishes full Config and seed changes', () => {
    const state = fixture();
    state.config.refugees.arrivalGrowthPeople = Number.MAX_SAFE_INTEGER;
    state.scoreContext = createScoreContext(state);
    expect(calculateTerminalScore(state, 'lost')).toMatchObject({ status: 'unscored', reason: 'population_arithmetic_unsafe' });
    const other = fixture(); other.config.economy.initialResources.food++;
    expect(createScoreContext(other).comparison.configHash).not.toBe(initial.scoreContext.comparison.configHash);
    other.seed++;
    expect(createScoreContext(other).comparison.rootSeed).not.toBe(initial.scoreContext.comparison.rootSeed);
    expect(createScoreContext({ ...initial, config: { ...initial.config, terminalScore: { wH: 200, wF: 600, bMax: 50 } } }).coefficients.wH).toBe(200);
  });
});

describe('population, facilities and crowding', () => {
  it('counts every disjoint pool once, including cargo, and excludes infection and neutral people', () => {
    const state = fixture(), city = state.facilities.find(f => f.id === 'capital')!;
    city.workers -= 15;
    state.pendingUnitProductions.push({ id: 'pending', cityFacilityId: city.id, unitType: 'police', population: 5, readyTurn: 2 });
    const cp = state.checkpoints[0]!; cp.waiting = 3; cp.screening = 4; cp.approved = 3; cp.infected = 9;
    city.infected = 7;
    const transport = createUnit(state, 'new-transport', 'multipurposeHelicopter', city.position);
    transport.cargoUnitId = 'police-1'; state.units.push(transport);
    state.units.find(u => u.id === 'police-1')!.transportedByUnitId = transport.id;
    expect(score(state)).toMatchObject({ healthyPopulation: String(155 + transport.population),
      populationByLocation: { facilities: '95', units: String(45 + transport.population), formations: '5', waiting: '3', screening: '4', approved: '3' }, initialPersonnel: '45' });
  });

  it('does not award newly commissioned, zero-population, replacement or reinforcement unit counts', () => {
    const state = fixture(), before = score(state), city = state.facilities.find(f => f.id === 'capital')!;
    const newUnit = createUnit(state, 'police-999', 'police', city.position);
    city.workers -= newUnit.population; state.units.push(newUnit);
    const zero = createUnit(state, 'zero-unit', 'police', city.position); zero.population = 0; state.units.push(zero);
    expect(score(state).points).toEqual(before.points);
    expect(score(state).survivingUnits).toBe(before.survivingUnits + 2);
    state.units = state.units.filter(u => u.id !== 'police-1');
    const lost = score(state);
    expect(lost.initialPersonnelTotal).toBe('45'); expect(lost.initialPersonnel).toBe('40');
    state.units.push(createUnit(state, 'replacement-1000', 'police', city.position));
    expect(score(state).points.initialPersonnel).toBe(lost.points.initialPersonnel);
    expect(score(state).healthyPopulation).toBe(before.healthyPopulation);
  });

  it('makes crowding informational for both outcomes, without RNG or mutation', () => {
    const state = fixture();
    const a = state.facilities.find(f => f.id === 'city-1')!, b = state.facilities.find(f => f.id === 'capital')!;
    a.workers = 50; b.workers = 50; a.workerCapacity = 50; b.workerCapacity = 50;
    const balanced = score(state), rng = structuredClone(state.rngState);
    const balancedLoss = score(state, 'lost');
    a.workers = 1; b.workers = 99;
    const crowded = score(state);
    expect(crowded.points).toEqual(balanced.points);
    expect(score(state, 'lost').points).toEqual(balancedLoss.points);
    expect(crowded.crowding.excess).toBe('49'); expect(balanced.crowding.excess).toBe('0');
    expect(state.rngState).toEqual(rng);
    expect(state.events).toEqual(initial.events);
  });

  it('uses initial IDs and terminal ownership/health, including recovered and empty stopped sites', () => {
    const state = fixture(), f = state.facilities.find(f => f.id === 'farm-1')!;
    const base = score(state).healthyInitialFacilities;
    for (const operationalStatus of ['stopped', 'recovering', 'operational'] as const) {
      f.operationalStatus = operationalStatus; f.workers = 0; f.powerSupplyEnabled = false;
      expect(score(state).healthyInitialFacilities).toBe(base);
      f.workers = 1; expect(score(state).healthyInitialFacilities).toBe(base);
    }
    for (const operationalStatus of ['disabled', 'building', 'ruined', 'infected'] as const) {
      f.operationalStatus = operationalStatus;
      expect(score(state).healthyInitialFacilities).toBe(base - 1);
    }
    f.operationalStatus = 'recovering'; f.infected = 1;
    expect(score(state).healthyInitialFacilities).toBe(base - 1);
    f.infected = 0; f.owner = 'none'; expect(score(state).healthyInitialFacilities).toBe(base - 1);
    f.owner = 'player'; f.status = 'owned'; expect(score(state).healthyInitialFacilities).toBe(base);
    state.facilities.push({ ...f, id: 'built-farm', constructible: true });
    expect(score(state).healthyInitialFacilities).toBe(base);
    state.facilities = state.facilities.filter(item => item.id !== f.id);
    expect(() => score(state)).toThrow(/missing initial facility/);
  });

  it('rejects duplicate identities and changed manifests or coefficients', () => {
    const state = fixture(); state.units.push(structuredClone(state.units[0]!));
    expect(() => score(state)).toThrow(/duplicate/);
    const broken = fixture(); broken.scoreContext.initialFacilityIds.pop();
    expect(() => score(broken)).toThrow(/start context/);
    const changed = fixture(); changed.config.terminalScore.wH++;
    expect(() => score(changed)).toThrow(/start context/);
    const reused = fixture(); reused.units = []; reused.nextUnitNumber = 1;
    expect(() => score(reused)).toThrow(/ID counter/);
  });
});

export function terminalState(outcome: 'won' | 'lost'): GameState {
  return createTerminalSessionFixture('v172-terminal-test', outcome).createNew({ seed: 42, agentId: 'v172-test' }).exportPrivateState() as unknown as GameState;
}

describe('real Core terminal boundary', () => {
  it.each(['won', 'lost'] as const)('freezes a %s result and rejects every later action without rescoring', outcome => {
    const state = terminalState(outcome), engine = GameEngine.fromSnapshot(state);
    const result = engine.step(terminalFixtureAction(state, outcome));
    expect(result.error).toBeNull(); expect(result.result?.outcome).toBe(outcome);
    const actual = result.result!.terminalScore as ScoredTerminal;
    expect(actual).toEqual(calculateTerminalScore(result.state as GameState, outcome));
    expect(outcome === 'won' ? BigInt(actual.points.total) > 0n : BigInt(actual.points.total) < 0n).toBe(true);
    const frozen = engine.getState();
    for (const action of [{ type: 'EndTurn' }, { type: 'LoadSnapshot', snapshot: state }, { type: 'Wait', unitId: 'police-1' }] as const) {
      expect(engine.step(action).error?.code).toBe('game_over'); expect(engine.getState()).toEqual(frozen);
    }
    actual.points.total = '0'; expect(engine.getResult()).toEqual(frozen.result);
  });

  it('does not settle optional rewards after an immediate defeat', () => {
    const state = terminalState('lost');
    const air = state.facilities.find(f => f.type === 'airBase')!;
    air.owner = 'player'; air.status = 'owned'; air.operationalStatus = 'stopped'; air.workers = 0; air.infected = 0;
    state.airBaseObjective = { firstCapturedTurn: 1, fellBeforeCapture: false, reward: 'pending', failureSpawn: 'none' };
    prepareTestSnapshot(state);
    const result = GameEngine.fromSnapshot(state).step({ type: 'EndTurn' });
    expect(result.error).toBeNull(); expect(result.result?.reason).toBe('capitalLost');
    expect(result.state.airBaseObjective.reward).toBe('pending');
    expect(result.events.some(e => e.type === 'facility_objective_updated' && e.payload.reward === 'claimed')).toBe(false);
  });
});
