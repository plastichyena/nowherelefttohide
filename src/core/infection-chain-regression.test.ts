import { describe, expect, it } from 'vitest';
import fixture from '../testing/fixtures/v155-random-seed3-actions.json';
import { GameEngine } from './engine';
import { validateInvariants } from './invariants';
import { populationLedgerTotal } from './state';
import type { GameAction } from './types';

describe('constructible facilities destroyed during an infection chain', () => {
  it('resolves the Seed 3 turn only once per site and preserves unrelated housing', () => {
    const engine = new GameEngine(fixture.seed);
    for (const [index, action] of fixture.actions.entries()) {
      const result = engine.step(action as GameAction);
      expect(result.error, `decision ${index + 1}: ${JSON.stringify(action)}`).toBeNull();
    }
    const state = engine.getState();
    const falls = state.events.filter(event => event.type === 'facility_overrun'
      && event.payload.facilityId === 'simple-farm-2');
    expect(falls).toHaveLength(1);
    expect(state.facilities.some(facility => facility.id === 'simple-farm-2')).toBe(false);
    expect(state.facilities.some(facility => facility.id === 'temporary-housing-7')).toBe(true);
    expect(state.population.cumulativeDeaths).toBe(8);
    expect(populationLedgerTotal(state)).toBe(143);
    expect(validateInvariants(state)).toEqual({ valid: true, errors: [] });
    expect(state.turn).toBe(4);
  }, 60_000);
});
