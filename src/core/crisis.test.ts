import { describe, expect, it } from 'vitest';
import { createDefaultConfig } from './config';
import { deriveCrisisSummary, deriveEndTurnRisk } from './crisis';
import { GameEngine } from './engine';
import { createInitialState, createUnit } from './state';

describe('v1.5.0 Core Crisis / EndTurn Risk projections', () => {
  it('is deterministic, public-only, and read-only for uncontained Capital infection', () => {
    const state = createInitialState(15021, createDefaultConfig({ economy: { initialZombieCount: 0, initialHunterCount: { min: 0, max: 0 } } }));
    const capital = state.facilities.find((facility) => facility.type === 'capital')!;
    capital.infected = 3;
    capital.operationalStatus = 'infected';
    const before = JSON.stringify(state);

    const first = deriveCrisisSummary(state);
    const second = deriveCrisisSummary(state);

    expect(first).toEqual(second);
    expect(JSON.stringify(state)).toBe(before);
    expect(first).toContainEqual(expect.objectContaining({
      severity: 'critical',
      reasonCode: 'capital_infection_uncontained',
      entityIds: [capital.id],
      publicFacts: expect.objectContaining({ infected: 3, healthyPopulation: capital.workers }),
    }));
    expect(JSON.stringify(first)).not.toMatch(/inheritedTarget|noiseTarget|spawnGroupId|rngState/i);
  });

  it('lists public legal Attack Charges without changing EndTurn legality', () => {
    const config = createDefaultConfig({ economy: { initialZombieCount: 0, initialHunterCount: { min: 0, max: 0 } } });
    const engine = new GameEngine(15022, config);
    const state = engine.getState() as ReturnType<typeof createInitialState>;
    const police = state.units.find((unit) => unit.type === 'police')!;
    const target = createUnit(state, 'core-crisis-target', 'zombie', { q: police.position.q + 1, r: police.position.r });
    target.hp = 1;
    state.units.push(target);
    expect(engine.step({ type: 'LoadSnapshot', snapshot: state }).error).toBeNull();
    const before = JSON.stringify(engine.getState());

    const risk = deriveEndTurnRisk(engine.getState());
    const unitRisk = risk.unitsWithAttackChargesRemaining.find((entry) => entry.unitId === police.id)!;

    expect(unitRisk).toEqual(expect.objectContaining({
      unitId: police.id,
      moveRemaining: true,
      attackChargesRemaining: 1,
      legalAttackTargetIds: [target.id],
      suppressionTargetId: null,
    }));
    expect(engine.getLegalActions()).toContainEqual({ type: 'EndTurn' });
    expect(JSON.stringify(engine.getState())).toBe(before);
  });
});
