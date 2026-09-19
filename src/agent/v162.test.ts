import { expect, it } from 'vitest';
import { BalancedAgent } from './balancedAgent';
import { createAgentObservation } from './observation';
import { GameEngine } from '../core/engine';
import { createDefaultConfig } from '../core/config';
import { createUnit } from '../core/state';
import { prepareTestSnapshot } from '../core/testConfig';
import type { GameState } from '../core/types';

function engine() {
  return new GameEngine(1, createDefaultConfig({ economy: {
    initialZombieCount: 0, initialHunterCount: { min: 0, max: 0 }, initialGasCount: { min: 0, max: 0 }, initialScreamerCount: 0,
  } }));
}

it('chooses legal zero-civilian-damage Capital suppression over National Guard suppression', () => {
  const game = engine();
  const state = game.getState() as GameState;
  const capital = state.facilities.find(f => f.id === 'capital')!;
  capital.workers -= 5; capital.infected = 5; capital.operationalStatus = 'infected';
  prepareTestSnapshot(state);
  expect(game.step({ type: 'LoadSnapshot', snapshot: state }).error).toBeNull();
  const actions = game.getLegalActions().filter(a => a.type === 'EndTurn' || a.type === 'Move' && a.destination.q === 25 && a.destination.r === 25);
  expect(actions.some(a => a.type === 'Move' && a.unitId === 'national-guard-1')).toBe(true);
  const decision = new BalancedAgent().decide(createAgentObservation(game.getState()), actions);
  expect(decision.action.type).toBe('Move');
  if (decision.action.type !== 'Move') throw Error('Expected suppression movement');
  const unitId = decision.action.unitId;
  expect(state.units.find(u => u.id === unitId)?.type).toMatch(/police|riotPolice/);
  expect(decision.trace?.reasonCodes).toContain('CAPITAL_ZERO_CIVILIAN_DAMAGE_SUPPRESSION');
  expect(game.step(decision.action).error).toBeNull();
  const ended = game.step({ type: 'EndTurn' });
  expect(ended.error).toBeNull();
  expect(ended.state.facilities.find(f => f.id === 'capital')).toMatchObject({ infected: 0, workers: capital.workers });
});

it('retains the sole nearby defender of a threatened Power Plant', () => {
  const game = engine();
  const state = game.getState() as GameState;
  state.units = state.units.filter(u => u.id === 'police-1');
  state.units[0]!.position = { q: 25, r: 27 };
  state.units.push(createUnit(state, 'approaching-zombie', 'zombie', { q: 25, r: 30 }));
  prepareTestSnapshot(state);
  expect(game.step({ type: 'LoadSnapshot', snapshot: state }).error).toBeNull();
  const actions = game.getLegalActions().filter(a => a.type === 'Wait' || a.type === 'EndTurn'
    || a.type === 'Move' && a.destination.q === 30 && a.destination.r === 25);
  expect(actions.some(a => a.type === 'Move')).toBe(true);
  const decision = new BalancedAgent().decide(createAgentObservation(game.getState()), actions);
  expect(decision.action).toEqual({ type: 'Wait', unitId: 'police-1' });
  expect(decision.trace?.reasonCodes).toContain('HOLD_CRITICAL_SITE_DEFENSE');
  expect(game.step(decision.action).error).toBeNull();
});

it('considers Deny before accepting more population during guaranteed resource defeat', () => {
  const game = engine();
  const state = game.getState() as GameState;
  state.resources.food = 0; state.resources.civilianGoods = 0;
  state.facilities.find(f => f.id === 'farm-1')!.workers = 0;
  state.checkpoints[0]!.waiting = 100;
  state.roadBranches.find(b => b.branchId === 'north')!.currentPolicy = 'passThrough';
  prepareTestSnapshot(state);
  expect(game.step({ type: 'LoadSnapshot', snapshot: state }).error).toBeNull();
  const observation = createAgentObservation(game.getState());
  expect(observation.strategicForecast.guaranteedDefeat.guaranteed).toBe(true);
  const actions = game.getLegalActions().filter(a => a.type === 'EndTurn' || a.type === 'SetCheckpointPolicy' && a.branchId === 'north');
  const decision = new BalancedAgent().decide(observation, actions);
  expect(decision.action).toEqual({ type: 'SetCheckpointPolicy', branchId: 'north', policy: 'deny' });
  expect(game.step(decision.action).error).toBeNull();
});


it('restores food production while public runway is short and workers remain available', () => {
  const game = engine();
  const state = game.getState() as GameState;
  state.facilities.find(f => f.id === 'farm-1')!.workers = 2;
  state.resources.food = 100;
  prepareTestSnapshot(state);
  expect(game.step({ type: 'LoadSnapshot', snapshot: state }).error).toBeNull();
  const before = createAgentObservation(game.getState());
  expect(before.strategicForecast.resources.food.runway.current.estimatedShortageTurn).toBeLessThanOrEqual(4);
  const actions = game.getLegalActions().filter(a => a.type === 'EndTurn' || a.type === 'AssignWorkers' && a.facilityId === 'farm-1');
  const decision = new BalancedAgent().decide(before, actions);
  expect(decision.action.type).toBe('AssignWorkers');
  if (decision.action.type !== 'AssignWorkers') throw Error('Expected worker restoration');
  expect(decision.action.workers).toBeGreaterThan(2);
  expect(decision.trace?.reasonCodes).toContain('RESTORE_WORKERS_BEFORE_RUNWAY_EXHAUSTION');
  expect(game.step(decision.action).error).toBeNull();
  const after = createAgentObservation(game.getState());
  expect(after.strategicForecast.resources.food.runway.current.netBurn).toBeLessThan(before.strategicForecast.resources.food.runway.current.netBurn!);
});
