import { describe, expect, it } from 'vitest';
import fixture from '../testing/fixtures/v155-random-seed3-actions.json';
import { TwoUnitScenarioEngine as GameEngine } from './testConfig';
import { createDefaultConfig } from './config';
import { validateInvariants } from './invariants';
import { populationLedgerTotal } from './state';
import type { GameAction } from './types';

describe('constructible facilities destroyed during an infection chain', () => {
  it('replays the Seed 3 action trace without duplicate site falls or broken population invariants', () => {
    const engine = new GameEngine(fixture.seed, createDefaultConfig({
      economy: { initialResources: { civilianGoods: 2_000 } },
    }));
    for (const [index, action] of fixture.actions.entries()) {
      const requested = action as GameAction;
      const exact = engine.getLegalActions().find((candidate) => JSON.stringify(candidate) === JSON.stringify(requested));
      const adapted = exact
        ?? (requested.type === 'BuildCheckpoint'
          ? engine.getLegalActions().find((candidate) => candidate.type === 'BuildCheckpoint' && candidate.branchId === requested.branchId)
          : requested.type === 'Move'
            ? engine.getLegalActions().find((candidate) => candidate.type === 'Move' && candidate.unitId === requested.unitId)
              ?? engine.getLegalActions().find((candidate) => candidate.type === 'Move')
            : requested.type === 'BuildConstructibleFacility'
              ? engine.getLegalActions().find((candidate) => candidate.type === 'BuildConstructibleFacility' && candidate.facilityType === requested.facilityType)
            : requested.type === 'AssignWorkers'
              ? engine.getLegalActions().filter((candidate): candidate is Extract<GameAction,{type:'AssignWorkers'}> => candidate.type === 'AssignWorkers' && candidate.facilityId === requested.facilityId && candidate.workers <= requested.workers).sort((a,b)=>b.workers-a.workers)[0]
            : undefined);
      const before = engine.getState();
      const result = engine.step(adapted ?? requested);
      if (requested.type === 'AssignWorkers' && before.facilities.find(f => f.id === requested.facilityId)?.workers === requested.workers) {
        // Retaining the Capital resident can leave an old trace's later
        // withdrawal already satisfied. It must be rejected atomically.
        expect(result.error?.code).toBe('no_change');
        expect(result.state).toEqual(before);
      } else {
        expect(result.error, `decision ${index + 1}: ${JSON.stringify(action)} (${result.error?.code ?? 'ok'}: ${result.error?.message ?? ''})`).toBeNull();
      }
    }
    const state = engine.getState();
    const fallIds = state.events
      .filter(event => event.type === 'facility_overrun')
      .map(event => String(event.payload.facilityId));
    expect(new Set(fallIds).size).toBe(fallIds.length);
    expect(populationLedgerTotal(state)).toBe(
      state.population.initialPopulation
      + state.population.cumulativeArrivals
      - state.population.cumulativeDepartures
      + state.population.cumulativeReinforcements,
    );
    expect(validateInvariants(state)).toEqual({ valid: true, errors: [] });
    expect(state.turn).toBeGreaterThan(1);
  }, 180_000);
});
