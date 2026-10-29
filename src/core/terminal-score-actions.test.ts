import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from './config';
import { GameEngine } from './engine';
import { createInitialState, createUnit } from './state';
import { hexKey, hexNeighbors } from './hex';
import { prepareTestSnapshot } from './testConfig';
import { synchronizeArtilleryStats } from './unit-capabilities';
import { calculateTerminalScore, type ScoredTerminal } from './terminal-score';
import type { GameAction, GameState } from './types';
import { createTerminalSessionFixture, terminalFixtureAction } from '../testing/v171-session-fixture';

const quiet = () => createDefaultConfig({ mapMode: 'fixed',
  economy: { initialZombieCount: 0, initialScreamerCount: 0, initialHunterCount: { min: 0, max: 0 }, initialGasCount: { min: 0, max: 0 },
    initialResources: { food: 100000, civilianGoods: 100000, militaryGoods: 100000, fuel: 100000 } },
  refugees: { arrivalIntervalMin: 99, arrivalIntervalMax: 99 },
  vision: { capital: 50 },
});
const score = (state: Readonly<GameState>) => calculateTerminalScore(state as GameState, 'won') as ScoredTerminal;
function act(engine: GameEngine, action: GameAction) {
  const step = engine.step(action); expect(step.error, step.error?.message).toBeNull(); return step;
}

describe('score under real population actions', () => {
  it('conserves H/F/B through worker assignment, evacuation, reservation and commissioning', () => {
    const state = createInitialState(31, quiet());
    const city = state.facilities.find(f => f.id === 'city-1')!, capital = state.facilities.find(f => f.id === 'capital')!;
    capital.workers = 99; city.workers = 50;
    prepareTestSnapshot(state);
    const engine = GameEngine.fromSnapshot(state), original = score(state);
    for (const action of [
      { type: 'AssignWorkers', facilityId: 'farm-1', workers: 0 },
      { type: 'AssignWorkers', facilityId: 'farm-1', workers: 10 },
      { type: 'TransferPopulation', fromFacilityId: 'city-1', toFacilityId: 'capital', people: 49 },
      { type: 'ProduceUnit', unitType: 'police', destination: capital.position },
    ] as GameAction[]) {
      const next = act(engine, action);
      expect(score(next.state).points).toEqual(original.points);
    }
    const pending = score(engine.getState());
    expect(pending.populationByLocation.formations).toBe('5');
    expect(BigInt(pending.crowding.excess)).toBeGreaterThan(0n);
    // Return evacuated residents before EndTurn so existing overcrowding infection is not confused with scoring.
    act(engine, { type: 'TransferPopulation', fromFacilityId: 'capital', toFacilityId: 'city-1', people: 49 });
    const completed = act(engine, { type: 'EndTurn' });
    expect(completed.state.pendingUnitProductions).toHaveLength(0);
    expect(score(completed.state).points).toEqual(original.points);
    expect(score(completed.state).survivingUnits).toBe(original.survivingUnits + 1);
  });

  it.each(['ifv', 'multipurposeHelicopter'] as const)('counts initial infantry once across %s boarding and disembarkation', type => {
    const state = createInitialState(1, quiet());
    const police = state.units.find(u => u.id === 'police-1')!;
    police.position = { q: 24, r: 25 };
    state.units = state.units.filter(u => u.id === police.id);
    state.units.push(createUnit(state, 'carrier', type, { q: 25, r: 25 }));
    prepareTestSnapshot(state);
    const engine = GameEngine.fromSnapshot(state), original = score(state);
    act(engine, { type: 'BoardTransport', unitId: police.id, transportId: 'carrier' });
    expect(score(engine.getState()).points).toEqual(original.points);
    expect(score(engine.getState()).survivingUnits).toBe(2);
    act(engine, { type: 'EndTurn' });
    act(engine, { type: 'DisembarkTransport', transportId: 'carrier', destination: { q: 24, r: 25 } });
    expect(score(engine.getState()).points).toEqual(original.points);
    expect(score(engine.getState()).initialPersonnel).toBe('5');
    expect(score(engine.getState()).initialPersonnelTotal).toBe('45');
  });

  it('credits last-turn neutral rescue and recovering recapture exactly once', () => {
    for (const recapture of [false, true]) {
      const state = createTerminalSessionFixture('score-rescue', 'won').createNew({ seed: 42, agentId: 'rescue' }).exportPrivateState() as unknown as GameState;
      const site = state.facilities.find(f => f.type === 'farm' && f.owner === 'none')!;
      site.infected = 0; site.workers = recapture ? 0 : 7;
      site.status = recapture ? 'ruined' : 'unowned'; site.operationalStatus = recapture ? 'ruined' : 'stopped';
      site.earlyCaptureSurvivorStatus = recapture ? 'lost' : 'available';
      const police = state.units.find(u => u.id === 'police-1')!;
      const occupied = new Set(state.units.filter(u => u.id !== police.id).map(u => hexKey(u.position)));
      police.position = hexNeighbors(site.position).find(p => state.map.tiles.some(t => hexKey(t) === hexKey(p) && t.movementCost !== null && t.playerOccupancyAllowed) && !occupied.has(hexKey(p)))!;
      prepareTestSnapshot(state, true);
      const engine = GameEngine.fromSnapshot(state), before = score(state);
      const moved = act(engine, { type: 'Move', unitId: police.id, destination: site.position });
      expect(moved.state.facilities.find(f => f.id === site.id)?.operationalStatus).toBe(recapture ? 'recovering' : 'operational');
      const rescued = score(moved.state);
      expect(rescued.healthyPopulation).toBe((BigInt(before.healthyPopulation) + (recapture ? 0n : 7n)).toString());
      expect(rescued.healthyInitialFacilities).toBe(before.healthyInitialFacilities + 1);
      const won = act(engine, terminalFixtureAction(state, 'won'));
      expect(won.result?.outcome).toBe('won');
      expect((won.result!.terminalScore as ScoredTerminal).points).toEqual(rescued.points);
      expect(won.state.turn).toBe(state.turn);
    }
  });

  it('resolves artillery deaths and capital loss completely before freezing the simultaneous defeat', () => {
    const state = createInitialState(1, quiet());
    state.units = [createUnit(state, 'gun', 'fieldArtillery', { q: 15, r: 25 }, 'ready', 'veteran'),
      createUnit(state, 'spotter', 'reconTeam', { q: 26, r: 27 })];
    const gun = state.units[0]!; gun.mode = 'deployed'; gun.canMove = false; synchronizeArtilleryStats(state, gun);
    for (const f of state.facilities.filter(f => f.owner === 'player')) { f.workers = 0; f.infected = 0; f.operationalStatus = 'stopped'; }
    const capital = state.facilities.find(f => f.id === 'capital')!; capital.workers = 1; capital.operationalStatus = 'operational';
    prepareTestSnapshot(state);
    const result = act(GameEngine.fromSnapshot(state), { type: 'AttackHex', attackerId: gun.id, position: capital.position });
    expect(result.result?.reason).toBe('capitalLost'); expect(result.state.population.healthyCivilians).toBe(0);
    const frozen = result.result!.terminalScore as ScoredTerminal;
    expect(frozen.healthyPopulation).toBe(String(result.state.units.filter(u => u.isPlayerUnit).reduce((n, u) => n + u.population, 0)));
    expect(frozen).toEqual(calculateTerminalScore(result.state as GameState, 'lost'));
    expect(BigInt(frozen.points.total)).toBeLessThan(0n);
    expect(result.events.some(e => e.type === 'facility_overrun' && e.payload.facilityId === 'capital')).toBe(true);
  });

  it('does not score a Final with pending members or a rejected candidate', () => {
    const config = quiet(); config.horde.waves = [{ turn: 1, directionCount: 4, compositionPerDirection: { hordeZombie: 30, zombie: 0 }, final: true }];
    const engine = new GameEngine(42, config);
    const spawned = act(engine, { type: 'EndTurn' });
    expect(spawned.state.horde.pendingWaves.length).toBeGreaterThan(0);
    expect(spawned.result).toBeNull(); expect(spawned.gameOver).toBe(false);
    const before = engine.getState();
    const rejected = engine.step({ type: 'Move', unitId: 'police-1', destination: { q: -99, r: -99 } });
    expect(rejected.error).not.toBeNull(); expect(rejected.result).toBeNull(); expect(engine.getState()).toEqual(before);
  });

  it('discards a terminal candidate with invalid score bounds including its RNG and result', () => {
    const state = createTerminalSessionFixture('score-rejected', 'won').createNew({ seed: 42, agentId: 'bounds' }).exportPrivateState() as unknown as GameState;
    state.facilities.find(f => f.id === 'capital')!.workers = 20000;
    prepareTestSnapshot(state);
    const engine = GameEngine.fromSnapshot(state), before = engine.getState();
    const result = engine.step(terminalFixtureAction(state, 'won'));
    expect(result.error?.code).toBe('invariant_failure'); expect(result.error?.message).toContain('fixed bounds');
    expect(result.result).toBeNull(); expect(engine.getState()).toEqual(before);
  });
});
